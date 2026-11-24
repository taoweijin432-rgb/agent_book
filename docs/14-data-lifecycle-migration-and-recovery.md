# 数据生命周期、迁移与恢复设计

- 文档编号：DOC-14
- 版本：0.1.7
- 状态：草案
- 更新时间：2026-09-23
- 规范性依赖：[关系数据库物理 Schema](12-relational-physical-schema.md)、[数据库约束、索引与并发](13-database-constraints-indexes-and-concurrency.md)、[数据不变量与事务边界](11-data-invariants-and-transaction-boundaries.md)、[Canon 正式提交协议](08-canon-commit-protocol.md)、[双真实源规范](04-dual-source-of-truth-spec.md)
- 参考性引用：[数据库逻辑模型](09-database-logical-model.md)、[逻辑实体目录](10-logical-entity-catalog.md)、[系统架构](05-system-architecture.md)

## 1. 文档边界与保留原则

本文件定义关系数据库权威记录、Candidate/执行历史、投影结果、Schema 迁移、备份恢复和最低灾备演练的生命周期边界。不输出 SQL、DDL、ORM、迁移脚本或部署拓扑；不自行批准数据库产品、对象存储、删除期限、备份周期或 RPO/RTO 数值。

Author Design Source 与 Canon Narrative Source 仍是两个真实源。Candidate、Context、Validation、Approval、Commit Ledger、Outbox 和审计是权威记录或治理/执行记录，但不构成第三个叙事真实源。图、向量、搜索、缓存、当前状态和时间线均是可重建投影。普通 Schema 迁移保持业务语义不变，不等于新的 Canon 提交；业务事实修订必须走 Canon Commit 及其不可变关系。

统一保留口径如下：对模型调用、Context Bundle、Candidate 正文、Prompt/Model/Tool 版本、hash、受保护引用和最小审计证据，至少保留来源链和校验所需信息。原始载荷或密钥引用删除/失效后，只能标记“部分不可重放”及影响范围，不得继续承诺完整恢复或逐字复现。

## 2. 数据生命周期矩阵

“可重建”只表示可以从权威源或明确的 Outbox/Rebuild Record 创建新的执行记录或结果；不表示可以伪造、替代或还原原始执行历史。原始 Attempt、Failure、访问审计和模型调用载荷属于历史证据，不能被重新执行结果覆盖。

