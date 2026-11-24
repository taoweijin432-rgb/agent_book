# Canon 正式提交协议

- 文档编号：DOC-08
- 版本：0.2.8
- 状态：草案
- 更新时间：2026-09-22
- 关联文档：[产品需求](02-product-requirements.md)、[漂移定义与质量模型](03-drift-definition-and-quality-model.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[系统架构](05-system-architecture.md)、[叙事数据模型](06-narrative-data-model.md)、[上下文组装规范](07-context-assembly-spec.md)
- 目标：定义候选正文何时、如何成为 Canon 叙事源中的正式内容

## 1. 协议原则

`Candidate Version`、`Narrative Assertion`、`Candidate Event`、`Candidate Fact Proposal` 和 `Candidate State Transition` 必须经过校验和必要审批。`Canon Commit` 在同一原子边界内写入一个 `Canonical Text Version`、确认后的 `Story Event`、`Canon Fact`、`State Transition`、`Canon Temporal Relation`、相关映射、提交审计和 `Projection Outbox`，并获得严格单调递增的 `Canon Commit Sequence`；由成功序列确定的 `Canon Watermark` 是逻辑快照边界，不是独立叙事对象或第三真实源。写作 Agent 不能直接创建或修改 Canon 对象；草稿暂存区不是第三个叙事业务真实源，Canon Commit 成功前 Candidate 对象不具备 Canon 语义。结构化数据库是权威数据源；图和向量更新是可重建投影。

## 2. 正式流程

### 2.1 创建场景任务

场景服务先创建 `Scene Task Version`，绑定小说/卷/章/场景、`Author Design Revision`、由成功 `Canon Commit Sequence` 确定的 `Canon Watermark`、视角、时间地点、目标、秘密安全约束和输出要求。Scene Task 创建时不要求预先存在 Context Bundle；后续 Context Bundle 必须引用一个已存在且有效的 Scene Task Version。

### 2.2 读取一致数据快照

Context Compiler 基于 Scene Task Version、Author Design Revision 和 Canon Watermark 编译 Context Bundle。Context Bundle 必须保存最终编译后的有效上下文内容，或者受权限保护的不可变内容引用；同时保存完整内容 hash、最终 Context Item 顺序、每项实际内容或不可变内容引用、来源记录和版本、权限裁剪结果、安全投影策略版本、组装器版本、token/预算结果和输入版本；若水位已过期、存在未解决硬冲突或权限策略无法确定，任务不得进入生成。

### 2.3 生成候选正文

Generation Run 必须属于一个 Workflow Run 且引用一个不可变 Context Bundle；该 Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 完全相同。模型网关按固定 Prompt/模型/参数版本调用写作 Agent，生成属于该 Workflow Run 的 `Candidate Version` 并写入草稿暂存区。模型生成 Candidate 引用 Generation Run；修复 Candidate 必须引用同一 Workflow Run 内的前序 Candidate 和 `Repair Record`，如调用模型可同时引用新的 Generation Run；人工编辑 Candidate 必须引用同一 Workflow Run 内的前序 Candidate 和 `Human Change Record`。所有 Candidate 必须能追溯具体 Context Bundle，并明确直接使用新 Bundle 或继承前序 Candidate 的 Bundle；继承关系必须可审计；非模型 Candidate 不要求存在新的 Generation Run；此时不更新 Canon 正文、Canon Fact 或当前状态。

### 2.4 提取 Narrative Assertion 并形成候选提案

校验服务从 Candidate Version 抽取 `Narrative Assertion`，再根据断言形成 `Candidate Event`、`Candidate Fact Proposal` 和 `Candidate State Transition`，并保留正文片段定位、抽取版本、置信度和不确定项。四者在校验、审批和 Canon Commit 前均不是已生效 Canon 对象。

### 2.5 执行硬约束校验

使用 Author Design 约束、Canon Watermark、人物知识权限、时间关系、地点、物品、关系和秘密规则执行一致性、权限、信息泄露和状态转换校验。向量/图命中不可单独作为通过依据。Approval Record 本身不能覆盖硬约束；硬冲突候选只有在新的 `Author Design Revision` 已生效，或存在有效 `Constraint Exception` 时，才可以进入审批和 Canon Commit。没有上述依据时，提交服务必须拒绝候选。

### 2.6 执行软质量评测

评估人物性格/语言、能力成长、因果、剧情目标、伏笔、视角和文风等软问题。软问题不一定阻断，但必须显示证据、评分/置信度和人工可处理方式。

### 2.7 局部修复

修复服务可在草稿暂存区产生新候选；新候选必须重新抽取、硬校验和必要的软评测。修复不能只改标签、评分或状态而不重新验证正文。人工编辑也必须产生新的 Candidate Version 并保留 `Human Change Record`；Candidate 内容不可原地覆盖。

### 2.8 人工或自动审批

当前版本自动审批默认关闭。只有质量基准集、正式阈值、规则版本和授权策略经过评审确认后，才能在明确范围内启用自动审批。Workflow Run 可以包含多个 Candidate，但最多选择一个当前最终 Candidate；选择、替换或取消当前候选均追加不可变选择历史，当前选择变化后原 `approved` 不再有效，历史 Approval 不自动迁移。转入 `approved` 前必须存在对该最终 Candidate 有效且完全匹配的 Approval Record。人工审批必须能看到正文、证据、冲突、上下文来源、Candidate Version、正文 hash、`Validation Run`、`Author Design Revision`、`Canon Watermark`、审批策略版本、`Context Bundle` 和影响范围。Approval Record 只能批准绑定仍然有效的输入；普通 `approved` 不能单独覆盖硬约束。保留设计约束但允许例外时，才可使用绑定有效 `Constraint Exception` 的 `force_override`。批准、拒绝、要求重写和强制覆盖是不同决定，分别记录理由和操作者。

### 2.8.1 校验与审批强制失效

以下任一对象发生变化时，旧校验结果与旧审批结果的有效性查询结果变为 stale/invalid：`Candidate Version`、状态变更提案、`Author Design Revision`、`Canon Watermark`、校验策略、校验器版本、关键 `Context Bundle` 或审批所绑定的输入集合。系统必须追加 `Approval Invalidation Record`，不得原地修改原 Approval Record；失效后必须形成新的不可变候选或运行版本，重新校验、重新审批。Validation Run 历史结果同样不得原地覆盖。

### 2.9 提交正文

提交服务再次检查 Workflow Run 当前选择的最终 Candidate，而不是任意历史 Candidate；同时检查选择历史版本、Candidate/Workflow/Context Bundle/Generation Run（如有）的 Scene Task Version 相等关系、一个 Context Bundle、Canon Watermark、幂等键、有效 Approval 及审批策略版本。通过后，在一个逻辑事务中写入一个 `Canonical Text Version`、`Canon Commit`、`Canon Commit Sequence` 和每个投影目标对应的 `Projection Outbox`；正文版本成为 Canon 叙事源中可追踪的正式正文记录，但正文记录本身不自动等于客观 `Canon Fact`。

### 2.10 提交事件与状态变化

同一逻辑事务还写入确认后的 `Narrative Assertion` 结果、零到多个 `Story Event`、`Canon Fact`、`State Transition`、`Canon Temporal Relation`、`Candidate-to-Canon Mapping`、`Canon Commit Item`、`Evidence Reference`、Author Design 对象与 Canon Evidence 的权威映射，以及必要的 `supersedes`/`reverses`/`compensates` 关系。任何未通过校验、未完成必要审批或缺少硬约束依据的候选不得写入；一个 Commit 不提交多个 Candidate 或多个 Canonical Text Version。

### 2.11 更新派生状态

Canon 事务内只写入 `State Transition` 等权威 Canon 记录，不得写入 `State Snapshot`/`Derived Current State`；不直接写入 `Reader Disclosure State`、`Derived Timeline View` 或 `Design Fulfillment State`。大纲目标和伏笔可以在事务内保存 Canon Evidence Mapping；目标完成度、伏笔埋设/回收状态和当前状态均在事务成功后由 `Projection Outbox` 驱动派生。投影失败不得改变成功 Canon Commit。

### 2.12 触发投影更新

每个投影目标在 Canon 正式事务内产生独立 `Projection Outbox`。事务成功后，普通 `Projection Task` 从一个 Outbox 创建，重建 `Projection Task` 从一个 `Projection Rebuild Record` 创建；二者的 origin 只能二选一。Task 和 `Projection Attempt` 均在事务外创建和执行，失败或重试产生新的 Attempt，不把 Canon Commit 改为失败。查询服务必须识别投影落后并标记降级，不能假装与最新 Canon Watermark 完全一致。

### 2.13 记录完整审计

记录 Scene Task、Workflow Run、Validation Run、Context Bundle、Generation Run、模型/Prompt/工具调用、Candidate Version、Approval Record、Approval Invalidation Record、Canon Commit、Canon Commit Sequence、Canon Watermark、Projection Outbox、Projection Task、Projection Attempt、事件/状态、成本、耗时和错误。秘密内容按最小披露和脱敏策略记录；自动检查通过只表示检查结果符合当前规则，不表示业务语义已经被运行时验证为正确。

## 3. 幂等、并发与版本冲突

- **`idempotency_key`**：一次提交请求的稳定幂等标识。
- **`payload_hash`**：一个 Candidate Version、事件/状态提案、审批和相关版本形成的内容摘要；不等同于幂等键。
- **重复提交**：同 key、同 hash 返回原结果；同 key、不同 hash 拒绝并告警，不能覆盖原结果。
- **Canon 水位保护**：Candidate 绑定的 Canon Watermark/成功 Commit Sequence 与当前基线不兼容时拒绝提交，不得静默合并。
- **成功序列**：当前单 Canon 主分支的成功 Canon Commit Sequence 严格单调递增；不承诺数值连续或无空洞，对外 Canon Watermark 不倒退；失败或回滚请求不推进水位。
- **并发场景处理**：Candidate 可以并行生成；不同场景的提交仍须执行 Canon Watermark 和关键实体冲突检查。多场景冲突范围以及未来 Commit Group 仍待确认。
- **版本冲突**：提交发现当前最终 Candidate、选择历史版本、Design Revision、Canon Watermark 或 Context Bundle 已变更，必须停止自动提交，重新编译上下文/校验，或由作者明确发起基于旧快照的受控重演。
- **部分失败**：权威 Canon 提交事务内任何一步失败都对外报告未提交；Outbox 与 Canon 必须同事务写入。后台投影失败属于提交后的可重试 Attempt，不得被呈现为 Canon 部分成功。

## 4. 原子提交边界与回滚

Canon Commit 原子边界只包含：一个 Candidate Version 的绑定、Canon Commit、成功 Canon Commit Sequence、由其确定的 Canon Watermark、一个 Canonical Text Version、Narrative Assertion 的确认结果、Story Event、Canon Fact、State Transition、Canon Temporal Relation、Candidate-to-Canon Mapping、Canon Commit Item、Evidence Reference、Author Design 对象与 Canon Evidence 的权威映射、supersedes/reverses/compensates 等显式关系、Projection Outbox 和最小 Canon 提交审计记录。`State Snapshot`/`Derived Current State`、`Reader Disclosure State`、`Derived Timeline View`、`Design Fulfillment State`、图关系、向量索引、搜索索引和缓存不在该事务内更新。

Canon Commit Ledger 是权威提交记录，不只是查询索引；查询索引可以由账本派生。账本至少能够追踪 Candidate Version、Context Bundle、Validation Run、Approval Record、提交人或 Agent、Author Design Revision、Canon Watermark、成功 Commit Sequence 和提交结果。原始 Projection Outbox 是事务内权威运行记录，不得伪造；普通 Task/Attempt 在事务提交后创建，重建 Task 只能由 Projection Rebuild Record 创建。

回滚必须创建新的反向、失效或补偿提交。原提交记录保持不可变，并通过关联关系标记其影响已被撤销或替代；不得无痕删除，也不得修改成功 Canon Commit 的结果为 `failed`、`reversed`、`compensated` 或 `superseded`。回滚后的派生结果由 Outbox 驱动重算；对后续已经依赖旧 Canon Watermark 的章节，需产生影响清单和待修订任务。

## 5. 已发布章节修改与历史事实失效

已发布章节不能直接编辑原版本。`Publication Record` 追加表达发布、撤回和重新发布，`Canonical Text Version` 本身只保存不可变正文、Commit、证据范围和身份关系，不保存可变发布状态。作者发起修订任务，说明修订原因、目标版本和影响范围；批准后生成新的 Candidate、Canonical Text Version 和 Canon Commit，原 Canon Fact、Story Event、State Transition 和正文版本保持历史不可变。系统通过原 Publication Record、新 Canon Commit/正文版本和 Canon Watermark 生成 Impact Assessment/Impact Item；只生成影响清单和修订建议，不自动修改后续章节或下游正文、不自动生成新的 Canon Commit，也不自动覆盖 Author Design。

## 6. 旧任务重放与异常处理

完全重放必须固定原始 `Author Design Revision`、`Canon Watermark`/成功 `Canon Commit Sequence`、Scene Task Version、Context Bundle 的实际编译内容或受保护不可变引用、Prompt 版本、模型版本、工具版本、参数和随机性相关配置，并保留原始输入与外部调用结果。可以重建原始输入和执行链，但不承诺重新调用外部模型得到逐字相同输出；Candidate Version 的原始正文必须保留。

如果原始模型或 Prompt 版本不可用，使用兼容但不同版本执行只能称为“重新运行”或“复现对比”，结果必须作为新的 Workflow Run/Candidate Version 重新校验，不得覆盖原 Canon Commit。无法完全复现时，记录复现等级、不可用依赖和差异原因。

对于上下文来源被删除、索引结果漂移或外部工具不可用的情况，标记为部分不可复现并说明边界；旧任务重新提交前仍必须检查当前 Canon Watermark、幂等键和版本冲突。

## 7. 人工强制覆盖与硬约束例外

保留设计约束但允许例外时，硬冲突候选只有在存在有效 `Constraint Exception` 且 Approval 使用 `force_override` 后才能进入 Canon Commit。人工授权本身不能绕过硬约束；新 Design Revision 已消除原冲突时，使用普通 `approved`，不能把新设计修订当作 `force_override` 的授权替代。

`Constraint Exception` 至少记录：适用范围、原硬约束、覆盖原因、授权主体、生效版本、到期条件或撤销状态、审计时间。没有有效 `Constraint Exception` 时，`force_override` 不得进入 Canon Commit。系统仍记录原始 Candidate Version、阻断规则、覆盖前后差异和审计 Trace。

对已成功的 Canon Commit，撤销、反转和补偿必须通过新的不可变 Canon Commit 表达，原提交与后续操作之间建立明确的 `reverses`、`compensates`、`supersedes` 或等价关系，当前有效视图可以由这些关系计算，历史提交记录始终可审计。

## 8. 生命周期状态与可观测结果

不得使用一个状态记录承载所有阶段。至少区分以下状态：

- **Workflow Run**：写作流程的运行/审计记录，状态为创建、生成中、校验中、待修复、待审批、已拒绝、已批准、失败、取消、过期；`approved` 只表示工作流审批完成，不等于 Canon Commit 的 `committed`，不得通过状态变化直接成为 Canon Commit。
- **Canon Commit**：准备提交、提交中、已提交、提交失败。成功 Canon Commit 永久保持 `committed`；`reversed`、`compensated`、`superseded` 只表示关系语义，不修改原提交状态。
- **Projection Task**：`pending`、`completed`、`cancelled`、`abandoned`、`needs_rebuild`。
- **Projection Attempt**：`processing`、`succeeded`、`retryable_failure`、`permanent_failure`、`expired`。

对用户展示的状态必须与对应权威记录一致，不能因 UI 已生成、索引已排队或模型返回成功而显示为“正文已正式生效”。自动检查通过只表示当前检查规则返回通过，不等于业务语义已经验证为正确。

## 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.2.8 | 2026-09-22 | 草案 | 补齐当前最终 Candidate、选择历史并发检查、Scene Task 一致性和审批策略版本 |
| 0.2.7 | 2026-09-22 | 草案 | 补齐 Candidate 三类来源、最终候选审批绑定和非模型候选边界 |
| 0.2.0 | 2026-09-20 | 草案 | 第一轮跨文档一致性修订：补充一致快照、幂等键与 payload hash 分离、审批绑定、生命周期拆分、回滚和投影 Outbox |
| 0.2.1 | 2026-09-20 | 草案 | 修正 Narrative Assertion 提取流程，补充强制失效、Canon Commit Ledger、硬约束覆盖依据和不可变撤销/补偿语义 |
| 0.2.2 | 2026-09-20 | 草案 | 修正 Scene Task 到 Context Bundle 的因果顺序，统一 Validation Run，强化硬约束覆盖和 Canon Commit 不可变生命周期 |
| 0.2.3 | 2026-09-20 | 草案 | 统一 Candidate/Canon 对象命名，明确 Entity/治理记录在数据模型中的边界，并修正 Canon Commit 审计与正文写入语义 |
| 0.2.4 | 2026-09-21 | 草案 | 统一 Canon Commit Sequence/Canon Watermark，收敛原子事务与派生投影边界，拆分 Projection Task/Attempt 并修正重放、审批例外和发布影响语义 |
| 0.2.5 | 2026-09-21 | 草案 | 清理 Context Bundle、审批例外和人工强制覆盖段落中的重复句与标点缺陷 |
| 0.2.6 | 2026-09-21 | 草案 | 明确 Workflow Run 边界并统一 Projection Rebuild Record/Task/Attempt 重建来源 |
