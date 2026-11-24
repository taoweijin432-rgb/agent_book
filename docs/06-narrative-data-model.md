# 叙事数据模型

- 文档编号：DOC-06
- 版本：0.2.8
- 状态：草案
- 更新时间：2026-09-22
- 关联文档：[漂移定义与质量模型](03-drift-definition-and-quality-model.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[系统架构](05-system-architecture.md)、[上下文组装规范](07-context-assembly-spec.md)
- 说明：本文件定义领域概念模型和对象语义；数据库逻辑模型、表结构、字段、约束、索引及物理存储方案将在下一阶段设计。本轮不设计表名、字段名、字段类型、主键、外键、唯一约束、索引、SQL DDL 或 ORM 模型。时间语义不机械展开为每个对象或未来每张表都必须具备的四个字段。

## 1. 共同建模原则

核心对象必须有稳定身份、版本/修订、生命周期、来源证据和必要的时间语义。对象删除优先表达为失效、废弃或软删除，以便历史正文和审计可重放。对象是否属于权威数据，以其所在域和提交状态判断：作者设计源和 Canon 叙事源是权威；草稿、检索索引和模型输出不是权威。

时间语义至少需要区分：发生时间、有效时间、记录时间和提交时间。它们是需要区分的语义，不代表每个对象或未来每张表都必须机械增加四个字段。无法确认的时间不得被模型擅自补成精确日期；可使用区间、相对顺序或待确认语义。来源证据至少包括来源类型、来源对象/版本、正文片段或作者决定、抽取/确认方式和置信度。

## 2. 作者设计域

| 对象 | 业务含义与关系 | 权威/版本/生命周期 | 时间、删除与证据 |
|---|---|---|---|
| 世界规则 | 世界中适用的物理、魔法、社会、技术或叙事约束；可与例外条件关联 | 作者设计源；草案→确认→修订/废弃 | 生效范围可按故事时间/卷/条件表达；废弃保留原因和版本 |
| 人物设计 | 人物身份、背景、性格、能力、动机、稳定语言特征 | 作者设计源；稳定人物 ID，属性按版本演化 | 设计时间与故事时间分离；正文证据由事实域承载 |
| 地点设计 | 地点身份、层级、可达性、环境和规则 | 作者设计源；可与地点事实/位置状态关联 | 坐标/距离方案待确认；废弃不删除历史出现 |
| 组织设计 | 组织目标、成员约束、阵营、等级和关系规则 | 作者设计源；成员关系可映射事实域 | 组织存在区间待确认；证据来自作者或正文事件 |
| 物品设计 | 物品身份、属性、能力、限制和唯一性 | 作者设计源；与物品事实状态分离 | 设计属性不等于当前持有/损坏事实 |
| 剧情弧 | 中长期冲突、转折、目标和结局方向 | 作者设计源；草案→已确认/生效→已替代/已废弃 | 关联大纲节点和目标证据；实现进度由 Design Fulfillment State 派生 |
| 大纲节点 | 可执行或可验证的情节点/目标 | 作者设计源；草案→已确认/生效→已替代/已废弃 | 记录计划顺序/窗口但不冒充发生时间；完成状态由 Design Fulfillment State 派生 |
| 伏笔 | 线索、回收目标、触发条件和生命周期 | 作者设计源；草案→已确认/生效→已替代/已废弃 | 指定 Canon Watermark 下的埋设/推进/回收/违反/完成由 Design Fulfillment State 根据 Canon Evidence 派生 |
| 秘密 | 受保护的真相、知情边界和揭示条件 | 作者设计源；真相和安全投影分离 | 记录知情时间、揭示条件；日志和上下文需脱敏 |
| 结局约束 | 结局必须满足/禁止满足的高层约束 | 作者设计源；草案→已确认/生效→已替代/已废弃 | 指定 Canon Watermark 下的满足/违反由 Design Fulfillment State 派生；不回写设计版本 |

候选设计方案：设计对象可采用单表多类型、按域分表或文档化属性。当前优先选择概念上分域、实现上可在单体结构化数据库中模块化；具体字段数量和扩展属性待基准和查询模式确定。

## 3. 内容结构对象

内容结构对象表示作品的稳定组织身份，不承担草稿、候选或 Canon 提交的事实生命周期。它们可以关联多个版本，但自身不随着某个候选或提交状态改变身份。

| 对象 | 业务含义与关系 | 稳定身份与生命周期 | 权威/版本/时间语义 |
|---|---|---|---|
| `Novel` | 作品根结构，连接作者设计、内容结构、Canon 内容和审计记录 | 稳定作品身份；创建→活动→归档 | 结构权威；项目版本和归档时间分开记录 |
| `Volume` | 小说下的长周期叙事分组 | 稳定卷身份；创建→活动→归档 | 与 Novel、Chapter 关联；卷的规划、正文编辑、发布和修订由相关设计对象、Candidate Version 和 Canonical Text Version 承担 |
| `Chapter` | 可组织、编辑和发布的章节结构身份 | 稳定章身份；创建→活动→归档 | 可关联多个 Draft/Candidate Version 和 Canonical Text Version；自身不承担草稿、审批、Canon 提交或修订状态 |
| `Scene` | 章节内用于规划和生成的场景结构身份 | 稳定场景身份；创建→活动→归档 | 可关联多个任务、候选版本和 Canon 正文版本；正文编辑、发布和修订属于 Draft/Candidate Version、Canonical Text Version 及其流程，不属于 Scene 身份生命周期 |

Chapter 和 Scene 的正文内容、草稿版本、候选版本和 Canon 正文版本通过关联关系连接；结构身份不能因为某个候选被拒绝或某次提交被修订而被改写成另一个身份。

## 4. 跨域身份对象

跨域身份对象连接 Author Design 与 Canon 叙事对象，但不属于任一叙事业务真实源。

| 对象 | 业务含义与领域关系 | 身份、生命周期与权威边界 |
|---|---|---|
| `Entity` | 人物、地点、组织、物品等对象的稳定身份锚点；Author Design 中的设计对象以及 Canon 中的 `Story Event`、`Canon Fact`、`State Transition` 和 `Narrative Assertion` 都可以引用或映射到同一 Entity | 稳定身份；合并、拆分、失效或映射变化必须保留历史和审计关系；Entity 是权威身份记录，但不是 Author Design 内容、Canon Fact 或第三个叙事业务真实源 |
| `Entity Alias` | 同一 Entity 在不同语言、阶段、称谓或伪装身份下的名称 | 别名变化不创建新 Entity；名称、伪装身份和阶段变化通过历史映射保留 |

Entity 用于维持作者设计对象与 Canon 叙事对象之间的稳定对应关系；它不因某个候选正文被拒绝而改变身份。本节只定义概念和关系，不设计表、ID、外键或唯一约束。

## 5. Canon 叙事语义对象

以下对象描述正文中的叙述主张、故事事件、客观主张和状态变化。它们与内容结构对象、草稿执行对象分离。

| 对象 | 业务含义与边界 | 稳定身份、关系与生命周期 | 权威/证据语义 |
|---|---|---|---|
| `Canonical Text Version` | 成功 Canon Commit 后形成的正式正文记录；不是任意草稿文本 | 提交后获得稳定版本身份；原版本不可静默覆盖，修订产生新版本并建立关系 | Canon 叙事源；来源于 Candidate Version、Canon Commit 和正文证据 |
| `Narrative Assertion` | 从候选正文版本或 Canon 正文版本识别出的叙述主张 | 稳定关联正文版本和证据片段；可被分类、确认、否定或保持未确认 | 本身不自动等于 Story Event、Canon Fact、State Transition、角色知识或客观真相 |
| `Story Event` | 经 Canon Commit 确认在故事中发生的事件、揭示、决策或变化 | 仅在成功提交后成立；原对象保持不可变，撤销/反转/补偿通过新对象及 `revises`、`reverses`、`compensates`、`supersedes` 等关系表达 | Canon 叙事源；必须有 Canon 正文和提交证据 |
| `Canon Fact` | 经 Canon 内容明确确认、可作为后续推理依据的客观主张 | 具有稳定身份、有效范围和来源；通过修订、撤销或补偿关系演进，不把历史对象改成从未存在 | Canon 叙事源；不是任何可查询句子的同义词 |
| `State Transition` | 已确认 Story Event 造成的人物、关系、物品、知识或位置变化 | 稳定关联事件、前后状态和有效时间；历史转换不可静默修改 | Canon 叙事源；必须可追溯到事件和正文证据 |
| `State Snapshot` | 由已提交事件、Canon Fact 和 State Transition 计算出的当前状态投影 | 事务外由 Projection Outbox 驱动重建；绑定 Canon Watermark；不在 Canon Commit 原子事务内同步写入 | 派生投影；必须记录来源水位和重建依据 |

`Narrative Assertion` 必须经过分类、校验、审批和 Canon Commit，才能将相应提案纳入 Canon。正文中出现一句话不等于该句话描述的内容已经成为客观世界事实；谎言、传闻、误认和不可靠叙述应先作为叙事陈述或角色信念处理。

角色知识和信念使用两个独立状态模型：`Character Knowledge State` 仅允许 `known_true`、`known_false`、`unknown`；`Character Belief State` 仅允许 `believed_true`、`believed_false`、`unknown`。缺少 Knowledge Evidence 时只能得到 `unknown`；`known_false` 表示角色知道命题为假，不能由缺少记录推导。Belief 可以与 Canon Fact 不一致；两者都不等于客观 Canon Fact，且不得使用同一个状态字段或同一值域替代。

### 5.1 状态类别与 Timeline

人物状态、关系状态、物品状态、位置状态、Character Knowledge State 和 Character Belief State 均可作为 `State Transition` 与 `State Snapshot` 的状态类别或派生结果表达，不要求恢复为独立顶级事实源。Character Knowledge State 只从 Knowledge Evidence 派生，Character Belief State 只从 Belief Evidence 派生。

Timeline 来源于带 source domain 和来源版本的 `Canon Temporal Relation`、Author Design Temporal Constraint、Time Interval 和 Temporal Evidence，是查询、排序或重建视图，可以由权威关系和状态变化重建；不得成为第三套事实。Design 时间约束不得被当作已经发生的 Canon 时间；非线性时间线和多个 Canon 分支仍属于 `00` 中的开放问题。

### 5.2 Reader Disclosure State

`Reader Disclosure State` 表示读者在某个 `Canon Watermark` 下已经被披露到何种程度，来源于 `Canonical Text Version`、`Narrative Assertion` 或披露事件；当前披露状态可以是可重建投影，历史披露证据不可被静默覆盖。它与作者设计秘密、Agent 可见范围和 Character Knowledge/Belief State 分离，不与 `Constraint Exception` 合并。

## 6. 执行域

草稿与候选属于写作执行域。`Candidate Event`、`Candidate Fact Proposal` 和 `Candidate State Transition` 只有执行/暂存语义，在校验、审批和 Canon Commit 前都不是 Canon 对象；成功提交后分别映射为新的 `Story Event`、`Canon Fact` 和 `State Transition`，原 Candidate 对象保留用于审计和来源追踪，不能原地修改成 Canon 对象。

| 对象 | 业务含义 | 稳定身份、生命周期与关系 |
|---|---|---|
| `Scene Task` | 场景目标、输入快照、视角、权限和输出约束 | Task Version 先存在；创建→可编译→运行→完成/失败/过期；关联 Author Design Revision 和 Canon Watermark，不要求预先存在 Context Bundle |
| `Workflow Run` | 一次从生成、校验、修复到审批的写作工作流运行 | 必须且只能关联一个 Scene Task Version；可包含多个 Generation Run、Validation Run、Repair Record、Approval Record 和 Candidate Version；最多选择一个当前最终 Candidate Version；选择、替换或取消当前候选均追加不可变选择历史，历史选择不得删除或改写；当前选择变化后原 `approved` 不再有效，历史 Approval 不自动迁移；允许状态包括 `created`、`generating`、`validating`、`needs_repair`、`pending_approval`、`rejected`、`approved`、`failed`、`cancelled`、`expired`，具体状态转换图留到后续状态机设计；转入 `approved` 必须以当前最终 Candidate 的有效 Approval Record 为依据，且不等于 Canon 已提交 |
| `Context Bundle` | 进入模型的最终分层上下文及其来源、版本、权限、入选原因和预算 | 在 Generation Run 之前生成和冻结；每个 Bundle 必须且只能属于一个已存在且有效的 Scene Task Version；可以暂时不被任何 Generation Run 引用，也可以被零个或多个 Generation Run 引用或复用；每个 Generation Run 必须且只能引用一个固定且不可变的 Bundle |
| `Generation Run` | 一次模型生成尝试及其模型、Prompt、工具和参数记录 | 必须且只能属于一个 Workflow Run，且必须且只能引用一个不可变 Context Bundle；其 Context Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 完全相同；排队→运行→成功/失败/取消；一次运行可以产生零到多个 Candidate Version |
| `Draft/Candidate Version` | 草稿暂存区中的候选正文版本 | 必须且只能属于一个 Workflow Run，并绑定或明确继承一个实际适用的 Context Bundle；该 Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 完全相同；非 Canon；生成→编辑/修复→拒绝/替换/过期/待提交；模型生成候选关联 Generation Run，修复候选关联同一 Workflow Run 内的前序 Candidate 和 Repair Record（模型辅助修复时可额外关联 Generation Run），人工编辑候选关联同一 Workflow Run 内的前序 Candidate 和人工修改记录且不要求新的 Generation Run；直接使用新 Bundle 或继承前序 Bundle 必须形成可审计关联；Candidate 不能原地转化为 Canon |
| `Candidate Event` | 从 Candidate Version 的 Narrative Assertion 形成的候选事件提案 | 非 Canon；抽取→校验→接受/拒绝/失效；成功后才可映射为 Canon Story Event |
| `Candidate Fact Proposal` | 候选正文中可能成为 Canon Fact 的客观主张提案 | 非 Canon；必须经过证据、权限、冲突校验和审批 |
| `Candidate State Transition` | 候选正文中可能造成状态变化的提案 | 非 Canon；必须关联 Candidate Event，并在提交事务中确认 |
| `Validation Run/Result` | 对候选及其输入快照执行的校验运行和结果 | 不可覆盖原始候选；策略或关键输入变化时产生新的运行 |
| `Repair Record` | 关联修复前后的 Candidate Version，记录修复原因、差异、触发问题和重新校验结果 | 修复产生新的候选版本；不覆盖原候选，也不直接修改 Canon |
| `Approval Record` | 对特定候选版本、正文 hash、校验运行和快照的批准/拒绝决定 | 必须绑定当前最终 Candidate、正文 hash、Validation Run、Context Bundle、Author Design Revision、Canon Watermark 和审批策略版本；与绑定输入不可分离；候选、当前选择或关键输入变化后失效 |
| `Canon Commit` | 将 Canonical Text Version、确认结果和状态变化写入 Canon 的事务提交 | 准备提交→提交中→已提交/提交失败；成功提交不可改写，后续影响通过新提交和关系表达 |
| `Constraint Exception` | 权威治理/授权记录，不是 Canon 叙事对象 | 关联原 Author Design 约束、原冲突、适用范围、授权主体和生效版本；可被 Approval Record 和 Canon Commit 引用；生命周期为提议→生效→到期/撤销，不修改原设计修订或 Canon 历史 |
| `Projection Outbox` | 记录 Canon Commit 产生的投影更新意图 | 与 Canon Commit 在同一事务中产生；权威运行记录，不是第三个叙事业务真实源；原始 Outbox 不可随意重建；普通 Projection Task 根据它创建 |
| `Projection Task` | 一个需要完成的逻辑投影工作 | 普通 Task 必须关联一个 Projection Outbox；重建 Task 必须关联一个 Projection Rebuild Record；origin 只能二选一；pending→completed/cancelled/abandoned/needs_rebuild |
| `Projection Attempt` | 一次领取、执行、超时、失败或成功尝试 | 事务外执行；processing→succeeded/retryable_failure/permanent_failure/expired；重试产生新 Attempt，不产生重复 Task；Checkpoint 只能由成功且未过期 Attempt 推进 |
| `Projection Rebuild Record` | 从现存权威 Outbox 或 Canon 源重新建立投影的计划和结果 | 重建范围、输入水位、策略版本和校验结果必填；可产生一个或多个有明确范围的重建 Projection Task；不得伪造原始 Outbox |

对被逆转、撤销或补偿的 Canon 对象，原对象继续保留；通过 `revises`、`reverses`、`compensates`、`supersedes` 或等价关系表示演进；当前有效状态可以是派生结果，但不得直接修改历史对象使其看起来从未生效。

## 7. 审计域

- **模型调用**：模型标识、参数、时间、输入输出引用、脱敏摘要和结果状态。
- **Prompt 版本**：模板/编译器版本、变量来源和可重放标识；不把秘密原文无保护地写入日志。
- **工具调用**：调用者角色、工具能力、输入摘要、结果、权限和失败原因。
- **Token 与成本**：输入/输出 token、检索/校验成本、计费口径、耗时和关联任务。
- **人工修改**：操作者、差异、原因、审批、影响对象和重新校验结果。
- **评测结果**：数据集版本、指标、模型/规则版本、样本、错误分类和置信区间（如有）。

审计对象本身应可追加写入，历史记录不得被普通业务操作覆盖；秘密和个人敏感信息遵循最小记录、脱敏和访问审计原则。

## 8. 候选方案与待确认项

- **事件与状态的存储**：事件溯源式全量事件、事件加当前快照，或事实表加变更记录。建议阶段 1 采用可回放的事件/事实记录加快照，待性能测试确认。
- **时间表示**：绝对时间、相对序、区间和不确定性组合；故事类型不同，字段侧重点不同，待样本集确认。
- **证据粒度**：字符区间、段落 ID、正文版本或语义片段。建议至少保留正文版本和稳定片段引用，具体定位方案待编辑器形态确认。
- **实体合并**：默认不自动合并；候选合并需人工确认并保留旧身份映射，以避免身份漂移。
- **删除语义**：默认软删除/失效；物理清理、保留期限和导出策略待安全与合规评审确定。

## 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.2.8 | 2026-09-22 | 草案 | 补齐选择历史、同 Scene Task Version 关系和前序候选范围 |
| 0.2.7 | 2026-09-22 | 草案 | 明确 Workflow Run 状态为允许集合并收口 Candidate 来源与关系基数 |
| 0.2.0 | 2026-09-20 | 草案 | 第一轮跨文档一致性修订：区分结构身份、候选版本、Canon 正文、叙事陈述、事件、状态转换和状态快照，补充知识状态、读者披露、约束例外与投影 Outbox |
| 0.2.1 | 2026-09-20 | 草案 | 重构内容结构对象、Canon 叙事语义对象和执行域，删除冲突生命周期并明确 Narrative Assertion、Canon Fact、角色知识和不可变修订关系 |
| 0.2.2 | 2026-09-20 | 草案 | 将范围收窄为领域概念模型与对象语义，恢复 Entity、Timeline、Constraint Exception、Reader Disclosure State、Projection Outbox 和 Repair Record 等缺失对象 |
| 0.2.3 | 2026-09-20 | 草案 | 将 Entity 调整为跨域身份对象，拆分状态/Timeline，移出 Constraint Exception 的 Canon 归属并统一 Candidate 到 Canon 映射 |
| 0.2.4 | 2026-09-21 | 草案 | 统一 Canon Watermark、知识/信念分离、Design Fulfillment State、State Snapshot 和 Projection Task/Attempt 边界 |
| 0.2.5 | 2026-09-21 | 草案 | 修正 Context Bundle 与 Generation Run 的一对多引用关系和冻结顺序 |
| 0.2.6 | 2026-09-21 | 草案 | 补入 Workflow Run 执行域语义并明确其与 Candidate、Approval 和 Canon Commit 的边界 |
