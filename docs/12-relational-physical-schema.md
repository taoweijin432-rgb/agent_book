# 关系数据库物理 Schema 设计

- 文档编号：DOC-12
- 版本：0.1.7
- 状态：草案
- 更新时间：2026-09-23
- 规范性依赖：[产品需求](02-product-requirements.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[叙事数据模型](06-narrative-data-model.md)、[Canon 正式提交协议](08-canon-commit-protocol.md)、[数据库逻辑模型](09-database-logical-model.md)、[逻辑实体目录](10-logical-entity-catalog.md)、[数据不变量与事务边界](11-data-invariants-and-transaction-boundaries.md)
- 参考性引用：[系统架构](05-system-architecture.md)、[上下文组装规范](07-context-assembly-spec.md)

## 1. 文档边界与数据库基线

本文件把 `09`、`10`、`11` 的逻辑模型转换为可评审的关系数据库物理设计基线，但不输出可执行 SQL、ORM、迁移文件或索引脚本。列名和数据库类型类别可以在本文件确定；具体 DDL、数据库产品参数和部署拓扑留到后续评审。
Candidate 与 Canon 严格分离。Candidate 与 Canon 在物理表层严格分离：Candidate 相关表不得通过外键或状态值直接变成 Canon 表；只有 Canon Commit 事务创建 Candidate-to-Canon Mapping 和 Canon 对象。

当前仓库没有正式批准的数据库产品选型，也没有检测到与 PostgreSQL 兼容关系数据库冲突的正式技术栈。因此，本文件采用 **PostgreSQL 兼容关系数据库作为建议性物理设计基线，状态为待确认**。这不是业务批准，也不要求后续实现必须使用 PostgreSQL；若正式选型改变，必须重新评审类型、约束、索引和并发部分，不得同时维护两套完整 Schema。

基线原则如下：

- 字符集建议使用 UTF-8；排序规则和不区分大小写的名称比较必须按字段查询需求明确，不用数据库默认排序隐式决定业务唯一性。
- 业务故事时间、记录时间和提交时间分离；数据库时间统一按 UTC 记录，展示时区由应用层或项目配置决定。数据库时区策略待部署评审确认。
- 表、列、约束和索引采用 `snake_case`；稳定身份以 `*_id` 表示，版本以 `*_version_id` 或明确的版本序号表示，时间以 `*_at` 表示，hash 以 `*_hash` 表示。
- 主键建议使用不可猜测的 UUID 类标识；需要严格排序的序列使用独立的逻辑序号或数据库序列语义，但不能把序号当作身份。
- 外键用于结构归属、不可变来源和提交映射；跨真实源的语义一致性仍由领域服务和事务检查负责，不能只依赖外键存在。
- Author Design、Candidate、Approval、Canon、Outbox 和关键审计绑定以追加/不可变为主。Workflow Run、Generation Run、Model Call、Validation Run、Projection Task、Projection Attempt、Projection Checkpoint、Projection Rebuild Record、Trace 和影响评估等运行记录的身份、来源、输入版本和请求载荷绑定不可变；运行中状态、结束时间、结果引用和失败信息可以按各表定义受控更新，终态结果不得被重跑覆盖。失效、废弃、撤销、替代和归档通过状态或关系记录表达；物理删除只适用于经保留策略批准的非权威派生缓存，当前保留期限待决策。
- 核心身份、版本、状态、权限、约束、来源、Candidate/Canon 关联和提交关系必须使用规范化列及关系表，不能只放在 JSON 或 EAV 中。
- JSON/JSONB 类扩展属性只用于不稳定的扩展属性、模型原始请求/响应、受控编译载荷或脱敏快照；不得承载 Candidate 身份、Approval 绑定、Canon Commit 归属、Scene Task Version 或权限边界。
- 正文、秘密、Prompt、模型请求/响应、Context Bundle 内容和工具结果属于高敏或最高敏数据；物理层应支持受保护对象存储引用、加密列/加密卷和最小权限，具体密钥方案待安全评审。

## 2. 逻辑实体完整映射

`10` 共包含 **93 个逻辑实体目录条目**。以下每个条目恰有一个主物理映射结论；共享同一物理表时通过 `object_type`、来源域或关系角色区分，不把共享映射误解为新增业务实体。

| 逻辑实体 | 物理实现 | 物理对象 | 权威性质 | 说明 |
|---|---|---|---|---|
| Project/Novel | 独立表 | novel | 结构权威记录 | 作品根结构；项目归属和归档边界 |
| Volume | 独立表 | volume | 结构权威记录 | 归属于 novel；顺序受项目范围约束 |
| Chapter | 独立表 | chapter | 结构权威记录 | 归属于 volume；发布状态由 publication_record 表达 |
| Scene | 独立表 | scene | 结构权威记录 | 归属于 chapter；规划和任务入口 |
| Entity | 独立表 | entity | 跨域权威身份记录 | 稳定身份锚点，不承载完整设计或 Canon 状态 |
| Entity Alias | 关系表 | entity_alias | 跨域身份记录 | 别名和指代；按实体和适用范围唯一 |
| Entity Merge/Split Record | 独立表 | entity_merge_split_record | 身份治理记录 | 追加记录；不改写历史引用 |
| Design-to-Entity Binding | 关系表 | design_to_entity_binding | 跨域映射记录 | 绑定设计对象身份和 Entity，并带适用 Revision |
| Canon-to-Entity Reference | 关系表 | canon_to_entity_reference | 跨域映射记录 | 绑定 Canon 对象引用和 Entity |
| Author Design Revision | 不可变版本表 | author_design_revision | Author Design Source | 设计修订及生效范围；确认后不可变 |
| Design Object Identity | 独立表 | design_object_identity | Author Design Source | 稳定设计对象身份 |
| Design Object Version | 不可变版本表 | design_object_version | Author Design Source | 按 object_type 承载人物/地点/组织/物品等具体版本 |
| Design Constraint | 不可变版本表 | design_constraint | Author Design Source | 硬/软约束、严重级别和适用范围 |
| Outline Node | 不可变版本表 | outline_node | Author Design Source | 大纲目标和完成判据 |
| Character Design | 不可变版本表 | design_object_version(character) | Author Design Source | 以 object_type=character 的设计版本承载 |
| Location Design | 不可变版本表 | design_object_version(location) | Author Design Source | 以 object_type=location 的设计版本承载 |
| Organization Design | 不可变版本表 | design_object_version(organization) | Author Design Source | 以 object_type=organization 的设计版本承载 |
| Item Design | 不可变版本表 | design_object_version(item) | Author Design Source | 以 object_type=item 的设计版本承载 |
| World Rule | 不可变版本表 | world_rule | Author Design Source | 世界规则及适用范围 |
| Plot Arc | 独立表 | plot_arc | Author Design Source | 剧情弧稳定身份和当前生效版本引用 |
| Foreshadowing Plan | 不可变版本表 | foreshadowing_plan | Author Design Source | 伏笔设计和回收条件 |
| Secret Definition | 不可变版本表 | secret_definition | Author Design Source | 秘密真相和披露边界；受保护 |
| Ending Constraint | 不可变版本表 | ending_constraint | Author Design Source | 结局约束和适用范围 |
| Scene Task | 不可变版本表 | scene_task_version | Execution Record | 任务版本；scene_task 作为稳定身份容器 |
| Context Bundle | 不可变版本表 | context_bundle | Execution Record | 冻结上下文包和输入水位 |
| Context Item | 某聚合下的明细表 | context_item | Execution Record | Bundle 内条目；顺序、来源和裁剪结果 |
| Context Source Reference | 某聚合下的明细表 | context_source_reference | Execution Record | Context Item 的来源版本和证据定位 |
| Prompt Version | 不可变版本表 | prompt_version | Execution/Audit Record | Prompt 模板和编译规则版本 |
| Model Configuration | 不可变版本表 | model_configuration | Execution/Audit Record | 模型、参数和随机性配置版本 |
| Workflow Run | 独立表 | workflow_run | 权威运行记录 | 绑定一个 Scene Task Version；保存当前 Candidate 指针和选择序号 |
| Generation Run | 独立表 | generation_run | Execution Record | 绑定 Workflow Run 和固定 Context Bundle |
| Model Call | 独立表 | model_call | Audit/Execution Record | 实际请求/响应引用、hash 和调用状态 |
| Tool Call | 独立表 | tool_call | Audit/Execution Record | 受限工具调用和结果引用 |
| Cost Record | 独立表 | cost_record | Audit Record | Token、成本、耗时和计量口径 |
| Trace Span | 独立表 | trace_span | Audit Record | 调用链和阶段观测 |
| Candidate Version | 不可变版本表 | candidate_version | Candidate Record | 候选正文；严格不属于 Canon |
| Narrative Assertion | 独立表 | narrative_assertion | Candidate/Canon Evidence Record | 候选或 Canon 正文断言及证据定位 |
| Candidate Event | 独立表 | candidate_event | Candidate Record | 候选事件提案 |
| Candidate Fact Proposal | 独立表 | candidate_fact_proposal | Candidate Record | 候选事实提案 |
| Candidate State Transition | 独立表 | candidate_state_transition | Candidate Record | 候选状态变化提案 |
| Candidate-to-Canon Mapping | 关系表 | candidate_to_canon_mapping | Governance Record | Candidate 到 Canon 对象的提交映射 |
| Validation Run | 独立表 | validation_run | Governance Record | 固定 Candidate 输入上的一次校验运行 |
| Validation Rule Version | 不可变版本表 | validation_rule_version | Governance Record | 规则、严重级别和阈值版本 |
| Validation Issue | 独立表 | validation_issue | Governance Record | 问题、证据和阻断级别 |
| Validation Result | 独立表 | validation_result | Governance Record | 规则/指标结果；追加保存 |
| Repair Record | 独立表 | repair_record | Execution/Governance Record | 前后 Candidate 和重校验链 |
| Approval Record | 独立表 | approval_record | Governance Record | 绑定唯一 Candidate 身份及全部审批输入 |
| Approval Invalidation Record | 独立表 | approval_invalidation_record | Governance Record | Approval 失效追加记录 |
| Constraint Exception | 不可变版本表 | constraint_exception | Governance Record | 硬约束例外授权 |
| Canon Commit | 独立表 | canon_commit | Canon/Governance Record | 不可变提交账本；绑定当前最终 Candidate |
| Canon Commit Item | 某聚合下的明细表 | canon_commit_item | Canon Record | Commit 写入的结构化对象清单 |
| Canonical Text Identity | 独立表 | canonical_text_identity | Canon Structure | 正文逻辑身份 |
| Canonical Text Version | 不可变版本表 | canonical_text_version | Canon Narrative Source | 正式正文版本；不可原地修改 |
| Publication Record | 独立表 | publication_record | Canon/Governance Record | 发布、撤回和重新发布决定 |
| Impact Assessment | 独立表 | impact_assessment | Governance/Derived Record | 发布修订影响分析 |
| Impact Item | 某聚合下的明细表 | impact_item | Governance/Derived Record | 影响分析明细 |
| Story Event | 不可变版本表 | story_event | Canon Narrative Source | 已确认发生的事件 |
| Canon Fact | 不可变版本表 | canon_fact | Canon Narrative Source | 已确认事实 |
| State Transition | 不可变版本表 | state_transition | Canon Narrative Source | 已确认状态变化 |
| Canon Commit Sequence / Canon Watermark | 不可变版本表 | canon_commit（受控列组） | Canon/Governance Record | Sequence 和 Watermark 随成功 Commit 产生；不独立成叙事实体 |
| Supersession Relation | 关系表 | supersession_relation | Canon/Governance Record | 替代关系；追加不可变 |
| Reversal Relation | 关系表 | reversal_relation | Canon/Governance Record | 反向效果关系；追加不可变 |
| Compensation Relation | 关系表 | compensation_relation | Canon/Governance Record | 补偿关系；追加不可变 |
| Evidence Reference | 独立表 | evidence_reference | Cross-domain Evidence Record | 正文片段、作者决定或工具证据 |
| State Dimension | 不可变版本表 | state_dimension | Author Design/Controlled Registry | 允许追踪的状态维度和值域 |
| Derived Current State | 派生表或物化结果 | derived_current_state | Derived Projection | 由 Canon 状态记录重建 |
| Character Knowledge State | 派生表或物化结果 | character_knowledge_state | Derived Projection | 由 Knowledge Evidence 重建；缺失为 unknown |
| Character Belief State | 派生表或物化结果 | character_belief_state | Derived Projection | 由 Belief Evidence 重建 |
| Knowledge Evidence | 不可变版本表 | knowledge_evidence | Canon Evidence | 角色知道命题的证据 |
| Belief Evidence | 不可变版本表 | belief_evidence | Canon Evidence | 角色相信命题的证据 |
| Reader Disclosure Evidence | 不可变版本表 | reader_disclosure_evidence | Canon Evidence | 读者披露证据 |
| Reader Disclosure State | 派生表或物化结果 | reader_disclosure_state | Derived Projection | 按 Canon Watermark 和视角重建 |
| Temporal Relation | 不可变版本表 | temporal_relation | Canon Narrative Source | 仅承载提交确认的 Canon 时间关系；候选时间信息留在 Candidate 提案/证据 |
| Temporal Constraint | 不可变版本表 | temporal_constraint | Author Design Source | 设计时间约束 |
| Time Interval | 独立表 | time_interval | Temporal Record | 时间区间或相对窗口 |
| Temporal Evidence | 独立表 | temporal_evidence | Evidence Record | 时间证据及来源域 |
| Derived Timeline View | 视图 | v_derived_timeline | Derived Projection | 由时间关系、约束和区间查询/重建 |
| Design Fulfillment State | 派生表或物化结果 | design_fulfillment_state | Derived Projection | 按 Canon Watermark 计算设计完成度 |
| Projection Outbox | 独立表 | projection_outbox | Authoritative Runtime Record | Canon Commit 同事务产生 |
| Projection Task | 独立表 | projection_task | Projection Runtime Record | 普通或重建投影任务；来源互斥 |
| Projection Attempt | 独立表 | projection_attempt | Projection Runtime Record | 事务外执行尝试 |
| Projection Checkpoint | 独立表 | projection_checkpoint | Projection Runtime Record | 按目标/范围/策略唯一；记录最高 Watermark |
| Projection Failure | 独立表 | projection_failure | Projection Runtime Record | Attempt 失败记录 |
| Projection Rebuild Record | 独立表 | projection_rebuild_record | Projection Runtime Record | 重建范围、来源水位和切换依据 |
| Actor/Principal | 独立表 | actor_principal | Authorization Record | 作者、服务或 Agent 身份 |
| Execution Role | 不可变版本表 | execution_role | Authorization Record | 执行角色及版本 |
| Capability | 不可变版本表 | capability | Authorization Record | 受限动作和资源域 |
| Capability Grant | 不可变版本表 | capability_grant | Authorization Record | 主体能力授予及范围 |
| Data Scope | 不可变版本表 | data_scope | Authorization Record | 项目、场景、视角、水位和秘密范围 |
| Visibility Decision | 独立表 | visibility_decision | Authorization Record | 一次读取授权决定 |
| Access Audit Record | 独立表 | access_audit_record | Audit/Authorization Record | 访问和拒绝审计 |
| Human Change Record | 独立表 | human_change_record | Audit Record | 人工修改差异和原因 |
| Evaluation Result | 独立表 | evaluation_result | Audit Record | 质量评测样本和结果 |

映射统计：独立表/明细表/关系表/不可变版本表/当前指针/派生表或物化结果/视图/受保护对象存储引用/当前延期均作为单一主映射结论使用；本版本没有把任何逻辑实体标记为当前延期。`Canon Commit Sequence / Canon Watermark` 映射到 `canon_commit` 的受控列组，不生成独立叙事实体。

## 3. 表目录与物理域

下表是可评审的物理对象目录。重要列写成类型类别而非 SQL 语法；“规模”只表示设计等级，不是未经基准验证的容量承诺。

| 物理对象 | 物理域 | 结构与重要列类别 | 关键关系/约束与生命周期 | 敏感/规模 |
|---|---|---|---|---|
| novel | Project Structure | 作品根；`novel_id`、名称、状态、归档标记；唯一外部标识 | 无父表；权威结构记录；归档不删除 | 低敏；小/中 |
| volume | Project Structure | `volume_id`、`novel_id`、顺序、标题、状态 | FK novel；项目内顺序约束 | 低敏；中 |
| chapter | Project Structure | `chapter_id`、`volume_id`、序号、标题、状态 | FK volume；发布由 publication_record 表达 | 中敏；大 |
| scene | Project Structure | `scene_id`、`chapter_id`、顺序、目标引用、状态 | FK chapter；结构身份不可变 | 中敏；大 |
| entity | Entity Identity | `entity_id`、`novel_id`、类别、生命周期 | FK novel；稳定身份唯一 | 中/高敏；大 |
| entity_alias | Entity Identity | `alias_id`、`entity_id`、名称、语言、适用范围 | FK entity；范围内唯一 | 中敏；大 |
| entity_merge_split_record | Entity Identity | `governance_id`、`novel_id`、`request_key`、治理原因、操作者、操作类型、时间 | FK novel；成员由 entity_merge_split_member 互斥角色支撑；追加不可变 | 高敏；小/中 |
| design_to_entity_binding | Entity Identity | 设计对象、Entity、Revision、绑定角色 | FK 两侧；有效区间唯一 | 高敏；中 |
| canon_to_entity_reference | Entity Identity | Canon 对象、Entity、Commit、证据 | FK `canon_commit.canon_commit_id`/Entity；目标复用同 Commit 的四类 Canon Commit Item 支撑；追加不可变 | 高敏；大 |
| author_design_revision | Author Design | `revision_id`、novel、版本序号、状态、生效范围、内容 hash | FK novel；冻结后不可更新 | 高敏；中/大 |
| design_object_identity | Author Design | 设计对象稳定 ID、类型、Entity 关联 | FK entity 可空；身份不可变 | 高敏；大 |
| design_object_version | Author Design | 版本 ID、identity、revision、object_type、结构化核心属性、扩展属性 | FK identity/revision；版本不可变 | 高敏；大 |
| design_constraint | Author Design | 约束 ID、revision、严重级别、规则、范围、例外条件 | FK revision；生效版本不可变 | 高敏；大 |
| outline_node | Author Design | 节点 ID、arc、版本、目标、前后置、完成判据 | FK plot_arc；版本不可变 | 高敏；大 |
| world_rule | Author Design | 规则 ID、revision、适用范围、规则正文、例外 | FK revision；核心规则结构化 | 高敏；大 |
| plot_arc | Author Design | arc ID、novel、版本引用、状态、边界 | FK novel；历史版本保留 | 高敏；中 |
| foreshadowing_plan | Author Design | 伏笔 ID、arc/node、阶段、触发、回收、废弃条件 | FK arc/node；真相字段保护 | 高敏；中/大 |
| secret_definition | Author Design | secret ID、版本、真相引用/受保护载荷、知情边界 | 受保护对象存储引用优先；不可明文日志 | 最高敏；小/中 |
| ending_constraint | Author Design | 约束 ID、novel/arc、强度、范围、判据 | FK novel/arc；版本不可变 | 高敏；小/中 |
| scene_task / scene_task_version | Scene Task and Context | 稳定 task、版本、`scene_id`、`novel_id`、revision、input watermark、视角、约束、状态 | FK scene、novel、revision；版本不可变 | 高敏；大 |
| context_bundle | Scene Task and Context | bundle ID、task_version、内容 hash、编译器/策略版本、输入水位、状态 | FK scene_task_version；冻结不可更新 | 最高敏；大 |
| context_item | Scene Task and Context | item ID、bundle、顺序、内容引用、来源、裁剪、token | FK bundle；包冻结后不可更新 | 高敏；极大 |
| context_source_reference | Scene Task and Context | item、来源域/ID/版本、证据范围、权限依据 | FK item；只追加 | 最高敏；极大 |
| prompt_version | Scene Task and Context | prompt ID、模板/编译规则、版本、发布状态、保护级别 | 版本唯一；模板不可覆盖 | 高敏；中 |
| model_configuration | Scene Task and Context | 模型 ID、参数、随机性配置、版本、能力声明 | 版本唯一；配置不可覆盖 | 中/高敏；中 |
| workflow_run | Workflow and Generation | run ID、task_version、状态、current_candidate、selection_version、`run_version`、审计 | FK task_version/candidate；状态变化追加审计 | 高敏；大 |
| workflow_candidate_selection_history | Workflow and Generation | selection ID、workflow_run、candidate、动作、序号、有效标记、操作者 | FK workflow/candidate；仅 Workflow 明细，不是业务实体 | 高敏；大 |
| generation_run | Workflow and Generation | run ID、workflow、bundle、prompt、model、状态、输入 hash | FK workflow/bundle/prompt/model；运行记录追加 | 最高敏；极大 |
| model_call | Workflow and Generation | call ID、generation、调用尝试序号、请求/响应保护引用、hash、状态、开始/结束时间 | FK generation；输入绑定不可变，运行结果受控更新 | 最高敏；极大 |
| tool_call | Workflow and Generation | call ID、run、capability、范围、结果引用、失败原因 | FK run/capability；追加 | 高敏；极大 |
| cost_record | Workflow and Generation | run/call、token、成本、耗时、计量口径 | FK run/call；更正追加 | 高敏；极大 |
| trace_span | Workflow and Generation | trace/span、父 span、阶段、时间、状态 | FK run；追加 | 中/高敏；极大 |
| candidate_version | Candidate and Assertion | candidate ID、workflow、前序 candidate、bundle、generation 可空、正文保护引用、内容 hash、状态 | FK workflow/bundle；正文和 hash 不可变 | 最高敏；极大 |
| narrative_assertion | Candidate and Assertion | assertion、source text、candidate/canon 来源、范围、类型、置信 | FK source；追加 | 高敏；极大 |
| candidate_event | Candidate and Assertion | candidate、assertion、参与者、时间关系、置信 | FK candidate/assertion；候选不可变 | 高敏；大 |
| candidate_fact_proposal | Candidate and Assertion | candidate、assertion、主客体、谓词、范围、证据 | FK candidate/assertion；候选不可变 | 高敏；大 |
| candidate_state_transition | Candidate and Assertion | candidate、event、目标、前后状态、证据 | FK candidate/event；候选不可变 | 高敏；大 |
| candidate_to_canon_mapping | Candidate and Assertion | candidate、commit、目标 Canon 对象、结果 | FK candidate/commit；提交后追加 | 高敏；大 |
| validation_run | Validation and Approval | run、candidate、规则集合、快照 hash、结果状态 | FK candidate/revision/watermark；不可覆盖 | 高敏；大 |
| validation_rule_version | Validation and Approval | rule ID、版本、规则正文、阈值、严重级别 | 版本不可覆盖 | 高敏；中 |
| validation_issue | Validation and Approval | issue、run、规则、证据、级别、状态 | FK run/rule；追加 | 高敏；极大 |
| validation_result | Validation and Approval | result、run、规则、通过/失败/不确定、置信 | FK run/rule；追加 | 中/高敏；极大 |
| repair_record | Validation and Approval | record、前/后 candidate、触发问题、差异、重校验 | FK candidate/issue；追加 | 高敏；大 |
| approval_record | Validation and Approval | approval、唯一 candidate、hash、bundle、revision、watermark、validation、policy、决定 | FK all；不可修改 | 最高敏；大 |
| approval_invalidation_record | Validation and Approval | invalidation、approval、原因、输入版本、检测者、时间 | FK approval；追加 | 高敏；大 |
| constraint_exception | Validation and Approval | exception、原约束、原因、范围、授权主体、生效/到期 | FK constraint；版本不可变 | 最高治理敏感；小/中 |
| canon_commit | Canon Commit and Canon Narrative | `canon_commit_id`、`novel_id`、workflow、candidate、selection_version、approval、idempotency、payload hash、sequence、watermark、状态 | FK novel/workflow/candidate/approval；成功不可变 | 最高敏；大 |
| canon_commit_item | Canon Commit and Canon Narrative | commit、目标类别/ID、来源 mapping ID | FK commit；mapping 由延后约束或同事务互相校验；提交内创建 | 高敏；极大 |
| canonical_text_identity | Canon Commit and Canon Narrative | text identity、chapter/scene、稳定归属 | FK chapter/scene；身份不可变 | 中/高敏；大 |
| canonical_text_version | Canon Commit and Canon Narrative | text version、`version_no`、identity、commit、正文保护引用、hash、证据范围 | FK identity/commit；不可更新 | 最高敏；极大 |
| story_event / canon_fact / state_transition | Canon Commit and Canon Narrative | 各自 ID、`novel_id`、`event_key`/`fact_key`/`transition_key`、commit、主体/谓词/状态、证据、有效范围 | FK novel/commit；追加不可变 | 高敏；极大 |
| temporal_relation / temporal_constraint / time_interval / temporal_evidence | Temporal Records | Canon 关系、设计约束、同源区间和证据；来源域、版本、范围和区间键 | Temporal Relation 仅 Canon；Constraint 仅 Author Design；追加 | 高敏；大 |
| supersession_relation / reversal_relation / compensation_relation | Canon Commit and Canon Narrative | 旧/新对象或 commit、原因、证据、范围 | FK commit/object；追加不可变 | 高敏；中/大 |
| evidence_reference | Canon Commit and Canon Narrative | 来源域、对象/版本、正文范围、确认方式 | 跨域引用；追加 | 高敏；极大 |
| publication_record / impact_assessment / impact_item | Publication and Impact Assessment | 发布决定/影响评估/明细；对象版本和范围 | FK text/commit/publication；追加 | 高敏；中/大 |
| state_dimension | Knowledge, Belief and Disclosure | 维度、版本、对象类别、允许值语义 | 版本不可变；设计/受控配置 | 高敏；中 |
| knowledge_evidence / belief_evidence | Knowledge, Belief and Disclosure | 角色、命题、来源 event/fact/text、时间、watermark、证据 | FK Canon evidence；追加 | 高敏；大 |
| character_knowledge_state / character_belief_state | Knowledge, Belief and Disclosure | 角色、命题/fact、watermark、策略、值域 | 派生可替换；只从证据重建 | 高敏；大 |
| reader_disclosure_evidence / reader_disclosure_state | Knowledge, Belief and Disclosure | 披露证据及按 watermarked 视角的状态 | 证据权威、状态派生 | 最高敏；大 |
| derived_current_state / design_fulfillment_state | Knowledge, Belief and Disclosure | 对象/维度/watermark/策略、值、证据摘要 | 派生可重建；不回写源 | 中/高敏；大 |
| v_derived_timeline | Temporal Records | 按 Canon/Design source 分层的查询视图 | 视图；不存事实 | 高敏；查询结果 |
| projection_outbox | Projection Outbox and Execution | outbox、commit、target、source watermark、strategy、event hash | FK commit；与 Canon 同事务，不删除 | 高敏；大/极大 |
| projection_task / projection_attempt / projection_failure | Projection Outbox and Execution | 任务来源、目标、范围、`strategy_version`、状态、attempt、失败 | FK outbox/rebuild；事务外追加 | 中/高敏；极大 |
| projection_checkpoint / projection_rebuild_record | Projection Outbox and Execution | target、normalized scope、strategy、watermark、校验摘要；重建 `novel_id`、来源 Outbox/Commit、范围/切换 | checkpoint 身份唯一；重建暂存后切换 | 中/高敏；中/大 |
| actor_principal / execution_role / capability / capability_grant | Authorization and Visibility | 主体、角色、能力、授权范围、版本、有效期 | FK 主体/角色/能力；撤销追加 | 最高敏；中 |
| data_scope / visibility_decision / access_audit_record | Authorization and Visibility | 范围、水位、视角、决定、原因、访问审计 | FK actor/grant/resource；追加 | 最高敏；极大 |
| human_change_record / evaluation_result | Audit, Trace, Cost and Evaluation | 人工差异/原因/再校验；评测数据集/规则/模型/指标 | FK candidate/commit/run；追加 | 高敏；大 |

表目录中的共享表有明确 discriminator 或来源域：`design_object_version` 区分设计对象类型；`story_event / canon_fact / state_transition` 可采用同一 Canon 提交事务下的分域表，不要求机械合并；`temporal_relation` 与 `temporal_constraint` 必须物理分离；`projection_task` 的普通与重建来源必须互斥；`workflow_candidate_selection_history` 只是 Workflow Run 聚合的持久化明细，不是独立业务实体。

## 3.1 通用列规则与逐表定义约定

以下类型类别是本文件的物理设计词汇，不是 SQL 语法，也不预设长度、索引实现或数据库厂商参数：`ID`（UUID 类主键/外键）、`TEXT`（文本）、`HASH`（固定算法的内容摘要）、`TS`（UTC 时间）、`INT`（整数/序号）、`DECIMAL`（成本或比例）、`BOOL`（布尔）、`ENUM`（受控值域）、`JSON`（受控扩展载荷）、`REF`（受保护对象引用）、`OFFSET`（正文范围）、`WATERMARK`（成功 Canon 读取水位）、`SEQ`（成功提交序号）。除另有说明外，表都使用 `created_at: TS/必填`、`updated_at: TS/必填`、`created_by: ID/必填`；追加不可变表的 `updated_at` 仅为创建时的同值审计列，业务更新被拒绝。

逐表定义中的“业务唯一”是候选唯一性要求；最终使用唯一约束、部分唯一约束或事务检查时，必须保持同一语义。“归档”表示逻辑不可用但保留记录；“删除”只表示经过保留策略批准的物理删除。规模为定性等级，不是容量或性能承诺。下表中的共享前缀由本节集中定义，但每张表仍列出关键列、外键、值域、生命周期和敏感等级。

## 3.2 逐表物理定义

### 项目结构与身份

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本表列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `novel` | Project/Novel；项目结构权威记录 | `novel_id: ID/必填`；`external_key: TEXT/必填`；`title: TEXT/必填`；`status: ENUM/必填`；`archived_at: TS/可空` | 无 | `external_key` 在系统范围唯一 | ID 和外部键不可变；状态可受控更新；归档保留，不物理删除 | 低/小中 |
| `volume` | Volume；项目结构权威记录 | `volume_id: ID/必填`；`novel_id: ID/必填`；`display_order: INT/必填`；`title: TEXT/必填`；`status: ENUM/必填` | `novel_id→novel.novel_id` | `(novel_id, display_order)` 唯一 | 归属不可变；标题/顺序可受控更新；归档保留 | 低/中 |
| `chapter` | Chapter；项目结构权威记录 | `chapter_id: ID/必填`；`volume_id: ID/必填`；`chapter_no: INT/必填`；`title: TEXT/必填`；`status: ENUM/必填` | `volume_id→volume.volume_id` | `(volume_id, chapter_no)` 唯一 | 结构身份不可变；发布状态由发布记录追加表达；不删除已有关联章节 | 中/大 |
| `scene` | Scene；项目结构权威记录 | `scene_id: ID/必填`；`chapter_id: ID/必填`；`scene_no: INT/必填`；`goal_ref: TEXT/可空`；`status: ENUM/必填` | `chapter_id→chapter.chapter_id` | `(chapter_id, scene_no)` 唯一 | 归属和序号变更须审计；归档保留 | 中/大 |
| `entity` | Entity；跨域稳定身份权威记录 | `entity_id: ID/必填`；`novel_id: ID/必填`；`entity_type: ENUM/必填`；`display_name: TEXT/可空`；`lifecycle: ENUM/必填` | `novel_id→novel.novel_id` | `(novel_id, entity_id)` 主键范围唯一 | 身份不可变；合并/拆分只追加治理记录；失效不删除 | 中高/大 |
| `entity_alias` | Entity Alias；身份引用记录 | `alias_id: ID/必填`；`entity_id: ID/必填`；`alias_text: TEXT/必填`；`language: TEXT/必填`；`scope_ref: TEXT/必填`；`valid_to: TS/可空` | `entity_id→entity.entity_id` | `(entity_id, alias_text, scope_ref)` 在有效记录中唯一 | 旧别名只失效；不覆盖历史名称 | 中/大 |
| `entity_merge_split_record` | Entity Merge/Split Record；身份治理权威审计 | `governance_id: ID/必填`；`novel_id: ID/必填`；`request_key: TEXT/必填`；`operation: ENUM(merge,split)/必填`；`reason: TEXT/必填`；`effective_at: TS/必填` | `novel_id→novel.novel_id`；源/目标实体由专属明细表引用 | `(novel_id, request_key)` 唯一；源与目标不得相同 | 追加不可变；历史引用不改写；不删除 | 高/小中 |
| `entity_merge_split_member` | 身份治理支撑表；记录一次治理的源/目标成员 | `member_id: ID/必填`；`governance_id: ID/必填`；`entity_id: ID/必填`；`member_role: ENUM(source,target)/必填` | `governance_id→entity_merge_split_record.governance_id`；`entity_id→entity.entity_id` | `(governance_id, entity_id, member_role)` 唯一；每次治理至少一个 source 和 target | 追加不可变；随治理记录归档 | 高/中 |
| `design_to_entity_binding` | Design-to-Entity Binding；跨域映射记录 | `binding_id: ID/必填`；`design_object_identity_id: ID/必填`；`entity_id: ID/必填`；`author_design_revision_id: ID/必填`；`binding_role: ENUM/必填`；`valid_to: TS/可空` | `design_object_identity_id→design_object_identity.design_object_identity_id`；`entity_id→entity.entity_id`；`author_design_revision_id→author_design_revision.revision_id` | `(design_object_identity_id, author_design_revision_id, binding_role)` 有效期内唯一 | 失效追加新记录；不覆盖适用 Revision | 高/中 |
| `canon_to_entity_reference` | Canon-to-Entity Reference；跨域映射记录 | `reference_id: ID/必填`；`entity_id: ID/必填`；`canon_commit_id: ID/必填`；`canon_object_type: ENUM(story_event,canon_fact,state_transition,canonical_text)/必填`；`canon_object_id: ID/必填` | `entity_id→entity.entity_id`；`canon_commit_id→canon_commit.canon_commit_id`；目标必须复用同 Commit 的四类 Commit Item 类型支撑表之一 | `(canon_commit_id, canon_object_type, canon_object_id, entity_id)` 唯一 | 追加不可变；随 Canon 保留，不删除 | 高/大 |

### 作者设计

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本表列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `author_design_revision` | Author Design Revision；作者设计源权威版本 | `revision_id: ID/必填`；`novel_id: ID/必填`；`revision_no: INT/必填`；`request_key: TEXT/必填`；`status: ENUM(draft,effective,superseded,archived)/必填`；`content_hash: HASH/必填`；`effective_at: TS/可空` | `novel_id→novel.novel_id` | `(novel_id, revision_no)` 唯一；`(novel_id, request_key)` 请求幂等；每项目最多一个 effective 指针 | draft 可更新；effective/superseded 内容不可变；历史不删除 | 高/中大 |
| `design_object_identity` | Design Object Identity；设计对象稳定身份 | `design_object_identity_id: ID/必填`；`novel_id: ID/必填`；`object_type: ENUM/必填`；`entity_id: ID/可空` | `novel_id→novel.novel_id`；`entity_id→entity.entity_id` | `(novel_id, object_type, design_object_identity_id)` 唯一 | 身份和类型不可变；失效保留 | 高/大 |
| `design_object_version` | Design Object Version、Character/Location/Organization/Item Design；作者设计源权威版本 | `design_object_version_id: ID/必填`；`design_object_identity_id: ID/必填`；`revision_id: ID/必填`；`object_type: ENUM(character,location,organization,item,concept)/必填`；`name: TEXT/必填`；`core_attributes: JSON/必填`；`status: ENUM/必填` | `design_object_identity_id→design_object_identity.design_object_identity_id`；`revision_id→author_design_revision.revision_id` | `(design_object_identity_id, revision_id)` 唯一；`object_type` 必须等于身份类型 | 版本不可更新；新设计产生新版本；归档保留 | 高/大 |
| `design_constraint` | Design Constraint；作者设计源约束 | `constraint_id: ID/必填`；`revision_id: ID/必填`；`constraint_type: ENUM/必填`；`severity: ENUM(hard,soft)/必填`；`rule_key: TEXT/必填`；`scope_ref: TEXT/必填`；`exception_policy: JSON/可空` | `revision_id→author_design_revision.revision_id` | `(revision_id, rule_key, scope_ref)` 唯一 | 版本不可变；例外另表；不删除有效约束 | 高/大 |
| `outline_node` | Outline Node；作者设计源目标 | `outline_node_id: ID/必填`；`plot_arc_id: ID/必填`；`revision_id: ID/必填`；`node_key: TEXT/必填`；`goal: TEXT/必填`；`completion_criteria: JSON/必填`；`status: ENUM/必填` | `plot_arc_id→plot_arc.plot_arc_id`；`revision_id→author_design_revision.revision_id` | `(plot_arc_id, revision_id, node_key)` 唯一 | 版本不可变；完成状态由派生表表达 | 高/大 |
| `world_rule` | World Rule；作者设计源规则 | `world_rule_id: ID/必填`；`revision_id: ID/必填`；`rule_key: TEXT/必填`；`rule_text: TEXT/必填`；`scope_ref: TEXT/必填`；`exception_ref: TEXT/可空` | `revision_id→author_design_revision.revision_id` | `(revision_id, rule_key)` 唯一 | 版本不可变；废弃追加新版本 | 高/大 |
| `plot_arc` | Plot Arc；作者设计源稳定弧线 | `plot_arc_id: ID/必填`；`novel_id: ID/必填`；`current_revision_id: ID/可空`；`status: ENUM/必填`；`boundary: JSON/必填` | `novel_id→novel.novel_id`；`current_revision_id→author_design_revision.revision_id` | `(novel_id, plot_arc_id)` 唯一；当前指针最多一个 | 身份不可变；当前版本可变，历史版本不覆盖；归档保留 | 高/中 |
| `foreshadowing_plan` | Foreshadowing Plan；作者设计源伏笔生命周期设计 | `foreshadowing_id: ID/必填`；`revision_id: ID/必填`；`arc_id: ID/可空`；`node_id: ID/可空`；`stage: ENUM/必填`；`trigger: JSON/必填`；`reveal_criteria: JSON/必填`；`secret_ref: ID/可空` | `revision_id→author_design_revision.revision_id`；`arc_id→plot_arc.plot_arc_id`；`node_id→outline_node.outline_node_id`；`secret_ref→secret_definition.secret_id` | `(revision_id, foreshadowing_id)` 唯一；arc/node 至少一个 | 设计版本不可变；推进/回收状态由派生完成度表达 | 高/中大 |
| `secret_definition` | Secret Definition；作者设计源受保护秘密 | `secret_id: ID/必填`；`revision_id: ID/必填`；`truth_ref: REF/必填`；`knowledge_boundary: JSON/必填`；`protection_level: ENUM/必填` | `revision_id→author_design_revision.revision_id` | `(revision_id, secret_id)` 唯一 | 受保护载荷不可原地更新；新 Revision 新记录；密钥失效标记不可重放 | 最高/小中 |
| `ending_constraint` | Ending Constraint；作者设计源结局约束 | `ending_constraint_id: ID/必填`；`revision_id: ID/必填`；`arc_id: ID/可空`；`strength: ENUM/必填`；`criterion: JSON/必填` | `revision_id→author_design_revision.revision_id`；`arc_id→plot_arc.plot_arc_id` | `(revision_id, ending_constraint_id)` 唯一 | 版本不可变；完成度由派生状态表达 | 高/小中 |

### 场景任务、上下文与生成执行

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `scene_task` | Scene Task；执行域稳定任务身份 | `scene_task_id: ID/必填`；`scene_id: ID/必填`；`request_key: TEXT/必填`；`status: ENUM/必填`；`current_version_id: ID/可空` | `scene_id→scene.scene_id`；`current_version_id→scene_task_version.scene_task_version_id`（可延后校验） | `(scene_id, scene_task_id)` 唯一；`(scene_id, request_key)` 请求幂等 | 身份不可变；当前版本可变；归档保留 | 高/大 |
| `scene_task_version` | Scene Task Version；执行域权威版本 | `scene_task_version_id: ID/必填`；`scene_task_id: ID/必填`；`novel_id: ID/必填`；`version_no: INT/必填`；`author_design_revision_id: ID/必填`；`input_canon_watermark: WATERMARK/必填`；`viewpoint_ref: TEXT/必填`；`task_constraints: JSON/必填`；`status: ENUM/必填` | `scene_task_id→scene_task.scene_task_id`；`novel_id→novel.novel_id`；`author_design_revision_id→author_design_revision.revision_id` | `(scene_task_id, version_no)` 唯一 | 版本冻结后不可更新；新任务版本追加；不得覆盖历史水位 | 高/大 |
| `context_bundle` | Context Bundle；执行域冻结输入记录 | `context_bundle_id: ID/必填`；`scene_task_version_id: ID/必填`；`workflow_run_id: ID/可空`；`author_design_revision_id: ID/必填`；`input_canon_watermark: WATERMARK/必填`；`compiler_version: TEXT/必填`；`policy_version: TEXT/必填`；`content_hash: HASH/必填`；`content_ref: REF/必填`；`status: ENUM(frozen,expired)/必填` | `scene_task_version_id→scene_task_version.scene_task_version_id`；`author_design_revision_id→author_design_revision.revision_id`；`workflow_run_id→workflow_run.workflow_run_id` | `(scene_task_version_id, content_hash)` 唯一；冻结后禁止更新 | frozen/expired 只追加状态审计；不得删除被引用包 | 最高/大 |
| `context_item` | Context Item；Bundle 明细 | `context_item_id: ID/必填`；`context_bundle_id: ID/必填`；`item_order: INT/必填`；`item_type: ENUM/必填`；`content_ref: REF/必填`；`selected_reason: TEXT/必填`；`token_count: INT/可空`；`redaction_state: ENUM/必填` | `context_bundle_id→context_bundle.context_bundle_id` | `(context_bundle_id, item_order)` 唯一 | Bundle 冻结后不可变；随 Bundle 保留 | 高/极大 |
| `context_source_reference` | Context Source Reference；来源追踪明细 | `context_source_reference_id: ID/必填`；`context_item_id: ID/必填`；`source_domain: ENUM/必填`；`source_version_id: ID/必填`；`evidence_reference_id: ID/必填`；`evidence_locator: OFFSET/必填`；`permission_basis: JSON/必填` | `context_item_id→context_item.context_item_id`；`evidence_reference_id→evidence_reference.evidence_reference_id`；source_domain/source_version_id 必须与 Evidence 一致 | `(context_item_id, source_domain, source_version_id, evidence_locator)` 唯一 | 追加不可变；Bundle 过期仍保留 | 最高/极大 |
| `prompt_version` | Prompt Version；执行配置权威版本 | `prompt_version_id: ID/必填`；`prompt_key: TEXT/必填`；`version_no: INT/必填`；`template_ref: REF/必填`；`protection_level: ENUM/必填`；`status: ENUM/必填` | 无 | `(prompt_key, version_no)` 唯一 | 版本不可变；停用不删除 | 高/中 |
| `model_configuration` | Model Configuration；执行配置权威版本 | `model_configuration_id: ID/必填`；`model_key: TEXT/必填`；`version_no: INT/必填`；`parameters: JSON/必填`；`capability_declaration: JSON/必填`；`status: ENUM/必填` | 无 | `(model_key, version_no)` 唯一 | 版本不可变；停用保留 | 中高/中 |
| `workflow_run` | Workflow Run；权威运行记录 | `workflow_run_id: ID/必填`；`scene_task_version_id: ID/必填`；`current_candidate_id: ID/可空`；`current_selection_version: INT/必填`；`run_version: INT/必填`；`status: ENUM/必填`；`request_key: TEXT/必填` | `scene_task_version_id→scene_task_version.scene_task_version_id`；`current_candidate_id→candidate_version.candidate_version_id`（延后校验） | `request_key` 在项目/任务范围唯一；当前指针单行 | 当前指针和状态可受控更新；选择历史另表追加；运行记录不物理删除 | 高/大 |
| `workflow_candidate_selection_history` | Workflow Run 聚合明细；不是独立业务实体 | `selection_history_id: ID/必填`；`workflow_run_id: ID/必填`；`selection_version: INT/必填`；`candidate_version_id: ID/可空`；`selection_action: ENUM/select,replace,cancel/必填` | `workflow_run_id→workflow_run.workflow_run_id`；`candidate_version_id→candidate_version.candidate_version_id` | `(workflow_run_id, selection_version)` 唯一；与 current_selection_version 一致 | 追加不可变；不删除、不复用版本号 | 高/大 |
| `generation_run` | Generation Run；执行权威记录 | `generation_run_id: ID/必填`；`workflow_run_id: ID/必填`；`context_bundle_id: ID/必填`；`prompt_version_id: ID/必填`；`model_configuration_id: ID/必填`；`status: ENUM/必填`；`request_key: TEXT/必填` | `workflow_run_id→workflow_run.workflow_run_id`；`context_bundle_id→context_bundle.context_bundle_id`；`prompt_version_id→prompt_version.prompt_version_id`；`model_configuration_id→model_configuration.model_configuration_id` | `(workflow_run_id, request_key)` 唯一 | 输入绑定不可变；执行状态追加审计；模型调用完成后不覆盖输入 | 高/大 |
| `model_call` | Model Call；运行审计/执行记录 | `model_call_id: ID/必填`；`generation_run_id: ID/必填`；`call_attempt_no: INT/必填`；`request_ref: REF/必填`；`response_ref: REF/可空`；`request_hash: HASH/必填`；`response_hash: HASH/可空`；`status: ENUM(started,running,succeeded,failed,cancelled)/必填`；`started_at: TS/必填`；`ended_at: TS/可空`；`result_ref: REF/可空` | `generation_run_id→generation_run.generation_run_id` | `(generation_run_id, call_attempt_no)` 唯一；`request_hash` 非唯一，可支持同输入新调用；终态条件下响应和结果引用不可再覆盖 | 调用身份、输入绑定、请求 hash 不可变；running 可受控写入响应/结束时间/结果；终态不可改写；新尝试新行 | 最高/极大 |
| `tool_call` | Tool Call；受限工具审计记录 | `tool_call_id: ID/必填`；`generation_run_id: ID/必填`；`tool_name: TEXT/必填`；`request_ref: REF/必填`；`response_ref: REF/可空`；`status: ENUM/必填` | `generation_run_id→generation_run.generation_run_id` | `(generation_run_id, tool_call_id)` 唯一 | 不可覆盖工具结果；失败追加重试记录 | 最高/大 |
| `cost_record` | Cost Record；计量审计记录 | `cost_record_id: ID/必填`；`generation_run_id: ID/可空`；`model_call_id: ID/可空`；`token_in: INT/必填`；`token_out: INT/必填`；`cost_amount: DECIMAL/可空`；`measurement_version: TEXT/必填` | `generation_run_id→generation_run.generation_run_id`；`model_call_id→model_call.model_call_id` | `(model_call_id, measurement_version)` 唯一 | 原始计量追加；聚合另行生成，不覆盖 | 中高/极大 |
| `trace_span` | Trace Span；调用链审计记录 | `trace_span_id: ID/必填`；`trace_id: TEXT/必填`；`span_id: TEXT/必填`；`parent_span_id: ID/可空`；`run_ref_type: ENUM/必填`；`run_ref_id: ID/必填`；`status: ENUM(started,completed,error,cancelled)/必填`；`started_at: TS/必填`；`ended_at: TS/可空`；`result_ref: REF/可空` | `parent_span_id→trace_span.trace_span_id` | `(trace_id, span_id)` 唯一 | 身份、父级和开始时间不可变；运行中可更新状态、结束时间和结果引用；终态不覆盖；按审计策略归档 | 中高/极大 |

### 候选、校验与审批

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `candidate_version` | Candidate Version；草稿暂存区记录，不是第三真实源 | `candidate_version_id: ID/必填`；`workflow_run_id: ID/必填`；`context_bundle_id: ID/必填`；`generation_run_id: ID/可空`；`candidate_kind: ENUM(model,repair,human)/必填`；`content_ref: REF/必填`；`content_hash: HASH/必填`；`content_hash_spec_version: TEXT/必填`；`status: ENUM/必填`；`previous_candidate_id: ID/可空` | `workflow_run_id→workflow_run.workflow_run_id`；`context_bundle_id→context_bundle.context_bundle_id`；`generation_run_id→generation_run.generation_run_id`；`previous_candidate_id→candidate_version.candidate_version_id` | 每个 Candidate 一个稳定 ID；`generation_run_id` 对 model 必填、对 repair/human 可空；不能跨 Workflow Run | 正文与绑定输入不可变；状态受控追加；失效不删除 | 最高/极大 |
| `narrative_assertion` | Narrative Assertion；候选抽取或 Canon 正文的断言记录，非独立真实源 | `assertion_id: ID/必填`；`source_domain: ENUM(candidate,canon)/必填`；`candidate_version_id: ID/可空`；`canonical_text_version_id: ID/可空`；`assertion_type: ENUM/必填`；`assertion_hash: HASH/必填`；`source_content_hash: HASH/必填`；`hash_spec_version: TEXT/必填`；`extractor_version: TEXT/必填`；`confidence: DECIMAL/可空` | `candidate_version_id→candidate_version.candidate_version_id`；`canonical_text_version_id→canonical_text_version.canonical_text_version_id`；互斥来源由支撑表确认 | `(candidate_version_id, assertion_hash, extractor_version)` 或 `(canonical_text_version_id, assertion_hash, extractor_version)` 唯一；`source_content_hash` 必须等于对应正文版本 hash | 抽取结果不可覆盖；重新抽取新版本 | 高/极大 |
| `narrative_assertion_candidate_source` | Narrative Assertion 来源支撑；Candidate 正文来源 | `assertion_id: ID/必填`；`candidate_version_id: ID/必填`；`source_version_id: ID/必填` | `assertion_id→narrative_assertion.assertion_id`；`candidate_version_id→candidate_version.candidate_version_id` | 每个 candidate Assertion 恰一来源支撑行；source_version_id 与 candidate 一致 | 追加不可变 | 高/大 |
| `narrative_assertion_canon_source` | Narrative Assertion 来源支撑；Canon 正文来源 | `assertion_id: ID/必填`；`canonical_text_version_id: ID/必填`；`source_version_id: ID/必填` | `assertion_id→narrative_assertion.assertion_id`；`canonical_text_version_id→canonical_text_version.canonical_text_version_id` | 每个 canon Assertion 恰一来源支撑行；source_version_id 与正文一致 | 追加不可变 | 高/大 |
| `candidate_event` | Candidate Event；草稿结构化提案 | `candidate_event_id: ID/必填`；`candidate_version_id: ID/必填`；`event_key: TEXT/必填`；`subject_entity_id: ID/必填`；`predicate: TEXT/必填`；`object_ref: ID/可空`；`story_time_ref: ID/可空`；`object_hash: HASH/必填`；`object_hash_spec_version: TEXT/必填`；`assertion_id: ID/必填` | `candidate_version_id→candidate_version.candidate_version_id`；`subject_entity_id→entity.entity_id`；`story_time_ref→time_interval.time_interval_id`；`assertion_id→narrative_assertion.assertion_id` | `(candidate_version_id, event_key)` 唯一；assertion 必须同 Candidate | 不可变；未提交可失效，不能变 Canon | 高/大 |
| `candidate_fact_proposal` | Candidate Fact Proposal；草稿事实提案 | `candidate_fact_proposal_id: ID/必填`；`candidate_version_id: ID/必填`；`fact_key: TEXT/必填`；`proposed_value: JSON/必填`；`object_hash: HASH/必填`；`object_hash_spec_version: TEXT/必填`；`assertion_id: ID/必填` | `candidate_version_id→candidate_version.candidate_version_id`；`assertion_id→narrative_assertion.assertion_id` | `(candidate_version_id, fact_key)` 唯一 | 不可变；拒绝或提交映射均追加 | 高/大 |
| `candidate_state_transition` | Candidate State Transition；草稿状态提案 | `candidate_state_transition_id: ID/必填`；`candidate_version_id: ID/必填`；`entity_id: ID/必填`；`state_dimension_id: ID/必填`；`transition_key: TEXT/必填`；`from_value: JSON/可空`；`to_value: JSON/必填`；`object_hash: HASH/必填`；`object_hash_spec_version: TEXT/必填`；`assertion_id: ID/必填` | `candidate_version_id→candidate_version.candidate_version_id`；`entity_id→entity.entity_id`；`state_dimension_id→state_dimension.state_dimension_id`；`assertion_id→narrative_assertion.assertion_id` | `(candidate_version_id, entity_id, state_dimension_id, transition_key)` 唯一 | 不可变；不能原地变为 Canon State Transition | 高/大 |
| `candidate_to_canon_mapping` | Candidate-to-Canon Mapping；提交映射权威记录 | `mapping_id: ID/必填`；`canon_commit_id: ID/必填`；`candidate_version_id: ID/必填`；`candidate_object_type: ENUM(candidate_event,candidate_fact_proposal,candidate_state_transition)/必填`；`candidate_object_id: ID/必填`；`canon_commit_item_id: ID/必填`；`candidate_object_hash: HASH/必填`；`candidate_content_hash: HASH/必填` | `canon_commit_id→canon_commit.canon_commit_id`；`candidate_version_id→candidate_version.candidate_version_id`；`canon_commit_item_id→canon_commit_item.commit_item_id` | `(canon_commit_id, candidate_object_type, candidate_object_id)` 唯一；`candidate_object_hash` 必须等于来源提案 object_hash，`candidate_content_hash` 必须等于 Candidate content_hash；两端必须属于同一 Workflow/Commit | 追加不可变；不得删除有效映射 | 高/极大 |
| `candidate_to_canon_candidate_source` | Candidate-to-Canon Mapping 来源支撑；候选对象来源 | `mapping_id: ID/必填`；`candidate_object_type: ENUM(candidate_event,candidate_fact_proposal,candidate_state_transition)/必填`；`candidate_object_id: ID/必填`；`candidate_event_id: ID/可空`；`candidate_fact_proposal_id: ID/可空`；`candidate_state_transition_id: ID/可空` | `mapping_id→candidate_to_canon_mapping.mapping_id`；各类型列分别 FK 对应 Candidate 提案表 | 每个 Mapping 恰一来源支撑行；三类类型列恰一非空；`candidate_object_id` 必须等于对应类型列；对象属于 mapping 的 Candidate Version | 追加不可变 | 高/大 |
| `validation_run` | Validation Run；校验权威运行记录 | `validation_run_id: ID/必填`；`candidate_version_id: ID/必填`；`request_key: TEXT/必填`；`author_design_revision_id: ID/必填`；`input_canon_watermark: WATERMARK/必填`；`rule_set_version: TEXT/必填`；`result: ENUM(running,pass,fail,inconclusive,invalidated)/必填`；`input_hash: HASH/必填`；`started_at: TS/必填`；`ended_at: TS/可空`；`result_ref: REF/可空` | `candidate_version_id→candidate_version.candidate_version_id`；`author_design_revision_id→author_design_revision.revision_id` | `(candidate_version_id, request_key)` 唯一；`input_hash` 非唯一，可支持同输入新运行；运行中结果可受控更新，终态不覆盖 | 输入绑定不可变；running 可更新结果/结束时间/结果引用；终态不可改写；新请求新运行身份 | 高/大 |
| `validation_rule_version` | Validation Rule Version；校验配置版本 | `validation_rule_version_id: ID/必填`；`rule_key: TEXT/必填`；`version_no: INT/必填`；`severity: ENUM(hard_blocking,soft_warning,info,uncertain)/必填`；`rule_ref: REF/必填` | 无 | `(rule_key, version_no)` 唯一 | 版本不可变；停用保留 | 高/中 |
| `validation_issue` | Validation Issue；校验问题记录 | `validation_issue_id: ID/必填`；`validation_run_id: ID/必填`；`rule_version_id: ID/必填`；`severity: ENUM/必填`；`issue_key: TEXT/必填`；`evidence_ref: ID/可空`；`resolution: ENUM/可空` | `validation_run_id→validation_run.validation_run_id`；`rule_version_id→validation_rule_version.validation_rule_version_id`；`evidence_ref→evidence_reference.evidence_reference_id` | `(validation_run_id, issue_key)` 唯一 | 追加不可变；修复由 Repair Record 关联 | 高/极大 |
| `validation_result` | Validation Result；规则结果明细 | `validation_result_id: ID/必填`；`validation_run_id: ID/必填`；`rule_version_id: ID/必填`；`result: ENUM(pass,fail,inconclusive,invalidated)/必填`；`score: DECIMAL/可空` | `validation_run_id→validation_run.validation_run_id`；`rule_version_id→validation_rule_version.validation_rule_version_id` | `(validation_run_id, rule_version_id)` 唯一 | 追加不可变；重跑新 Validation Run | 中高/极大 |
| `repair_record` | Repair Record；候选修复来源链 | `repair_record_id: ID/必填`；`workflow_run_id: ID/必填`；`input_candidate_id: ID/必填`；`output_candidate_id: ID/必填`；`validation_issue_id: ID/可空`；`repair_kind: ENUM/必填`；`diff_ref: REF/必填` | `workflow_run_id→workflow_run.workflow_run_id`；输入/输出→candidate_version.candidate_version_id；`validation_issue_id→validation_issue.validation_issue_id` | `(input_candidate_id, output_candidate_id)` 唯一；两 Candidate 同 Workflow Run | 追加不可变；不得覆盖输入 Candidate | 高/大 |
| `approval_record` | Approval Record；审批权威记录 | `approval_id: ID/必填`；`candidate_version_id: ID/必填`；`request_key: TEXT/必填`；`candidate_content_hash: HASH/必填`；`context_bundle_id: ID/必填`；`author_design_revision_id: ID/必填`；`input_canon_watermark: WATERMARK/必填`；`validation_run_id: ID/必填`；`approval_policy_version: TEXT/必填`；`decision: ENUM/必填`；`decided_at: TS/必填` | Candidate、Bundle、Revision、Validation 的 FK；`workflow_run_id` 不作为 Approval 归属依据 | `(approval_id)` 唯一；`(candidate_version_id, request_key)` 请求幂等；有效性由决定、绑定 hash 和失效记录联合查询，不设置权威可变 status | 决定和绑定不可修改；失效追加记录；原 Approval 保留 | 最高/大 |
| `approval_invalidation_record` | Approval Invalidation Record；审批失效审计 | `invalidation_id: ID/必填`；`approval_id: ID/必填`；`reason_code: ENUM/必填`；`trigger_type: ENUM/必填`；`trigger_version: TEXT/必填`；`detected_at: TS/必填` | `approval_id→approval_record.approval_id` | `(approval_id, reason_code, trigger_version)` 唯一 | 追加不可变；不得更新 Approval；stale 由有效性查询派生 | 最高/大 |
| `constraint_exception` | Constraint Exception；人工例外授权记录 | `exception_id: ID/必填`；`constraint_id: ID/必填`；`scope_ref: TEXT/必填`；`reason: TEXT/必填`；`granted_by: ID/必填`；`effective_at: TS/必填`；`expires_at: TS/可空` | `constraint_id→design_constraint.constraint_id`；`granted_by→actor_principal.actor_id` | `(constraint_id, scope_ref, effective_at)` 唯一 | 授权范围不可修改；到期失效；不删除 | 最高/小中 |

### Canon、正文、证据与发布

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `canon_commit` | Canon Commit；Canon Narrative Source 提交账本 | `canon_commit_id: ID/必填`；`novel_id: ID/必填`；`workflow_run_id: ID/必填`；`candidate_version_id: ID/必填`；`selection_version: INT/必填`；`approval_id: ID/必填`；`approval_policy_version: TEXT/必填`；`idempotency_key: TEXT/必填`；`payload_hash: HASH/必填`；`digest_spec_version: TEXT/必填`；`input_canon_watermark: WATERMARK/必填`；`success_commit_sequence: SEQ/可空`；`canon_watermark: WATERMARK/可空`；`result: ENUM(preparing,committed,failed)/必填`；`canonical_text_version_id: ID/可空` | `novel_id→novel.novel_id`；`workflow_run_id→workflow_run.workflow_run_id`；`candidate_version_id→candidate_version.candidate_version_id`；`approval_id→approval_record.approval_id`；正文指针→canonical_text_version.canonical_text_version_id；Novel 必须与 Workflow、Candidate、Task Version 同项目 | `(novel_id, idempotency_key)` 唯一；成功提交序号按项目唯一且只在 committed 时存在；失败不占成功水位 | preparing 事务内短暂存在；committed 内容不可更新；失败记录不可伪装成功 | 最高/大 |
| `canon_commit_item` | Canon Commit Item；Canon 提交内目标清单 | `commit_item_id: ID/必填`；`canon_commit_id: ID/必填`；`target_type: ENUM(story_event,canon_fact,state_transition,canonical_text)/必填`；`target_id: ID/必填`；`source_mapping_id: ID/可空` | `canon_commit_id→canon_commit.canon_commit_id`；`source_mapping_id→candidate_to_canon_mapping.mapping_id`；实际目标由类型专属关系表确认 | `(canon_commit_id, target_type, target_id)` 唯一；每个进入 Canon 的对象恰一项 | 追加不可变；目标不可替换 | 高/极大 |
| `canon_commit_item_story_event_target` | Commit Item 类型支撑表；目标为 Story Event | `commit_item_id: ID/必填`；`story_event_id: ID/必填` | `commit_item_id→canon_commit_item.commit_item_id`；`story_event_id→story_event.story_event_id` | 两列均唯一；父项 target_type 必须匹配 | 随 Commit 追加不可变 | 高/极大 |
| `canon_commit_item_fact_target` | Commit Item 类型支撑表；目标为 Canon Fact | `commit_item_id: ID/必填`；`canon_fact_id: ID/必填` | `commit_item_id→canon_commit_item.commit_item_id`；`canon_fact_id→canon_fact.canon_fact_id` | 两列均唯一；父项 target_type 必须匹配 | 追加不可变 | 高/极大 |
| `canon_commit_item_state_target` | Commit Item 类型支撑表；目标为 State Transition | `commit_item_id: ID/必填`；`state_transition_id: ID/必填` | `commit_item_id→canon_commit_item.commit_item_id`；`state_transition_id→state_transition.state_transition_id` | 两列均唯一；父项 target_type 必须匹配 | 追加不可变 | 高/极大 |
| `canon_commit_item_text_target` | Commit Item 类型支撑表；目标为 Canonical Text Version | `commit_item_id: ID/必填`；`canonical_text_version_id: ID/必填` | `commit_item_id→canon_commit_item.commit_item_id`；`canonical_text_version_id→canonical_text_version.canonical_text_version_id` | 两列均唯一；每个 Commit 至多一个正文目标 | 追加不可变 | 高/大 |
| `canonical_text_identity` | Canonical Text Identity；Canon 正文稳定身份 | `canonical_text_identity_id: ID/必填`；`chapter_id: ID/必填`；`scene_id: ID/可空`；`current_canonical_text_version_id: ID/可空` | `chapter_id→chapter.chapter_id`；`scene_id→scene.scene_id`；`current_canonical_text_version_id→canonical_text_version.canonical_text_version_id`（延后检查循环） | `(chapter_id, scene_id)` 条件唯一；当前版本必须属于同一 identity | 身份不可变；当前指针可受控更新；版本由下表追加 | 中高/大 |
| `canonical_text_version` | Canonical Text Version；Canon Narrative Source 正文权威版本 | `canonical_text_version_id: ID/必填`；`canonical_text_identity_id: ID/必填`；`version_no: INT/必填`；`canon_commit_id: ID/必填`；`text_ref: REF/必填`；`content_hash: HASH/必填`；`text_length: INT/必填` | `canonical_text_identity_id→canonical_text_identity.canonical_text_identity_id`；`canon_commit_id→canon_commit.canon_commit_id` | `(canonical_text_identity_id, version_no)` 唯一；一个 Commit 至多一个版本 | 内容和来源不可变；修订新 Commit 新版本；成功 Canon 不删除 | 最高/极大 |
| `story_event` | Story Event；Canon Narrative Source 权威事件 | `story_event_id: ID/必填`；`novel_id: ID/必填`；`canon_commit_id: ID/必填`；`event_key: TEXT/必填`；`subject_entity_id: ID/必填`；`predicate: TEXT/必填`；`object_ref: ID/可空`；`story_time_interval_id: ID/可空`；`evidence_reference_id: ID/必填` | `novel_id→novel.novel_id`；`canon_commit_id→canon_commit.canon_commit_id`；`subject_entity_id→entity.entity_id`；`story_time_interval_id→time_interval.time_interval_id`；`evidence_reference_id→evidence_reference.evidence_reference_id` | `(canon_commit_id, event_key)` 唯一；对象必须有 Commit Item | 追加不可变；修订另建新事件/关系 | 高/极大 |
| `canon_fact` | Canon Fact；Canon Narrative Source 权威事实 | `canon_fact_id: ID/必填`；`novel_id: ID/必填`；`canon_commit_id: ID/必填`；`fact_key: TEXT/必填`；`fact_value: JSON/必填`；`effective_scope: TEXT/必填`；`active_from_sequence: SEQ/必填`；`evidence_reference_id: ID/必填`；`valid_from: TS/可空`；`valid_to: TS/可空` | `novel_id→novel.novel_id`；`canon_commit_id→canon_commit.canon_commit_id`；`evidence_reference_id→evidence_reference.evidence_reference_id` | `(novel_id, fact_key, effective_scope, active_from_sequence)` 受冲突检查 | 不可变；替代/反向/补偿另建关系 | 高/极大 |
| `state_transition` | State Transition；Canon Narrative Source 权威状态变化 | `state_transition_id: ID/必填`；`novel_id: ID/必填`；`canon_commit_id: ID/必填`；`entity_id: ID/必填`；`state_dimension_id: ID/必填`；`transition_key: TEXT/必填`；`from_value: JSON/可空`；`to_value: JSON/必填`；`story_time_interval_id: ID/可空`；`evidence_reference_id: ID/必填` | `novel_id→novel.novel_id`；`canon_commit_id→canon_commit.canon_commit_id`；`entity_id→entity.entity_id`；`state_dimension_id→state_dimension.state_dimension_id`；时间/证据 FK | `(entity_id, state_dimension_id, transition_key)` 由 Commit 内检查 | 追加不可变；派生当前状态另表 | 高/极大 |
| `canon_relation_target` | Canon 关系目标支撑表；替代/反向/补偿共享的可验证目标 | `target_ref_id: ID/必填`；`relation_kind: ENUM(supersession,reversal,compensation)/必填`；`target_type: ENUM(canon_commit,canonical_text,story_event,canon_fact,state_transition)/必填`；`target_commit_id: ID/可空`；`target_text_version_id: ID/可空`；`target_story_event_id: ID/可空`；`target_fact_id: ID/可空`；`target_state_transition_id: ID/可空` | 各目标列分别 FK 对应 Canon 表；恰一目标列非空 | `target_type` 与非空 FK 必须一致；每个关系恰一目标支撑行；目标与关系项目一致 | 支撑身份和目标不可变；追加保留 | 高/中 |
| `supersession_relation` | Supersession Relation；Canon 治理关系 | `relation_id: ID/必填`；`canon_commit_id: ID/必填`；`target_ref_id: ID/必填`；`replacement_commit_id: ID/必填`；`reason: TEXT/必填` | `canon_commit_id→canon_commit.canon_commit_id`；`target_ref_id→canon_relation_target.target_ref_id`；`replacement_commit_id→canon_commit.canon_commit_id` | `(target_ref_id, replacement_commit_id)` 唯一；目标类型由支撑表 discriminator 确定 | 追加不可变；原 Commit 不更新 | 高/中大 |
| `reversal_relation` | Reversal Relation；Canon 反向关系 | `relation_id: ID/必填`；`canon_commit_id: ID/必填`；`target_ref_id: ID/必填`；`reason: TEXT/必填` | `canon_commit_id→canon_commit.canon_commit_id`；`target_ref_id→canon_relation_target.target_ref_id` | `(target_ref_id, canon_commit_id)` 唯一 | 追加不可变 | 高/中 |
| `compensation_relation` | Compensation Relation；Canon 补偿关系 | `relation_id: ID/必填`；`canon_commit_id: ID/必填`；`target_ref_id: ID/必填`；`compensation_scope: JSON/必填` | `canon_commit_id→canon_commit.canon_commit_id`；`target_ref_id→canon_relation_target.target_ref_id` | `(target_ref_id, canon_commit_id)` 唯一 | 追加不可变 | 高/中 |
| `evidence_reference` | Evidence Reference；跨域证据索引，不因存在而成为 Canon Fact | `evidence_reference_id: ID/必填`；`source_domain: ENUM(author_design,candidate,canon,tool)/必填`；`source_version_id: ID/必填`；`source_object_type: ENUM/必填`；`source_object_id: ID/必填`；`locator: OFFSET/必填`；`evidence_kind: ENUM/必填` | 来源由四个类型专属支撑表之一确认；父表的 source_object_type/source_object_id 是与来源支撑行重复保存的去重身份，不取代类型专属 FK 和归属校验 | `(source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind)` 唯一；旧四字段组合仅作非唯一检索索引 | 追加不可变；来源失效标记，不删除 | 高/极大 |
| `evidence_design_source` | Evidence 来源支撑表；Author Design 来源 | `evidence_reference_id: ID/必填`；`author_design_revision_id: ID/必填`；`source_object_type: ENUM(author_design_revision,design_object_version,design_constraint,outline_node,world_rule,temporal_constraint,foreshadowing_plan,ending_constraint)/必填`；`source_object_id: ID/必填`；`source_author_design_revision_id: ID/可空`；`source_design_object_version_id: ID/可空`；`source_design_constraint_id: ID/可空`；`source_outline_node_id: ID/可空`；`source_world_rule_id: ID/可空`；`source_temporal_constraint_id: ID/可空`；`source_foreshadowing_plan_id: ID/可空`；`source_ending_constraint_id: ID/可空` | `evidence_reference_id→evidence_reference.evidence_reference_id`；`author_design_revision_id→author_design_revision.revision_id`；各类型列分别 FK 对应设计表 | 父 evidence 恰一来源支撑行；类型列恰一非空；`source_object_id` 必须等于对应类型列；对象所属 Revision 必须等于 `author_design_revision_id`（Revision 类型除外，此时两者相等），项目一致 | 追加不可变；缺失、错类型、跨项目或错误 Revision 拒绝 | 高/大 |
| `evidence_candidate_source` | Evidence 来源支撑表；Candidate 来源 | `evidence_reference_id: ID/必填`；`candidate_version_id: ID/必填`；`source_object_type: ENUM(candidate_version,candidate_event,candidate_fact_proposal,candidate_state_transition,narrative_assertion)/必填`；`source_object_id: ID/必填`；`source_candidate_event_id: ID/可空`；`source_candidate_fact_proposal_id: ID/可空`；`source_candidate_state_transition_id: ID/可空`；`source_assertion_id: ID/可空` | `evidence_reference_id→evidence_reference.evidence_reference_id`；`candidate_version_id→candidate_version.candidate_version_id`；各子对象目标列分别 FK 对应 Candidate 表 | 父 evidence 恰一来源支撑行；字段组合按 3.3 的 Candidate 映射表校验；`candidate_version_id` 在子对象类型中是容器字段，不计入子对象目标字段互斥数量 | 追加不可变；缺失、错类型、跨项目或错误 Candidate 版本拒绝 | 高/大 |
| `evidence_canon_source` | Evidence 来源支撑表；Canon 来源 | `evidence_reference_id: ID/必填`；`canonical_text_version_id: ID/可空`；`canon_commit_id: ID/可空`；`source_object_type: ENUM(canonical_text_version,canon_commit,story_event,canon_fact,state_transition,temporal_relation)/必填`；`source_object_id: ID/必填`；`source_story_event_id: ID/可空`；`source_canon_fact_id: ID/可空`；`source_state_transition_id: ID/可空`；`source_temporal_relation_id: ID/可空` | `evidence_reference_id→evidence_reference.evidence_reference_id`；正文、Commit 与各子对象目标列分别 FK 对应 Canon 表 | 父 evidence 恰一来源支撑行；字段组合按 3.3 的 Canon 映射表校验；`canon_commit_id` 对正文和内部对象类型是容器字段，不计入子对象目标字段的互斥数量；历史证据可引用同项目既有已提交对象，不要求本次 Commit | 追加不可变；缺失、错类型、跨项目或错误 Commit 关系拒绝 | 高/大 |
| `evidence_tool_source` | Evidence 来源支撑表；工具证据来源 | `evidence_reference_id: ID/必填`；`tool_call_id: ID/必填`；`source_ref: REF/必填` | `evidence_reference_id→evidence_reference.evidence_reference_id`；`tool_call_id→tool_call.tool_call_id`；`tool_call.generation_run_id` 用于校验父 Evidence 的 `source_version_id` | 父 evidence 恰一来源支撑行；父 `source_object_type=tool_call`、`source_object_id=tool_call_id` | 追加不可变 | 高/中 |
| `publication_record` | Publication Record；发布权威记录 | `publication_id: ID/必填`；`canonical_text_version_id: ID/必填`；`request_key: TEXT/必填`；`decision: ENUM(publish,withdraw)/必填`；`decided_by: ID/必填`；`decided_at: TS/必填` | `canonical_text_version_id→canonical_text_version.canonical_text_version_id`；`decided_by→actor_principal.actor_id` | `(canonical_text_version_id, request_key)` 请求幂等；决定时间仅作审计 | 发布决定追加不可变；撤回不改正文 | 高/中 |
| `impact_assessment` | Impact Assessment；发布/修订影响评估记录 | `assessment_id: ID/必填`；`trigger_commit_id: ID/必填`；`base_publication_id: ID/可空`；`target_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`request_key: TEXT/必填`；`status: ENUM(running,completed,failed)/必填`；`result_ref: REF/可空` | `trigger_commit_id→canon_commit.canon_commit_id`；`base_publication_id→publication_record.publication_id` | `(trigger_commit_id, strategy_version, request_key)` 唯一；目标 Watermark 可随新请求变化 | 输入绑定不可变；运行中结果可受控更新；终态结果不覆盖；主动重评估使用新 request_key | 高/中 |
| `impact_item` | Impact Item；影响对象明细 | `impact_item_id: ID/必填`；`assessment_id: ID/必填`；`resource_type: ENUM/必填`；`resource_id: ID/必填`；`impact_kind: ENUM/必填`；`severity: ENUM/必填` | `assessment_id→impact_assessment.assessment_id` | `(assessment_id, resource_type, resource_id)` 唯一 | 追加不可变；不自动修改下游正文 | 高/大 |

### 时间、知识、披露与派生投影

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `time_interval_source` | Time Interval 来源支撑表；复用单表 discriminator 验证区间来源 | `interval_source_id: ID/必填`；`time_interval_id: ID/必填`；`source_domain: ENUM(author_design,candidate,canon)/必填`；`source_version_id: ID/必填`；`source_type: ENUM(temporal_constraint,candidate_event,candidate_fact_proposal,candidate_state_transition,canonical_text_version,story_event,canon_fact,state_transition)/必填`；`temporal_constraint_id: ID/可空`；`candidate_event_id: ID/可空`；`candidate_fact_proposal_id: ID/可空`；`candidate_state_transition_id: ID/可空`；`canonical_text_version_id: ID/可空`；`story_event_id: ID/可空`；`canon_fact_id: ID/可空`；`state_transition_id: ID/可空` | `time_interval_id→time_interval.time_interval_id`；各类型列分别 FK 对应来源表 | `time_interval_id` 必填且唯一；每个区间恰一来源支撑；source_type 与恰一非空类型列一致；source_version_id 等于对应来源 ID；Author Design/Candidate/Canon 来源对象分别同项目并匹配约束、Candidate 或 Commit 容器 | 支撑身份、来源和区间绑定不可变；创建/提交时来源检查失败则整笔回滚 | 高/大 |
| `temporal_relation` | Temporal Relation；Canon Narrative Source 时间关系 | `temporal_relation_id: ID/必填`；`source_domain: ENUM(canon)/必填`；`source_version_id: ID/必填`；`relation_type: ENUM/必填`；`left_ref: ID/必填`；`right_ref: ID/必填`；`interval_id: ID/可空`；`canon_commit_id: ID/必填` | `interval_id→time_interval.time_interval_id`；`canon_commit_id→canon_commit.canon_commit_id`；来源必须由 temporal_relation_canon_source 支撑 | `(source_version_id, left_ref, relation_type, right_ref)` 唯一；source_version_id 与 canon_commit 同项目/提交一致 | 追加不可变；只能由 Canon Commit 或受控修订产生；派生时间线不回写 | 高/大 |
| `temporal_constraint` | Temporal Constraint；Author Design Source 时间约束 | `temporal_constraint_id: ID/必填`；`revision_id: ID/必填`；`constraint_type: ENUM/必填`；`left_ref: ID/必填`；`right_ref: ID/必填`；`interval_id: ID/可空`；`severity: ENUM/必填` | `revision_id→author_design_revision.revision_id`；`interval_id→time_interval.time_interval_id` | `(revision_id, left_ref, constraint_type, right_ref)` 唯一 | 版本不可变；不写 Canon 时间关系 | 高/大 |
| `time_interval` | Time Interval；故事时间记录 | `time_interval_id: ID/必填`；`source_domain: ENUM(author_design,candidate,canon)/必填`；`source_version_id: ID/必填`；`interval_key: TEXT/必填`；`time_kind: ENUM(absolute,relative,unknown)/必填`；`start_value: TEXT/可空`；`end_value: TEXT/可空`；`precision: ENUM/必填`；`certainty: ENUM/必填` | 来源绑定统一由 `time_interval_source.time_interval_id` 查询；source_domain/source_version_id 必须与唯一绑定行一致 | `(source_domain, source_version_id, interval_key)` 唯一；`time_interval_source.time_interval_id` 唯一且每个区间恰一来源绑定 | relative/unknown 可无确定日期证据，但必须有合法来源身份；来源不完整不得保存 | 高/大 |
| `temporal_evidence` | Temporal Evidence；时间证据记录 | `temporal_evidence_id: ID/必填`；`source_domain: ENUM(author_design,candidate,canon)/必填`；`source_version_id: ID/必填`；`source_type: ENUM/必填`；`interval_id: ID/必填`；`evidence_reference_id: ID/必填` | `interval_id→time_interval.time_interval_id`；`evidence_reference_id→evidence_reference.evidence_reference_id`；Evidence 的 source_domain/source_version_id 必须与本行一致 | `(source_domain, source_version_id, interval_id, evidence_reference_id)` 唯一；证据来源与区间来源同源、同项目且版本兼容，但不要求等于本次 Commit | 追加不可变；跨来源或错误版本拒绝 | 高/大 |
| `temporal_relation_canon_source` | Temporal 来源支撑表；Canon 关系来源 | `temporal_relation_id: ID/必填`；`canon_commit_id: ID/必填`；`source_version_id: ID/必填`；`source_type: ENUM(canonical_text,story_event,canon_fact,state_transition)/必填`；`source_canonical_text_version_id: ID/可空`；`source_story_event_id: ID/可空`；`source_fact_id: ID/可空`；`source_state_transition_id: ID/可空` | `temporal_relation_id→temporal_relation.temporal_relation_id`；`canon_commit_id→canon_commit.canon_commit_id`；各类型列分别 FK 对应 Canon 对象 | 父关系恰一来源支撑行；四类来源列恰一非空；`source_version_id` 必须等于对应来源 ID；来源对象与 `canon_commit_id` 同项目/提交 | 追加不可变 | 高/中 |
| `state_dimension` | State Dimension；受控状态值域 | `state_dimension_id: ID/必填`；`dimension_key: TEXT/必填`；`allowed_values: JSON/必填`；`version_no: INT/必填`；`status: ENUM/必填` | 无 | `(dimension_key, version_no)` 唯一 | 版本不可变；停用保留 | 高/中 |
| `knowledge_evidence` | Knowledge Evidence；角色知识证据 | `knowledge_evidence_id: ID/必填`；`character_entity_id: ID/必填`；`proposition_key: TEXT/必填`；`value: ENUM(known_true,known_false,unknown)/必填`；`evidence_reference_id: ID/必填`；`canon_watermark: WATERMARK/必填` | `character_entity_id→entity.entity_id`；`evidence_reference_id→evidence_reference.evidence_reference_id` | `(character_entity_id, proposition_key, canon_watermark, evidence_reference_id)` 唯一 | 追加不可变；缺证据不生成 known_false | 高/大 |
| `belief_evidence` | Belief Evidence；角色信念证据 | `belief_evidence_id: ID/必填`；`character_entity_id: ID/必填`；`proposition_key: TEXT/必填`；`value: ENUM(believed_true,believed_false,unknown)/必填`；`evidence_reference_id: ID/必填`；`canon_watermark: WATERMARK/必填` | `character_entity_id→entity.entity_id`；`evidence_reference_id→evidence_reference.evidence_reference_id` | `(character_entity_id, proposition_key, canon_watermark, evidence_reference_id)` 唯一 | 追加不可变；不得成为 Canon Fact 来源 | 高/大 |
| `character_knowledge_state` | Character Knowledge State；派生投影 | `state_id: ID/必填`；`character_entity_id: ID/必填`；`proposition_key: TEXT/必填`；`knowledge_value: ENUM(known_true,known_false,unknown)/必填`；`canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`source_digest: HASH/必填` | 来源由 knowledge_evidence 追溯；不反向 FK 写入 Canon | `(character_entity_id, proposition_key, canon_watermark, strategy_version)` 唯一 | 可重建/替换；不回写权威源 | 高/大 |
| `character_belief_state` | Character Belief State；派生投影 | `state_id: ID/必填`；`character_entity_id: ID/必填`；`proposition_key: TEXT/必填`；`belief_value: ENUM(believed_true,believed_false,unknown)/必填`；`canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`source_digest: HASH/必填` | 来源由 belief_evidence 追溯；不反向 FK 写入 Canon | `(character_entity_id, proposition_key, canon_watermark, strategy_version)` 唯一 | 可重建/替换；不回写 Canon Fact | 高/大 |
| `reader_disclosure_evidence` | Reader Disclosure Evidence；披露证据权威记录 | `disclosure_evidence_id: ID/必填`；`canonical_text_version_id: ID/必填`；`assertion_id: ID/必填`；`disclosure_kind: ENUM/必填`；`reader_scope: JSON/必填`；`reader_scope_hash: HASH/必填`；`canon_watermark: WATERMARK/必填` | `canonical_text_version_id→canonical_text_version.canonical_text_version_id`；`assertion_id→narrative_assertion.assertion_id` | `(canonical_text_version_id, assertion_id, reader_scope_hash, disclosure_kind)` 唯一；`reader_scope_hash` 是规范化 reader_scope 的摘要，二者必须匹配 | 追加不可变；披露状态派生 | 最高/大 |
| `reader_disclosure_state` | Reader Disclosure State；派生投影 | `state_id: ID/必填`；`resource_key: TEXT/必填`；`reader_scope_hash: HASH/必填`；`disclosure_value: ENUM/必填`；`canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`source_digest: HASH/必填` | 来源由 disclosure evidence 回查；不回写正文 | `(resource_key, reader_scope_hash, canon_watermark, strategy_version)` 唯一 | 可重建/替换；低水位不可切当前 | 最高/大 |
| `derived_current_state` | Derived Current State；派生投影 | `state_id: ID/必填`；`entity_id: ID/必填`；`state_dimension_id: ID/必填`；`value: JSON/必填`；`canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`source_digest: HASH/必填` | `entity_id→entity.entity_id`；`state_dimension_id→state_dimension.state_dimension_id` | `(entity_id, state_dimension_id, canon_watermark, strategy_version)` 唯一 | 可重建/替换；不回写 State Transition | 高/大 |
| `design_fulfillment_state` | Design Fulfillment State；派生投影 | `fulfillment_id: ID/必填`；`design_object_type: ENUM/必填`；`design_object_id: ID/必填`；`state: ENUM/必填`；`canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`source_digest: HASH/必填` | 来源由 Design Object、Canon Evidence 和 Mapping 回查；多态校验 | `(design_object_type, design_object_id, canon_watermark, strategy_version)` 唯一 | 可重建/替换；不回写 Design Revision | 高/大 |
| `v_derived_timeline` | Derived Timeline View；查询投影 | 视图不设业务主键；输出 `timeline_row_key: TEXT`、`source_domain: ENUM`、`source_version_id: ID`、`canon_watermark: WATERMARK`、`relation_type: ENUM` | 仅从 temporal_relation、temporal_constraint、time_interval、temporal_evidence 查询 | 查询结果不建立权威唯一性 | 不存写入、不归档；重建查询定义 | 高/查询大 |
| `projection_outbox` | Projection Outbox；Canon Commit 同事务的权威运行记录 | `outbox_id: ID/必填`；`canon_commit_id: ID/必填`；`target: ENUM/必填`；`scope_hash: HASH/必填`；`source_canon_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`event_hash: HASH/必填`；`emitted_at: TS/必填` | `canon_commit_id→canon_commit.canon_commit_id` | `(canon_commit_id, target, strategy_version)` 唯一；同 Commit 可零到多目标 | 与 Commit 同事务创建；不伪造/不覆盖；按审计策略归档 | 高/大极大 |
| `projection_task` | Projection Task；投影执行逻辑记录 | `task_id: ID/必填`；`origin_type: ENUM(outbox,rebuild)/必填`；`outbox_id: ID/可空`；`rebuild_record_id: ID/可空`；`target: ENUM/必填`；`scope_hash: HASH/必填`；`strategy_version: TEXT/必填`；`status: ENUM(pending,completed,cancelled,abandoned,needs_rebuild)/必填` | `outbox_id→projection_outbox.outbox_id`；`rebuild_record_id→projection_rebuild_record.rebuild_record_id`；二者互斥 | 普通有效状态 `(pending,needs_rebuild)` 下 `(outbox_id,target,strategy_version)` 唯一；重复消费查找全部状态：pending 复用、needs_rebuild 进入显式恢复、completed 返回结果、cancelled/abandoned 返回终止状态；普通 scope_hash 必须等于 Outbox，不能绕过唯一性；重建按 Rebuild Record 范围唯一 | Task 身份、来源、范围和策略不可变；状态受控转换；重复消息不得自动恢复终态 Task；普通重试复用 Task 并创建新 Attempt | 中高/极大 |
| `projection_attempt` | Projection Attempt；一次执行历史 | `attempt_id: ID/必填`；`task_id: ID/必填`；`attempt_no: INT/必填`；`status: ENUM(processing,succeeded,retryable_failure,permanent_failure,expired)/必填`；`started_at: TS/必填`；`expires_at: TS/必填`；`ended_at: TS/可空`；`result_hash: HASH/可空`；`result_ref: REF/可空`；`worker_version: TEXT/必填` | `task_id→projection_task.task_id` | `(task_id, attempt_no)` 唯一；Attempt ID 是执行身份；`expires_at` 为领取时计算的截止时间；`worker_version` 仅记录软件版本 | Task/来源/输入版本/策略绑定和截止时间不可变；processing 可受控更新终态；成功时 `ended_at` 记录成功接受时间；只有在受并发保护的状态转换判定点以数据库权威时间严格早于 `expires_at` 才能转为 succeeded；过期转换要求数据库权威时间大于或等于 `expires_at`；二者均须同时检查 `status=processing`，并在同一短事务中保存终态和 `ended_at`；`expired` 不得恢复 succeeded | 中高/极大 |
| `projection_failure` | Projection Failure；失败历史 | `failure_id: ID/必填`；`attempt_id: ID/必填`；`failure_kind: ENUM/必填`；`failure_detail_ref: REF/可空`；`retryable: BOOL/必填` | `attempt_id→projection_attempt.attempt_id` | `(attempt_id, failure_kind)` 唯一 | 追加不可变；不伪造历史失败 | 中高/大 |
| `projection_checkpoint` | Projection Checkpoint；目标投影当前水位记录 | `checkpoint_id: ID/必填`；`target: ENUM/必填`；`normalized_scope_hash: HASH/必填`；`strategy_version: TEXT/必填`；`current_watermark: WATERMARK/必填`；`last_successful_attempt_id: ID/必填`；`state: ENUM(active,staging)/必填` | `last_successful_attempt_id→projection_attempt.attempt_id` | `(target, normalized_scope_hash, strategy_version, state)` 唯一；active 仅一行 | 只接受 status=succeeded 且成功接受时间（`ended_at`）严格早于 `expires_at`、来源/范围/策略/水位、替代或失效状态及既有发布条件均匹配的 Attempt；不再以推进 Checkpoint 时的当前时间比较原 `expires_at`；水位单调；staging 达标后切换 | 中高/中 |
| `projection_rebuild_record` | Projection Rebuild Record；重建治理记录 | `rebuild_record_id: ID/必填`；`novel_id: ID/必填`；`target: ENUM/必填`；`scope_hash: HASH/必填`；`source_outbox_id: ID/可空`；`source_commit_id: ID/可空`；`source_from_watermark: WATERMARK/必填`；`target_watermark: WATERMARK/必填`；`strategy_version: TEXT/必填`；`status: ENUM(requested,running,verified,switched,abandoned)/必填`；`switch_reason: TEXT/可空`；`verified_at: TS/可空`；`switched_at: TS/可空` | `novel_id→novel.novel_id`；`source_outbox_id→projection_outbox.outbox_id`；`source_commit_id→canon_commit.canon_commit_id`；来源至少一个且不伪造 Outbox | `(novel_id, target, scope_hash, strategy_version, source_from_watermark, target_watermark)` 唯一 | 身份、来源、水位、范围和策略不可变；running/verified/switched 等治理状态和时间可受控更新；终态不覆盖；用于创建新 Task/Attempt，不代替原始 Outbox | 中高/中大 |

### 授权与审计

| 表 | 对应逻辑实体与权威性质 | 主键；重要列（类型/可空和值域） | 外键（本列→目标表.列） | 唯一性与条件 | 不可变、生命周期与删除 | 敏感/规模 |
|---|---|---|---|---|---|---|
| `actor_principal` | Actor/Principal；授权主体身份 | `actor_id: ID/必填`；`actor_type: ENUM(user,agent,service)/必填`；`display_name: TEXT/必填`；`status: ENUM/必填` | 无 | `(actor_type, display_name)` 可重名受 ID 区分 | 身份不可变；停用保留 | 最高/中 |
| `execution_role` | Execution Role；授权角色版本 | `role_id: ID/必填`；`role_key: TEXT/必填`；`version_no: INT/必填`；`capability_set_ref: JSON/必填`；`status: ENUM/必填` | 无 | `(role_key, version_no)` 唯一 | 版本不可变；停用保留 | 高/中 |
| `capability` | Capability；受限动作定义 | `capability_id: ID/必填`；`capability_key: TEXT/必填`；`resource_domain: ENUM/必填`；`action: ENUM(read,write_candidate,validate,approve,commit,project,administer)/必填` | 无 | `(resource_domain, action, capability_key)` 唯一 | 定义不可变；停用追加版本 | 最高/中 |
| `capability_grant` | Capability Grant；主体授权记录 | `grant_id: ID/必填`；`actor_id: ID/必填`；`role_id: ID/必填`；`capability_id: ID/必填`；`data_scope_id: ID/必填`；`effective_at: TS/必填`；`expires_at: TS/可空` | `actor_id→actor_principal.actor_id`；`role_id→execution_role.role_id`；`capability_id→capability.capability_id`；`data_scope_id→data_scope.data_scope_id` | 同主体/能力/范围有效期不得重叠 | 授权撤销追加记录；历史不覆盖 | 最高/中 |
| `data_scope` | Data Scope；项目/场景/视角/水位/秘密范围 | `data_scope_id: ID/必填`；`novel_id: ID/必填`；`scene_id: ID/可空`；`viewpoint_entity_id: ID/可空`；`max_canon_watermark: WATERMARK/可空`；`scope_hash: HASH/必填`；`secret_scope: JSON/必填`；`secret_scope_format_version: TEXT/必填`；`default_decision: ENUM/必填` | `novel_id→novel.novel_id`；`scene_id→scene.scene_id`；`viewpoint_entity_id→entity.entity_id` | `(novel_id, scope_hash)` 唯一；`scope_hash` 是规范化项目/场景/视角/水位/秘密范围的摘要 | 身份范围和摘要不可变；范围变化新记录 | 最高/大 |
| `visibility_decision` | Visibility Decision；一次读取授权决定 | `visibility_decision_id: ID/必填`；`actor_id: ID/必填`；`data_scope_id: ID/必填`；`resource_type: ENUM/必填`；`resource_id: ID/必填`；`decision: ENUM(allow,deny,redacted,filtered,indeterminate_deny)/必填`；`basis_hash: HASH/必填` | `actor_id→actor_principal.actor_id`；`data_scope_id→data_scope.data_scope_id` | `(actor_id, data_scope_id, resource_type, resource_id, basis_hash)` 唯一；时间检索复用通用 `created_at`，不机械新增时间字段 | 访问决定追加不可变；不修改历史决定 | 最高/极大 |
| `access_audit_record` | Access Audit Record；访问与拒绝审计 | `access_audit_id: ID/必填`；`actor_id: ID/必填`；`resource_type: ENUM/必填`；`resource_id: ID/必填`；`action: ENUM/必填`；`decision: ENUM/必填`；`reason: TEXT/可空` | `actor_id→actor_principal.actor_id`；资源由域服务校验；时间复用通用 `created_at` | `(actor_id, created_at, resource_type, resource_id, action)` 非严格唯一 | 追加不可变；按安全策略分层保留 | 最高/极大 |
| `human_change_record` | Human Change Record；人工修改审计 | `human_change_id: ID/必填`；`candidate_version_id: ID/必填`；`actor_id: ID/必填`；`diff_ref: REF/必填`；`reason: TEXT/必填`；`revalidation_run_id: ID/可空` | `candidate_version_id→candidate_version.candidate_version_id`；`actor_id→actor_principal.actor_id`；`revalidation_run_id→validation_run.validation_run_id` | `(candidate_version_id, human_change_id)` 唯一 | 追加不可变；人工修改产生新 Candidate，不改旧正文 | 高/大 |
| `evaluation_result` | Evaluation Result；评测审计记录 | `evaluation_result_id: ID/必填`；`run_ref_type: ENUM/必填`；`run_ref_id: ID/必填`；`dataset_version: TEXT/必填`；`metric_key: TEXT/必填`；`score: DECIMAL/可空`；`result: ENUM/必填` | 运行对象由专属支撑表或领域服务校验 | `(run_ref_type, run_ref_id, dataset_version, metric_key)` 唯一 | 追加不可变；汇总不覆盖原始样本 | 中高/大 |

## 3.3 多态引用与跨域完整性选择

本设计采用“父表 discriminator + 类型专属关系表 + 事务内互斥/同项目检查”的确定方案，不采用只有裸 `type/id` 的不可验证引用，也不把完整性全部推给应用层。所有类型专属关系表的父键均为唯一主键，父行必须且只能有一个匹配子行；数据库可用约束、延后约束或同一短事务中的计数检查落实“恰一”。类型值与子表类型固定映射，来源、目标和项目/版本/Commit 归属由提交服务在事务内复核。

- **Narrative Assertion 来源**：`source_domain=candidate` 时 `candidate_version_id` 必填、`canonical_text_version_id` 必须为空，并必须存在 `narrative_assertion_candidate_source` 支撑关系；`source_domain=canon` 时反之。Assertion 不直接产生 Canon 权威性；Canon Fact 仍必须由 Canon Commit、Commit Item、Evidence 和提交规则共同产生。
- **Canon Commit Item 目标**：父表保存 `target_type/target_id`，四个类型专属表分别验证 Story Event、Canon Fact、State Transition 或 Canonical Text Version。父项不得零子项或多子项；目标必须属于同一 `canon_commit_id`，Canonical Text 目标每个 Commit 至多一个。
- **Candidate-to-Canon Mapping**：映射必须有一个 Candidate Version、一个 Commit Item 和一个类型专属 Candidate 来源行；来源 Candidate 必须属于该 Commit 的 Workflow Run，`candidate_object_hash` 必须与候选对象 object_hash 相等，`candidate_content_hash` 必须与 Candidate content_hash 相等；目标只能通过 Commit Item 到达，不允许裸目标 ID。
- **Evidence Reference**：父表的 `source_domain` 与四个来源支撑表严格互斥。Design 来源继续按其类型专属目标列恰一非空；Candidate 与 Canon 来源必须按下表逐类型校验，容器字段不计入子对象目标字段的互斥数量。Tool 只允许 Tool Call。历史证据可引用同项目已存在的旧版本，但不得跨项目或跨来源域；缺失、错类型、悬空、容器归属或版本不一致均拒绝并回滚。

Candidate 来源字段映射如下；`candidate_version_id` 在子对象类型中只表示容器，在 `candidate_version` 类型中表示实际目标：

| `source_object_type` | 实际目标字段 | 容器字段 | 必填字段与相等关系 | 必须为空的字段 | 归属校验 |
|---|---|---|---|---|---|
| `candidate_version` | `candidate_version_id` | 无独立容器字段 | `source_object_id=candidate_version_id`；`evidence_reference.source_version_id=candidate_version_id` | `source_candidate_event_id`、`source_candidate_fact_proposal_id`、`source_candidate_state_transition_id`、`source_assertion_id` | Candidate Version 必须存在，并与 Evidence 所属项目、Workflow 范围一致 |
| `candidate_event` | `source_candidate_event_id` | `candidate_version_id` | `source_object_id`、`candidate_version_id`、`source_candidate_event_id`；`source_object_id=source_candidate_event_id`；`evidence_reference.source_version_id=candidate_version_id` | 其余三个子对象目标字段 | Candidate Event 必须属于指定 Candidate Version，且项目、Workflow 一致 |
| `candidate_fact_proposal` | `source_candidate_fact_proposal_id` | `candidate_version_id` | `source_object_id`、`candidate_version_id`、`source_candidate_fact_proposal_id`；`source_object_id=source_candidate_fact_proposal_id`；`evidence_reference.source_version_id=candidate_version_id` | 其余三个子对象目标字段 | Candidate Fact Proposal 必须属于指定 Candidate Version，且项目、Workflow 一致 |
| `candidate_state_transition` | `source_candidate_state_transition_id` | `candidate_version_id` | `source_object_id`、`candidate_version_id`、`source_candidate_state_transition_id`；`source_object_id=source_candidate_state_transition_id`；`evidence_reference.source_version_id=candidate_version_id` | 其余三个子对象目标字段 | Candidate State Transition 必须属于指定 Candidate Version，且项目、Workflow 一致 |
| `narrative_assertion` | `source_assertion_id` | `candidate_version_id` | `source_object_id`、`candidate_version_id`、`source_assertion_id`；`source_object_id=source_assertion_id`；`evidence_reference.source_version_id=candidate_version_id` | 其余三个子对象目标字段 | Narrative Assertion 必须为 `source_domain=candidate`，并通过其 Candidate 来源支撑关系属于指定 Candidate Version；项目、Workflow 一致 |

Canon 来源字段映射如下；`canon_commit_id` 对正文和内部对象是所属 Commit 容器，对 `canon_commit` 类型本身则是实际目标：

| `source_object_type` | 实际目标字段 | 容器字段 | 必填字段与相等关系 | 必须为空的字段 | 归属校验 |
|---|---|---|---|---|---|
| `canonical_text_version` | `canonical_text_version_id` | `canon_commit_id` | `source_object_id`、`canonical_text_version_id`、`canon_commit_id`；`source_object_id=canonical_text_version_id`；`evidence_reference.source_version_id=canonical_text_version_id` | `source_story_event_id`、`source_canon_fact_id`、`source_state_transition_id`、`source_temporal_relation_id` | 正文版本必须由指定 Commit 创建；正文、Commit 与 Evidence 必须属于同一 Novel，且 Commit 已成功提交 |
| `canon_commit` | `canon_commit_id` | 无独立容器字段 | `source_object_id=canon_commit_id`；`evidence_reference.source_version_id=canon_commit_id` | `canonical_text_version_id` 及四个内部对象目标字段 | Commit 必须已成功提交，并与 Evidence 属于同一 Novel |
| `story_event` | `source_story_event_id` | `canon_commit_id` | `source_object_id`、`source_story_event_id`、`canon_commit_id`；`source_object_id=source_story_event_id`；`evidence_reference.source_version_id=canon_commit_id` | `canonical_text_version_id` 及其余三个内部对象目标字段 | Story Event 必须属于指定 Commit；事件目标字段与 Commit 容器字段允许同时非空；Event、Commit 与 Evidence 必须属于同一 Novel |
| `canon_fact` | `source_canon_fact_id` | `canon_commit_id` | `source_object_id`、`source_canon_fact_id`、`canon_commit_id`；`source_object_id=source_canon_fact_id`；`evidence_reference.source_version_id=canon_commit_id` | `canonical_text_version_id` 及其余三个内部对象目标字段 | Canon Fact 必须属于指定 Commit；Fact、Commit 与 Evidence 必须属于同一 Novel |
| `state_transition` | `source_state_transition_id` | `canon_commit_id` | `source_object_id`、`source_state_transition_id`、`canon_commit_id`；`source_object_id=source_state_transition_id`；`evidence_reference.source_version_id=canon_commit_id` | `canonical_text_version_id` 及其余三个内部对象目标字段 | State Transition 必须属于指定 Commit；Transition、Commit 与 Evidence 必须属于同一 Novel |
| `temporal_relation` | `source_temporal_relation_id` | `canon_commit_id` | `source_object_id`、`source_temporal_relation_id`、`canon_commit_id`；`source_object_id=source_temporal_relation_id`；`evidence_reference.source_version_id=canon_commit_id` | `canonical_text_version_id` 及其余三个内部对象目标字段 | Temporal Relation 必须属于指定 Commit；Relation、Commit 与 Evidence 必须属于同一 Novel |

Candidate/Canon 映射中的“其余子对象目标字段必须为空”只约束互斥的实际目标列，不约束对应容器列；因此引用 Story Event 时 `source_story_event_id` 与其所属 `canon_commit_id` 必须同时非空。

Evidence 的去重身份和跨表唯一执行方案如下。父 `evidence_reference` 增加的 `source_object_type/source_object_id` 只作为规范化去重身份的冗余列，必须与唯一来源支撑行中的实际目标类型和 ID 完全相同；它们不能替代类型专属 FK、容器归属或项目/版本校验。

| 来源域 | `source_version_id` 映射 | `source_object_type` | `source_object_id` | 容器与归属校验 |
|---|---|---|---|---|
| `author_design` | `author_design_revision_id`；若实际目标类型为 `author_design_revision`，两者相同 | 仅允许 `evidence_design_source` 现有枚举 | 对应类型专属目标列的 ID | 实际目标属于指定 Design Revision；项目一致；父字段与支撑行一致 |
| `candidate` | `candidate_version_id` | 仅允许 `candidate_version,candidate_event,candidate_fact_proposal,candidate_state_transition,narrative_assertion` | `candidate_version` 类型取 `candidate_version_id`；其余取对应子对象目标列 | 子对象或 Narrative Assertion 必须属于指定 Candidate Version；项目和 Workflow 一致；保留既有目标/容器组合规则 |
| `canon` | `canonical_text_version` 类型取正文版本 ID；`canon_commit`、`story_event`、`canon_fact`、`state_transition`、`temporal_relation` 类型按现有映射取所属 Commit ID | 仅允许 `evidence_canon_source` 现有六种枚举 | 取正文、Commit 或对应内部对象目标列的实际 ID | 正文/内部对象与指定 Commit、Novel、成功提交状态一致；内部对象目标列与 `canon_commit_id` 容器列可以同时非空 |
| `tool` | `tool_call.generation_run_id` | 固定为 `tool_call` | `tool_call_id` | `tool_call` 必须存在；其 `generation_run_id` 必须等于父 `source_version_id`；项目和执行范围一致 |

强制执行采用父表唯一索引加事务内延后完整性约束的组合方案，不采用跨表普通唯一索引，也不采用“先查询再插入”作为唯一性保证：

1. `evidence_reference` 上建立 `(source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind)` 的唯一约束；旧 `(source_domain, source_version_id, locator, evidence_kind)` 仅建立非唯一检索索引。
2. Evidence 父行与一个且仅一个类型支撑行必须在同一短事务中写入。采用数据库延后约束触发器在事务提交前检查：父 `source_domain/source_version_id/source_object_type/source_object_id` 与支撑行的类型、实际目标、容器和现有归属映射完全一致；父表不得存在多个来源支撑行，支撑行也不得脱离父表存在。类型专属 FK、项目/版本归属和既有目标/容器规则继续由支撑表及同一事务校验执行。
3. 并发创建相同完整身份时由父表唯一约束在数据库层原子裁决；获胜事务提交父行和支撑行，冲突事务只能复用已提交的同一 Evidence 或返回重复，不得再创建第二条有效记录。任一支撑校验失败，父行和支撑行整体回滚。
4. 消费方只通过 `evidence_reference_id` 引用 Evidence；消费方数量、事实或校验结果不进入去重身份，因此多个消费方可以共享同一 Evidence。
- **Temporal Relation/Interval**：`temporal_relation` 只允许 Canon 来源，通过 `temporal_relation_canon_source` 支撑；`temporal_constraint` 只允许 Author Design Revision。候选时间信息留在 Candidate 提案及 `evidence_candidate_source`，不得写入 Canon Temporal Relation。`time_interval` 必须有同源来源版本，绝对时间缺证据时只能保存 relative/unknown/区间。Derived Timeline View 不接受直接写入。
- **Time Interval 来源完整性**：`time_interval_source.time_interval_id` 是必填 FK 且唯一；`time_interval` 不再保存重复的 `source_binding_id`，来源绑定统一从 `time_interval_source.time_interval_id` 查询。数据库延后约束触发器必须在同一事务提交前检查 `time_interval`、`time_interval_source` 以及会引用区间的来源对象写入：每个区间恰有一个来源绑定；source_type 与对应目标列匹配；实际来源对象存在；区间与绑定的来源域、版本和项目归属一致；来源对象自身引用区间时，该引用与绑定的 `time_interval_id` 一致。触发检查覆盖“仅创建区间未创建来源绑定”的路径，不能只在来源绑定插入时检查；领域服务可以提前校验，但不能替代数据库最终约束。

  创建顺序固定为：①创建 `time_interval`；②在本事务内创建需要引用该区间的来源对象，或复用已有合法来源对象；③创建 `time_interval_source` 及所需关联；④执行提交前完整性校验；⑤整体提交。区间缺少绑定只允许存在于未提交事务内部，不得独立提交半成品。Canon 来源对象与区间可以在同一 Canon 原子事务内创建，不要求来源对象提前单独提交；任一步失败，相关 Canon 写入、区间、来源对象和绑定全部回滚。区间来源对象与支撑时间判断的 Evidence 是不同关系，历史 Evidence 不要求来自本次 Commit。

  `source_domain=author_design` 时 source_type 只能为 `temporal_constraint`，`source_version_id` 必须等于该约束 ID，约束的 Revision/Novel 决定区间归属；`source_domain=candidate` 时只能来自 Candidate Event/Fact Proposal/State Transition，source_version_id 必须等于对应提案 ID，Candidate/Workflow/Novel 必须一致，候选区间不得进入 Canon Timeline；`source_domain=canon` 时只能来自 Canonical Text/Story Event/Canon Fact/State Transition，source_version_id 必须等于已提交对象 ID，对象 Commit/Novel 必须一致。Temporal Evidence 必须引用同源 interval 和 Evidence Reference，Evidence 的来源对象可以是同项目历史版本，不要求等于本次 Commit；来源、类型、项目或版本检查失败时，创建/提交事务整体回滚，Derived Timeline 不发布。
- **Projection Task 来源**：`origin_type=outbox` 时 `outbox_id` 必填且 `rebuild_record_id` 为空；`origin_type=rebuild` 时相反。普通任务只能由存量 Outbox 创建，重建任务只能由 Rebuild Record 创建。任务、Outbox、Rebuild Record、目标和策略必须属于同一 Novel/范围。
- **跨项目/版本检查**：外键存在不等于同项目。涉及 Candidate、Bundle、Workflow、Approval、Validation、Commit 的写入必须在同一短事务读取 Novel/Scene Task Version，并检查 Workflow Run、Candidate、Bundle、Approval、Validation 与 Commit 的项目和版本链一致。失败不写入部分关系。

## 3.4 JSON/JSONB 属性边界

JSON 只承载扩展载荷、描述性内容、复杂表达式或受保护的可重建缓存；凡是参与身份、版本、授权、硬约束或提交检查的核心语义，必须由规范化列、关系或受控不可变配置引用承接。JSON 内容必须带格式版本，并由对应领域服务校验；格式变化产生新版本或新配置，不静默改变既有记录。

- `design_object_version.core_attributes`：允许保存人物/地点/组织/物品的扩展属性和结构化描述，但对象类型、设计身份、Revision、名称和硬约束引用必须由 `design_object_identity`、`design_object_version` 和 `design_constraint` 承接；硬约束检查不得只读取无结构 JSON。
- `scene_task_version.task_constraints`：允许保存场景编译后的复杂表达式和裁剪配置；格式版本及适用范围必须明确，硬约束必须引用已版本化的 `design_constraint`，Task Version 的 Revision、水位和视角仍以规范化列为准。
- `execution_role.capability_set_ref`：允许保存带格式版本的能力集合描述或受保护配置引用，但不得直接授予能力；最终动作必须解析到 `capability`、`capability_grant` 和 `data_scope` 的有效关系。
- `data_scope.secret_scope`：允许保存带 `secret_scope_format_version` 的秘密选择/裁剪表达式；项目、场景、视角、最大 Canon Watermark 和默认决定由规范化列承接，最终秘密可见性必须经过 Capability Grant、Data Scope 和 Visibility Decision 校验。

## 4. 核心版本与不可变结构

### 4.1 Stable Identity 与 Immutable Version

稳定身份表只描述“是谁”，不可变版本表描述“在某个 Revision/Commit/策略版本下是什么”。Author Design Revision 绑定一组 Design Object Version；Scene Task 绑定 Scene Task Version；Canonical Text Identity 绑定多个 Canonical Text Version；Candidate Version、Context Bundle、Prompt、Rule、Policy、Model Configuration 和 Canon Commit 成功后不得原地覆盖其内容或输入绑定。

当前指针可以变化，但历史版本不被重写。`workflow_run.current_candidate_id` 与 `workflow_run.current_selection_version` 表达当前选择；每次选择、替换或取消追加 `workflow_candidate_selection_history` 明细。该明细表不改变逻辑模型，不成为 Candidate Selection 业务实体。

### 4.2 Context Bundle、Candidate 和 Approval

Context Bundle 保存最终编译内容或受保护不可变引用、内容 hash、Scene Task Version、Author Design Revision、Canon Watermark、策略/编译器版本和 Item 顺序。Generation Run 必须绑定一个 Bundle；模型 Candidate 必须指向 Generation Run；修复/人工编辑 Candidate 可直接使用新 Bundle或继承前序 Bundle，但必须形成可审计关系，前驱 Candidate 必须属于同一 Workflow Run。

Approval Record 必须同时保存一个明确且唯一的 Candidate Version 身份、Candidate hash、Context Bundle、Author Design Revision、Canon Watermark、Validation Run 和 Approval Policy Version。即使另一个 Candidate 的正文和所有输入相同，也不得继承或复用原 Approval。当前最终 Candidate 变化时，原 Approval 通过追加 Approval Invalidation Record 失效；重新选择原 Candidate 也必须新建 Approval。

### 4.3 Canon Commit 与水位

Canon Commit 物理记录必须绑定 Workflow Run、当前最终 Candidate、当前有效选择历史版本、有效 Approval、Approval Policy Version、payload hash、幂等键、输入水位、成功 Commit Sequence 和 Canon Watermark。一次 Commit 只绑定一个 Candidate、只生成一个 Canonical Text Version，并可产生零到多个结构化 Canon 对象及 Commit Item/Mapping。

Canon Watermark 是成功 Commit 的逻辑读取边界，物理上随提交账本和提交序列保存或由受控视图读取；它不是独立叙事实体，不能创建 `canon_revision` 或 `canon_snapshot` 表。

### 4.4 Workflow Run 与 Scene Task Version 一致性

物理外键保证对象存在，事务服务还必须检查：

```text
Workflow Run.Scene Task Version
= Generation Run.Context Bundle.Scene Task Version
= Candidate Version.Context Bundle.Scene Task Version
```

该相等关系是逻辑一致性检查，不要求在每张表机械重复所有列。物理冗余列若为查询优化而保留，必须由服务校验并记录来源，不能成为第二事实来源。

## 5. 物理设计边界与待确认项

- PostgreSQL 兼容基线待正式数据库选型确认。
- UUID 具体生成方式、时间精度、排序规则、加密实现和对象存储接口待技术评审。
- 正文/秘密/模型载荷是否全部使用对象存储引用、哪些字段需要数据库加密，待安全评审。
- 物理分区、冷热归档、表空间和大表拆分待容量基准确认，本轮不预设分区键。
- 多 Canon 分支、多租户、订阅、计费、分享社区和 Commit Group 不在当前物理设计范围。

## 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.1.7 | 2026-09-23 | 草案 | 消除 Time Interval 来源绑定创建循环并明确延后完整性校验次序 |
| 0.1.6 | 2026-09-23 | 草案 | 修正 Evidence 实际来源目标与跨表唯一性约束的去重和并发执行语义 |
| 0.1.5 | 2026-09-23 | 草案 | 收口 Projection Attempt 的截止判定、成功接受时间和 Checkpoint 推进条件 |
| 0.1.4 | 2026-09-23 | 草案 | 明确 Candidate 与 Canon Evidence 来源的逐类型目标、容器和归属约束 |
| 0.1.3 | 2026-09-22 | 草案 | 补齐时间区间与证据来源完整性、摘要规范版本、Attempt 过期控制和普通 Task 重复消费语义 |
| 0.1.2 | 2026-09-22 | 草案 | 修正字段/外键闭合、摘要语义、运行记录可变边界、Projection Task 唯一性和 Canon 时间关系来源 |
| 0.1.1 | 2026-09-22 | 草案 | 补齐逐表物理定义、多态引用完整性方案和字段/版本绑定规则 |
| 0.1.0 | 2026-09-22 | 草案 | 建立 PostgreSQL 兼容建议基线、逻辑实体完整映射、表目录和核心版本/提交物理结构 |
