# Projection Checkpoint、水位单调推进与 staging→active 发布切换

本目录是独立夹具，Schema 为 `projection_checkpoint_fixture`。每份版本化结果代表指定项目、目标、规范化范围和策略在某 Canon Watermark 的**完整快照**。结果先由独立连接、独立事务写入隔离区，随后在另一个短事务中复核资格并发布；失败或回滚不会删除先前已经提交的隔离结果。

## 规范与三类水位

遵循 [docs/00 主题权威](../../docs/00-document-map.md)，以 [docs/09 §5.5 的 Attempt→Checkpoint 关系](../../docs/09-database-logical-model.md)、[docs/12 的 Projection 表及身份定义](../../docs/12-relational-physical-schema.md)、[docs/13 TX-PROJECTION-002/003/004](../../docs/13-database-constraints-indexes-and-concurrency.md)、[docs/14 §2.1、§4.2 的截止接纳及恢复切换规则](../../docs/14-data-lifecycle-migration-and-recovery.md) 为依据。迁移在新 Schema 内复制上一批必要的 Attempt 实现后扩展，不在运行时借用旧原型。

核对未发现阻断实现的实质冲突：docs/09 的“成功且未过期”按 docs/12—14 明确的成功接纳时间解释，即 `status=succeeded AND ended_at IS NOT NULL AND ended_at < expires_at`。**发布时不比较当前时间与 expires_at。**

| 名称 | 实际值 | 用途 |
|---|---|---|
| C：当前已提交 Canon 水位 | 本项目 committed Canon 夹具账本的 `max(canon_watermark)` | 表示当前权威来源边界；返回落后信息，不能冒充投影进度 |
| A：当前 active 投影水位 | active 指针所指 Checkpoint 的 `current_watermark`；不存在时为 null | 每次切换在发布身份锁内重新读取；不能回退 |
| R：待发布结果水位 | 不可变结果的 watermark，必须等于 Task 的实际 snapshot Commit 水位 | 完整快照覆盖的准确边界，不能由调用参数改成 C |
| G：重建目标水位 | Rebuild Record 的不可变 `target_watermark` | 重建达标门槛；与已记录的起始水位、来源一起保留 |

普通发布不要求 `R=C`。即使 Canon 已到 20，合格水位 10 的完整快照仍可成为 active=10，返回 `behind_canon=true, lag=10`。重建要求 `R>=G`，并在切换时重新比较 A：`R>A` 才推进，`R=A` 且实际摘要相同才幂等复用；`R<A` 不能切换。C 是可比较的当前 Canon 边界，G 是此次重建既定目标，A 是要保护的当前发布进度；这里不把三者含糊地称为 latest，也不静默把 G 改成 C。

本批不实现增量差量应用、连续 Outbox 消费或缺口检测。完整快照可以表达较高水位，但这**不证明跳到较高水位就已处理全部增量事件**。

## 模型、身份与当前指针

| 对象 | 本轮职责 |
|---|---|
| project、canon_commit、projection_policy、projection_outbox | 最小 committed 来源和固定超时策略；输入不可改写；不实现完整 Canon Commit/Outbox 消费 |
| projection_rebuild_record | 真实 Outbox 或 Commit 至少一个来源；项目、目标、范围、策略、起始/目标水位、治理状态、验证/切换时间、理由及实际 Attempt |
| projection_task | `origin_type=outbox/rebuild`，两个来源 FK 严格二选一；保留 snapshot Commit、准确水位、项目、目标、范围、策略 |
| projection_attempt、projection_attempt_audit | 沿用领取、锁后实时截止判定、过期/失败/重试及不可变执行历史 |
| projection_result_version | 不可变完整快照、实际内容摘要、调用者声明摘要、稳定引用、Attempt 与实际 Task 来源/范围/策略/水位绑定 |
| result_permission_fixture | 明确的 allow/deny 及依据，只模拟权限判断；不是授权系统 |
| projection_result_verification | 绑定具体结果、Attempt、来源、范围、策略、水位、实际摘要、权限依据及 `fixture-integrity-v1` 规则；结论由数据库计算 |
| publication_identity | 项目已编码的发布身份；具名唯一约束及行锁处理首次创建和并发发布 |
| checkpoint_slot | 不可变 Checkpoint 身份槽；具名四字段唯一约束 `uq_projection_checkpoint_identity` |
| publication_receipt | 经过最终复核的不可变发布/暂存/幂等/隔离收据，也是当前状态的权威夹具依据 |
| projection_checkpoint、projection_active_pointer、active_projection | 从身份槽和有效收据派生的只读当前记录/指针及实际载荷；不是独立可写的状态副本 |
| projection_publication_history | 只包含实际推进 active 的 published 收据；不会把幂等回读或暂存当作第二份有效发布 |
| projection_task_invalidation | 发布资格失效的不可变依据；保留已发生的成功与发布历史 |

