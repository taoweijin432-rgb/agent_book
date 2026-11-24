# Projection Attempt 领取、截止接纳、过期与重试竞争

本目录是独立数据库约束夹具，Schema 固定为 `projection_attempt_fixture`。只验证普通 Outbox 来源 Task 的 Attempt 执行历史及数据库状态转换。没有 Checkpoint、水位推进、staging→active 发布、真实 Worker 或外部图/向量投影。

按 [docs/00](../../docs/00-document-map.md) 的主题权威规则，以当前 [docs/12 的 Projection 表定义](../../docs/12-relational-physical-schema.md)、[docs/13 的 TX-PROJECTION-002/003/004 和并发规则](../../docs/13-database-constraints-indexes-and-concurrency.md)、[docs/14 §2.1](../../docs/14-data-lifecycle-migration-and-recovery.md) 为依据。TX-PROJECTION-004 仅用于确认成功接受时间与后续发布时间的边界，本轮不实现该事务。

## 最小夹具

| 对象 | 本轮字段与边界 |
|---|---|
| project、canon_commit | 项目及已 committed 的 Canon 来源；保留来源 Watermark；不实现 Canon 提交协议 |
| projection_policy | 测试可创建不同 `strategy_version/timeout_ms`；既有策略版本不可改写；不是 Worker 传入当前时间 |
| projection_outbox | Canon 来源、项目、目标、scope_hash、source_canon_watermark、strategy_version、event_hash、emitted_at；不实现完整 Outbox 生产/消费 |
| projection_task | Task ID、普通 Outbox 来源、项目、目标、范围、策略及五种 Task 状态；输入绑定不可改写；pending/needs_rebuild 下普通来源部分唯一 |
| projection_attempt | attempt_id、task_id、attempt_no、status、started_at、expires_at、ended_at、result_hash、result_ref、worker_version；另有 previous_attempt_id 和 failure_detail_ref |
| projection_attempt_audit | 首次领取、成功、失败、过期和重试审计；对应 Attempt、旧状态、新状态、数据库时间、结果/失败详情引用及前次 Attempt ID；与转换同事务 |

所有业务对象及迁移账本均位于本 Schema；不借用既有原型。ID 使用可读 `text`；Attempt ID 默认由数据库 `gen_random_uuid()` 生成。`worker_version` 仅记录软件版本，没有唯一、领取令牌或并发版本语义。

Task 夹具只接受 `origin_type=outbox` 且 Outbox FK 必填，不创建虚假的 Rebuild Record。Task 与 Outbox 的项目、目标、范围、策略严格匹配，Outbox 的项目/来源 Watermark 与 committed Canon 匹配。这里只提供供测试插入 Task 的夹具和输入保护，**没有实现 TX-PROJECTION-002 查询全部历史 Task 状态并消费复用的完整创建协议**。

## 操作入口与返回语义

函数均使用全限定调用，例如 `projection_attempt_fixture.accept_success(...)`，返回 JSON：

```text
{"outcome": "...", "attempt": {完整 Attempt 当前行} 或 null}
```

| 入口 | 参数 | 实际转换/创建 | 无操作或拒绝返回 |
|---|---|---|---|
| claim_attempt | task_id、worker_version | 无既有 Attempt 且 Task pending：`created` | 活跃 processing：`in_progress`；历史 succeeded：`already_succeeded`；permanent_failure：`not_retryable`；已到期 processing/expired/retryable_failure：`retry_required`；Task 非 pending：`task_not_executable` |
| accept_success | attempt_id、result_hash、result_ref | processing 且锁后数据库时间严格早于截止：`accepted_success` | processing 已到期：`deadline_elapsed`；相同成功 ID/结果重复：`idempotent_success`；其他终态或不同成功结果：`already_terminal`，原结果不改写 |
| expire_attempt | attempt_id | processing 且锁后数据库时间已到截止：`expired` | 截止前：`not_expired`；任意既有终态：`already_terminal` |
| record_failure | attempt_id、retryable_failure/permanent_failure、失败详情引用 | processing：`failure_recorded` | 终态：`already_terminal`；非法失败类型是 SQL 参数错误 |
| retry_attempt | 旧 attempt_id、worker_version | pending Task 的最新 expired/retryable_failure：`retried`；最新 processing 已到期时先转换 expired，再同事务创建新 Attempt | 未到期：`in_progress`；最新执行已有更新 Attempt：`superseded`，返回最新行；旧 succeeded/permanent_failure：`not_retryable`；Task 非 pending：`task_not_executable` |

