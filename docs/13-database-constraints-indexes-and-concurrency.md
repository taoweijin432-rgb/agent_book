# 数据库约束、索引与并发设计

- 文档编号：DOC-13
- 版本：0.1.7
- 状态：草案
- 更新时间：2026-09-23
- 规范性依赖：[数据不变量与事务边界](11-data-invariants-and-transaction-boundaries.md)、[关系数据库物理 Schema](12-relational-physical-schema.md)、[数据库逻辑模型](09-database-logical-model.md)、[逻辑实体目录](10-logical-entity-catalog.md)、[Canon 正式提交协议](08-canon-commit-protocol.md)
- 参考性引用：[系统架构](05-system-architecture.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[数据生命周期、迁移与恢复](14-data-lifecycle-migration-and-recovery.md)

## 1. 设计边界与核对口径

本文件把 `11` 的逻辑不变量和事务边界承接到物理设计层，定义数据库约束、短事务内检查、领域服务检查、异步校验、并发控制和查询驱动的索引。它不输出 SQL、DDL、ORM、迁移脚本，也不把静态文档检查表述成数据库运行测试。

PostgreSQL 兼容关系数据库只是 `12` 中的建议性、待确认基线；下文使用类型类别和约束语义，不把任何厂商语法视为已批准选型。Agent 不直接操作任意表，写入必须通过受限工具或领域服务。模型调用、人工审批和完整投影执行均不得被数据库长事务覆盖。

本轮从受保护的 `11` 实际提取到 **35 个 `INV-*` 和 21 个 `TX-*`**。编号集合按完整多段名称匹配，不通过单段名称模式推断数量；本文件逐条覆盖现行源规范中的全部编号。

## 2. 数据不变量落实矩阵

“数据库约束”是关系、值域、唯一性、互斥和不可变边界；“事务内检查”是提交前必须在同一短事务读取并复核的条件；“应用层语义检查”是领域规则；“异步检查”只能提供质量或重建补充，不能替代提交前硬约束。失败行为必须明确为拒绝、回滚或追加审计。

| 编号 | 实际禁止/要求 | 表与字段 | 数据库约束机制 | 事务内检查 | 应用层语义检查 | 异步检查 | 失败行为 |
|---|---|---|---|---|---|---|---|
| INV-SOURCE-001 | 两个真实源不得直接覆盖；跨源只能经映射、事件、修订或提交 | `author_design_revision.revision_id`；`canon_commit.canon_commit_id`；Mapping | 两域表分离；Candidate/Canon FK 不互换；Mapping 两端必填 | 写入前锁定源版本并确认跨域事件类型 | 检查设计意图与 Canon 语义冲突 | 影响评估可异步 | 直接同步拒绝并写访问审计 |
| INV-WORKFLOW-001 | 一个 Workflow Run 只绑定一个 Scene Task Version；Workflow `approved` 不等于 Approval 或 Canon；Approval 的输入绑定不归属 Workflow | `workflow_run.scene_task_version_id`；`approval_record` 全部绑定列；`canon_commit.workflow_run_id` | Workflow FK 非空；Approval 的 Candidate/Bundle/Revision/Validation FK 非空；不建立 Workflow 到策略/水位的替代绑定 | 锁 Workflow、Task Version，校验项目和版本链 | 区分运行状态、Approval 有效性和 Canon 成功 | 不适用；不能用异步补救边界 | 不一致拒绝并回滚本次写入 |
| INV-WORKFLOW-002 | Generation Run 恰属一个 Workflow 和一个冻结 Bundle；Candidate 恰属一个 Workflow，模型来源必须有 Generation Run，修复/人工链不得跨 Run | `generation_run.workflow_run_id/context_bundle_id`；`candidate_version.workflow_run_id/generation_run_id/previous_candidate_id` | 非空 FK；候选类型条件值域；同 Run 关系唯一 | 读取共同 `scene_task_version_id` 并锁定父版本 | 检查来源链、跨 Run 和伪造 Run | 可异步抽取来源图，但不能放宽基数 | 拒绝保存或回滚来源链 |
| INV-IDENTITY-001 | Entity 仅为稳定身份锚点，不承载完整设计或 Canon 状态 | `entity.entity_id/entity_type`；Design/Canon binding | Entity 与设计/Canon 分表；禁止把正文/设计核心属性列入 Entity | 检查合并/拆分成员和项目归属 | 身份治理服务判定合并、拆分和引用影响 | 影响投影可异步重建 | 非法承载拒绝并审计 |
| INV-CANDIDATE-001 | Candidate、候选事件/事实/状态不得原地成为 Canon | `candidate_version`；`candidate_event`；`candidate_fact_proposal`；`candidate_state_transition`；Canon 表 | Candidate 表与 Canon 表无类型转换 FK；Mapping 为追加关系 | Canon Commit 检查源域和新目标 ID | Commit 服务创建全新 Canon 对象 | 异步只做来源回查 | 发现原地升级则回滚 |
| INV-CANDIDATE-002 | 无有效 Approval 的 Candidate 不得提交 | `approval_record`；`approval_invalidation_record`；`canon_commit` | Approval 输入 FK 非空；Commit Approval FK 非空 | 锁 Candidate、Approval 和失效记录并重新计算有效性 | 校验决定、策略适用性、绑定 hash 和基线 | 不适用；硬门禁不得异步化 | Commit 拒绝且无 Canon 写入 |
| INV-APPROVAL-001 | Approval 必须绑定具体 Candidate hash、Bundle、Design Revision、Watermark、Validation 和 Policy | `approval_record.candidate_version_id/candidate_content_hash/context_bundle_id/author_design_revision_id/input_canon_watermark/validation_run_id/approval_policy_version` | 非空 FK；候选 hash 为摘要列；同一 Approval 不允许更新 | 锁定所有绑定输入并逐项相等比较 | 判定输入是否为当前最终 Candidate 的有效上下文 | 不适用；不能用异步确认替代 | 不匹配拒绝或标为不可用，不改原 Approval |
| INV-APPROVAL-002 | 绑定输入/策略变化使旧 Approval 失效；原 Approval 不改写，追加 Invalidation | `approval_invalidation_record.approval_id/reason_code/trigger_version` | `(approval_id, reason_code, trigger_version)` 唯一；Approval 追加不可变 | 发现变化时同事务写 Invalidation，Commit 时锁并读取失效记录 | 解释变化是否覆盖 Candidate、Bundle、Revision、规则或水位 | 异步发现可触发失效请求，但提交前必须复核 | 追加失效记录；拒绝复用旧 Approval |
| INV-CANON-001 | 成功 Canon Commit 永久 committed，不可更新为失败或其他状态 | `canon_commit.result/success_commit_sequence/payload_hash`；Commit Item | committed 行不可更新触发保护；成功序号非空条件约束 | 创建和成功标记同一事务确认 | 后续修订使用新 Commit 与关系 | 审计检查不可变性 | 任何原地修改拒绝并审计 |
| INV-CANON-002 | 修订、撤销、反向、补偿、替代使用新记录和显式关系 | `supersession_relation/reversal_relation/compensation_relation` | 关系两端 FK；原 Commit 不可更新 | 同一 Commit 事务写关系并校验目标存在 | 判断关系语义和影响范围 | Impact Assessment 可异步 | 缺关系或试图删旧记录则回滚 |
| INV-CANON-003 | 同 Watermark 下唯一事实不能冲突；冲突必须阻断或由有效关系解释 | `canon_fact.fact_key/fact_value`；`state_transition.entity_id/state_dimension_id`；Watermark | 同域键和有效范围候选唯一；不可由索引单独解释语义冲突 | 锁定相关 Canon 范围，检查冲突与关系 | 判断身份、地点、物品、关系和因果冲突 | 质量扫描只能补充 | 硬冲突拒绝并回滚 |
| INV-KNOWLEDGE-001 | 缺少知识证据只能是 unknown，不得是 known_false | `knowledge_evidence`；`character_knowledge_state.knowledge_value` | 值域 CHECK；派生表来源摘要非空 | 状态写入必须存在 Evidence 或显式 unknown | 区分缺失、否定证据和未知 | 可异步重建并比对 | 非法值拒绝；派生结果不发布 |
| INV-KNOWLEDGE-002 | Knowledge 和 Belief 使用各自值域且不得混用 | `character_knowledge_state.knowledge_value`；`character_belief_state.belief_value`；两类 Evidence | 分表值域 CHECK；来源表类型固定 | 重建前检查 Evidence 类型与状态表一致 | 处理谣言、误认、纠正 | 可异步重建 | 类型或值域不符回滚/不切换 |
| INV-KNOWLEDGE-003 | Belief Evidence 不能升级为客观 Canon Fact | `belief_evidence`；`canon_fact.evidence_reference_id` | Evidence 来源类型约束；Canon Fact 不能引用唯一 Belief 来源 | Commit 前验证事实证据来源 | 领域校验客观事实成立条件 | 异步检查只报告问题 | 以 Belief 独立支撑事实则拒绝 |
| INV-DISCLOSURE-001 | Disclosure State 必须绑定 Canon Watermark 和正文/Assertion/披露证据 | `reader_disclosure_state`；`reader_disclosure_evidence`；`canonical_text_version_id` | Watermark、策略、来源摘要非空；Evidence FK | 切换前锁定正文版本和披露证据 | 按读者视角判断秘密披露层级 | 可异步重建并回查 | 缺链或水位不符不发布 |
| INV-TEMPORAL-001 | Temporal Relation 仅属于 Canon Narrative Source；Temporal Constraint 属于 Author Design Source；Derived Timeline View 只能从带 source domain/source version 的同源关系、区间和证据派生，视图不可写 | `temporal_relation`；`temporal_relation_canon_source`；`temporal_constraint`；`time_interval`；`temporal_evidence` | Canon Relation 与 Design Constraint 分表；Canon Relation 来源支撑恰一；视图无写入口 | 物理记录写入时校验 source 支撑、同项目和同提交；Candidate 时间提案不得写入 Canon Relation | 区分 Canon 时间、设计约束和 Candidate 提案；提交服务确认 Canon 时间关系 | 可异步闭包检测 | 直接写视图、无来源或 Candidate 进入 Canon Relation 均拒绝 |
| INV-TEMPORAL-002 | 无绝对证据保持 relative/unknown/区间 | `time_interval.time_kind/precision/certainty`；Temporal Evidence | 值域 CHECK；absolute 必须有证据关系 | 写入/Commit 前检查证据与精度 | 判断是否足以确定日期 | 异步抽取可提出候选但不能升级 | 强行确定值拒绝或保留不确定值 |
| INV-PROJECTION-001 | 派生投影不得回写 Author Design 或 Canon | `projection_task/attempt/checkpoint`；Derived 表；Canon/Design 表 | 投影角色无源表写权限；派生表无反向业务 FK | 领域服务校验写入目标域 | 工具能力边界和授权检查 | 一致性扫描可异步 | 越权写入拒绝并审计 |
| INV-PROJECTION-002 | 成功 Canon Commit 与 Outbox 同事务；无成功 Commit 不得有生效 Outbox | `canon_commit`；`projection_outbox` | Outbox 非空 Commit FK；`(commit,target,strategy)` 唯一 | Canon 原子事务内创建并锁定 Commit | 判断 emitted 是否对应 committed | 恢复可异步创建 Rebuild Record，不伪造 Outbox | 任一步失败整体回滚 |
| INV-IDEMPOTENCY-001 | 同幂等键和同 payload 只有一个提交结果，重复请求返回原结果 | `canon_commit.idempotency_key/payload_hash/result` | `(novel_id,idempotency_key)` 唯一；payload hash 非空 | 锁唯一键并比较 hash | 相同请求返回原结果，不再写新 Canon | 不适用 | 重复返回原结果或等待原事务 |
| INV-IDEMPOTENCY-002 | 同幂等键不同 payload 必须拒绝且不覆盖原请求 | `canon_commit.idempotency_key/payload_hash` | 唯一键保护原记录 | 锁唯一键后比较 hash | 写异常审计，不修改原 Commit | 不适用 | 拒绝并保留原记录 |
| INV-CONTEXT-001 | Bundle 冻结后不可改，需保留内容 hash、最终顺序、来源版本、权限依据和入选原因 | `context_bundle`；`context_item`；`context_source_reference` | Bundle 状态和值域；Item order `(bundle_id,item_order)` 唯一；来源非空 | 冻结事务校验所有 Item 与 Reference 完整 | 权限投影、去重、裁剪和可重放性检查 | 可异步检查来源可访问性，不得修改 Bundle | 修改拒绝；新编译创建新 Bundle |
| INV-AUTH-001 | Agent 读取不得超出 Data Scope/视角；默认拒绝 | `data_scope`；`visibility_decision`；`access_audit_record` | Scope FK；Decision 值域；访问审计追加 | 每次读取前计算范围、Watermark、秘密过滤 | 权限服务实施最小披露 | 异步审计发现不能补发已泄露内容 | 不确定即 deny/redacted 并审计 |
| INV-AUTH-002 | Agent 不得写未授权域；Writing Agent 只能写 Candidate/草稿 | `actor_principal`；`capability_grant`；Candidate/Canon/Design 表 | Grant FK 和 action 值域；服务账号无任意表权限 | 写入口验证 actor、capability、scope 和目标域 | 角色与动作矩阵判断 | 异步审计不能使越权写入合法 | 拒绝、回滚并记录 |
| INV-PUBLISH-001 | 已发布章节修订不自动改下游正文，只产生影响评估和新任务 | `publication_record`；`impact_assessment/impact_item` | 发布记录追加；下游正文 FK 不可级联更新 | 修订提交锁定已发布版本并创建关系/影响触发记录 | 判断影响范围，不自动级联 Commit | Impact Assessment 可异步生成 | 禁止级联更新；缺评估不发布修订结果 |
| INV-REBUILD-001 | 每个派生状态追溯源记录、版本、Watermark、策略、重建任务 | Derived 表；`projection_attempt/checkpoint/rebuild_record` | 来源摘要、策略和水位非空；Checkpoint 身份唯一 | 切换前锁 Attempt/Checkpoint，检查目标和来源 | 来源、权限和结果校验 | 可异步做全量对账 | 缺链不切换，保留隔离结果 |
| INV-DESIGN-001 | Draft 可编辑；冻结后 Revision、对象集合、生效范围和依据不可变 | `author_design_revision.status/content_hash`；Design Object Version | `(novel_id,revision_no)` 唯一；effective 条件唯一 | 冻结事务检查完整性并更新当前指针 | 设计服务判断可编辑状态 | 影响评估异步 | 冻结后写入拒绝；新 Revision |
| INV-DESIGN-002 | 设计对象只保存设计生命周期；实现/回收/违反由 Fulfillment 派生 | `outline_node/foreshadowing_plan/ending_constraint`；`design_fulfillment_state` | 设计 FK 与派生表分离 | Commit 时只写 Canon/Mapping，禁止回写设计状态 | 完成度策略计算 | 可异步重算 | 设计状态被事实覆盖则拒绝 |
| INV-CONTEXT-002 | Task Version 先存在；一个 Task 可有多个 Bundle | `scene_task/current_version_id`；`scene_task_version`；`context_bundle` | Task Version FK；Bundle 非空 Task FK；Bundle 唯一 hash | Bundle 创建前锁并确认 Task Version 有效 | 编译器检查 Task/权限/水位 | 检索结果可异步准备 | 无 Task Version 拒绝 |
| INV-CANDIDATE-003 | 一个 Run 可多 Candidate，同一时刻至多一个 current；选择历史追加且 Approval 不迁移 | `workflow_run.current_candidate_id/current_selection_version`；`workflow_candidate_selection_history`；Approval | `(workflow_run_id,selection_version)` 唯一；当前指针值域 | 锁 Workflow 行和选择版本；追加历史、更新当前指针；Commit 前再次复核 | 重新选择原 Candidate 也须新 Approval | 异步只做历史完整性核对 | 并发版本冲突拒绝；旧 Approval 不恢复 |
| INV-CARDINALITY-001 | 一个 Commit 绑定一个 Candidate 并产生一个 Canonical Text Version；结构化对象零到多 | `canon_commit.candidate_version_id`；`canonical_text_version.canon_commit_id`；Commit Item | Commit Candidate 非空；文本目标条件唯一 | 同事务计数并检查一 Commit 一正文 | 结构化对象生成和来源确认 | 不适用；提交基数为硬门禁 | 基数不符整笔回滚 |
| INV-CARDINALITY-002 | 每个进入 Canon 的结构化对象必须有 Commit Item，且 Item 指向真实目标 | `canon_commit_item` 及四个类型目标支撑表 | 父项恰一目标子行；目标 FK；Commit 归属一致 | 提交前枚举对象和 Item 集合比对 | 判断是否确实进入 Canon | 不适用 | 缺 Item 或悬空目标回滚 |
| INV-COMMIT-SEQ-001 | 只有成功 Commit 分配成功 Sequence/Watermark；失败不推进，单分支严格单调 | `novel.novel_id`；`canon_commit.success_commit_sequence/canon_watermark` | `novel` 行作为单项目 Canon 串行化锁对象；项目内成功序号唯一；committed 条件非空 | 先锁 `novel`，再读取最新成功 Commit；无成功 Commit 时初始读取边界为逻辑 0；同事务确认新水位 | 识别失败、回滚、序列间隙不代表成功 | 对账可异步但不能补水位 | 竞争失败回滚；不把内部序列当成功水位 |
| INV-MODEL-001 | 保存实际模型请求/响应和 Candidate 原文；重调用是新 Call/Run；正文摘要、提案摘要和提交摘要不要求相等 | `model_call.request_ref/response_ref/request_hash/response_hash`；Candidate `content_ref/content_hash`；提案 `object_hash`；`canon_commit.payload_hash` | 请求/响应 hash、Candidate 正文引用和提案摘要非空；各自绑定不可变 | 保存前重算正文 hash、核对 Assertion/提案属于 Candidate 且 source_content_hash 一致；Canon 时另行重算 payload hash | 模型适配器记录实际载荷；Commit 服务校验完整提交摘要 | 成本/Trace 可异步 | 缺载荷、hash 不符或来源版本不一致拒绝 |
| INV-PROJECTION-003 | 普通 Task 恰关联一个 Outbox；重建 Task 恰关联一个 Rebuild Record；两者互斥；普通有效状态下同一 Outbox/目标/策略不重复创建，scope_hash 不能绕过唯一性 | `projection_task.origin_type/outbox_id/rebuild_record_id/target/scope_hash/strategy_version/status`；`projection_outbox.scope_hash` | XOR 互斥约束；来源 FK；普通状态条件唯一 `(outbox_id,target,strategy_version)`；普通 scope_hash 必须等于 Outbox 范围摘要 | 创建 Task 时锁来源并校验 Novel、目标、策略、范围和有效状态；重复消费复用既有普通 Task | 判断普通/重建来源语义和状态转换 | 异步只可执行已创建 Task | 来源缺失、双来源、范围不一致或有效重复回滚 |

## 2.1 摘要语义与 Canon Commit 第 4 步

摘要字段表达不同层级的内容，不能因为数值不同就互相否定：

- Candidate `content_hash` 是不可变候选正文内容的摘要。保存 Candidate 时必须重算正文摘要并与保存值比较。
- Assertion、Candidate Event、Candidate Fact Proposal 和 Candidate State Transition 各有自身 `assertion_hash`/`object_hash`；它们同时保存或关联 Candidate 正文版本摘要 `source_content_hash`/`candidate_content_hash`，对象摘要与正文摘要不要求相等。
- Approval 的 `candidate_content_hash` 必须匹配其具体 Candidate 正文，并同时匹配 Context Bundle、Author Design Revision、输入 Canon Watermark、Validation Run 和策略版本。
- Canon Commit `payload_hash` 是完整提交请求的规范化摘要，至少覆盖 Candidate 身份、Candidate 正文摘要、结构化提案及其摘要、Approval、Selection Version、输入水位、Design/Validation/Policy 版本和相关 Commit 输入；它不等于 Candidate `content_hash`。

摘要输入集合、顺序和规范化规则由受控的摘要规范版本确定，并保存于 `canon_commit.digest_spec_version`；该字段属于提交请求/审计链，和 `payload_hash`、幂等键一起不可变。规范版本必须能回查算法、规范化规则、输入字段集合及排序规则；同一幂等请求始终使用其原始版本核验，新规范不得重新解释或覆盖旧摘要，未知版本拒绝提交。Canon Commit 前依次重算正文摘要、核对 Assertion/提案归属及来源正文版本、复核 Approval 绑定，再重算完整 `payload_hash` 并与请求及已有幂等记录比较。同幂等键同 payload 返回既有结果；同键不同 payload 拒绝。

## 3. 21 个事务边界的物理承接

以下每个事务都使用短事务。写入集合不包含未列出的任意表；事务外动作不得被误认为事务已成功。幂等键冲突按“同输入返回原结果、异输入拒绝”处理，除非该行另有说明。

| 事务 | 入口与前置条件 | 读取集合 | 写入集合 | 锁定/版本比较 | 幂等与冲突处理 | 回滚范围 | 事务外动作 |
|---|---|---|---|---|---|---|---|
| TX-DESIGN-001 创建 Author Design Revision | 项目存在；当前 Revision 可见；请求者有设计写权限；请求键可用 | `novel` 当前指针、Revision 请求键 | `author_design_revision`、对象版本引用、审计 | 项目当前 Revision 版本 | 同请求键同 hash 返回；异 hash 拒绝 | 新 Revision、对象引用、审计全部回滚 | 影响评估可异步 |
| TX-DESIGN-002 确认/冻结 Design Revision | Draft 完整、无未处理硬阻断、有确认权限 | Revision、对象版本、约束、例外 | Revision 状态/生效指针、确认审计 | 锁 Revision 和项目 effective 指针 | 已冻结同版本返回原结果；并发版本拒绝 | 状态与指针更新回滚 | 影响评估、通知异步 |
| TX-TASK-001 创建 Scene Task | Scene、Revision、输入 Canon Watermark 存在且可见；请求键可用 | Scene、Revision、项目水位、请求键 | `scene_task`、`scene_task_version`、任务约束、审计 | Scene 当前结构版本；Task 版本号 | `(scene_id, request_key)` 幂等 | Task 身份、版本、审计回滚 | 无 |
| TX-WORKFLOW-001 创建 Workflow Run | Scene Task Version 已存在且有效 | Task Version、项目、请求键 | `workflow_run` 初始行、初始选择历史、审计 | 锁 Task Version；比较任务版本 | `(scene_task_version_id, request_key)` 幂等；不写 Approval/Watermark | Workflow、选择明细、审计回滚 | 后续执行异步 |
| TX-WORKFLOW-002 更新 Workflow Run 状态 | Run 存在；状态转换合法 | Workflow 当前状态、`run_version`、当前选择版本 | Workflow 状态、运行审计、递增 `run_version` | 乐观 `run_version` 或行锁 | 状态版本冲突拒绝；不得推进 Canon | 本次状态与审计回滚 | 无 |
| TX-CONTEXT-001 冻结 Context Bundle | Task Version 有效；已完成权限过滤和编译 | Task Version、Design Revision、Canon Watermark、Data Scope、检索来源 | Bundle、Item、Source Reference、编译载荷引用、可见性审计 | 锁 Task Version 版本；比较来源版本 | 同 Task+内容 hash 返回；不同 hash 新 Bundle | Bundle/Item/Reference/审计全部回滚 | 预检索可异步，但冻结写入短事务 |
| TX-GENERATION-001 保存 Generation Run | Workflow 有效；Bundle 冻结；Prompt/Model 可用 | Workflow、Task Version、Bundle、Prompt、Model、请求键 | Generation Run、Model Call、Tool Call、Cost、Trace | 锁 Bundle 输入绑定；比较 Workflow `run_version`；Model Call 使用新 `call_attempt_no`，不以 request_hash 作执行唯一 | 同 Run+request key 同 payload 返回原结果；同输入新调用使用新 Call/Attempt 身份 | 本次执行记录和审计回滚；不写 Canon | 外部模型调用不在事务内；结果回写用新短事务 |
| TX-CANDIDATE-002 保存 Candidate Version | Workflow 有效；正文 hash 已算；适用 Bundle 可追溯 | Workflow、Bundle、Generation Run（模型 Candidate 必须有）、前序 Candidate | Candidate、来源关系、人工/修复审计 | 比较 Workflow Task Version 和来源 Candidate 所属 Run | Candidate ID 不复用；同内容仍是新 Candidate，不复用 Approval | Candidate 与来源审计回滚 | Validation 可异步启动 |
| TX-CANDIDATE-001 提取 Narrative Assertion | Candidate 正文不可变；抽取器版本可用 | Candidate、正文 `content_hash`、抽取器版本、Candidate 提案和来源 Evidence | Assertion、Candidate Event/Fact Proposal/State Transition、Evidence | 锁 Candidate 内容 hash；提案自身 `object_hash` 与 Assertion 的 source_content_hash 分别核对；Time Interval 来源绑定按 12 的 source binding 检查 | 同 Candidate+抽取器+hash 返回；正文变化必须新 Candidate；对象摘要不要求等于正文摘要；Candidate 时间信息不得写入 Canon Temporal Relation | 本次 Assertion/提案/Evidence 写入整体回滚 | Trace/质量评估等适用的异步动作 |
| TX-VALIDATE-001 执行 Validation Run | Candidate、Design、输入 Watermark、规则版本固定；请求键可用 | Candidate、Bundle、Revision、规则、约束、Canon 水位、请求键 | Validation Run、Issue、Result、验证证据 | 锁输入版本；比较 hash；`request_key` 只在同 Candidate 范围内幂等 | 同请求键同输入返回原 Run；同输入新校验使用新的请求键和 Run 身份，历史结果保留 | Run、Issue、Result 回滚 | 模型评测和修复建议异步 |
| TX-APPROVAL-001 写入 Approval Record | Candidate、hash、Bundle、Revision、Watermark、Validation、Policy 全匹配 | Workflow 当前选择/选择版本、Candidate、Bundle、Validation、Invalidation、Policy | Approval、Exception 引用、审批审计 | 锁 Workflow、选择版本、Candidate、Validation；提交前再算有效性 | 同请求键同绑定返回；不同绑定拒绝；不同 Candidate 永不复用 | Approval 和审计回滚；不改 Candidate | 不自动触发 Canon |
| TX-CANON-001 执行 Canon Commit | 当前最终 Candidate、有效 Approval、选择版本、基线和权限全部满足 | 详见第 4 节 18 步的 Candidate、Workflow、Selection History、Approval、Validation、Design、Watermark、Novel | Canon Commit、Text、Canon 对象、Commit Item、Mapping、关系、Watermark、Outbox | 事务入口先锁 `novel`；再按 Workflow/选择历史→Candidate/Approval/Validation→Canon 目标/正文身份顺序读取；同层对象按稳定 ID 排序；提交前复核选择、Approval 有效性、正文 hash、payload hash 和水位 | 同幂等键同 payload 返回原 Commit；异 payload 拒绝；同项目提交在 Novel 锁下串行 | 第 1—18 步所有 Canon 原子写入回滚 | 提交成功后才创建/执行投影 Task/Attempt |
| TX-CANON-002 创建修订/撤销/补偿提交 | 原 Commit/Publication 存在；影响范围和新 Candidate 已确认 | Novel、原 Commit、Publication、当前水位、关系目标 | 新 Candidate/Commit/Text、关系、Mapping、Outbox | 先按同一 Canon 顺序锁 `novel`，再锁 Workflow/选择历史、Candidate/Approval/Validation、Canon 目标/正文身份；不得先锁原 Canon 目标再反向请求 Novel | 原 Commit 不更新；新幂等键；同层目标按稳定 ID 排序 | 新 Commit 全部原子写回滚 | Impact Assessment 可异步 |
| TX-PROJECTION-001 写入 Projection Outbox | Canon Commit 原子事务中即将成功 | Canon Commit、目标策略 | `projection_outbox` | 与 Canon Commit 同事务同锁 | `(commit,target,strategy)` 冲突返回既有意图 | Outbox 与 Canon 一并回滚 | Task 创建事务外执行 |
| TX-PROJECTION-002 创建 Projection Task | 普通来源有 Outbox，或重建来源有 Rebuild Record；来源范围和策略可用 | Outbox/Rebuild Record、目标、范围、策略、该来源全部既有 Task 状态 | 一个 `projection_task` 或复用既有 Task | 锁来源；查询全部既有普通 Task 状态；无 Task 才创建；pending 复用，needs_rebuild 进入显式恢复，completed 返回结果，cancelled/abandoned 返回终止状态；普通 `(outbox_id,target,strategy_version)` 有效唯一且 scope_hash 必须等于 Outbox；重建按 Rebuild Record 范围唯一 | 同一来源并发消费在来源锁下只产生一个普通 Task；普通重试复用 Task，创建新 Attempt；终态不自动恢复 | Task 与审计回滚 | Worker 领取使用新的短事务 |
| TX-PROJECTION-003 执行 Projection Attempt | Task 可执行；来源 Watermark 有效；新 Attempt 身份可用 | Task、来源、当前 Checkpoint、Attempt、`expires_at` | 新 `projection_attempt` processing 记录；事务外执行后写完成状态、结束时间、结果引用；Failure（如失败） | `attempt_id` 是执行身份；`worker_version` 仅软件追踪；完成和过期都在受并发保护的短事务中进行：先取得 Attempt 行锁，再在状态转换判定点使用数据库权威时间重新检查 `status=processing`；成功仅当数据库权威时间严格早于 `expires_at`，并以同一事务写入 `status=succeeded`、`ended_at`（成功接受时间）和结果引用；过期仅当数据库权威时间大于或等于 `expires_at`，并以同一事务写入 `status=expired`；两个条件更新最多一个成功 | 每次重试新 Attempt；已终结/expired Attempt 不改写；成功接受后不因当前时间超过 `expires_at` 自动失效；旧外部结果只能进入版本化隔离/幂等目标，不能覆盖 active 投影 | 成功或过期状态及 `ended_at` 必须与状态转换同事务提交；事务回滚不形成已成功接受或已过期转换记录；历史 Attempt 不改 | 实际投影执行在事务外；Worker 本地时间不得参与接受判定；外部副作用由目标版本/Watermark/范围幂等和隔离切换保护 |
| TX-PROJECTION-004 更新 Projection Checkpoint | Attempt 在截止前成功接受；重建范围和当前已发布 Canon Watermark 可比较 | Attempt、Task、Rebuild Record、当前 Checkpoint、当前已发布 Watermark | Checkpoint 当前行/新历史、校验摘要、切换审计 | 锁 Checkpoint；比较 Attempt `status=succeeded`、`ended_at < expires_at`（成功接受时未过期）、Attempt/Task 来源、范围、策略版本、水位、替代/失效状态及既有投影发布条件；不比较推进 Checkpoint 时的当前时间与原 `expires_at`；只有对应有效成功 Attempt 可推进 | 截止前成功接受的结果允许在截止后推进 Checkpoint；低水位只写 staging；同水位同摘要幂等；旧/迟到或已失去来源资格的 Attempt 拒绝，不覆盖 active 结果 | Checkpoint/审计更新回滚 | 触发下一 Task 可异步 |
| TX-IDENTITY-001 Entity 合并/拆分 | 身份存在；无未处理歧义；有治理权限 | Entity、现有绑定、未完成治理记录 | Merge/Split Record、成员、后续映射/失效标记 | 锁源/目标 Entity 和当前治理版本 | request key 幂等；循环和自引用拒绝 | 治理记录、成员、映射一起回滚 | 派生图/搜索重建异步 |
| TX-APPROVAL-002 记录 Approval Invalidation | Approval 存在且发现绑定输入或策略变化 | Approval、Candidate、Bundle、Revision、Validation、已有 Invalidation | `approval_invalidation_record`、失效审计 | 锁 Approval；比较 reason/trigger version | `(approval_id, reason_code, trigger_version)` 幂等；原 Approval 不改 | Invalidation 和审计回滚 | 新 Approval 由后续独立事务创建 |
| TX-PUBLICATION-001 记录 Publication Record | Canonical Text Version committed；有发布权限；请求键可用 | Text Version、Commit、当前发布记录、请求键 | 新 Publication Record、发布审计 | 锁正文身份和当前发布指针 | 同正文+request_key 返回原记录；撤回使用新 request_key | 发布记录和审计回滚 | Impact Assessment 可异步 |
| TX-IMPACT-001 生成 Impact Assessment/Item | 触发 Commit、原 Publication Record 和目标 Watermark 存在；请求键可用 | Commit、Publication、下游 Scene/Chapter、策略、请求键 | Assessment、Item、审计 | 锁评估输入版本；比较请求键和输入 hash | 同触发 Commit+策略+request_key 幂等；目标水位变化或主动重评估使用新 request_key，历史保留 | Assessment/Item 回滚 | 不自动生成 Commit 或修改下游 |

## 4. Canon Commit 18 个原子步骤的物理承接

以下 18 步都属于 `TX-CANON-001` 的同一 Canon 原子事务；第 18 步明确区分数据库提交和提交后的投影动作。数据库内部序列取号不等于成功 Canon Watermark，失败或回滚不推进成功水位。

| 步骤 | 物理读取/写入 | 锁或版本检查 | 事务归属 | 失败行为 |
|---|---|---|---|---|
| 1. 幂等键与 payload hash | **前置物理动作：先锁定目标 `novel` 行**；随后读 `canon_commit` 唯一键、请求规范化摘要和已有 `payload_hash` | 锁 `(novel_id,idempotency_key)`；同 hash 返回既有结果，异 hash 拒绝；后续步骤复用 Novel 锁 | Canon 原子事务入口准备及业务步骤 1 | 拒绝，不写新 Canon |
| 2. 当前最终 Candidate 与选择历史 | 在已持有 Novel 锁后，读/锁 `workflow_run.current_candidate_id/current_selection_version` 和选择历史 | 锁 Workflow；比较选择版本和 Candidate 所属 Run；同层按稳定 ID 排序 | Canon 原子事务 | 选择变化拒绝 |
| 3. Scene Task Version 一致性 | 读 Workflow、Candidate、Bundle、Generation Run 的 Task Version | 行锁或版本条件；必须全部相等 | Canon 原子事务 | 不写 Canon 并回滚 |
| 4. Candidate 内容哈希 | 读 Candidate 正文引用/`content_hash`、Assertion/提案自身摘要、来源正文摘要和提交请求摘要输入 | 重算正文 hash 与 Candidate 保存值比较；核对 Assertion/提案属于该 Candidate 且 source/candidate content hash 一致；不要求提案摘要等于正文摘要 | Canon 原子事务 | 任一摘要或归属不符拒绝 |
| 5. 审批绑定及失效检查 | 读 Approval、Invalidation、Candidate、Bundle、Revision、Validation、Policy | 锁 Approval 和失效记录；重新计算有效性 | Canon 原子事务 | 缺失/失效/错绑拒绝 |
| 6. Validation Run | 读 Validation 输入 hash、规则版本、硬问题和结果 | 比较 Candidate、Design、Watermark、Rule Set | Canon 原子事务 | 未通过或过期拒绝 |
| 7. Author Design Revision | 读 Revision 状态、对象版本集合、Exception | 锁/版本比较；冻结 Revision 才可作为提交基线 | Canon 原子事务 | 草案或无例外硬冲突拒绝 |
| 8. Canon Watermark | 复用已在事务入口取得的 Novel 锁，读取该项目最新成功 Commit Sequence/Watermark 和 Candidate 输入水位 | 第 8 步不是首次获取项目锁；读取必须观察已完成前序提交；无成功 Commit 时输入边界为逻辑 0 | Canon 原子事务 | 基线冲突拒绝；失败不推进水位 |
| 9. 权限 | 读 Actor、Capability Grant、Data Scope | 校验 commit 能力、项目、章节、视角和秘密范围 | Canon 原子事务 | 默认拒绝并审计 |
| 10. 逻辑串行化及 Commit Sequence 分配 | 读取已锁定 Novel 的最新成功水位，为成功提交准备逻辑序号 | 只在成功路径确认 Sequence/Watermark；数据库内部序列间隙不代表成功 Canon | Canon 原子事务 | 竞争失败回滚；不把内部序列当成功水位 |
| 11. 创建 Canon Commit | 写 `canon_commit`，绑定 Workflow、Candidate、Selection、Approval、幂等键和输入水位 | FK/唯一键/版本条件 | Canon 原子事务 | 整体回滚 |
| 12. 创建一个 Canonical Text Version | 写一个 `canonical_text_version` 和正文保护引用 | 目标正文身份、Commit FK；每 Commit 至多一个 | Canon 原子事务 | 回滚 Commit 和正文 |
| 13. 创建结构化 Canon 对象及 Commit Item | 写零到多个 Story Event、Canon Fact、State Transition 及类型目标支撑表 | 每对象锁/检查来源、冲突和同 Commit Item | Canon 原子事务 | 任一对象或 Item 不完整则全回滚 |
| 14. 创建 Candidate-to-Canon Mapping | 写 Mapping、Candidate 来源类型支撑、Candidate object hash、Candidate content hash 和 Commit Item 绑定 | Candidate 必须同 Workflow；类型支撑表恰一来源，`candidate_object_hash` 与提案 object_hash、`candidate_content_hash` 与 Candidate content_hash 一致 | Canon 原子事务 | 来源或目标不一致全回滚 |
| 15. 创建替代、反向或补偿关系 | 在 Novel→Workflow/Selection→Candidate/Approval/Validation→Canon 目标/正文身份锁顺序之后，写对应 relation 表 | 锁关系目标时按稳定 ID 排序；不得反向请求 Novel；原 Commit 不可更新 | Canon 原子事务 | 关系不完整则回滚新提交 |
| 16. 推进 Canon Watermark 并更新正文当前版本关系 | 写成功 `success_commit_sequence/canon_watermark`，并更新 `canonical_text_identity.current_canonical_text_version_id` | Novel 锁、水位单调；正文版本必须属于同一 Text Identity 和本 Commit | Canon 原子事务 | 不能推进或正文身份不一致则全回滚；不得写派生投影 |
| 17. 写入全部所需 Projection Outbox | 写每个目标的 Outbox，绑定 Commit、目标 `scope_hash`、水位、策略和事件 hash | `(commit,target,strategy)` 唯一；Outbox scope_hash 与目标范围一致；与 Commit 同事务 | Canon 原子事务 | 任一 Outbox 失败则 Commit 全回滚 |
| 18. 原子提交，随后才创建和执行投影任务 | 数据库提交 Canon、正文、结构化对象、Mapping、关系、水位和全部 Outbox；提交后创建或复用普通 Task，再创建 Attempt | 数据库提交是原子边界；Task/Attempt 使用新短事务；不把 Rebuild Record 作为正常提交必写 | 数据库提交在 Canon 原子事务内；Task/Attempt 在事务外 | 提交失败全部回滚；投影失败只记 Attempt/Failure，不改 Canon |

## 5. 并发与锁定原则

- Candidate、Validation、Model Call 和人工编辑可以并行，因为它们引用不可变输入；当前选择、Approval 有效性和 Canon 水位在提交时仍须重新读取。
- Canon Commit 及修订/撤销/反向/补偿提交的锁顺序固定为：`novel` → Workflow/选择历史 → Candidate/Approval/Validation → Canon 目标/正文身份。事务入口先取得目标 Novel 锁，最新成功水位只在持锁后读取；同层多个对象按稳定 ID 排序。
- 第 8 步复用入口已持有的 Novel 锁，不再次获取；项目无成功 Commit 时使用逻辑水位 0。审批、设计冻结等独立写入路径若与 Canon 实际重叠，必须遵守相同前序锁顺序，不得持有后序对象锁后反向请求 Novel；不重叠的只读路径无需获取项目锁。
- Workflow Run 的当前 Candidate 指针可以变化，但选择历史版本只追加；Canon Commit 同时锁 Workflow 和选择版本，并使用版本条件防止旧提交穿透。
- Approval 不使用可变权威 `status` 代表有效性。有效性由决定、Candidate hash、Bundle、Revision、Validation、Policy、输入 Watermark 和 Invalidation 记录联合计算；提交前必须重新计算。
- 请求幂等与新执行分离：同一请求键返回既有结果；同输入的新 Model Call、Validation Run 或 Impact Assessment 使用新的执行/请求身份，历史结果保留。输入 hash 不自动承担执行唯一性；未知 `digest_spec_version` 不得猜测后继续提交。
- Projection Task 的普通有效状态为 `pending`/`needs_rebuild`，同一 Outbox、目标、策略最多一个有效普通 Task。消费事务必须查询全部既有 Task 状态：pending 复用、needs_rebuild 走显式恢复、completed 返回结果、cancelled/abandoned 返回终止状态；重复消息不得自动恢复终态。
- `projection_attempt` 使用 Attempt ID 作为执行身份，`worker_version` 仅表示软件版本。完成和过期必须在同一受并发保护的短事务中先取得 Attempt 行锁，再以数据库权威时间在状态转换判定点重新检查：成功要求 `status=processing` 且数据库权威时间严格早于 `expires_at`；过期要求 `status=processing` 且数据库权威时间大于或等于 `expires_at`。成功转换在同一事务将 `ended_at` 写为成功接受时间；完成与过期最多一个终态转换成功，清理任务是否已运行不改变截止后的完成判定。Checkpoint 只接受 `status=succeeded` 且 `ended_at < expires_at` 的 Attempt，即成功接受时未过期；截止后推进不再比较当前时间与原 `expires_at`，但仍须通过来源、范围、策略版本、水位、替代/失效和发布条件检查。外部投影写入不因数据库拒绝迟到回写而自动撤销，目标必须用来源 Watermark/范围/策略幂等键和 staging→active 版本切换防止旧执行覆盖当前结果。
- 任何覆盖模型调用、人工审批或完整投影执行的长事务都禁止。具体隔离级别、锁语法和死锁重试策略待产品选型和基准确认。

## 6. 索引设计：从查询模式反推

下表是逻辑索引族，不是索引脚本。唯一约束只承担业务唯一性；若唯一约束已经覆盖同一前缀查询，不再机械创建重复性能索引。索引列必须出现在 `12` 的逐表定义中。

| 索引族 | 目标表 | 查询条件/排序 | 键列顺序 | 唯一性/条件 | 用途与取舍 |
|---|---|---|---|---|---|
| 项目结构 | `volume`、`chapter`、`scene` | 按父对象取顺序 | `novel_id,display_order`；`volume_id,chapter_no`；`chapter_id,scene_no` | 各自组合唯一 | 结构导航；唯一约束已支持同键读取，不另建重复索引 |
| 当前 Design Revision | `author_design_revision` | 按项目找 effective 或按版本号读取 | `novel_id,revision_no`；另有 `novel_id WHERE status=effective` 条件唯一 | 版本编号唯一；effective 条件下项目唯一 | 不把 status 拼入版本编号唯一约束 |
| Task Version | `scene_task_version` | 按 Scene 取版本、按水位回查 | `scene_task_id,version_no`；`scene_task_id,author_design_revision_id,input_canon_watermark` | 第一组唯一；第二组非唯一 | 任务版本和基线回查 |
| Workflow 当前选择 | `workflow_run` | 按主键读取当前候选 | 主键 `workflow_run_id` | 不重复建立 workflow 主键索引 | 当前指针读取 |
| 选择历史 | `workflow_candidate_selection_history` | 按 Run 读取选择序列 | `workflow_run_id,selection_version` | 组合唯一 | 历史顺序与并发版本校验 |
| Candidate 来源链 | `candidate_version` | 按 Run、前序、Bundle、Generation 查询 | `workflow_run_id,created_at`；`previous_candidate_id`；`context_bundle_id,generation_run_id` | 非唯一；按查询负载评估 | 来源追踪；不把 Candidate 设为 Canon |
| Context Bundle | `context_bundle` | 按 Task、水位和 hash 取冻结包 | `scene_task_version_id,input_canon_watermark,content_hash` | 组合唯一 | 重放和 Approval 输入回查 |
| Model Call | `model_call` | 按 Generation 读取调用尝试和请求载荷 | `generation_run_id,call_attempt_no`；`generation_run_id,request_hash` | 尝试序号唯一；request_hash 非唯一 | 支持同输入新调用和历史回查 |
| Impact Assessment | `impact_assessment` | 按触发 Commit、策略、请求键和目标水位查评估 | `trigger_commit_id,strategy_version,request_key`；`trigger_commit_id,target_watermark` | 请求键组合唯一；目标水位不构成执行唯一 | 同请求幂等，主动重评估使用新 request_key |
| Validation | `validation_run`、`validation_result` | 按 Candidate、请求键、规则版本和 hash 查运行 | `candidate_version_id,request_key`；`candidate_version_id,input_hash`；`validation_run_id,rule_version_id` | 请求键组合唯一；input_hash 非唯一 | 同请求幂等，新请求保留新运行历史 |
| Approval 绑定 | `approval_record`、`approval_invalidation_record` | 按 Candidate、request key 和所有绑定输入查 Approval | `candidate_version_id,request_key`；绑定输入列；`approval_id,reason_code,trigger_version` | 请求键组合唯一；Approval 不设可变 status；失效记录组合唯一 | 有效性联合查询；按基准决定覆盖索引，不能代替语义复核 |
| Canon 水位范围 | `canon_commit` | 按项目读取成功提交和水位范围 | `novel_id,success_commit_sequence`；`novel_id,canon_watermark` | committed 条件；失败不纳入成功水位 | 明确区分成功 Sequence 与内部取号 |
| Canon 来源追踪 | `canon_commit`、`candidate_to_canon_mapping` | 按 Candidate/Commit/正文追踪 | `candidate_version_id`；`canon_commit_id,candidate_version_id`；`canon_commit_id` | 非唯一 | 来源和回滚审计 |
| 正文版本 | `canonical_text_version` | 按稳定正文身份取版本、按 hash 回查 | `canonical_text_identity_id,version_no`；`content_hash` | 前者唯一 | 当前正文指针和内容校验 |
| Commit Item 目标 | `canon_commit_item` 及类型支撑表 | 按 Commit 枚举目标 | `canon_commit_id,target_type,target_id`；支撑表目标 ID | 组合唯一 | 保证对象与 Item 完整 |
| Evidence | `evidence_reference` 及四类来源支撑表 | 按来源域/版本/实际来源对象/范围回查；消费方引用按 Evidence ID 回查 | 唯一：`source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind`；检索：`source_domain,source_version_id,locator,evidence_kind` | 前者由父表唯一约束保证；后者非唯一检索索引 | 父 Evidence 与唯一来源支撑行由同一事务校验；消费方不参与去重 |
| 知识/信念 | `knowledge_evidence`、`belief_evidence`、派生表 | 按角色、命题、水位读取 | `character_entity_id,proposition_key,canon_watermark` | 非唯一或按策略唯一 | 分离知识与信念值域 |
| 时间对象 | `temporal_relation`、`temporal_constraint`、`time_interval` | 按来源、主体和关系读取 | `source_domain,source_version_id,left_ref,relation_type,right_ref`；`revision_id,left_ref,constraint_type,right_ref` | 组合唯一 | 明确 source domain，不以视图代事实 |
| Outbox | `projection_outbox` | 取某 Commit 的待投影意图 | `canon_commit_id,target,strategy_version`；`scope_hash` 用于范围回查 | 组合唯一；状态不作为权威事实 | Canon 同事务来源回查 |
| Projection Task | `projection_task` | 按来源、目标、范围取待执行或复用有效任务 | 普通：`origin_type,outbox_id,target,strategy_version`；重建：`origin_type,rebuild_record_id,target,scope_hash,strategy_version` | 普通仅 `pending/needs_rebuild` 条件唯一；普通 scope_hash 必须等于 Outbox；重建按明确范围唯一 | 防止通过改变 scope_hash 创建第二个有效普通 Task |
| Projection Attempt | `projection_attempt` | 按 Task 找最新尝试、处理到期或迟到结果 | `task_id,attempt_no`；`task_id,status,expires_at` | 组合唯一；完成/过期按受锁保护的状态和数据库权威时间条件处理 | 每次重试新 Attempt；成功接受时间记录在 `ended_at`；完成/过期仅一个状态条件更新获胜 |
| Checkpoint | `projection_checkpoint` | 按目标/范围/策略读取 active | `target,normalized_scope_hash,strategy_version,state` | active 条件唯一 | 水位和切换控制 |
| Trace/Cost/Evaluation | `trace_span`、`cost_record`、`evaluation_result` | 按 Run、时间、模型、数据集 | `trace_id,started_at`；`model_call_id,measurement_version`；`run_ref_type,run_ref_id,dataset_version,metric_key` | 原始记录非唯一；评测组合唯一 | 审计和成本回查，写放大按基准评估 |
| 访问审计 | `visibility_decision`、`access_audit_record` | 按主体、资源、创建时间和决定 | `actor_id,created_at`；`resource_type,resource_id,created_at` | 非唯一 | 复用通用 `created_at`，不机械新增时间字段 |

## 6.1 时间区间与证据的物理检查

`time_interval` 通过 `time_interval_source` 的单表 discriminator 绑定实际来源对象；`time_interval_source.time_interval_id` 为必填 FK 且唯一，`time_interval` 不保存反向 `source_binding_id`。数据库延后约束触发器覆盖 `time_interval`、`time_interval_source` 及所有会引用区间的来源对象写入，并在提交前检查：每个区间恰有一个来源绑定；source_type 与目标列匹配；实际来源对象存在；区间与绑定的来源域、版本、项目归属一致；来源对象自身的区间引用与绑定一致。该检查必须覆盖仅创建区间而遗漏来源绑定的路径；领域服务可提前校验，但不能替代数据库最终约束。

创建顺序为：创建区间 → 在同一事务创建或复用需要引用该区间的来源对象 → 创建 `time_interval_source` 及关联 → 执行提交前完整性检查 → 整体提交。区间无绑定只允许存在于未提交事务内部。`TX-CANDIDATE-001` 的 Candidate 提取和 `TX-CANON-001` 的 Canon 原子事务均按此顺序承接；同事务创建的 Canon 来源对象可以参与最终校验，不要求提前提交，失败时相关写入整体回滚。区间来源对象与 Temporal Evidence 是不同关系，历史 Evidence 不要求来自本次 Commit。

Candidate 只能绑定 Candidate Event/Fact Proposal/State Transition；Canon 只能绑定已提交正文、Story Event、Canon Fact 或 State Transition；Author Design 只能绑定 `temporal_constraint`。`source_version_id` 必须等于支撑行选中的实际对象 ID，支撑对象与项目、Revision、Workflow、Candidate 或 Commit 的容器关系必须一致。`temporal_evidence` 还必须使其 Evidence Reference 的来源域/版本与本行一致；来源缺失、错类型、跨项目、跨域或版本不兼容时，事务拒绝并回滚，不发布 Timeline。

Evidence 来源约束按 `12` 的逐类型映射执行，不再对 Candidate/Canon 的容器列使用笼统的“类型列恰一非空”：

Evidence 去重采用父表唯一约束加数据库延后完整性约束的确定方案：父 `evidence_reference` 保存 `source_domain`、`source_version_id`、`source_object_type`、`source_object_id`、`locator` 和 `evidence_kind`，唯一约束只建立在这六列上；旧四字段组合只建立非唯一检索索引，不能拒绝不同实际来源对象。由于实际来源列也存在于类型支撑表，不能把跨表字段写成普通单表唯一索引；数据库延后约束触发器在同一短事务提交前检查父字段与唯一来源支撑行完全一致，并执行四类来源的类型、对象、容器、版本和项目归属校验。

父表与支撑表采用一对一父键和同一写入事务：父行先取得唯一身份约束，支撑行必须引用该父行；支撑行缺失、多个支撑行、类型或 ID 不一致、类型专属 FK 悬空或归属不符时，整个事务回滚。并发相同完整身份由父表唯一约束原子裁决，不能依赖先查询后插入；冲突事务只能复用已提交 Evidence 或返回重复。四类来源的身份映射为：Design 使用 Design Revision 加实际设计对象；Candidate 使用 Candidate Version 加 Candidate 实际对象；Canon 使用正文/Commit/内部 Canon 对象及既有 Commit 容器组合；Tool 固定为 `tool_call` 加 `tool_call_id`，其 `source_version_id` 由 `tool_call.generation_run_id` 校验。消费方不参与唯一身份，多个消费方可共享同一 Evidence。

- `evidence_candidate_source` 的行级 CHECK 负责 `source_object_type` 与目标列空值组合、`source_object_id` 相等关系；`candidate_version` 类型要求全部子对象目标列为空且 `source_object_id=candidate_version_id`，其余类型只允许对应子对象目标列非空。`candidate_version_id` 是子对象的容器字段，不计入互斥目标数量。目标 FK 负责对象存在性；数据库延后约束强制校验父子来源、容器、项目、Workflow 和 `source_version_id` 一致性，领域服务可提前校验 Candidate 子对象及 Narrative Assertion 是否属于指定 Candidate Version。
- `evidence_canon_source` 的行级 CHECK 负责六种类型的目标列组合和 `source_object_id` 相等关系。直接引用正文时 `canonical_text_version_id` 与所属 `canon_commit_id` 同时必填；直接引用 Commit 时仅 `canon_commit_id` 作为目标；引用内部对象时只允许对应目标列与 `canon_commit_id` 同时非空，`canon_commit_id` 不计入子对象目标互斥数量。目标 FK 负责对象存在性；数据库延后约束强制校验正文或内部对象确由指定 Commit 创建、Commit 已成功提交，并校验 Evidence、目标、Commit 的 Novel 范围及 `source_version_id` 映射一致，提交服务可提前校验。
- `evidence_design_source` 继续使用既有类型专属目标列恰一匹配规则。四类来源都必须先匹配父 `evidence_reference.source_domain`，并额外匹配父 `source_object_type/source_object_id` 与支撑行实际目标；任何类型/目标组合、容器归属、版本、项目范围或父子来源不一致都拒绝整个写入事务。

## 7. 需要领域服务或异步系统配合的规则

数据库不能独立判断世界规则、人物性格、因果完整性、秘密是否泄露、Approval Policy 是否适用、设计与正文语义冲突、读者视角下的披露程度或 Timeline 关系闭包。它必须提供不可变记录、关系存在性、互斥来源、值域、唯一性和短事务边界；领域服务负责语义判定；异步校验负责质量扫描、影响评估和投影对账，不能替代 `INV-CANDIDATE-002`、`INV-APPROVAL-002`、Canon 基数约束、`INV-COMMIT-SEQ-001` 等提交前硬门禁。

`12` 中的 JSON 仅保存扩展属性、复杂表达式或受保护配置载荷。`design_object_version.core_attributes` 的硬约束必须回查 `design_constraint`；`scene_task_version.task_constraints` 的硬约束必须回查版本化设计约束；`execution_role.capability_set_ref` 不得直接授予能力，必须解析到 `capability/capability_grant/data_scope`；`data_scope.secret_scope` 只能作为带格式版本的裁剪表达式，最终授权由 Data Scope、Capability Grant 和 Visibility Decision 决定。

## 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.1.7 | 2026-09-23 | 草案 | 修复 Time Interval 来源绑定创建循环并校正审批锁顺序与 Evidence 执行职责 |
| 0.1.6 | 2026-09-23 | 草案 | 收口 Evidence 完整来源身份的唯一约束、跨表原子校验和并发重复处理 |
| 0.1.5 | 2026-09-23 | 草案 | 明确 Projection Attempt 截止时点、成功接受时间和 Checkpoint 延迟推进语义 |
| 0.1.4 | 2026-09-23 | 草案 | 同步 Candidate 与 Canon Evidence 来源的类型组合及约束执行位置 |
| 0.1.3 | 2026-09-22 | 草案 | 统一 Canon 锁顺序，补齐时间/证据来源校验、摘要规范版本、Task 重复消费和 Attempt 过期控制 |
| 0.1.2 | 2026-09-22 | 草案 | 分离正文与提交摘要，收口字段/外键/唯一约束、Novel 水位锁、运行生命周期和 Projection Task 唯一性 |
| 0.1.1 | 2026-09-22 | 草案 | 按 11 逐条落实不变量和事务，逐项承接 Canon Commit 18 步，修正 Approval、投影来源、并发与索引边界 |
| 0.1.0 | 2026-09-22 | 草案 | 建立全部 INV/TX 落实矩阵、Canon Commit 物理承接、并发边界和查询索引设计 |
