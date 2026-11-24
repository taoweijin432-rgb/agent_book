# Canon Commit 幂等与正文提交原子性

本批实现 docs/08 §2.8—2.13、§3—4 的**首次正文提交最小闭环**，承接 docs/09—11 的当前候选/审批/提交基数、docs/12 §3.2 的 Canon 表与正文类型支撑、docs/13 TX-CANON-001/TX-PROJECTION-001 及项目锁序、docs/14 的不可变历史。按 docs/15 的隔离空库、真实 COMMIT、独立连接和有限并发验收方式验证；DOC-15 的环境描述是历史计划，本次按用户指定固定版本运行，不修改正式文档。未发现影响本批正确性的实质规范冲突。

仅支持单 Canon 主分支、一个 Candidate 对一份正式正文、尚无正式版本的正文身份、结构化集合明确为空、全部必需 Outbox 同事务写入。成功只在调用方真实 COMMIT 且延后约束通过后持久化。它不证明完整 Canon Commit、正文修订、结构化对象映射或真实投影已经完成。

## 交付与执行

独立目录 `prototypes/canon-commit-atomic-core/`，独立 Schema `canon_commit_atomic_fixture`。固定依赖 `node-pg-migrate@9.0.0`、`pg@8.23.0`，镜像 `postgres:18.6`。

```sh
pnpm install --frozen-lockfile --ignore-scripts --offline
pnpm prototype
node verification/verify-protected.mjs
```

本次离线安装复用已有 36 个缓存依赖，没有升级。执行命令、实际 Server/Node/pnpm/Docker、镜像 digest、TCP 就绪端口、迁移/测试/最终退出码及清理结果见 [运行报告](verification/runner-result.md)。[文件清单](verification/file-manifest.txt) 列出实际交付；[保护核验](verification/hash-validation.txt) 列出路径、内容、精确追加检查。

运行器从上一原型复制，只适配本目录名称、数据库、Schema 和范围说明：清除旧临时结果；启动本轮独占容器和随机 localhost 端口/密码；在有限期限内用宿主机 TCP `SELECT 1` 确认可用；新建空数据库、完整迁移、真实测试、结果有效性检查；始终清理本轮容器与临时结果并保存报告。失败退出码不会被成功清理覆盖，不全局清理 Docker。

## 规范步骤与实现对应

| 规范/本批顺序 | 数据库实现 |
|---|---|
| 1 先锁项目范围；DOC-13 §5 | `commit_text` 先调用 `lock_novel`，READ COMMITTED 下锁 `novel`；真实项目由不可变 Candidate→Workflow→Task 回查 |
| 2 同项目/key 幂等；DOC-08 §3 | 先查 `canon_commit(project_id,idempotency_key)`，数据库重算请求摘要；历史成功同摘要优先返回，异摘要拒绝 |
| 3 当前候选、历史版本与审批；DOC-08 §2.9 / TX-CANON-001 | 新请求的 `canon_commit` BEFORE INSERT 触发器执行 `lock_scope` 与 `check_admission`，不接收预检查通行证 |
| 4 当前成功水位；DOC-13 原子步骤 8 | `current_watermark` 只读取本项目成功记录的最大成功序号；没有记录为 0，精确核对请求输入边界 |
| 5 成功序号；DOC-08 §3 | 持有 Novel 锁后分配最大成功序号 + 1；项目内唯一，插入守卫拒绝跳号；不用独立序列代表成功水位 |
| 6 一个正式正文及 Item；DOC-12 §3.2 | `canon_commit`、`canonical_text_version`、`canon_commit_item`、`canon_commit_item_text_target`；真实正文和数据库重算 hash |
| 7 全部 Outbox；TX-PROJECTION-001 | 读取不可变投影配置，两类夹具目标均写入 `projection_outbox`，完整集合由数据库延后检查 |
| 8 成功状态、当前正文、水位与失效 | `committed` 行、正文当前视图、水位派生读取；Commit AFTER INSERT 同事务追加受影响 Approval 失效和最小提交审计 |
| 9 调用方真实 COMMIT | 五张核心表的 `atomic_completeness` 延后约束触发器及延后正文 FK，在真实 COMMIT 阻断缺失/错绑；失败整体回滚 |
| 不可变历史；DOC-14 | 核心及上游历史 UPDATE/DELETE/TRUNCATE 守卫，当前视图拒绝独立 DML；成功历史不随后续 Approval 失效而改变 |

`target_type='canonical_text'` 保留规范的目标类型；其实际目标实体是 `canonical_text_version`，通过专属支撑表确认，未把两个术语合并。正式正文落库不产生客观 Canon Fact。