返回 `created/accepted_success/expired/failure_recorded/retried` 表示**本事务内**实际创建或转换，调用者仍须 COMMIT 才持久化。`idempotent_success` 是已存在相同成功结果的幂等返回；其余业务返回不写状态、结果或新的转换审计。正常业务返回本身不抛 SQL 错误，其 SQLSTATE 为成功；报告中的失败阶段栏会区分返回拒绝与普通 DML 异常。

一次成功不自动把 Task 标记 completed；完整 Task 完成及发布协议不在本轮。pending Task 若已有成功 Attempt，再次领取不会创建新执行。失败接纳只检查当前 processing，不增加规范未定义的“失败也必须早于截止”门槛；它会写数据库实际结束时间和失败审计，绝不产生成功结果。permanent_failure 永不自动重试。

## 数据库约束与直接 DML

| 规则/错误标识 | SQLSTATE | 失败阶段或执行位置 |
|---|---|---|
| uq_projection_attempt_number | 23505 | `(task_id, attempt_no)` 唯一约束的最终保障 |
| uq_projection_attempt_processing | 23505 | `status=processing` 部分唯一索引的最终保障 |
| projection_attempt_initial_state | 23514 | INSERT：禁止直接创建 succeeded 或其他终态 |
| projection_attempt_time_authority | 23514 | INSERT 禁止显式 started_at/expires_at/ended_at；UPDATE 禁止传入假的 ended_at |
| projection_attempt_identity | 23514 | UPDATE：身份、Task、编号、前次 ID、worker_version、开始与截止时间不可改写；INSERT 的前次绑定不能伪造 |
| projection_attempt_number | 23514 | INSERT：编号必须是最新编号加一，不允许显式跳号或回填旧号 |
| projection_attempt_terminal | 23514 | UPDATE：任意已终结执行的实际覆盖或恢复均拒绝 |
| projection_attempt_transition | 23514（参数入口非法状态为 22023） | UPDATE：只能从 processing 转成受支持终态，不允许预填结果后保持 processing |
| projection_attempt_immutable | 23514 | DELETE/TRUNCATE：不得删除执行历史 |
| projection_attempt_deadline | 55000 | 直接 UPDATE：锁后时间已到截止，禁止 succeeded；成功入口转换为 `deadline_elapsed` 返回 |
| projection_attempt_not_expired | 55000 | 直接 UPDATE：锁后时间未到截止，禁止 expired；过期入口转换为 `not_expired` 返回 |
| projection_attempt_in_progress | 55000 | 直接 INSERT：存在未过期 processing，不能另建执行 |
| projection_attempt_not_retryable | 55000 | 直接 INSERT：既有最新 succeeded/permanent_failure，不允许新 Attempt |
| projection_task_not_executable | 55000 | 直接 INSERT Attempt：Task 非 pending；函数入口返回 `task_not_executable` |
| ck_projection_attempt_lifecycle | 23514 | INSERT/UPDATE：processing 结果为空；成功结果完整且 ended_at < expires_at；expired ended_at >= expires_at；失败详情完整且无成功结果 |
| ck_projection_attempt_worker、ck_projection_attempt_times | 23514 | 行级 CHECK：软件版本非空，截止晚于开始，结束不早于开始 |
| projection_attempt_failure_kind | 22023 | 失败入口：参数只允许两种失败类型 |
| projection_attempt_not_found | P0002 | 操作入口：Attempt ID 不存在；不存在的 Task 在 STRICT 查询阶段拒绝（P0002） |
| projection_input_immutable、projection_task_terminal | 23514 | 实际来源/输入修改或删除、Task 非 pending 后自动恢复均拒绝 |
| projection_source_mapping | 23514 | Task/Outbox INSERT：来源项目、范围、目标、策略或 Watermark 映射错误 |
| projection_attempt_audit_mapping、projection_attempt_audit_immutable | 23514 | 审计 INSERT 必须描述真实状态及实际时间；修改、删除和 TRUNCATE 均拒绝 |

