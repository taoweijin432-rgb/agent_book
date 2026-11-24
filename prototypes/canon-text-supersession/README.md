# 正文修订与 Supersession 原子提交独立原型

本夹具只证明单 Canon 主分支、单个正文身份、每次一个新 Candidate / Commit / 正文版本的纯正文修订。合法提交在同一事务中生成正文、正文 Item、关系目标、supersession、审批失效、最小审计和两个必需 Outbox；历史成功记录保持不可变。

不修改正式 Schema，不依赖其他原型运行时对象。新 Schema 为 `canon_text_supersession_fixture`，数据库为 `canon_text_supersession`。保留首次结构化提交，专门构造真实的“旧 Commit 含结构化对象，不能纯正文替代”负例；修订路径两端的结构化 Canon 集合均必须为空。

## 运行与实际交付

```sh
cd /Users/yuka/agent-book/prototypes/canon-text-supersession
pnpm install --frozen-lockfile --ignore-scripts
pnpm prototype
node verification/verify-protected.mjs
```

固定沿用 PostgreSQL `18.6`、`node-pg-migrate@9.0.0`、`pg@8.23.0`。本轮实测 Node `22.23.2`、pnpm `11.18.0`、Docker `29.4.0`。运行器沿用上轮宿主机 TCP SELECT 1 就绪检查、有限总超时、迁移/测试退出码、结果新鲜度检查与 finally 清理，只调整原型名称、数据库、Schema 和报告说明。数据库密码为每次随机生成，不写入报告。

实际执行 `pnpm prototype`：迁移 0、测试 0、最终退出码 0；5 个顶层测试与 130 个子场景全部通过，无跳过。Node TAP 将顶层和子场景一起计数为 135。

| 分组 | 实际子场景 | 验证重点 |
|---|---:|---|
| A 合法正文版本链与历史读取 | 6 | v1→v2→v3、旧输出不变、另一 Scene 提交、当前与历史读取、Validation 输入 |
| B 修订资格与审批绑定 | 28 | 新审批、预检查失效、不可变意图、同一 Candidate 伪造原因摘要、过时目标、真实结构化旧 Commit、范围拒绝 |
| C 普通 DML 与关系完整性 | 84 | 完整直接 DML 正例、独立关系负例、真实 FK 错绑、延迟检查、历史 INSERT/UPDATE/DELETE/TRUNCATE |
| D 故障与真实 COMMIT 原子回滚 | 5 | 关系故障、第二条 Outbox 故障、COMMIT 缺/错关系、函数返回后 ROLLBACK，同 key 重试 |
| E 历史幂等与修订竞争 | 7 | v3 后重放 v2、异摘要拒绝、提交/回滚竞争、双 key 竞争、跨项目隔离、固定 search_path 与故障清理 |

关键 PID、故障位置和真实 COMMIT 证据见 [evidence-summary.md](verification/evidence-summary.md)。完整执行记录、每个负例的阶段、SQLSTATE、约束及独立观察数据见 [runner-result.md](verification/runner-result.md)。实际文件逐项列在 [file-manifest.txt](verification/file-manifest.txt)：README、固定依赖与锁文件、单个 `.mjs` 迁移、测试、运行器，以及保护和验收材料。根目录唯一改动为 `.gitignore` 精确追加指定行。

## 规范对应与沿用机制

| 规范 | 本原型落实 |
|---|---|
| docs/08 §2.9—2.12、§3—5、§8 | 一 Candidate 一正文一 Commit；幂等键与摘要分离；Canon 基线再检查；成功历史不可变；新 Commit 表达修订并写全部 Outbox |
| docs/12 正文、Canon Commit 与关系表 | 稳定正文身份、独立正文版本与版本号；正式 `canon_relation_target` / `supersession_relation` 字段及关系方向；当前状态派生读取 |
| docs/13 TX-CANON-001 / TX-CANON-002 | Novel→Workflow/选择历史→Candidate/Approval/Validation→正文身份及 Canon 目标；同层按稳定 ID 排序；数据库约束及同事务准入 |
| docs/14 §3.1 | 业务修订产生新记录和显式关系；原成功 Commit、正文、结构化对象、Mapping 及 Outbox 不改写 |

核对了 `canon-commit-atomic-core` 和 `canon-structured-mapping` 实现，将必要机制复制进新 Schema：真实来源链、不可变选择历史、七项 Approval 绑定、冻结提案、数据库实际内容摘要、项目互斥、事务封口、延迟完整性、Item/Mapping/Evidence、必需投影配置和运行器。没有跨 Schema 查询、导入旧迁移或调用旧原型文件。