| 数据类别 | 初始/运行状态 | 权威性与保留 | 可重建性及边界 | 归档/删除语义 |
|---|---|---|---|---|
| 草稿暂存区与 Candidate | created/编辑/修复/待审批/失效 | Candidate 正文、hash、来源链、人工修改和审批影响保留；不属于第三叙事真实源 | 可重新生成候选，但不能声称重建原始模型输出 | 物理删除待安全与合规决策；默认不删有效来源 |
| Context Bundle/Item/Source Reference | 编译/冻结/过期 | 被 Generation、Candidate、Approval 或 Commit 引用的 Bundle 及实际内容/不可变引用必须保留 | 可重新编译新 Bundle；不能用重新检索替代原 Bundle | 过期不等于删除；删除期限待决策 |
| 模型调用输入输出 | queued/running/succeeded/failed/cancelled | Model Call 的执行身份、Generation 来源、输入版本、请求引用和 request_hash 不可变；running 可受控写入响应引用、结束时间、response_hash 和结果引用；终态结果不可覆盖 | 可重建输入链；外部模型输出不保证逐字重现；同输入新调用创建新的 Call/Attempt，不能覆盖旧调用 | 原始载荷删除待安全、合规和成本评审；缺失时标记能力降级 |
| Validation/Issue/Result/Repair | running/completed/invalidated | Validation Run 的 Candidate、请求键、Design、Watermark 和规则版本绑定不可变；运行中结果可受控更新；终态结果不覆盖 | 可创建新 Validation/Repair Run；同输入新运行使用新请求键，不能替代历史结果 | 治理历史默认不删，归档规则待确认 |
| Approval/Approval Invalidation | approved/rejected/stale/invalidated | Approval 和 Invalidation Record 保留；原 Approval 不改写，stale 由有效性查询派生 | 可重新审批；不能重建原审批决定 | 默认不删除；可受控归档但必须保留绑定摘要和失效链 |
| Canon Commit/Canonical Text/Story Event/Fact/State | preparing/committed/failed | 成功 Commit、正文和结构化 Canon 永久保留；修订/撤销/补偿由新记录及显式关系表达 | 可从提交账本回放查询；投影不能替代 Canon | 成功 Canon 不得物理删除 |
| Commit Item/Mapping/关系/Evidence | 随 Commit 创建 | 与 Canon 来源链同步保留；每个进入 Canon 的结构化对象必须有 Commit Item 和 Mapping | 可重建查询结果，原始来源关系不能由查询结果替代 | 有效来源不得删除 |
| Projection Outbox | emitted/pending/processed/failure | 原始 Outbox 是 Canon Commit 同事务产生的权威运行记录，保留到审计策略允许的归档阶段 | 不得由派生投影或重试伪造；缺失补偿只能创建 Rebuild Record 并审计 | 删除/归档待运维和审计决策 |
| Projection Task | pending/completed/cancelled/abandoned/needs_rebuild | Task 的来源、Outbox/Rebuild Record、目标、scope_hash、策略版本不可变；重复消费查询全部状态：无 Task 才创建、pending 复用、needs_rebuild 进入显式恢复、completed 返回结果、cancelled/abandoned 返回终止状态；普通有效状态仅 `pending`/`needs_rebuild` 保证唯一 | 可依据现存 Outbox 或 Rebuild Record 创建新的 Task；不得由重复消息自动恢复终态；普通重试复用 Task 并创建新 Attempt | 可按审计策略归档；不能覆盖历史来源 |
| Projection Attempt | processing/succeeded/retryable_failure/permanent_failure/expired | 创建 processing 记录后事务外执行；Attempt ID 是执行身份，`worker_version` 仅软件版本，`expires_at` 是领取时计算的截止时间；完成与过期在受并发保护的短事务中先取得 Attempt 行锁，再以数据库权威时间在状态转换判定点分别检查 `status=processing` 且严格早于/大于等于 `expires_at`；成功时在同一事务将 `ended_at` 记录为成功接受时间；只有一个终态转换获胜 | 每次重试创建新的 Attempt；expired 不得恢复 succeeded；只有成功接受时未过期（`status=succeeded` 且 `ended_at < expires_at`）、来源/范围/策略/水位及发布条件匹配的 Attempt 才能推进 Checkpoint；截止后允许推进，不再比较推进时的当前时间 | 原始 Attempt 不因重试删除；过期和迟到结果保留审计 |
| Projection Failure | retryable/permanent/handled | 与 Attempt 关联的 Failure 是历史证据，追加保留 | 可处理失败并产生新 Attempt；不得伪造原 Failure | 保留期限待审计评审 |
| Projection Checkpoint | staging/active | Checkpoint 保存目标、规范化范围、策略和成功 Watermark；只接受对应成功且成功接受时未过期的 Attempt，并再次检查来源、范围、策略、水位、替代/失效和发布条件；active 是当前派生进度，不是事实源 | 可从成功 Attempt/源重新计算；截止前成功接受的结果可在截止后推进；低水位只能进入 staging，达标并通过来源/权限/结果校验后切换 | 当前及必要历史保留；删除期限待确认 |
| Projection Rebuild Record | requested/running/verified/switched/abandoned | 重建身份、来源 Outbox/Commit、范围、水位和策略不可变；running/verified/switched 状态、验证/切换时间和原因可受控更新；终态不覆盖；不是每次正常提交必写对象 | 可依据 Outbox 或 Canon 源创建；不得伪造原始 Outbox/运行历史 | 治理记录按审计策略保留 |
| 审计日志/Trace/人工修改 | started/running/completed/error/cancelled/archived | Trace 的身份、父级、运行对象和开始时间不可变；运行中可更新状态、结束时间和结果引用；人工修改记录追加不可变 | 查询视图可重建，原始审计不能由新 Trace 替代 | 可脱敏、压缩、分层；周期待合规评审 |
| Cost/Evaluation | recorded/aggregated | 原始计量、评测规则/数据集/模型版本和结果保留到质量与成本评审需要 | 汇总可重算，原始样本结果按策略保留 | 期限待确认 |
| 图、向量、搜索、缓存、当前状态和时间线 | materialized/stale/staging/active | 仅是派生结果，保存来源版本、策略和 Watermark 以便重建 | 从权威关系数据、Outbox 或 Rebuild Record 重建；不回写真实源 | 可淘汰；低水位结果不得切换为当前 |