## 复制的准入模型与真实水位

准入所需的 Novel、Design、Task、Bundle、Workflow/选择历史、Generation、Candidate、Validation/硬问题、Approval、Invalidation 和审计已复制到本迁移，运行时不引用旧原型。保留正文和上下文实际 hash、不可变来源、人工编辑前序/依据、全部审批规范绑定、ABA、请求幂等及实时适用性检查。

新增 `chapter`、`scene` 和 `canonical_text_identity_root`。Task 固定 Scene；正文身份固定 Chapter/Scene，夹具要求 Scene 非空。Task/Candidate/Commit/正文身份必须属于同项目和同场景。Workflow 当前候选/版本依旧从不可变选择历史派生。正文身份的当前版本视图从同身份下唯一的首次成功版本读取；没有另一个可漂移的可变指针。

上一批 `baseline_history.canon_watermark` 已移除，`change_baseline` 不再接受水位参数，只改变 Design/规则/审批策略。`current_baseline.canon_watermark` 是兼容准入读取的**派生列**，调用同一 `current_watermark`，不是独立存储。`canon_watermark` 视图也使用同一读取函数。只有通过数据库提交边界的成功记录能对其他连接推进当前 Canon。

`canon_commit` 仅记录本批成功分支，不实现完整 preparing/failed 生命周期账本。在事务内它暂记 `result='committed'` 并使本连接看见暂定水位；其他连接不可见。若正文、Item、Outbox 或延后约束失败，该行、失效和审计全部回滚，不能成为持久成功记录。内部审计 identity 序列与 Canon 成功序号完全分开。

成功插入时，影响范围明确为该项目现有 Approval，逐个追加 `(approval_id,'canon_advanced',commit_id)` 失效记录；选择和基线变化保留原来的 Workflow/项目失效范围。失效不可撤除，旧审批不复活。历史 Commit 保留当时已通过的输入与审批绑定；后续当前水位和审批变化不会倒改已提交历史。

## 请求契约与摘要编码

入口：`canon_commit_atomic_fixture.commit_text(project_id, idempotency_key, request_jsonb)`。request 必须且只能包含：

```json
{
  "digest_spec_version": "canon-request-v1",
  "mode": "initial_text",
  "workflow_id": "真实 Workflow ID",
  "candidate_version_id": "真实 Candidate ID",
  "selection_version": 1,
  "approval_id": "真实 Approval ID",
  "input_canon_watermark": 0,
  "canonical_text_identity_id": "真实正文身份 ID",
  "projection_config_id": "fixture-targets-v1",
  "structured_outputs": {
    "events": [], "facts": [], "state_transitions": [],
    "assertions": [], "temporal_relations": [], "mappings": []
  }
}
```

所有 ID 必须为非空字符串；选择版本和水位为非负范围内的 JSON 整数，选择版本必须大于 0。mode 只允许 initial_text。已有正式版本的目标、replace/revision 模式、非空或不完整结构化集合、batch、未知/遗漏字段、未知摘要版本均显式拒绝。调用方不能传 targets 来减掉目标，传 payload_hash 也会因未知字段拒绝。

`canonical_request` 构造有版本的 JSONB 数组：`["canon-request-v1", project_id, 原始受限 request, 数据库回查的不可变输入对象]`。然后对 PostgreSQL 18 JSONB `::text` 的实际 UTF-8 字节计算 SHA-256，保存为 `payload_hash`。数组顺序、JSONB 对象规范化、UTF-8 和小写十六进制是本夹具编码规则；不承诺跨数据库通用编码。

| 摘要覆盖内容 | 来源 |
|---|---|
| Candidate 身份、实际正文 hash | 数据库 Candidate，重新计算正文 SHA-256 |
| Workflow、请求选择版本 | request 及不可变 Candidate 归属；**不是当前选择版本** |
| Task Version、Scene、Bundle 与实际 Bundle hash | 固定来源链 |
| Approval ID、七项绑定、决定 | 不可变 Approval Record |
| Validation ID、Candidate/Design/Canon/规则/校验器版本、输入 hash、结果 | 完整不可变 Validation 行 |
| Design 身份和内容 hash、规则内容 hash、审批策略版本和内容 hash | 固定 Task/Validation/Approval 指向的版本 |
| 请求预期水位与 Task 输入水位 | request 与不可变 Task；**不是重新读取的当前水位** |
| 目标正文身份、Chapter、Scene | 不可变身份根记录，排除当前版本指针 |
| 明确为空的结构化集合 | request 的六个空数组 |
| 必需投影配置身份和完整目标/策略清单 | 不可变 `projection_target_config` |