这里的 23505 是唯一约束的最终保障，不承诺所有非法 INSERT 都先到达索引：领取/创建触发器会更早以具名 55000 拒绝重复 processing。触发器还依据持锁后的历史计算 attempt_no，因此显式旧编号通常先被 `projection_attempt_number` 拒绝。所有相关 NOT NULL 约束仍执行；普通参数缺失会得到数据库相应错误。

直接 DML 可以执行符合规则的 processing 创建或终态转换，但必须通过相同数据库保护：INSERT 的时间及编号由数据库计算；UPDATE 不接受调用者指定 ended_at，数据库在实际持有 Attempt 行锁后写入实时结束时间。合法 DML 同样由 AFTER 触发器生成审计。伪造终态 INSERT、延长截止、回填接受时间、删除历史、预写结果、恢复旧终态均不可绕过这些规则。

Attempt、来源和审计的原值 UPDATE 合法，不被误判为新转换，不新增审计。审计 INSERT 需与实际 Attempt 状态、前次关系、真实时间及详情完全匹配，且 `(attempt_id,to_status)` 唯一；正常转换已有对应审计，因此普通 INSERT 不能再伪造另一份转换历史。删除和清空历史均受保护。

## 实际锁序与取时位置

1. **领取**：先 `SELECT Task FOR UPDATE`，再检查 Task 状态、锁唯一的最新 Attempt；没有历史才创建 processing。创建触发器复用持有的 Task 锁，并再次核对历史。
2. **成功/过期/失败**：先只读不可变的 attempt_id→task_id；随后锁 Task，再锁指定 Attempt。只有取得这些锁后才执行状态 UPDATE。
3. **重试**：Task→旧 Attempt→必要时更大的最新 attempt_no；若旧 processing 已到期，先合法转换 expired，再创建新 ID、编号加一、前次 ID 指向旧执行。旧行转换、新行创建和两个审计事件在同一事务内。
4. **普通 UPDATE**：执行器先取得 Attempt 目标行锁，行触发器只验证该已锁定 Attempt，**不再请求 Task 锁**，不形成 Attempt→Task 的反向路径。INSERT 目标行尚不存在，其触发器才可先锁 Task，再锁旧 Attempt。没有采用“BEFORE ROW 比执行器行锁更早”的假设。

入口一次只操作一个 Task。重试涉及的既有 Attempt 按旧编号→更大编号排序，不批量逆序锁行。测试中同时操作不同 Task 的事务分别持有各自的 Task→Attempt 锁；若调用者自行在一个事务中组合多个 Task 操作，需先按稳定 `task_id` 升序锁定所有 Task，再按该顺序调用；本轮没有提供任意多 Task 批量调度接口，也不承诺任意外部显式加锁/DML 组合无死锁。

最终判定在 `guard_attempt_update` 中：执行器已持有 Attempt 行锁后，用一次 `clock_timestamp()` 取得 `decision_time`，检查当前 processing 并执行以下规则，然后将**同一个时间值**写为 ended_at：

```text
succeeded: decision_time <  expires_at
expired:   decision_time >= expires_at
```

没有用事务开始时间、语句开始时间、Worker 本地时钟、调用参数或可伪造的会话开关授权转换。操作入口没有“当前时间”或“成功接受时间”参数。所有 14 个函数固定函数级 `search_path=pg_catalog, projection_attempt_fixture, pg_temp`，均为 invoker，不使用 SECURITY DEFINER。

成功接受时间与 COMMIT 完成时间分开：截止前状态转换合法后，稍后 COMMIT 即使已过截止也成功；提交前其他连接仍只看到 processing。ROLLBACK 则连同结果和成功审计一起撤销。没有在延后触发器中拿提交时当前时间重新否定已接纳成功。

## 运行与验收证据

固定 PostgreSQL `18.6`、`node-pg-migrate@9.0.0`、`pg@8.23.0`；沿用联合 Evidence 原型运行器及锁文件，只适配目录、数据库、Schema 和报告文案。