## 2.1 运行记录的可变边界与 Attempt 过期控制

运行历史保护不等于运行中每个字段都不可更新。以下边界与 `12`、`13` 一致：

- 执行身份、来源关系、输入版本、请求载荷绑定、策略版本和幂等/请求键不可变。`worker_version` 只记录 Worker 软件版本，不承担并发版本、租约或领取令牌语义。
- 创建或领取 Attempt 时，在来源 Task 锁下创建 `processing` 记录并取得唯一 `attempt_id`；同时依据投影策略计算并保存不可变 `expires_at`。同一 Task 的重试必须先检查既有 processing Attempt。
- 完成路径和过期路径都使用受并发保护的短事务：先取得 Attempt 行锁，再在状态转换判定点使用数据库权威时间重新判断。完成仅在 `status=processing` 且数据库权威时间严格早于 `expires_at` 时写入 `succeeded`；过期仅在 `status=processing` 且数据库权威时间大于或等于 `expires_at` 时写入 `expired`。成功路径在同一事务把 `ended_at` 写为成功接受时间；完成与过期同时发生时最多一个终态转换成功，清理任务尚未运行不改变截止后的完成判定。
- 已 expired 的 Attempt 不得恢复 succeeded；创建新 Attempt 与旧 Attempt 失效在 Task 锁和状态条件下排序，避免旧 Worker 与新重试同时生效。Checkpoint 必须核验 `status=succeeded`、`ended_at < expires_at`（成功接受时未过期），并再次核验 Task 来源、scope_hash、策略版本、Watermark、替代/失效状态和发布条件；不得以推进时的当前时间重新否定截止前已接受的成功。
- 数据库拒绝迟到结果只保护权威记录回写，不能撤销已经发生的外部投影写入。投影目标必须以来源 Commit/Outbox、Watermark、scope_hash、strategy_version 和结果 hash 形成幂等写入键；旧执行只能写隔离 staging 或被目标版本保护，只有通过 Checkpoint 的 CAS/单调水位检查才能切换 active，不能覆盖当前已发布结果。
- 无需为每类运行记录新增独立状态事件表，但每次状态转换必须保留执行 Trace、Failure 或审计依据。

## 3. Schema 迁移原则

### 3.1 业务事实修订与 Schema 迁移分离

- **业务事实修订**：改变故事事实、正文、状态、关系、时间或秘密披露的语义，必须创建新的 Candidate、Validation/Approval（如适用）和 Canon Commit，并以新正文、结构化对象、Mapping、关系和 Outbox 表达；原成功 Commit 不被改写。
- **保持业务语义不变的 Schema 迁移**：只改变列、约束、索引、物理组织或兼容读写路径，必须证明逻辑实体身份、值域、来源链、版本绑定和 Canon 语义不变。它不是新的叙事提交，不得借迁移覆盖历史事实。
- 两类操作的变更记录、操作者、校验摘要和回滚/前滚计划必须分开审计。若迁移发现业务数据语义不一致，应停止迁移并进入业务修订评审，不得用迁移脚本直接“修正” Canon。

### 3.2 Expand / Migrate / Contract

生产迁移采用向前兼容的顺序：

1. **Expand**：先增加可空列、关系、表或兼容视图，不改变旧读取路径的语义。
2. **Migrate**：分批回填、双读或受控双写；每批记录迁移版本、范围、数量、hash/校验摘要、失败原因和审计主体。保持业务语义不变的物理迁移可以在审计和校验下转换存储表示，不要求创建新的 Candidate、Design Revision 或 Canon Commit，但必须保留业务身份、业务版本、来源关系和内容语义；业务事实变化仍必须走正式修订流程。
3. **Contract**：确认消费者已切换、历史回填已校验且回滚窗口结束后，才移除旧列或旧兼容路径。