没有发现要求改写正式文档的实质冲突。此处是正式协议的更窄子集：尚无 Publication、Impact Assessment 或下游依赖治理，不能以本轮通过推断已满足已发布章节修订协议。正文版本要求连续递增来自本轮任务；项目成功序号在夹具中采用水位 +1，不宣称正式规范要求序号永不留空洞。

## 模型、链与读取

`canonical_text_identity_root` 保存不可变 Chapter / Scene 归属；`canonical_text_identity` 是只读派生视图。夹具只支持 Scene 非空的正文身份。

- v1 对应首次提交，没有修订意图或替代关系。
- v2 / v3 各有独立正文 ID、Candidate、Validation、Approval、Commit 和一个正文 Item。
- `candidate_revision_intent` 以新 Candidate 为主键，保存目标身份、预期旧版本 ID、原因、`fixture-text-revision-v1` 契约。
- `canon_relation_target.target_text_version_id` 指向旧正文；`supersession_relation.canon_commit_id` 和 `replacement_commit_id` 均为新 Commit。关系原因必须与审批所覆盖的意图完全一致。
- 关系目标只允许 `supersession/canonical_text`，正文目标必填，Commit/Event/Fact/State 目标列全部为空；各目标列仍保留真实 FK。
- `created_by_commit_id` 是夹具额外的目标支撑归属字段，用于防孤立目标、检查新 Commit 归属和禁止后续事务追加；不改变正式 target 的旧版本含义。

```text
identity I
  v1 (Commit C1, committed)
   ↑ target_text_version_id
  relation R2: creator=C2, replacement=C2, reason=批准的原因
  v2 (Commit C2, committed)
   ↑ target_text_version_id
  relation R3: creator=C3, replacement=C3
  v3 (Commit C3, committed) ← 正常读取返回的当前正文
```

`assert_text_chain(identity)` 从版本 1 开始逐行校验，而非单取 MAX：检查版本号恰为 1..N、每个版本的成功 Commit/项目/Scene/身份、每条边恰有一个目标与关系、预期旧版本恰为前驱、原因与创建/replacement 绑定、成功序号前后方向、两端结构化对象为空。完整有效链的尾端才成为当前版本。

`UNIQUE(identity, version_no)` 防重复版本，`one_successor_per_old_text` 直接对旧正文 ID 唯一，不能通过换 target_ref 接续同一旧版本。版本 +1、精确前驱绑定与 Commit 序号递增共同阻止跳号、断链、循环、未来目标和分叉。只读视图不能写入跨身份或跳链指针。

当前查询：

```sql
SELECT v.*
FROM canon_text_supersession_fixture.canonical_text_identity i
JOIN canon_text_supersession_fixture.canonical_text_version v
  ON v.canonical_text_version_id = i.current_canonical_text_version_id
WHERE i.canonical_text_identity_id = $1;
```

明确历史版本查询可按 `canonical_text_version_id` 连接 `canon_commit`、Candidate、Approval、Item 和 Outbox，正文及来源永久保留。替代正文不撤销旧 Commit，更不撤销结构化事实；带结构化对象的旧 Commit 在本批直接拒绝。

A 组实际序列：本身份 v1/项目水位 1 → v2/水位 2 → 另一 Scene 首次提交/水位 3 → 本身份 v3/水位 4。回滚不增加任何可见版本或水位。

## 修订意图、Validation 与请求摘要

意图在输入冻结前写入。INSERT 按真实 Candidate→Workflow→Task→Scene/项目验证旧正文、稳定身份和来源链；必须是成功 Commit 的真实正文，且新 Candidate 不能等于旧 Candidate。冻结后 INSERT 意图被拒绝，意图 UPDATE/DELETE/TRUNCATE 均被拒绝。改变意图需新 Candidate，不支持“改完仍沿用批准状态”。

冻结清单 `fixture-frozen-set-v1` 中包含：实际提案、Assertion、确认依据，以及修订意图和预期旧版本的 ID、身份、版本号、旧 Commit、数据库重新计算的实际正文 SHA-256。首次输入的 revision 为 null。

Validation 摘要 `validation-text-supersession-v1` 使用 PostgreSQL `jsonb_build_array(...)::text` 后对 UTF-8 作 SHA-256，覆盖原有 `validation_base_hash`（正文、Task/Bundle/Design/规则、输入 Canon 等）、冻结清单摘要、重新计算的清单及转换版本。不是客户端 JSON 字符串的摘要。

Approval 仍只有既定七项输入绑定：Candidate、正文 hash、Context Bundle、Design Revision、输入 Canon 水位、Validation、审批策略。Validation 的不可变 hash 间接绑定完整修订意图，无另设可变批准标志。B 组在同一 Candidate 下仅伪造 reason 的清单和 Validation hash，分别得到 `frozen_manifest_mismatch` 和 `validation_input_hash`。

