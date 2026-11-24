# Canon Commit 当前候选、审批绑定与提交准入原型

本目录是独立 PostgreSQL 夹具，Schema 为 `canon_commit_precondition_fixture`。只验证正式提交前的输入资格。`check_admission` 通过表示本次短事务检查成立；它不是预约、可复用许可证或 Canon 成功。锁释放后，后续正式提交必须在自己的原子事务内重新检查。

依据当前 docs/00、08—14 的候选、Workflow、审批、不可变输入和前置锁序。没有修改规范或八个既有原型。本原型选择保守的项目内串行化，便于观察状态与并发证据，不作为生产 Schema、吞吐量或完整鉴权方案。

## 运行与交付

在本目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm prototype
node verification/verify-protected.mjs
```

固定 `node-pg-migrate@9.0.0`、`pg@8.23.0`，使用 `postgres:18.6`；实际 Node、pnpm、Docker、数据库版本、镜像 RepoDigest、TCP 就绪端口、迁移/测试/最终退出码和清理结果由 [运行报告](verification/runner-result.md) 记录。

运行器沿用上一原型，仅适配名称、Schema、数据库和范围声明：删除旧临时结果；创建本轮独占、随机密码、仅绑定 localhost 随机端口的容器；有限期限内通过真实 TCP `SELECT 1`；新建空数据库迁移；执行测试；校验本轮结果结构；始终清理本轮容器和临时结果并保存报告。迁移失败、测试失败、缺失/无效结果或清理失败都不能返回成功。不做全局 Docker 清理。

实际文件见 [清单](verification/file-manifest.txt)；受保护文件前后摘要、文件集合及 `.gitignore` 精确追加见 [核验记录](verification/hash-validation.txt)。排除各原型 `node_modules`，保护 docs/00—15 全部文件、八个旧原型全部其他文件及根级常规文件；`.gitignore` 单独比较原字节加唯一指定行。没有 Git 暂存、提交、推送、reset 或 clean。

## 输入关系与不可变边界

| 对象 | 本夹具的关系与边界 |
|---|---|
| `novel` | 项目身份，也是所有相关操作共用的稳定锁对象 |
| `author_design_revision` | 项目内设计修订；冻结/草案都可作为负例输入，全部记录追加不可变 |
| `baseline_history` / `current_baseline` | 明确的测试基线历史/只读当前视图；模拟 Design、Canon 水位、规则和审批策略，不是 Canon 账本或生产配置系统 |
| `scene_task_version` | 固定项目、Design Revision、输入 Canon 水位和任务实际 JSON 内容 |
| `context_bundle` | 绑定 Task Version，保留实际上下文正文与 SHA-256；不可覆盖 |
| `workflow_identity` / `workflow_run` | 一个 Task Version 的 Workflow 身份及其只读当前视图 |
| `generation_run` | 固定 Workflow、具体 Bundle 和该 Bundle 的输入摘要 |
| `candidate_version` | 固定 Workflow、具体 Bundle、实际正文/hash 和来源；模型候选必须有 Generation；人工编辑必须有同 Workflow 前序及非空修改依据 |
| `candidate_selection_history` | `(workflow_id, selection_version)` 唯一；保留前序/新 Candidate；取消用新 Candidate 为 NULL 表达 |
| `validation_run` | 固定具体 Candidate、Design、Canon、规则、校验器版本、完整输入摘要和夹具结果；本轮不实现运行状态推进 |
| `validation_hard_issue` | 不可变的最小硬问题观察，`resolved=false` 阻断；若后追加未解决问题，准入实时复核仍阻断 |
| `approval_record` | 只含正式七项绑定、请求键、普通人工决定、主体/理由/时间；没有 Workflow 归属、选择版本或可变有效状态 |
| `approval_invalidation_record` | 正式幂等身份 `(approval_id, reason_code, trigger_version)`，另存触发类型和发现时间；不可改写/删除 |
| `operation_audit` | 操作和审批依据审计；审批时选择版本放在 `selection_version_evidence`，明确是夹具审计证据，不改变 Approval 字段契约 |

Workflow、Candidate 的 Bundle、存在的 Generation 必须对应同一个 Task Version，因此继承项目一致性。Generation 必须属于 Candidate 的 Workflow 且使用同一个具体 Bundle。人工编辑可明确 `direct` 使用新 Bundle，或 `inherited` 继承前序的同一 Bundle；两种正例均测试。

当前指针采用单一历史事实实现：`workflow_run.current_candidate_id/current_selection_version` 从最新选择历史即时得到；不另存可与历史漂移的可变副本。追加一条合法历史就是同事务更新指针和版本。历史插入的数据库触发器校验当前版本 + 1、真实前序、候选归属及非空变化，随后追加失效与审计。只读视图拒绝指针、版本、state 的独立 DML；原始身份也不可改绑。`state` 仅显示 selected/unselected，不实现完整 Workflow 生命周期，也不把它当审批或提交状态。

所有基础记录都有拒绝 UPDATE/DELETE 和 TRUNCATE 的触发器。通过合法 INSERT 与五类操作仍能成功，未使用禁止所有变化、客户端布尔标记或可伪造会话开关。重复合法失效可用 `ON CONFLICT ... DO NOTHING`；普通重复 INSERT 由唯一约束拒绝。

## 摘要协议

正文和 Bundle 摘要为实际 UTF-8 字节的 SHA-256、小写十六进制。写入与准入都重算；不是仅比较调用方的两个摘要。

Validation 输入采用 `validation-input-v1`。`validation_input_hash` 对以下有序 JSONB 数组的 PostgreSQL 18 `::text` 表示做 UTF-8 SHA-256：

```text
[
  "validation-input-v1",
  Candidate ID, SHA256(实际正文), Workflow ID, Task Version ID,
  Bundle ID, SHA256(实际 Bundle 内容), 实际 Task JSON,
  Design Revision ID, 实际 Design JSON,
  输入 Canon Watermark, Rule Set Version, 实际 Rule JSON,
  "fixture-validator-v1"
]
```

数组顺序和 PostgreSQL JSONB 文本规范化属于本夹具协议；不声称这是跨数据库通用摘要编码。改变协议应增加摘要版本和新 Validation，不应猜测旧摘要。Candidate 身份也进入摘要，相同正文的两个 Candidate 得到不同校验输入摘要。Generation 来源链和人工编辑前序另行核对且不可变，不能靠摘要绕过。

## 操作、返回与失败阶段

下表函数均需全限定 Schema，连接使用 `search_path=public`、显式 `BEGIN ISOLATION LEVEL READ COMMITTED`。函数级路径固定为 `pg_catalog, canon_commit_precondition_fixture, pg_temp`，没有 `SECURITY DEFINER`。

| 操作 | 参数与结果 | 主要错误/阶段 |
|---|---|---|
| `select_candidate` | Workflow、新 Candidate（NULL 取消）、预期选择版本；返回 changed 和新版本，或 no_change | `selection_version_conflict`、`selection_candidate_workflow`；写入历史也核对 `selection_previous_mismatch`、`selection_no_change` |
| `record_approval` | Candidate、request_key、七项绑定 JSON、approved/rejected、actor、reason；返回 created/replayed 和原始 Approval | `approval_request_conflict`、`approval_binding_shape`、`approval_not_current`、每项绑定错误、适用性错误；失败不写 Approval/依据审计 |
| `invalidate_approval` | Approval、原因、触发类型、触发版本；返回 created/replayed 和原失效记录 | 同正式身份但类型不一致：`invalidation_identity_conflict` |
| `change_baseline` | 项目、预期基线版本、Design、模拟 Canon、Rule、Policy；返回新基线 | `baseline_version_conflict`、`baseline_design_project`、`baseline_no_change`、`fixture_watermark_regression` |
| `check_admission` | 项目、Workflow、Candidate、Approval、预期选择版本；返回 accepted、完整 reasons、actual、scope | 业务不合格返回 false，不隐藏其他原因；不存在 Candidate 立即返回 candidate_missing；隔离/锁错误仍抛出 |

业务拒绝 SQLSTATE 为 `P0001`，`constraint` 等于原因码；数据库 CHECK/NOT NULL/唯一/FK 拒绝保留实际 SQLSTATE。禁用的 auto_approved/force_override 为 `23514 / approval_record_decision_check`。不可变记录为 `immutable_<table>`，只读视图为 `readonly_<view>`。超时/锁错误不重试为成功。

审批绑定错误分别是 `approval_content_hash`、`approval_bundle`、`approval_design`、`approval_canon`、`approval_validation`、`approval_policy`。Candidate ID 与函数请求身份不一致为 `approval_binding_shape`；准入跨 Candidate 则为 `approval_candidate_identity`。表插入早期可能返回 `task_design_project`、`bundle_task_chain`、`candidate_generation_chain`、`candidate_actual_hash`、`bundle_actual_hash`、`validation_snapshot`、`validation_input_hash`，测试报告标明实际失败阶段；不临时关闭触发器来伪造前置状态。

输入校验 FK 全部指向实际记录；归属负例使用真实的其他项目/Workflow/Task/Bundle/Generation/Design/Validation/策略对象。缺审批是专门的检查入口负例，不以悬空 FK 代替错绑测试。

## 有效性、失效和幂等算法

审批创建时先按 Candidate 真实归属加锁。新请求必须是当前最终 Candidate，七项绑定与实际输入一致。普通批准还要求 Design frozen 且当前适用、输入 Canon 精确等于当前模拟水位、Validation pass、规则仍适用、输入摘要一致且没有未解决硬问题。拒绝决定可以保留，但永不取得准入资格。actor/reason 是显式模拟的人工依据，不是已实现的身份授权。

同 Candidate/request_key 的完整绑定、决定、actor、reason 相同则返回原 Approval；任一不同显式冲突。请求重放先于新审批资格校验，因此历史失效审批仍可被读回，但返回不会写新选择、Approval、失效撤销或审计，不恢复有效性。重新审批必须换请求键并得到新 ID。

选择变化的影响范围是该 Workflow 全部历史 Approval；基线变化影响该项目全部历史 Approval。触发器在同一事务追加失效与审计；原决定/输入不变。这是明确保守的夹具范围。失效不能删除，因此 A→B→A 不恢复旧 A Approval；新的审批才可使用。基线规则回换也不能使历史 Approval 复活。

准入在持锁后重新读取真实 Candidate 归属、当前选择/版本/最新历史、Task/Bundle/Generation、实际正文/Bundle/校验输入摘要、Approval 七项绑定和决定、全部 Invalidation、Validation 状态与硬问题、冻结 Design、当前模拟 Canon 和规则/审批策略。有效性是这些条件的交集，没有权威 valid 状态。即使没有失效行，`candidate_reasons` 仍直接比较当前 Design/Canon/规则，审批策略也独立比较。

`actual` 返回真实项目/Workflow/Task/Candidate、当前选择历史和版本、正文/Bundle 摘要、Generation、Design 状态、绑定输入水位、当前基线、Approval 绑定/决定、失效依据、Validation 和重算输入摘要。检查审计仅保存本次结果；入口不接收任何历史审计作为许可证，复制/伪造一条 accepted 审计也不能通过后续检查。

## 实际锁序与并发证据

`lock_scope` 首先检查 READ COMMITTED，再锁实际项目的 `novel` 行，然后固定按以下顺序加 `FOR UPDATE`：

```text
Novel
→ 项目内 Workflow identity（workflow_id 排序）
→ 选择历史（workflow_id, selection_version 排序）
→ Candidate（candidate_version_id 排序）
→ Approval（approval_id 排序）
→ Validation（validation_run_id 排序）
```

这是有意保守的项目范围锁；同项目各入口共用它，不同项目没有共享项目锁。全项目变更已按稳定 ID 取得 Workflow/历史及后续对象。不可变输入无额外可变锁源；版本记录不能在锁外被改写。输入 INSERT、选择/基线/审批/失效的 BEFORE INSERT 触发器也执行同一前序保护。拒绝 UPDATE/DELETE 的触发器立即抛错，不拿后序锁再反向请求 Novel。

失效插入与准入共用永远存在的 Novel 行，因此不依赖 `SELECT ... FOR UPDATE` 锁定可能不存在的失效记录。测试从该 Approval 的失效数量 0 开始，分别执行检查先行与失效先行；观察者通过 `pg_stat_activity` 和 `pg_blocking_pids` 验证具体阻塞 PID、Lock 等待事件、事务/查询时间，然后才释放首事务，非固定睡眠猜测竞争。

所有业务测试均建立新的直连 pg.Client；连接超时 5 秒，statement_timeout 8 秒，lock_timeout 6 秒，阻塞观察最多 4.5 秒。没有连接池复用 search_path 或死锁重试。不同项目同时在首轮完成审批并提交。检查先通过、后基线/审批变化的路径保留当时通过事实，随后新事务检查拒绝旧输入，不能沿用旧结果。

## 验收覆盖与证据定位

数量只取实际报告，不在实现中固定声称通过数。参数化分组覆盖：

- A：完整输入→选择→pass→人工批准→准入；Canon 0 和历史边界；多候选；独立项目；数据库函数路径、约束定义与触发器。
- B：项目/Workflow/Task、Bundle/Generation、正文/上下文摘要、非当前和过旧版本；七项审批绑定、缺失/拒绝/失效、各 Validation 状态/输入/硬阻断、草案 Design 与基线变化。
- C：人工编辑继承/直接使用 Bundle、同正文不同身份、ABA、新旧审批、取消、请求/失效幂等、no_change；不可变表 UPDATE/DELETE/TRUNCATE、只读当前视图及伪造通过审计。
- D：选择/历史/指针/失效整体 COMMIT 和 ROLLBACK；审批及依据审计整体回滚；同预期版本两选择者；审批与替换、准入与首次失效、准入与模拟 Canon 变化的双向顺序；相同审批键竞争；独立项目首次提交；显式失效/模拟基线及审计整体回滚。

[运行报告](verification/runner-result.md) 每个子场景给出真实状态、SQLSTATE、约束、失败阶段和证据；并发条目保留 blocker/waiter/observer PID、等待时间和最终状态。只读观察者确认未提交操作不可见；回滚后核对选择、历史数量、失效、Approval 和审计数量。初次结构测试因写死数据库生成的长约束名失败，已改用实际约束定义核验；该失败曾正确返回退出码 1 并清理容器，最终报告来自修正后的完整新库运行。

## 模拟边界与剩余范围

本夹具无剩余验收阻断。它只证明上述关系、不可变性、事务资格和竞争控制。设计/规则内容、硬问题和人工 actor 均为明确的测试输入，不声称完成小说语义校验、真实 Agent 授权或业务阈值评审。

未实现 Canon Commit 提交幂等或正式账本、正式正文/Commit Item/Mapping、成功 Commit Sequence/Watermark 分配、Canon 与 Outbox 原子写入、完整修复/Validation 执行工作流、自动审批、force_override/Constraint Exception、真实权限或生产部署。准入本身不改变模拟基线，测试中的 `change_baseline` 也仅改变本 Schema 的前置夹具。