身份遵循规范：

```text
(target, normalized_scope_hash, strategy_version, state)
```

`checkpoint_slot` 在这四列上有实际数据库 UNIQUE，另外 `(identity_id,state)` 唯一。当前 `projection_checkpoint` 是本夹具的读模型：每个身份仅从串行发布收据选择一个最新 active 和一个最新 staging。staging 所属 Attempt 已被激活或幂等采用时，不再返回该 staging 行，也不倒退到更老的暂存行。一个 Attempt 的 Task 输入不可变，结果与收据只能匹配该身份，因此不能推进另一组当前 Checkpoint；同一 Attempt 不同时占用 staging 和 active。

这些读模型明确属于**夹具实现**，不提出新的正式领域实体或生产物理 Schema。读模型采用 invoker 视图，所有写操作由 INSTEAD OF 触发器拒绝；当前值没有另一张可被直接 UPDATE 改高水位的可写副本。`active_projection` 只能经 active 指针关联结果，不按结果写入时间选“最新结果”。

范围规范化：去掉范围键首尾空白，空值/空白使用保留根键 `$root`；对规范 JSON 数组 `[project_id, scope_key]` 的 UTF-8 内容计算 SHA-256。项目参与规范化，因此两个项目的同名根范围不共享 Checkpoint；JSON 数组编码避免文本分隔符歧义。本轮不实现真实业务范围解析器。

普通 Task 必须来自真实 Outbox，水位/Commit 必须与其匹配。重建 Task 必须来自真实 Rebuild Record，另有实际 committed snapshot Commit 及水位，且不早于重建起始边界。Rebuild Record 可单独引用真实 Commit，无需伪造原始 Outbox。未实现完整 Task 创建与调度协议。

## 结果写入与验证

`store_result(attempt_id,payload,result_ref,claimed_hash default null)` 在独立事务写入结果；默认由数据库生成实际声明摘要，也允许测试提供错误声明来验证拒绝边界。payload 是 JSONB 完整快照夹具，包含：

```text
format=complete_snapshot_v1
project_id、target、scope、strategy、watermark
snapshot={...完整快照的稳定夹具内容...}
```

实际 `content_hash` 是 STORED 生成列，由规范 JSONB 文本的 UTF-8 SHA-256 得出。验证入口重新计算实际载荷摘要，核对生成摘要、声明摘要、Attempt 接受的 hash/ref、完整快照格式及载荷中的归属字段，读取显式权限夹具；不只是比较两份调用者传入的 hash。

版本化结果唯一键包含 Attempt ID、来源域/来源 ID、项目、目标、规范化范围、策略、水位及实际内容 hash；不使用 worker_version 作为身份。同一逻辑结果重复写入复用原结果 ID 和原绑定，不能覆盖载荷。结果引用另外唯一，不能把同一引用改指另一份内容。

`verify_result(result_id,attempt_id)` 自动生成验证记录；输入没有 verified/passed 参数。普通 INSERT 也由触发器计算结论，显式传入 passed、reason、接受时间或摘要会被拒绝；既有验证不可改写。失败记录不能翻成成功记录；相同规则下重复验证复用原记录。权限夹具的 allow/deny 及依据不可原地更换，发布仍会复核当前 Task/Rebuild 资格。

processing 或 expired Worker 仍可提交不可变隔离结果，以模拟先发生的外部副作用；只有成功资格、绑定验证和最终来源复核全部通过后，才可能形成任何 Checkpoint（包括 staging）。本夹具不验证真实图/向量内容的业务正确性。

## 发布入口、返回与治理

`publish_result(attempt_id,result_id,requested_state default 'active',reason default 'fixture snapshot publication')` 不接受项目、目标、范围、策略、水位或已验证标志作为可改写参数。这些输出全部来自实际结果、Task、来源和验证记录。

