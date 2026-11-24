# 数据不变量与事务边界

- 文档编号：DOC-11
- 版本：0.1.7
- 状态：草案
- 更新时间：2026-09-22
- 规范性依赖：[产品需求](02-product-requirements.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[Canon 正式提交协议](08-canon-commit-protocol.md)、[数据库逻辑模型](09-database-logical-model.md)、[逻辑实体目录](10-logical-entity-catalog.md)
- 参考性引用：[系统架构](05-system-architecture.md)、[叙事数据模型](06-narrative-data-model.md)、[上下文组装规范](07-context-assembly-spec.md)

## 1. 适用范围与保证层次

本文件定义逻辑数据不变量、事务边界、并发、授权可见性和派生数据重建。它不规定数据库厂商、锁语法、字段类型、索引、部署拓扑或代码实现。

“数据库层保证”表示最终实现应把规则放在权威存储的一致性边界内；“应用层保证”表示领域服务必须在写入前执行；“共同保证”表示两层都不能省略。无论实现方式如何，Agent 都不得直接操作任意数据表，所有写操作必须经过受限工具或领域服务。

## 2. 数据不变量

| 编号 | 规则说明 | 涉及实体 | 检查时机/违反处理 | 保证层 | 对应需求 | 后续测试建议 |
|---|---|---|---|---|---|---|
| INV-SOURCE-001 | Author Design Source 与 Canon Narrative Source 互不直接覆盖；跨源影响必须经映射、事件、修订或提交服务 | Author Design Revision、Canon Fact、Story Event、Canon Commit | 设计提交、Canon Commit；拒绝直接同步并记录访问审计 | 共同 | FR-003、FR-019、NFR-002 | 设计改动和正文冲突样例 |
| INV-WORKFLOW-001 | Workflow Run 必须且只能关联一个 Scene Task Version，只组织执行和审计关系；其 `approved` 不得解释为 Canon 已提交；Approval Record 必须绑定 Candidate、内容哈希、Context Bundle、Author Design Revision、Canon Watermark、审批策略版本和 Validation Run；Canon 对象只能由成功 Canon Commit 产生 | Workflow Run、Scene Task Version、Approval Record、Canon Commit、Candidate Version、Context Bundle、Validation Run | 创建或更新 Workflow Run 时检查关联和状态边界；拒绝把 Workflow Run、Approval Record、Canon Commit 合并为同一生命周期或状态字段 | 共同 | FR-019、NFR-001、NFR-002 | 工作流批准与 Canon 提交分离 |
| INV-WORKFLOW-002 | 每个 Generation Run 必须且只能属于一个 Workflow Run，并且必须且只能引用一个冻结 Context Bundle；该 Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 完全相同；一个 Workflow Run 可包含零到多个 Generation Run；每个 Candidate Version 必须且只能属于一个 Workflow Run，并必须绑定或明确继承实际适用的 Context Bundle，且该 Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 完全相同；模型生成、修复和人工编辑分别遵守各自来源链，非模型 Candidate 不强制 Generation Run，不得伪造 Generation Run | Workflow Run、Generation Run、Context Bundle、Candidate Version、Repair Record、Human Change Record | 创建/保存各记录时检查共同 Scene Task Version、基数和来源链；当前不启用跨 Workflow Run 草稿依赖，修复或人工编辑关系不得绕过 `OQ-003`；不得仅检查对象分别存在；模型生成缺 Generation Run、修复或人工编辑前序候选不属于同一 Workflow Run、或以伪造 Run 补齐时拒绝 | 共同 | FR-009、FR-013、FR-019、NFR-004 | Workflow Run、Generation Run、Candidate 和 Bundle 关系闭合 |
| INV-IDENTITY-001 | Entity 只作跨域稳定身份锚点，不承载完整设计或完整 Canon 状态，不构成第三真实源 | Entity、Design Binding、Canon Reference | 建立/合并/拆分时检查；非法承载写入拒绝 | 应用层 | FR-003、FR-025 | 身份合并、拆分和历史引用回放 |
| INV-CANDIDATE-001 | Candidate Version、Candidate Event、Candidate Fact Proposal、Candidate State Transition 不得原地变为 Canon | Candidate、Canon Commit、Mapping | 提交前检查对象域和映射；必须新建 Canon 对象 | 共同 | FR-013、FR-019 | 候选拒绝、批准、提交三态测试 |
| INV-CANDIDATE-002 | 未完成有效审批的 Candidate 不得进入 Canon Commit | Candidate Version、Approval Record、Canon Commit | Commit 原子事务前复核；缺失或失效则拒绝 | 应用层 | FR-017、FR-019 | 审批缺失、过期、决策变更 |
| INV-APPROVAL-001 | Approval 必须绑定具体 Candidate 内容哈希、Context Bundle、Design Revision、Canon Watermark、Validation Run 和策略版本 | Approval Record、Candidate Version、Context Bundle、Validation Run | 审批写入和 Commit 前双重检查；不匹配则失效 | 共同 | FR-016、FR-019 | 同 Candidate 改文、换 Bundle、换 Canon Watermark |
| INV-APPROVAL-002 | Candidate、关键状态提案、Design Revision、Canon Watermark、规则/策略或关键 Context Bundle 变化后，旧 Validation/Approval 不得复用；Approval 失效必须追加 Approval Invalidation Record | Validation Run、Approval Record、Approval Invalidation Record | 版本变化时追加 Approval Invalidation Record，使有效性查询结果为 stale；Commit 拒绝旧运行 | 应用层 | FR-017、NFR-001 | 逐项变更失效矩阵 |
| INV-CANON-001 | 成功 Canon Commit 不可修改；成功状态永久保持 committed | Canon Commit、Canon Commit Item | 提交完成后只允许新增关系/新提交；尝试更新拒绝 | 共同 | FR-019、FR-021 | 重复更新成功提交 |
| INV-CANON-002 | Canon 修订、撤销、反向、补偿和替代必须使用新记录及显式关系 | Canon 对象、Supersession/Reversal/Compensation | 修订服务检查关系完整性；不允许原地删除 | 应用层 | FR-021、FR-022 | 已发布章节修订及回滚 |
| INV-CANON-003 | 同一 Canon Watermark 下不能有互相冲突且同时有效的唯一事实；冲突必须被阻断或被有效修订关系解释 | Canon Fact、State Transition、Canon Watermark | Commit 前执行冲突检查；失败回滚事务 | 共同 | FR-014、NFR-002 | 身份、地点、物品和状态冲突 |
| INV-KNOWLEDGE-001 | 缺少人物知识记录只能解释为 unknown，不得推导为 known_false | Character Knowledge State、Knowledge Evidence | 派生查询和校验时采用默认 unknown；非法推导不入库 | 应用层 | FR-014、NFR-003 | 缺记录、否定证据、错误信念 |
| INV-KNOWLEDGE-002 | Character Knowledge State 仅允许 `known_true`、`known_false`、`unknown`；Character Belief State 仅允许 `believed_true`、`believed_false`、`unknown`，两者不得混用 | Canon Fact、Character Knowledge State、Character Belief State、Knowledge Evidence、Belief Evidence | Knowledge State 只从 Knowledge Evidence 派生和重建；Belief State 只从 Belief Evidence 派生和重建；缺少知识证据推导为 unknown | 应用层 | FR-014、FR-025 | 真事实、谣言、误认、纠正 |
| INV-KNOWLEDGE-003 | Belief Evidence 不能升级为客观 Canon Fact；它只能证明角色相信某命题，不能证明客观事实真实性 | Belief Evidence、Character Belief State、Canon Fact | Canon Fact 提交和重建时拒绝以 Belief Evidence 作为真实性唯一依据 | 共同 | FR-014、FR-025 | 谣言/误认不能成为客观事实 |
| INV-DISCLOSURE-001 | Reader Disclosure State 必须绑定特定 Canon Watermark，并可追到正文、Assertion 和披露证据 | Reader Disclosure State、Text Version、Evidence | 投影生成和上下文编译；无 Canon Watermark 或证据链则拒绝使用 | 共同 | FR-006、NFR-003 | 不同读者 Canon Watermark 和修订重建 |
| INV-TEMPORAL-001 | Derived Timeline View 只能从带 source domain/source version 的 Temporal Relation、Temporal Constraint、Time Interval 和 Temporal Evidence 派生，不能成为独立写入事实源 | Temporal Relation、Temporal Constraint、Time Interval、Temporal Evidence、Derived Timeline View | Derived Timeline View 写请求拒绝；只能分别提交 Canon Temporal Relation 或 Author Design Temporal Constraint；Design Time Interval 不得解释为 Canon 时间 | 应用层 | FR-014、NFR-005 | 删除/重建 Derived Timeline View 对比 |
| INV-TEMPORAL-002 | 无绝对时间证据时保持 relative/unknown/区间，不得强行补成确定日期 | Time Interval、Temporal Evidence | 时间抽取和 Commit 前检查；不确定值保留 | 应用层 | FR-014 | 相对顺序和未知时间样例 |
| INV-PROJECTION-001 | 图、向量、搜索、缓存、Derived Current State、Reader Disclosure State、Derived Timeline View 和 Design Fulfillment State 不得回写 Author Design 或 Canon 权威记录 | Projection Task、Projection Attempt、Derived*、Canon/Design | 投影工具能力只允许写投影域；回写拒绝并审计 | 共同 | FR-023、NFR-005 | 投影篡改和源重建 |
| INV-PROJECTION-002 | Projection Outbox 必须与成功 Canon Commit 在同一事务产生；没有成功 Commit 不得有生效 Outbox；原始 Outbox 不是可随意重建的派生结果 | Canon Commit、Projection Outbox、Projection Rebuild Record | Canon Commit 原子边界内检查；失败一并回滚；恢复从现存 Outbox 或 Canon Commit 创建 Rebuild Record，不伪造原 Outbox | 共同 | FR-019、FR-023 | 正文成功/Outbox 失败注入 |
| INV-IDEMPOTENCY-001 | 相同幂等键和相同请求载荷只产生一个提交结果，重复请求返回原结果 | Canon Commit、Idempotency key、payload hash | Commit 开始和完成时检查；相同者幂等返回 | 共同 | FR-020 | 重复请求并发测试 |
| INV-IDEMPOTENCY-002 | 相同幂等键但 payload hash 不同必须拒绝，不得覆盖原请求 | Canon Commit、payload hash、Audit | 入口校验；记录异常并保持原提交不变 | 共同 | FR-020 | 同键不同正文/快照 |
| INV-CONTEXT-001 | Context Bundle 冻结后不可原地修改；必须保留最终编译内容或受保护不可变引用、完整内容哈希、Item 最终顺序、来源版本、权限依据和入选原因 | Context Bundle、Item、Source Reference | 冻结时完整性检查；变化生成新 Bundle；仅保存来源摘要不足以重放 | 共同 | FR-008、NFR-004 | 同任务多次编译与哈希比较 |
| INV-AUTH-001 | Agent 只能读取其 Data Scope 和人物视角允许的数据；默认拒绝，不依赖 Prompt 中的“不要读取” | Capability Grant、Data Scope、Visibility Decision | 每次读取前裁剪并审计；不确定即拒绝 | 共同 | FR-006、FR-010、NFR-003 | 秘密、未来事实、他人知识泄露 |
| INV-AUTH-002 | Agent 不得写入未获授权的域；写作 Agent 只能写 Candidate/草稿，不能写 Canon/Design | Actor、Role、Capability、Candidate、Canon | 工具/领域服务入口检查；越权拒绝 | 共同 | FR-009、NFR-003 | 伪造工具调用和任意写入 |
| INV-PUBLISH-001 | 已发布章节修订不得自动修改后续章节或下游正文；只能生成 Impact Assessment/Impact Item 影响清单和新修订任务 | Canonical Text、Impact Assessment、Impact Item、下游 Scene/Chapter | 发布修订后检查；禁止级联原地更新 | 应用层 | FR-022、OQ-006 | 历史时间线改变样例 |
| INV-REBUILD-001 | 每个派生状态必须可追溯到源记录、源版本、Canon Watermark、策略版本和重建任务 | Derived Current State、Derived Timeline View、Reader Disclosure State、Projection | 生成、切换和审计时校验；缺链不发布 | 共同 | NFR-004、NFR-005 | 从空投影全量重建 |

| INV-DESIGN-001 | Author Design Revision 草案可编辑；确认/冻结后内容、对象版本集合、生效范围和确认依据不可变，后续变化产生新 Revision | Author Design Revision、Design Object Version | 草案保存可改；冻结时校验；冻结后修改拒绝并要求新 Revision | 共同 | FR-003 | 草案编辑与冻结后修改 |
| INV-DESIGN-002 | Outline Node、Foreshadowing Plan、Ending Constraint 只保存设计生命周期；实现/满足/埋设/推进/回收/违反状态由 Design Fulfillment State 派生 | Design Object、Design Fulfillment State、Canon Evidence | 设计写入和 Canon Commit 时检查；不得把 Canon 结果写回设计生命周期 | 应用层 | FR-004、FR-005 | 设计与实际实现分离 |
| INV-CONTEXT-002 | Scene Task Version 必须先存在；Context Bundle 必须引用一个已存在且有效的 Task Version，一个 Task Version 可编译多个 Bundle | Scene Task、Context Bundle | Bundle 编译时检查；Task 创建不要求预先存在 Bundle | 共同 | FR-007、FR-008 | 任务先行和多次编译 |
| INV-CANDIDATE-003 | 一个 Workflow Run 可以包含多个 Candidate Version，但同一时刻最多选择一个当前最终 Candidate Version；选择、替换或取消均追加不可变选择历史，历史选择不得删除或改写；转入 `approved` 必须存在对该当前最终 Candidate 有效且完全匹配的 Approval Record；当前最终 Candidate 改变后原 `approved` 不再有效，历史 Approval 不自动迁移；Canon Commit 必须重新检查当前选择和 Approval 当前有效性 | Workflow Run、Candidate Version、Approval Record、Canon Commit | 选择和状态更新时检查唯一当前最终 Candidate、选择历史版本及 Approval 绑定；Approval 失效追加记录，不改写历史审批；并发选择变化导致旧提交失败或重新校验；Canon Commit 独立复核 | 共同 | FR-017、FR-019、FR-020 | 最终候选选择、历史和审批失效 |
| INV-CARDINALITY-001 | 一个 Canon Commit 绑定一个 Candidate Version，并产生一个 Canonical Text Version；结构化 Canon 对象、Commit Item、Mapping 和 Outbox 为零到多个 | Canon Commit、Candidate Version、Canonical Text Version、Canon Commit Item | Commit 原子事务检查；当前不支持一个 Commit 多 Candidate/多正文 | 共同 | FR-019、FR-020 | 基数和重复提交 |
| INV-CARDINALITY-002 | 每个进入 Canon 的结构化对象必须有对应 Canon Commit Item，且 Item 指向实际目标 Canon 对象身份或版本 | Canon Commit Item、Canon Fact、Story Event、State Transition、Mapping | Commit 内完整性检查；缺少目标引用则回滚 | 共同 | FR-019、FR-025 | 结构化对象映射 |
| INV-COMMIT-SEQ-001 | 只有成功 Commit 分配新的 Commit Sequence 并推进 Canon Watermark；失败或回滚请求不推进，当前单分支对外 Canon Watermark 不得倒退 | Canon Commit、Canon Watermark、Projection Checkpoint | Commit 逻辑串行化检查；失败全回滚 | 共同 | FR-020、NFR-002 | 并发成功/失败序列 |
| INV-MODEL-001 | Model Call 必须保存或引用实际渲染后的请求载荷和实际响应内容；Candidate 原始正文必须保留，重新调用模型只能是新运行，不能声称精确重建 | Model Call、Context Bundle、Candidate Version | 调用完成时校验请求/响应哈希；缺少受控引用不得宣称可重放 | 共同 | NFR-004、NFR-006 | 请求/响应恢复和非确定性 |
| INV-PROJECTION-003 | 普通 Projection Task 必须关联一个 Projection Outbox；重建 Projection Task 必须关联一个 Projection Rebuild Record；origin 只能二选一；一个 Outbox 可暂时没有普通 Task；一个 Task 可有多个 Attempt；Checkpoint 只能由成功且未过期 Attempt 推进 | Projection Outbox、Projection Rebuild Record、Projection Task、Projection Attempt、Projection Checkpoint、Projection Failure | Task 创建和 Attempt 执行时检查；同一 Outbox/目标/策略最多一个有效普通 Task；重复消费不得产生第二个有效 Task | 共同 | FR-023、NFR-005 | 重试、重建、过期和幂等 |

## 3. 事务边界

下表的“输入快照”是事务开始时固定的逻辑版本；“事务外后处理”不得被当作权威 Canon 成功的一部分。

| 编号/事务 | 输入快照与前置条件 | 同一事务内写入 | 版本/幂等/失败与重试 | 审计与异步 |
|---|---|---|---|---|
| TX-DESIGN-001 创建 Author Design Revision | 当前生效 Design Revision；对象版本合法 | Revision、对象版本引用、差异、审计 | Revision 请求键幂等；失败全部回滚；可用同载荷重试 | 记录作者/服务；影响评估可异步 |
| TX-DESIGN-002 确认/冻结 Design Revision | 草案版本完整、权限足够、无未处理阻断 | 状态变化、生效指针、确认记录 | 版本检查；重复确认返回原结果；失败不改变草案 | 记录确认；下游影响评估异步 |
| TX-TASK-001 创建 Scene Task | Novel/Scene、Author Design Revision、Canon Watermark 存在且可见 | Task Version、目标、视角、安全条件、Design Revision/Canon Watermark 引用 | 请求键幂等；创建 Task 不预绑定 Context Bundle | 记录创建者；不异步改变源 |
| TX-WORKFLOW-001 创建 Workflow Run | Scene Task Version 已存在且有效 | Workflow Run、运行审计、Scene Task Version 引用、当前最终 Candidate 指针及不可变选择历史所需的初始状态 | 请求键幂等；Author Design Revision 和 Canon Watermark 通过 Scene Task Version 确定；创建 Workflow Run 不要求重复保存直接 Design/Watermark 引用；不创建 Canon、不推进 Canon Watermark | 记录创建者；后续执行可异步；物理冗余保存留到 Schema 阶段 |
| TX-WORKFLOW-002 更新 Workflow Run 状态 | Workflow Run 存在且状态转换合法 | Workflow Run 状态、运行审计 | 状态更新不推进 Canon Commit Sequence/Canon Watermark；失败、取消或过期不得修改已有 Canon Commit | 记录状态变化；Canon 仍由独立提交事务处理 |
| TX-CONTEXT-001 冻结 Context Bundle | Task Version 已存在且有效，结构化查询/检索已过滤权限 | Bundle、实际编译内容/受保护引用、Item、Source Reference、策略版本、Design Revision、Canon Watermark、Task Version、哈希 | Bundle 内容不可变；哈希冲突拒绝；可重新编译新版本 | 记录 Visibility Decision；生成可异步 |
| TX-GENERATION-001 保存 Generation Run | Workflow Run 已存在且有效；冻结 Context Bundle、Prompt/Model 版本可用 | Generation Run、Model/Tool Call、Cost/Trace；Model Call 实际请求/响应引用 | Run 请求键幂等；必须绑定一个 Workflow Run 和一个固定 Bundle；失败不写 Canon | 记录模型/成本；Candidate 产生和 Assertion 抽取可异步 |
| TX-CANDIDATE-002 保存 Candidate Version | Workflow Run 已存在且有效；实际适用 Context Bundle 可追溯 | Candidate Version、正文内容哈希、来源关系和必要审计 | Candidate 内容不可变；模型生成必须有 Generation Run；修复/人工编辑分别检查前序 Candidate 与 Repair Record/Human Change Record；不得伪造 Generation Run；失败不写 Canon | 记录来源和内容哈希；Validation 可异步 |
| TX-CANDIDATE-001 提取 Narrative Assertion | Candidate 哈希固定，抽取器版本可用 | Assertion、Evidence、Candidate Event/Fact Proposal/Candidate State Transition | 同 Candidate+抽取版本幂等；正文变化必须新 Candidate | 记录抽取 Trace；后续 Validation 可异步 |
| TX-VALIDATE-001 执行 Validation Run | Candidate、Design、Canon Watermark 和规则版本固定 | Validation Run、Result、Issue、证据 | 输入哈希不符拒绝；失败可新运行重试，不改旧结果 | 记录规则和耗时；修复可异步 |
| TX-APPROVAL-001 写入 Approval Record | Candidate/内容哈希、Context Bundle、Author Design Revision、Canon Watermark/成功 Commit Sequence、Validation Run 和 Approval Policy Version 全部匹配 | Approval、决定、审计、Exception 引用（如有） | 请求键幂等；输入或策略版本变化使审批失效；失败不改变 Candidate | 记录审批主体；不自动触发越权提交 |
| TX-CANON-001 执行 Canon Commit | 详见第 4 节；需要 Workflow Run 当前最终 Candidate、有效 Approval、选择历史版本和当前 Canon 基线 | 详见第 4 节，包括 Canon Watermark、Commit Sequence 与 Outbox；不扩大 Canon 原子事务范围 | 幂等键、payload hash、当前选择历史版本、基线 Canon Watermark 和 Scene Task Version 一致性；任一步失败全回滚 | Canon 成功后才允许事务外投影 |
| TX-CANON-002 创建修订/撤销/补偿提交 | 原 Commit/Publication Record 存在且不可变，影响范围已评估 | 新 Candidate/Commit、Canonical Text Version、关系、Canon Watermark、Outbox | 新幂等键；原提交不变；失败回滚新提交 | Impact Assessment/Item 可异步生成；关系在提交内写入 |
| TX-PROJECTION-001 写入 Projection Outbox | Canon Commit 已在同事务成功 | 只在 Canon 事务内写入 Outbox | 与 Commit 同成败；不可独立补造生效 Outbox | 后续 Task 事务外创建 |
| TX-PROJECTION-002 创建 Projection Task | 普通 Task 的 Outbox 未完成且目标/策略可用，或重建 Task 的 Projection Rebuild Record 已存在且范围明确 | 一个 Task、origin 来源绑定、目标、策略版本和状态 | origin 只能二选一；同 Outbox/目标/策略只创建一个有效普通 Task；Rebuild Record 可创建多个明确范围的重建 Task | Worker 审计；Attempt 事务外创建 |
| TX-PROJECTION-003 执行 Projection Attempt | Task 可执行且来源 Canon Watermark 有效 | 新 Attempt、执行结果、Failure（如有） | 每次重试新建 Attempt；重复执行由源版本+Canon Watermark+策略幂等 | Worker 审计；执行异步 |
| TX-PROJECTION-004 更新 Projection Checkpoint | Attempt 成功且未过期；重建范围和当前已发布 Canon Watermark 可比较 | Checkpoint、Canon Watermark 和校验摘要 | Checkpoint 身份由投影目标、规范化投影范围和策略版本确定；普通推进只能单调增加；低水位重建只能写入暂存结果，未追平当前已发布水位不得切换；只有达到不低于当前水位并通过来源、权限和结果校验后才能切换 | 记录策略和校验；可触发重建 |
| TX-IDENTITY-001 Entity 合并/拆分 | 原身份存在、无未处理歧义、作者有权限 | Merge/Split Record、新映射、失效标记、审计 | 请求键幂等；历史引用不改写；失败全回滚 | 影响投影异步重建 |
| TX-APPROVAL-002 记录 Approval Invalidation | Approval 存在且检测到绑定输入/策略变化 | Approval Invalidation Record、失效状态审计 | 同原因/版本幂等；不得修改原 Approval，stale 只由有效性查询派生 | 记录失效；新 Approval 后续处理 |
| TX-PUBLICATION-001 记录 Publication Record | Canonical Text Version 已提交且具有发布权限 | Publication Record、发布审计 | 发布/撤回新增记录；不修改正文 | Impact Assessment 可异步 |
| TX-IMPACT-001 生成 Impact Assessment/Item | 触发 Commit、原 Publication Record 和新 Canon Watermark 存在 | Assessment、Item、策略/审计 | 评估可重算；不得自动生成 Commit 或修改下游 | 分析异步 |

## 4. Canon Commit 原子事务

Canon Commit 是唯一把 Workflow Run 当前最终 Candidate 结果转入 Canon Narrative Source 的逻辑提交边界。当前单分支严格采用“一次 Commit 对一个 Candidate Version、一个 Canonical Text Version”的基数。成功提交不可变；投影不属于 Canon 成功条件之外的补写事实。

1. **验证幂等键**：读取请求幂等键及请求载荷哈希。相同键和相同哈希返回原结果；同键异哈希立即拒绝。
2. **校验当前最终 Candidate 和选择历史**：确认待提交 Candidate 是所属 Workflow Run 当前选择的最终 Candidate，读取并锁定选择历史版本；选择变化则拒绝当前提交并要求重新校验。
3. **校验 Scene Task Version 一致性**：确认 Workflow Run、Generation Run（如有）、Context Bundle 和 Candidate 的逻辑 Scene Task Version 相等；不得仅检查对象分别存在。
4. **校验 Candidate 内容哈希**：确认 Candidate Version、正文、Narrative Assertion 和候选提案绑定同一内容哈希；变化则拒绝。
5. **校验审批绑定**：Approval 必须指向该当前最终 Candidate、哈希、Context Bundle、Author Design Revision、Canon Watermark/成功 Commit Sequence、Validation Run 和审批策略版本，且不存在有效的 Approval Invalidation Record。
6. **校验 Validation Run**：确认硬约束无未解决阻断，软质量结果仍有效，规则/校验器版本一致；失效结果不得复用。
7. **校验 Author Design Revision**：确认使用的是允许的设计修订；草案不能作为冻结提交依据；硬冲突只有在有效 Constraint Exception 存在时才能使用 `force_override`，新 Design Revision 已消除冲突时使用普通审批。
8. **校验 Canon Watermark**：确认 Candidate 使用的 Canon Watermark/成功 Commit Sequence 与当前基线兼容；不兼容时拒绝提交，重新编译/校验或进入修订流程。
9. **校验权限**：确认提交执行者具有 commit 能力、项目范围和目标章节权限；Writing Agent 不能承担该能力。
10. **逻辑串行化并分配 Commit Sequence**：在当前单分支内确认成功 Commit Sequence 严格单调递增、对外 Canon Watermark 不倒退；失败或回滚请求不分配成功 Canon Watermark。
11. **创建不可变 Canon Commit**：写入提交账本、一个 Candidate、幂等键、输入快照、操作者和提交结果初始状态；成功后状态永久为 `committed`。
12. **创建一个 Canonical Text Version**：将候选正文写入一个新的不可变 Canon 文本版本；修订、反向或补偿使用新的 Candidate、Commit 和正文版本。
13. **创建零到多个 Story Event、Canon Fact 和 State Transition**：只写入经过断言确认和硬校验的对象；每个进入 Canon 的结构化对象都必须同时创建对应 Commit Item。
14. **创建 Candidate-to-Canon Mapping**：为每个进入 Canon 的对象记录来源 Candidate、Assertion/Proposal、实际目标 Canon 对象身份或版本和确认结果。
15. **创建 supersession/reversal/compensation 关系**：若本次为修订、撤销、反向或补偿，写入显式关系；不更新原 Commit 的状态，关系不表示原提交失败。
16. **推进 Canon Watermark 并更新正文当前版本关系**：只在本事务内推进成功 Commit Sequence 和 Canon Watermark；不得写入 Derived Current State、Design Fulfillment State、Reader Disclosure State、Derived Timeline View 或其他投影结果。
17. **为每个投影目标写入一个 Projection Outbox**：Outbox 记录目标、源 Commit、Canon Watermark、策略版本和事件摘要；原始 Outbox 属于本事务权威运行记录，不作为可随意重建的投影。
18. **提交事务并在事务外执行投影**：Canon Commit、Canonical Text Version、结构化 Canon 对象、Commit Item、Mapping、关系、Canon Watermark 和全部 Outbox 必须同事务成功；失败全部回滚。事务提交后才创建 Projection Task 和 Projection Attempt，投影失败只产生新的 Projection Attempt；需要重建时创建 Projection Rebuild Record，并由其产生重建 Projection Task/Attempt；不改变 Canon。

## 5. 并发模型

- Candidate 可以并行生成；每个 Candidate 必须绑定生成时的 Author Design Revision、Canon Watermark/成功 Commit Sequence 和冻结 Context Bundle。
- Scene Task Version 先存在；Context Bundle 引用有效 Task Version。Bundle 过期后可用于受控重放，但不能直接作为当前提交基线。
- Canon Commit 采用逻辑串行化的成功序列确认。当前 Canon Watermark 与 Candidate 基线不兼容时拒绝提交；不能静默合并。
- 旧基线 Candidate 不自动丢弃，可生成新的 Context Bundle、Validation Run 和 Approval Record；重新提交必须是新的提交请求。
- 同幂等键同载荷返回原结果；同幂等键不同载荷拒绝。成功 Commit 永远不改成 `failed`、`reversed`、`compensated` 或 `superseded`；这些是关系语义。
- 同一 Outbox、投影目标和策略版本只创建一个有效 Projection Task。Worker 重试创建新的 Projection Attempt，不创建语义重复 Task。
- Checkpoint 只能由成功且未过期的 Attempt 单调推进；重复执行允许发生，但只能产生一次有效投影结果。
- 当前默认单一 Canon 主分支；多个并行 Canon 分支、完整非线性时间线和跨场景 Commit Group 仍是未来开放能力，不在本轮建立分支或多正文基数。

## 6. 授权与可见性

| 执行角色 | 可读范围 | 可写范围 | 明确禁止 |
|---|---|---|---|
| Design Studio/作者 | 全部本人有权项目设计、Canon 和审计；秘密按授权显示 | Author Design、Design Revision、审批决定和受控修订提案 | 绕过 Commit 原地改 Canon |
| Planning Agent | 设计安全投影、Canon 已提交事实、任务所需规划证据 | 规划提案、Scene Task 草稿 | 写 Design Source 或 Canon |
| Writing Agent | 仅当前 Scene Task 编译的 Context Bundle、允许视角和披露 Canon Watermark | Candidate、候选提案、草稿 | 读取原始秘密、任意检索全库、写 Canon/Design |
| Validation Agent/Service | Candidate、相关 Design 约束、Canon 基线和最小秘密验证材料 | Validation、Issue、Repair Candidate | 以模型判断绕过硬约束或改权威源 |
| Approval/Commit 执行者 | 候选、证据、校验、审批绑定和必要设计/例外 | Approval、Canon Commit、映射、关系、Outbox | 用普通 Approval 覆盖无依据硬冲突 |
| Projection Worker | Outbox、权威源版本和投影策略 | Projection Task、Checkpoint、Failure、派生索引 | 写 Author Design/Canon，暴露秘密 |

所有读取先执行 Capability、Data Scope、Canon Watermark、人物视角和秘密策略过滤；权限判断不确定时默认 `deny`，并记录 `Visibility Decision` 和 `Access Audit Record`。不能只依赖 Prompt 提示 Agent“不要读取”。日志、错误、检索命中和 Trace 均使用同样的拒绝/脱敏规则。

## 7. 派生数据与重建

| 派生对象 | 重建输入 | Canon Watermark/策略 | 幂等与校验 | 失败恢复与切换 |
|---|---|---|---|---|
| Derived Current State | 有效 State Transition、Canon Fact、关系和证据 | Canon Watermark + 状态策略版本 | 目标/维度/Canon Watermark唯一；与事件回放摘要比对 | 从最近检查点重放或全量重建；校验通过后切换 |
| Character Knowledge State | Knowledge Evidence、Canon Fact/Event、角色视角和时间关系 | Canon Watermark + 知识推导策略 | 角色/事实/Canon Watermark/策略幂等；缺失为 unknown；只允许 knowledge 值域 | 仅从 Knowledge Evidence 重建；新结果校验后替换 |
| Character Belief State | Belief Evidence、角色视角和故事时间 | Canon Watermark + 信念推导策略 | 角色/命题/Canon Watermark/策略幂等；只允许 belief 值域 | 仅从 Belief Evidence 重建；不把 belief 结果写成 knowledge 或 Canon Fact |
| Reader Disclosure State | Canonical Text、Narrative Assertion、Reader Disclosure Evidence | Canon Watermark + 披露策略/读者视角 | 对象/Canon Watermark/策略幂等；必须有披露证据链 | 从正文和证据重算；未通过则拒绝发布新结果 |
| Derived Timeline View | Canon Temporal Relation、Author Design Temporal Constraint（按指定视角分层）、同源 Time Interval、同源 Temporal Evidence | Canon Watermark + 时间解析策略 | Canon Watermark/视图/策略幂等；检查关系闭包和冲突 | 全量重建；不把视图写回时间关系或约束 |
| Design Fulfillment State | Author Design Object、Canon Fact/Event/Text/Evidence、映射关系 | Canon Watermark + 完成度策略 | Design Object/Canon Watermark/策略幂等；记录冲突或不确定性 | 删除后从两个真实源及映射证据重算；不回写 Design Revision |
| 图关系投影 | Entity、Canon Reference、Event/Fact/Transition、Canon Temporal Relation | Canon Watermark + 图策略 | 源 Commit/版本/策略幂等；抽样回查结构化源 | 从现存 Outbox 或 Canon 源创建新的 Task/Attempt 重建；不伪造原 Outbox |
| 向量索引 | 已授权正文/设计投影、稳定来源版本、嵌入策略 | Canon Watermark/Design Revision + 嵌入策略 | 源版本/策略幂等；回查权限和来源 | 创建新的 Rebuild Task/Attempt；不能反向确认事实 |
| 搜索索引 | 已授权文本、别名、事件和来源引用 | 相关 Canon Watermark/Design Revision + 检索策略 | 源版本/策略幂等；结果回查结构化源 | 创建新的 Rebuild Task/Attempt；不以索引结果替代权威记录 |
| 缓存 | 权威查询结果、投影 Canon Watermark、权限范围 | 结果 Canon Watermark + 策略版本 + Data Scope | Key 必须含 Canon Watermark/范围；过期即失效 | 丢弃后重读权威源；不从缓存反写 |

Projection Outbox 是 Canon Commit 事务内的权威运行记录，不与 Projection Task 或 Projection Attempt 合并，也不标记为可随意重建。创建或更新 Workflow Run、保存 Generation Run、保存 Candidate Version、执行 Validation Run、写入 Approval Record 和执行 Canon Commit 均使用独立事务；不得把完整 Workflow Run 作为覆盖生成、校验、修复、审批和提交的长事务。每次重建必须记录输入源及版本、起始/结束 Canon Watermark、策略版本、Task/Attempt/Trace、幂等键、校验摘要、失败原因和切换时间。只有新投影达到目标 Canon Watermark、通过来源回查和权限校验后，才可标记为当前投影；任何投影落后都不得降低权威 Canon 的成功状态。

## 8. 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.1.7 | 2026-09-22 | 草案 | 恢复缺失的 0.1.5 版本历史记录，不改变现有数据不变量和事务边界 |
| 0.1.6 | 2026-09-22 | 草案 | 收敛 Workflow Run 创建事务，保留投影恢复与独立事务边界 |
| 0.1.5 | 2026-09-22 | 草案 | 补齐 Scene Task 一致性、最终候选历史、审批失效、Canon Commit 当前选择不变量并校正原子步骤编号 |
| 0.1.4 | 2026-09-22 | 草案 | 补齐 Candidate 来源与最终选择不变量，分离 Workflow Run 跨阶段事务并收口 Checkpoint 重建规则 |
| 0.1.3 | 2026-09-21 | 草案 | 增加 Workflow Run 不变量和事务边界，清理恢复任务术语并明确其与 Canon Commit 的生命周期隔离 |
| 0.1.2 | 2026-09-21 | 草案 | 统一 Belief Evidence、Approval 失效查询、Projection Task/Attempt 来源互斥和 Canon 派生状态边界 |
| 0.1.1 | 2026-09-21 | 草案 | 固定 Canon Watermark/Commit Sequence、提交基数、审批失效、投影 Attempt、知识/信念值域和设计完成度派生边界 |
| 0.1.0 | 2026-09-21 | 草案 | 建立双真实源、Candidate/Canon、审批绑定、Canon Commit 原子性、并发、授权和派生数据重建的不变量与事务边界 |