正文 `content_hash` 和请求 `payload_hash` 是不同摘要。本批继承的 Validation 使用 `validation-input-v1`，对 Candidate ID/正文 hash、Workflow/Task、Bundle ID/实际内容 hash、Task JSON、Design ID/内容、输入水位、规则 ID/内容和固定校验器版本的有序 JSONB 数组计算摘要，不能只用正文 hash 代替。

当前水位、当前选择、现有 Invalidation、当前适用规则/策略不进入成功请求的摘要重解释。重放先对相同不可变请求重新算摘要并比较历史记录，再返回原 Commit、正文版本、Item、Outbox 身份；原审批失效、水位/选择/策略改变不阻断历史重放。新 key 则必须重新通过全部当前准入，陈旧输入不自动重基。

## 数据库防绕过与锁序

所有函数固定 `search_path=pg_catalog, canon_commit_atomic_fixture, pg_temp`，没有 SECURITY DEFINER、会话开关、客户端内部授权标记或生产入口故障参数。保护针对触发器正常启用时的普通 DML，不声称抵抗数据库所有者关闭约束、改函数或修改 Schema。

锁序为：Novel → 项目内 Workflow（ID 排序）→ 选择历史（Workflow/版本排序）→ Candidate（ID）→ Approval（ID）→ Validation（ID）→ 目标正文身份 → Commit。幂等历史读取在 Novel 锁后优先处理。请求摘要回查只读不可变输入。新请求经过准入后，先核对目标的真实项目/Scene，再锁该正文身份，避免对错误项目目标拿后序锁。

`commit_guard` 在**任何 canon_commit INSERT** 上检查数据库摘要、请求与冗余列绑定、真实当前水位、选择/审批/Validation/输入资格、正文目标归属、首次提交限制及下一序号。直接 INSERT 不能跳过正式准入。新子行也先拿同项目稳定前序锁；首次失效记录不存在时，Novel 仍是共同锁对象。

唯一约束保证每个项目/key 唯一、项目成功序号唯一、每 Commit 一个正文/Item、同身份首次版本唯一、支撑关系两列唯一，以及规范要求的 `(canon_commit_id,target,strategy_version)` Outbox 唯一。

五张核心表均有 `DEFERRABLE INITIALLY DEFERRED` 完整性触发器，在真实 COMMIT 处确认：正文与 Commit/身份/Candidate 实际正文及 hash 一致；正文 Item 的 canonical_text 类型/目标正确；专属支撑恰好匹配；Outbox 集合、范围、策略、成功来源水位、事件载荷/摘要全部匹配。正文循环 FK 也延后检查。缺正文可能先由 `commit_text_version_fk` 拒绝，报告真实约束，不冒充后续完整性错误。

普通 DML 可以逐步写入**完整且有效**的同一事务，该正例实测成功；部分事务不能持久化。不可变守卫拒绝核心/输入/审批/选择历史 UPDATE、DELETE、TRUNCATE；当前正文/水位/基线视图只读。不存在可直接改为 valid 的审批状态，也不以 Workflow approved 或历史预检查审计代替提交复核。

## 必需 Outbox

数据库配置 fixture-targets-v1 固定两个不同目标：

| 夹具目标 | 策略 |
|---|---|
| fixture_graph | fixture-graph-v1 |
| fixture_vector | fixture-vector-v1 |

配置不可变，CHECK 不允许缺失或替换此集合；配置身份和实际清单进入请求摘要。正文提交函数按数据库清单写入，客户端没有省略目标的入口。延后检查再次比较精确集合，空集合、少一个、多一个均失败。

范围使用实际 Scene ID；scope_hash 为 `["fixture-scene-scope-v1",project_id,scene_id]` JSONB 文本的 SHA-256。事件固定类型 fixture_canon_text_committed_v1，绑定项目、Commit、正文版本、Scene、成功来源水位、目标、策略、配置及请求摘要；event_hash 重算实际事件 JSONB 文本。没有创建 Projection Task/Attempt，也没有写外部图或向量系统。

## 返回、错误与事务阶段

返回包含 result、Commit/正文版本/Item/Outbox 原身份、成功序号/水位、请求摘要及 `requires_outer_commit=true`。新请求的 result 为 `created_in_transaction`，同请求重放为 `replayed`。函数不执行 COMMIT；调用方必须观察真实 COMMIT 的结果，不能缓存未持久化响应当成功记录。回滚后同 key 重试产生新的输出身份。