| 返回 outcome | 行为 |
|---|---|
| published | 推进唯一 active、留下有效发布历史，并完成对应 Task；重建满足条件才同事务 switched |
| idempotent | 当前同水位同实际摘要；复用原 active，不增加有效发布；该次合格工作可留下幂等收据并完成 Task/重建采用 |
| staged | 合格暂存：显式请求 staging、重建未达 G，或低于 A；不完成 Task、不 switched |
| staging_idempotent | 同水位同内容复用 staging；不替换其当前 Attempt/结果，不伪装成重建完成 |
| isolated | 比已接受 staging 更低，只保留隔离结果/收据，不回退 staging 或 active |
| watermark_conflict | 同水位与已接受 active/staging 内容摘要冲突；不新增有效状态或覆盖载荷 |
| attempt_not_eligible / attempt_result_mismatch | 非 succeeded、成功时间不合法，或结果不属于该实际 Attempt |
| source_ineligible / rebuild_ineligible | Task cancelled/abandoned/needs_rebuild、有后续失效记录，或 Rebuild 不具发布资格 |
| content_hash_mismatch / result_ref_mismatch / result_mapping / payload_mapping / snapshot_format_invalid | 实际内容、引用、归属或完整快照规则不通过 |
| permission_denied / permission_missing / verification_failed | 权限夹具拒绝/缺失，或没有绑定的通过验证记录 |

这些业务拒绝在内部以具名 `55000/publication_*` 裁决，函数将它们转换为明确 JSON outcome，调用本身正常返回，**不是 SQL 执行错误**。返回同时包含 `canon_watermark/active_watermark/pending_watermark/lag/behind_canon`。普通直接 INSERT 收据则直接收到相应 55000，不会绕过校验。

同水位摘要冲突同样保护 staging。旧 staging 被提升后不会再次占据当前 staging；更低水位也不能借显式 staging 请求让暂存水位倒退。

Rebuild 的输入绑定不可更新；本轮只提供 requested→running、未切换时 abandoned，以及有真实合格发布依据的 switched。只有 `R>=G`、不低于 A 且验证/来源有效后才写 switched、数据库切换时间、理由和实际 Attempt。空切换理由命中行级 CHECK，用于验收后续治理步骤失败时整次发布回滚；没有注入运行时故障开关。

`invalidate_task(task_id,cancelled/abandoned,reason)` 与发布竞争时先锁 Task。未完成的 pending Task 改为相应状态；已 completed 的 Task 保留原终态，追加独立不可变失效依据，后续发布被拒绝。这样不会把已发生的发布历史伪装成从未发生，也不会放宽上一批 Task 终态不可自动恢复的规则。Rebuild abandoned 不能切换，switched/abandoned 治理终态不可改写。

## 锁序、原子边界与直接 DML

实际顺序为：

```text
Task → Attempt →（若有）Rebuild Record → 发布身份唯一插入/行锁 → active/staging 身份槽（稳定 state 顺序）
```

入口只处理一个 Task、一个 Attempt、一个发布身份。继承的重试按旧 Attempt 编号→更大编号处理。两个身份槽按 state 升序创建；不在持有后序对象后回头取得前序对象锁。不提供任意多 Task 批量发布接口；调用者自行组合多个身份事务时应预先按稳定 ID 顺序取得同层锁。

首次 active 不存在时，先对 `publication_identity` 唯一键 INSERT ON CONFLICT，再取得该行锁；在持锁后重新读取当前 active 收据并裁决，覆盖“查询不存在后并发 INSERT”的窗口。不同发布身份没有额外的项目排他锁。

发布收据是新 INSERT 行，其 BEFORE 触发器调用 Task→Attempt 锁入口。普通 Attempt UPDATE 则由执行器先锁目标 Attempt，行触发器不再请求 Task；普通 Task/重建治理 UPDATE 也不反向请求 Attempt/发布身份。没有假定 BEFORE ROW 比执行器目标行锁更早。

同一 PostgreSQL 短事务中完成最终资格复核、接受收据（从而改变 Checkpoint/active 指针及发布历史读模型）、Task completed 和必要的 Rebuild switched。提交前写连接可见全部新状态，其他连接仍见旧状态；主动回滚或后续 CHECK 失败会一起撤销。成功接受 Attempt 和隔离结果写入是此前独立事务，绝不合成长期持锁的 Worker 工作流。

直接 DML 保护的关键标识：