大表回填应可暂停、可重试；索引构建使用数据库支持的在线/低阻塞策略，具体实现待产品选型确认。迁移失败先停止后续批次，保留已写入审计和校验结果；回滚策略按迁移类型评审，不使用破坏性删除恢复。

每个迁移必须有版本号、前置条件、影响对象、锁/并发策略、范围、校验、回滚或前滚方案、兼容窗口、操作者和审计记录。迁移可以转换物理存储表示，但不得静默改写历史事实、破坏内容 hash、来源关系或 Approval/Commit 的验证依据。Schema 迁移不得自动创建 Canon Commit、推进 Canon Watermark 或产生新的叙事关系。

### 3.3 原始载荷、哈希、受保护引用与最小审计证据

模型请求/响应、Context Bundle 内容、Candidate 正文、Prompt/Model/Tool 版本和受保护引用的保留必须形成同一来源链。可脱敏、加密、压缩或分层存储，但不得删除使 Approval、Commit、来源映射或权限回查无法验证的最小证据。若正文/载荷本体、对象存储引用或密钥失效，记录具体缺失项、影响的重放能力和恢复边界；该状态是能力降级，不得标记为“完整可恢复”。

## 4. 备份、恢复与最低灾备演练

### 4.1 恢复范围

权威关系数据库备份必须覆盖 Author Design、Candidate/Approval、Validation、Canon Commit Ledger、Canonical Text、结构化 Canon、Evidence、Mapping、原始 Projection Outbox 和关键审计。Canon Ledger 与原始 Outbox 按同一一致性边界恢复；缺失 Outbox 只能通过受控审计创建 Rebuild Record 和后续新 Task/Attempt，不伪造原始 Outbox。

Evidence 恢复必须同时恢复 `evidence_reference` 及其类型支撑行，并按 `12` 的逐类型字段映射和 `13` 的执行位置做完整性检查：Candidate 直接来源不得带子对象目标，Candidate 子对象必须属于指定 Candidate Version；Canon 正文、Commit 和内部对象必须使用各自合法字段组合，内部对象目标列与所属 `canon_commit_id` 可同时非空；所有目标、容器、版本和项目范围必须一致。检查失败的记录必须保持隔离并报告，不得通过猜测类型、清空容器或改写不可变 Evidence 来“修复”。 Evidence 恢复还必须按完整去重身份 `(source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind)` 检查；旧四字段组合只用于检索，不能把实际来源对象不同的记录合并。发现完整身份重复、父字段与支撑行不一致、支撑行缺失或多个支撑行时，记录必须隔离并报告，不得改写不可变 Evidence、擅自合并或删除其中一条。

Time Interval 恢复必须同时恢复 `time_interval` 和 `time_interval_source`。`time_interval_source.time_interval_id` 必须存在且唯一，来源类型、目标字段、来源域、来源版本、项目归属以及来源对象自身的区间引用必须一致；`time_interval` 不再依赖 `source_binding_id` 反向引用。发现孤立区间、重复来源绑定、错误归属、来源对象缺失或关联不一致时，必须隔离并报告，不猜测来源、不自动补造绑定、不改写不可变记录。

Context Bundle 的实际内容或受保护不可变引用、模型请求/响应、Prompt/Model/Tool 版本和 Candidate 原始正文按敏感等级备份。密钥、引用或保护凭证失效时，恢复结果必须显式标记部分不可重放。

### 4.2 派生投影恢复

图、向量、搜索、缓存、Derived Current State、Reader Disclosure State 和 Derived Timeline View 从关系数据库权威源重建。普通 Task 只能来自现存 Outbox；重建 Task 只能来自 Rebuild Record；重复消费 completed/cancelled/abandoned Task 只返回既有终态，不自动恢复；每次重试产生新的 Attempt。恢复或重试必须重新执行 Attempt 的受锁保护截止判定；只有成功接受时未过期的 Attempt 才能推进 Checkpoint，截止前已成功接受的结果允许在截止后推进。低水位重建只进入隔离 staging，必须满足目标 Watermark、来源回查、权限回查、结果 hash 和目标幂等校验后才能切换 active；低水位不得覆盖当前投影，投影失败不得改变 Canon 成功状态。已经发生的外部投影写入不由 Attempt 状态回滚，而由 staging、目标版本保护和 Checkpoint 切换边界隔离。