| 阶段 | 典型标识 |
|---|---|
| 请求形状/范围 | unknown_request_field、missing_request_field、unknown_digest_version、revision_not_supported、structured_outputs_not_supported、batch_not_supported |
| 幂等 | commit_idempotency_conflict；同 key 同摘要返回原输出 |
| 新请求准入 | stale_canon_watermark；admission_ 前缀加实际首个准入原因；例如 admission_approval_invalidated、admission_selection_version_conflict |
| INSERT 守卫 | request_payload_hash、commit_request_binding、commit_text_scope、commit_sequence_invalid、commit_approval_policy |
| 真实 COMMIT | commit_text_missing / commit_text_version_fk、commit_text_binding、commit_item_missing、commit_item_binding、commit_text_support_missing、commit_outbox_set、commit_outbox_binding |
| 历史修改/当前状态伪造 | immutable_表名、readonly_视图名 |

业务拒绝 SQLSTATE 为 P0001，constraint 与原因标识一致；FK、唯一和 CHECK 保留实际 23503、23505、23514。错误不被捕获成成功返回。测试记录提前写入守卫与真实 COMMIT 失败的区别；所有失败后都用独立连接检查输出、当前指针、水位、失效和审计状态。

## 五组验收与证据

实际数量、各场景状态、错误和阻塞 PID 均以 [运行报告](verification/runner-result.md) 为准。本次完整运行 5 个顶层测试、79 个参数化子场景全部通过（A 14、B 7、C 5、D 11、E 42），最终退出码 0。顶层与参数化子场景分别统计；每个逻辑子场景可能含多个断言/操作，不重复计数。

- A：水位 0→1→2、完整正文/Item/两类 Outbox；已有身份修订、六类非空结构化集合、批量/未知字段/摘要版本/省略目标拒绝。
- B：预检查通过后改选择或失效 Approval；ABA 保留失效，新审批不能混用旧选择；旧输入水位的新 key；Design、规则、审批策略变化后的事务内复核。
- C：函数返回后 ROLLBACK；测试专用触发器在正文已写后阻断 Item、在第一条 Outbox 已写后阻断第二条；真实 COMMIT 缺 Outbox 或追加额外目标失败；逐项确认无半成品且同 key 可重试。
- D：成功重放不增加计数；水位/选择/规则/策略变化后仍重放原身份；同 key 异摘要；同请求 A COMMIT/ROLLBACK 两种竞争；不同 key 同水位仅一人推进；不同项目同 key 首轮并行提交成功。
- E：完整有效的直接 DML 正例；缺正文/Item/支撑/目标集合，真实外项目/场景/正文目标错绑、伪造摘要/选择/序号/失效审批，Outbox 内容/范围/水位/摘要/唯一约束；核心历史更新/删除/清空；实际函数路径、延后约束、无投影执行表及无故障设施残留。

故障触发器只在测试中创建，finally 删除触发器和函数，不向提交入口增加故障开关，不关闭业务约束。异常 detail 证明所属 Commit 在故障点的 `(text_count,outbox_count)` 分别为 `(1,0)` 和 `(1,1)`；回滚后独立连接状态与之前一致。缺项测试先确认所有 INSERT 返回，再执行真实 COMMIT 并捕获目标错误，随后同 key 重试成功。

竞争使用三个独立 pg.Client，固定 `search_path=public`、全限定业务对象、显式 READ COMMITTED。连接超时 5 秒、statement_timeout 8 秒、lock_timeout 6 秒，阻塞观察最多 4.5 秒。观察者确认 `pg_stat_activity.wait_event_type='Lock'` 且 `pg_blocking_pids(waiter)` 含实际 blocker 后才释放 A；记录 PID、等待事件、事务/查询时间、释放方式和最终输出。没有随机 sleep 猜测竞争，也不靠死锁重试。

## 保护范围与限制

保护清单在任何修改前生成，最终重新遍历比较 SHA-256、路径集合、新增、遗漏和重复路径。范围覆盖 docs/00—15、九个既有原型（含 canon-commit-preconditions）、根依赖及其他仓库文件；排除 .git、node_modules、本新增目录及指向本目录的缓存别名。沿用修改前口径跟随旧原型缓存符号链接，因此清单按路径计数，多个别名不等于多个物理文件。`.gitignore` 按原始字节加唯一指定行单独校验。没有重建修改前基线来掩盖差异，没有 Git 暂存/提交/推送/reset/clean。

本轮没有剩余验收阻断。未实现完整 Canon 协议、非空结构化对象/Assertion/Evidence/Mapping、正文修订/替代/反向补偿、跨场景批量提交、Publication、Projection Task/Attempt 或真实投影、Agent/界面、自动审批/例外授权、真实权限/生产 Schema。Design、规则、硬问题和人工主体仍为明确的最小输入夹具；这不是完整小说语义校验。