| 标识 | SQLSTATE / 阶段 |
|---|---|
| publication_read_only | 23514；直接 INSERT/UPDATE/DELETE Checkpoint、指针、读取视图或有效发布历史 |
| publication_receipt_derived | 23514；直接伪造收据输出水位、身份、接受时间、验证 ID 或结论 |
| publication_result_mapping / publication_identity_mapping | 23514；结果或身份槽的项目/目标/范围/策略/实际来源映射错误 |
| publication_validation_derived | 23514；用 passed=true 等调用者字段伪造验证依据 |
| publication_immutable | 23514；修改、删除、TRUNCATE 版本化载荷、验证、收据、身份槽或失效历史 |
| projection_input_immutable | 23514；实际来源、Task、重建输入绑定改写 |
| publication_task_completion / publication_rebuild_switch | 23514；没有真实合格发布依据就伪造完成/切换 |
| ck_rebuild_switch_reason | 23514；已接受收据后的 Rebuild 治理行检查失败，整次发布一起撤销 |
| publication_* | 55000；直接收据 INSERT 的资格/冲突拒绝，发布函数转换为上述业务 outcome |

只读视图不能 TRUNCATE（PostgreSQL 的对象类型错误）；其底层不可变收据/身份槽另有 BEFORE TRUNCATE 保护。普通 DML 可以提交符合全部数据库检查的收据，但不能以另一套参数越过资格。没有 caller 可设置的会话开关作为凭据，所有函数固定 `pg_catalog, projection_checkpoint_fixture, pg_temp`，不使用 SECURITY DEFINER。

## 执行、验收与交付文件

固定 `postgres:18.6`、`node-pg-migrate@9.0.0`、`pg@8.23.0`；运行器和依赖锁文件复制已验证版本后仅作本原型适配。在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm prototype
node verification/verify-protected.mjs
```

运行器只启动本轮一次性容器，绑定 127.0.0.1 随机宿主机 TCP 端口，经有总期限的真实 SELECT 1 就绪检查，从空库迁移。清除旧结果，只读取本轮有效结果，保留失败状态；迁移、测试、全部场景、报告、容器及临时结果清理均成功才退出 0。所有测试均为新建直连、search_path=public、全限定业务对象、显式 READ COMMITTED，连接/语句/锁观察均有限超时。

[运行报告](verification/runner-result.md) 保存最后一次实际环境、digest、退出码、顶层与子场景实际数量、错误阶段、返回及并发 PID/wait_event/释放顺序。实际场景包括：首次/较高/幂等/冲突发布，截止后合法发布，所有非成功状态的 active/staging 拒绝，独立身份负例，真实摘要/引用/权限/验证规则，低水位及重建目标，旧 expired Worker 隔离写入，独立结果在 COMMIT/ROLLBACK/后续治理失败后的保留，以及各类首次提交竞争。

专项证据在报告的“截止前接受，截止后仍可发布”“结果先独立提交，发布 COMMIT/ROLLBACK/后续步骤失败”分组。并发测试记录实际 pg_stat_activity、具体阻塞 PID 和 A→B 提交释放顺序；不以随机 sleep 代替证据，不通过死锁重试取得通过结果。Attempt 回归另以锁等待跨截止、合法过期重试及终态/截止不可变验证保留上一批规则。

核心文件为本 README、package.json、pnpm-lock.yaml、migrations/001_projection_checkpoint_fixture.mjs、test/projection-checkpoint.test.mjs、scripts/run-prototype.mjs。`verification/file-manifest.txt` 列出全部实际新增文件。

`verification/protected-sha256-before.txt`、`protected-sha256-after.txt` 及 `hash-validation.txt` 按路径核验 docs/00—15、七个既有原型（排除 node_modules）与根文件；`.gitignore` 的原文及前后哈希单独证明仅追加指定条目。`verify-protected.mjs` 可重复运行；Git 初始/最终状态另存。未执行暂存、提交、推送、reset 或 clean。

## 模拟范围与剩余限制

本批只证明 PostgreSQL 夹具中的接纳、隔离和发布边界，不连接真实图/向量存储，不声称 PostgreSQL 事务可原子提交外部数据库。真实跨系统版本切换、增量连续应用、完整 Outbox 消费、完整权限/重建调度/Canon Commit、生产迁移及部署均未实现。完整快照内容是稳定测试数据，不等于真实投影业务质量保证。

测试中的长时间持锁仅用于截止和并发专项验证。数据库所有者禁用触发器、修改函数或 DDL 的管理能力不在普通 DML 保护范围。验收完成后停止本批，不修改正式文档或既有原型，不继续下一批。