### 4.3 最低灾备演练流程

具体演练周期、RPO/RTO 和恢复优先级待基准测试与运维批准；但每次演练至少包含以下步骤：

1. 在隔离环境恢复备份，并停用或限制 Worker、模型调用、发布和其他外部副作用。
2. 核对 Commit Ledger、Canonical Text、结构化 Canon 对象、Commit Item、Candidate-to-Canon Mapping 和 Projection Outbox 是否恢复到同一一致性边界。
3. 核对内容 hash、外键、Approval Invalidation 链、成功 Commit Sequence 和 Canon Watermark 的一致性；数据库内部序列不能替代成功水位核对。
4. 核对 Context/模型载荷的受保护内容、密钥状态、对象存储引用和最小审计证据；缺失项必须记录为能力降级。
5. 从权威源和现存 Outbox/Rebuild Record 创建隔离投影，验证低水位结果不会覆盖当前结果；每次重试使用新的 Attempt。
6. 完成权限、秘密保护、来源版本和项目范围回查，不以 Prompt 或向量相似度代替授权/事实校验。
7. 记录实际恢复耗时、可恢复的最新水位、数据损失窗口、缺失项、失败原因和处置结果。
8. 只有在一致性、权限、来源、哈希和隔离切换条件全部满足时，演练结果才可标记为通过；否则保持隔离，不恢复正常服务。

演练通过只说明本次样本恢复满足检查条件，不自动等同正式 RPO/RTO 达标；正式阈值和证据标准仍待批准。

## 5. 恢复通过条件与阻断条件

恢复结果至少应满足：权威记录在同一提交边界内可回查；成功 Commit 不被投影或迁移覆盖；正文、结构化 Canon、Mapping、Outbox、Approval 失效链和成功水位可验证；Evidence 的完整去重身份、父子来源一对一关系、来源类型、实际目标、容器归属、版本和项目范围符合 `12`、`13` 的映射与唯一性约束；旧四字段键相同但实际来源对象不同的记录不得被合并；Time Interval 与 `time_interval_source` 必须一对一绑定且来源归属、来源对象区间引用和项目/版本关系可验证；孤立或错误绑定只能隔离报告；派生投影只在隔离 staging 达到目标后切换；权限和受保护内容检查通过。任一条件不满足，恢复只能保持隔离并输出缺失/降级报告，不得恢复正常写入或发布服务。

## 6. 本阶段待确认项

- PostgreSQL 兼容基线及正式产品选型；
- 加密列/加密卷/对象存储引用的具体组合和密钥恢复流程；
- 备份介质、跨区域策略、演练频率和恢复优先级；
- RPO/RTO、归档/删除期限、原始载荷保留期限和在线索引方式；
- 大表回填窗口、分区和冷热归档策略。

## 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.1.7 | 2026-09-23 | 草案 | 同步 Time Interval 来源绑定循环修复、创建顺序和恢复隔离检查 |
| 0.1.6 | 2026-09-23 | 草案 | 同步 Evidence 完整来源身份的恢复唯一性和父子来源完整性检查 |
| 0.1.5 | 2026-09-23 | 草案 | 收口 Projection Attempt 截止接受、重试和 Checkpoint 延迟推进语义 |
| 0.1.4 | 2026-09-23 | 草案 | 补充 Evidence 来源逐类型映射的恢复与完整性检查 |
| 0.1.3 | 2026-09-22 | 草案 | 同步普通 Task 全状态消费、Attempt expires_at 竞争和外部投影版本保护语义 |
| 0.1.2 | 2026-09-22 | 草案 | 收口运行记录可变边界、Attempt 迟到结果、普通 Task 唯一性和 Schema 迁移语义 |
| 0.1.1 | 2026-09-22 | 草案 | 区分投影结果与执行历史，补充最低灾备演练、迁移语义和载荷保留边界 |
| 0.1.0 | 2026-09-22 | 草案 | 建立数据生命周期、Expand/Migrate/Contract 迁移、备份恢复和投影重建策略 |