提交请求摘要版本为 `canon-text-supersession-request-v1`。`canonical_request` 在数据库中规范化请求并读取实际 Candidate/Approval/Validation、全部既有绑定与版本内容、正文实际 hash、固定输入 Canon、稳定身份、冻结提案与修订输入（再次读取旧正文并计算 hash）、投影配置。未知字段拒绝；修订只接受空 `structured_outputs`。

请求示意，所有 ID 和输入水位必须来自真实记录：

```json
{
  "digest_spec_version": "canon-text-supersession-request-v1",
  "mode": "revise_text",
  "workflow_id": "new-workflow-id",
  "candidate_version_id": "new-candidate-id",
  "selection_version": 1,
  "approval_id": "new-approval-id",
  "input_canon_watermark": 1,
  "canonical_text_identity_id": "stable-text-identity-id",
  "projection_config_id": "fixture-targets-v1",
  "structured_outputs": []
}
```

意图通过 Candidate 查出，不接受客户端另传未审批 reason 或目标替换字段。`mode=initial_text` 只允许未提交身份且无修订意图；其他模式、batch 及未知字段拒绝。

历史请求摘要不包含重放当下的当前正文、当前 Canon、选择状态或审批失效记录。`commit_text(project,key,request)` 取得 Novel 锁，先判断项目内 key 并重新计算固定输入摘要：同摘要返回原 Commit、正文、Item、关系、完整输出和 Outbox ID；异摘要拒绝。v3 后重放 v2 保持当前 v3，不重新执行当前准入。

## 原子事务与普通 DML 防绕过

新请求的顺序：

1. Novel 锁、历史幂等判断。
2. 按稳定 ID 锁 Workflow/历史、Candidate/Approval/Validation，复核当前选择、七项绑定、真实 Validation、全部失效、输入 Canon 和冻结集合；预检查不是通行证。
3. 锁正文身份、旧正文及旧 Commit，校验完整链、预期旧版本仍为当前、旧 Commit 不含结构化 Canon。
4. 新 Commit、正文与正文 Item；新目标支撑及 supersession；事务内审批失效和最小审计；两个必需 Outbox。
5. 调用方真实 COMMIT，运行跨表延迟约束；只有全部成功才对其他连接可见。

提交维护触发器在插入新 Commit 时执行，和后续所有输出共用同一事务。准入在持锁期间、产生自身 Canon 失效记录前验证；历史成功 Approval 不要求在此后仍处于当前有效状态。没有额外的“已提交”或“已审批”可变授权位。

所有跨表检查由 `DEFERRABLE INITIALLY DEFERRED` 约束触发器在真实 COMMIT 执行，覆盖完整链、正文/Item/支撑、冻结对象集、关系以及全部 Outbox。新请求仍在 Commit INSERT 触发器中复核真实准入，普通直接 DML 也必须满足。跨项目目标和 replacement 在 BEFORE INSERT 阶段先检查实际项目，避免外键自动检查先锁住其他项目的 Canon 行；其余跨表对应关系仍延迟到 COMMIT 检查。

`created_transaction` 由 Commit 的 INSERT 触发器覆盖为数据库当前 XID；所有 Canon 子输出和关系插入检查同一创建事务，后续事务不能补充历史 Commit 的 Item/Evidence/Mapping/目标/关系/Outbox。该字段不可变，不依赖调用方 GUC、会话授权位或函数入口约定。

历史 UPDATE/DELETE/TRUNCATE 一律拒绝。不可变行的 UPDATE/DELETE 触发器只拒绝，不反向申请 Novel 锁；不假设 BEFORE ROW UPDATE 先于执行器取得目标行锁。正常写路径只追加，先锁项目，再按固定层级取得锁。全部函数固定 `search_path=pg_catalog, canon_text_supersession_fixture, pg_temp`，无 SECURITY DEFINER；测试客户端 `search_path=public` 并完全限定对象名。

两个 Outbox 目标为 `fixture_graph/fixture-graph-v1`、`fixture_vector/fixture-vector-v1`，必须恰好齐全。事件区分 `fixture_canon_text_initial_v1` 与 `fixture_canon_text_revised_v1`；修订事件带身份、旧/新正文 ID、关系 ID、成功来源水位、完整输出及其摘要。没有创建 Projection Task/Attempt，也未写外部存储。

函数返回 `created_in_transaction` 和 `requires_outer_commit=true`。这不是持久化成功承诺；调用方必须执行真实 COMMIT，并处理 COMMIT 阶段错误。

## 失败、竞争与回滚证据

报告逐项记录实际阶段和数据库返回值，例如：