在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm prototype
node verification/verify-protected.mjs
```

运行器只创建本轮唯一命名的一次性容器，绑定 `127.0.0.1` 随机 TCP 端口；从宿主机执行有统一 30 秒期限及连接清理预留的 SELECT 1，再从空库迁移。先删除旧结果，迁移成功才启动测试，只解析本轮有效结果；保留迁移/测试失败状态，最后删除本轮容器和临时结果。迁移、测试、全部场景、结果有效性、报告写入和资源清理均成功才退出 0，不执行全局 Docker 清理。

所有测试连接都是新建直连，`search_path=public`，业务对象名全限定；事务显式 READ COMMITTED。连接、语句、锁等待和观察均有限超时。测试策略的短时长仅用于夹具；过期由数据库 `clock_timestamp() >= expires_at` 查询确认，短间隔轮询只控制频率，不替代时间或锁等待证据。

[verification/runner-result.md](verification/runner-result.md) 保存最后一次实际运行的环境、镜像 digest、退出码、顶层/子场景实际数量、错误阶段、SQLSTATE/约束以及具体 PID 和返回值。数量来自执行累计，不预填通过数；Node 总 test 数包含顶层与子场景。

| 验收组 | 证据 |
|---|---|
| A 生命周期 | 首次领取、重复领取、相同软件版本不同 Task、非执行状态、完整成功结果、截止拒绝、清理前超时、过期、成功不自动失效、两类失败 |
| B 重试/不可变 | 旧执行不改回 processing，新 ID/递增编号/同 Task/前次关系；旧 Worker 回写隔离；事务主动回滚和新行 CHECK 失败均回滚过期及重试；普通 DML 和原值 UPDATE |
| C 锁等待跨截止 | Task 锁、Attempt 锁分别阻塞；pg_stat_activity 的 query_start 证明请求在截止前发起；记录 wait_event、具体阻塞 PID；数据库时间跨截止才释放锁，返回 deadline_elapsed，无成功结果 |
| C 接受与提交边界 | 截止前 accepted_success，未提交时独立观察仍 processing/无结果/无成功审计；数据库跨截止后 COMMIT 仍保留 ended_at < expires_at；对应 ROLLBACK 无成功残留 |
| D 并发 | 同 Task 两领取者、两清理者、成功/过期两种先锁顺序、两重试者、旧 Worker/重试两种先锁顺序；记录返回与 A→B 释放/首次提交顺序及最终独立回读 |
| D 独立 Task | 领取、成功、重试三组各使用独立写连接和观察连接；首次异步 COMMIT 均成功，无死锁重试 |
| E 路径/审计 | public 直连合法/截止/终态；实际 pg_proc、唯一约束、部分唯一索引、触发器、严格比较符号及 Schema 内 FK；状态及审计同事务回滚；来源绑定保护 |

## 文件与保护范围

- 核心文件：本 README、package.json、pnpm-lock.yaml、migrations/001_projection_attempt_fixture.mjs、test/projection-attempt.test.mjs、scripts/run-prototype.mjs。
- `verification/runner-result.md`：最终实际运行报告。
- `verification/protected-sha256-before.txt`、`protected-sha256-after.txt`：docs/00—15、六个既有原型的所有文件（排除 node_modules）、根文件的前后 SHA-256。
- `verification/gitignore-before.txt`、`gitignore-before.sha256`、`gitignore-after.sha256`：原始 .gitignore 及前后哈希；必须精确等于原文追加指定条目。
- `verification/verify-protected.mjs`、`hash-validation.txt`：按路径比较哈希和文件集合的可重复检查及结果。
- `verification/git-status-before.txt`、`git-status-after.txt`：初始及最终 Git 状态。
- `verification/file-manifest.txt`：实际交付文件清单。

本轮只新增本目录，以及根 `.gitignore` 的 `prototypes/projection-attempt-lifecycle/.test-results.json` 条目；保留用户已有内容。不修改正式文档、六个既有原型、根依赖或业务模块，不暂存、提交、推送、reset 或 clean。

## 未覆盖范围

本原型只保护数据库中的 Attempt 接纳与执行历史，**不能证明外部图或向量存储不会被旧 Worker 覆盖**。Checkpoint、来源资格/水位推进、隔离结果及 staging→active 发布切换属于下一批，本轮没有实现或验证。也不实现真实 Worker 服务、外部投影数据库、完整 Outbox 消费、完整 Canon Commit、权限系统或生产部署。数据库所有者禁用触发器、修改函数/DDL 等管理权限不在普通 DML 保护范围。

长时间持锁事务仅用于专项验收跨截止场景，不是生产 Worker 执行模式。没有展开生产负载、任意多 Task 调度或外部副作用基准；业务执行仍应放在数据库短事务之外。验收完成后停止本批。