| 负例 | 实际阶段 | SQLSTATE / 约束 |
|---|---|---|
| 新 Commit 缺正文 | COMMIT | 23503 / commit_text_version_fk |
| 缺替代关系 | COMMIT | P0001 / supersession_missing |
| 缺目标支撑 | COMMIT | P0001 / supersession_target_missing |
| replacement 错绑真实旧 Commit、自我替代、跨身份目标 | COMMIT | P0001 / supersession_binding |
| 跨项目目标 / replacement（真实 FK） | FK 可能取得对方行锁之前的 INSERT | P0001 / relation_target_project_mismatch |
| 版本跳号 | COMMIT | P0001 / text_chain_version_gap |
| 换 target_ref 包装同一旧版本 | INSERT | 23505 / one_successor_per_old_text |
| 缺任一必需 Outbox | COMMIT | P0001 / commit_outbox_set |
| 缺正文 Item / 支撑 | COMMIT | P0001 / commit_item_missing / commit_text_support_missing |
| 当前目标过时但已刷新 Canon 和审批 | 当前目标锁后 | P0001 / revision_old_not_current |
| 旧 Commit 有真实结构化对象 | 旧目标锁后 | P0001 / revision_old_structured_forbidden |

非正文目标的实际列组合首先由正文 NOT NULL 约束拒绝（23502，报告包含 table/column，PostgreSQL 未返回 constraint 名时保留空值）；另外单独改变 discriminator、保留真实正文目标的测试由类型 CHECK 拒绝（23514）。没有把所有错绑替换成悬空 FK。

D 组仅用测试临时触发器注入故障，finally 删除函数及触发器：关系插入失败前事务内已有新正文/Item/目标各 1、关系/Outbox 各 0；第二条 Outbox 失败前正文/Item/目标/关系各 1、Outbox 1。实际 DETAIL 记录这些数量，证明失败发生在要求的位置；未关闭任何业务约束，也未给提交入口增加故障开关。

每次失败由独立连接比较项目水位、当前正文、完整历史输出、审计和审批失效，另外直接 COUNT 全部 17 张输出表（含关系/目标/Evidence/Mapping/类型支撑），而非仅从 Commit 连接查询，避免遗漏孤立行。全部与故障前一致，再用同 key 成功提交。缺/错关系真实 COMMIT 失败和函数返回后的外层 ROLLBACK 也采用相同观察。

E 组使用两个事务连接与独立观察连接，通过 `pg_stat_activity` 和 `pg_blocking_pids` 确认具体阻塞后才释放持锁事务。完整 blocker/waiter/observer PID、wait_event、时间和结果见运行报告。连接 5s、语句 8s、锁 6s、观察 4.5s 有限超时；15ms 轮询只用于观察锁，不使用随机 sleep 或死锁重试。

A COMMIT 后，相同 key 的 B 重放原全部输出；A ROLLBACK 后，B 使用同 key 创建新的成功 Commit。不同 key 同时修订同一旧正文时，第二个实际被 `stale_canon_watermark` 拒绝；另有刷新 Canon/新审批后仍指旧版本的独立测试，实际被 `revision_old_not_current` 拒绝。不同项目使用同 key，A 持锁时 B 可提交且双方输出隔离。

## 保护核验、清理与限制

修改前保存原始保护基线和 `.gitignore` 字节；修改后独立重枚举所有保护文件并比较路径集合和 SHA-256。实际修改前后均为 378 个路径，没有预设数量；包含 docs/00—15、全部十一个既有原型、根依赖和其他仓库文件，并沿用基线口径跟随旧缓存符号链接。排除 `.git`、`node_modules`、本轮新增目录及指向本轮的缓存别名。检测新增、遗漏、重复路径和内容差异，结果全部通过。

根 `.gitignore` 等于原始字节加且仅加 `prototypes/canon-text-supersession/.test-results.json\n`，新增 54 字节。详见 [hash-validation.txt](verification/hash-validation.txt)、前后 SHA-256 清单、原始 gitignore 和 Git status。本轮没有 Git 暂存、提交、推送、reset 或 clean。

运行器已删除本轮独立容器及 `.test-results.json`，保留可读报告；未执行全局 Docker 清理。E 组检查测试故障函数已清空，没有 Publication/Impact/Projection 执行表。固定依赖仅安装在新原型目录，不更改根依赖。

范围限制：不实现结构化事实撤销、状态反向计算、reversal/compensation、批量修订、多 Canon 分支、完整作者确认工作流、Publication、Impact Assessment、后续章节自动改写、外部投影或真实权限。正文链读取逐段验证，项目锁保守串行化；性能与正式生产 Schema 均不在本批结论内。普通 DML 防绕过以约束正常启用为前提，不宣称抵抗数据库所有者 DDL 或关闭触发器。

本轮结束于纯正文修订与替代验证，不开展下一批。
