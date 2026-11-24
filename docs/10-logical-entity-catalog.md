# 逻辑实体目录

- 文档编号：DOC-10
- 版本：0.1.7
- 状态：草案
- 更新时间：2026-09-22
- 规范性依赖：[叙事数据模型](06-narrative-data-model.md)、[数据库逻辑模型](09-database-logical-model.md)
- 参考性引用：[产品需求](02-product-requirements.md)、[双真实源规范](04-dual-source-of-truth-spec.md)、[上下文组装规范](07-context-assembly-spec.md)、[Canon 正式提交协议](08-canon-commit-protocol.md)

## 1. 目录使用规则

本目录把 `06` 的概念对象落实为逻辑实体。每一行均按统一格式说明：逻辑名称、所属域与权威性质、业务职责、稳定身份、版本、主要属性语义、必填/可选语义、业务唯一性、外部引用、关系基数、创建者、修改方式、生命周期、删除/归档、审计、敏感性和上游依据。这里的“属性”是逻辑属性名，不是物理字段类型；不定义 SQL、索引或 ORM。

共同规则如下：

- 真实源只有 Author Design Source 与 Canon Narrative Source；`Entity`、审批、校验、例外、提交和投影记录不是第三叙事真实源。
- 需要保留历史的对象采用稳定身份与不可变版本；“当前”是受控指针或派生结果，不覆盖历史。Author Design Revision 在草案阶段可编辑，确认/冻结后不可变。
- Candidate 与 Canon 永不原地互换类型；映射由 `Canon Commit` 产生。
- 默认删除语义为失效、废弃、归档、撤销或替代；具体保留周期待确认。
- 每个正文或结构化断言都应能追到来源版本、证据范围、抽取/确认方式和操作者；秘密按最小披露和脱敏策略记录。

## 2. 项目结构与跨域身份

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Project/Novel | Project Structure；作品根结构，不是事实内容 | 稳定 Novel ID；版本用于结构修订；名称、状态、归档范围必填，简介可选 | 项目范围内名称或外部标识不得产生歧义；1 Novel 对多 Volume/Chapter/Scene | 作者创建；结构服务受控修改；创建→活动→归档；不物理删除，记录归档审计 | 普通项目元数据；`06`、FR-001 |
| Volume | Project Structure；长周期分组 | 稳定 Volume ID；顺序、标题、归属必填，规划说明可选 | 1 Novel 对多 Volume；同一 Novel 内顺序唯一 | 作者/规划服务创建；可调整顺序但不改历史正文归属；活动→归档 | 低敏；`06`、FR-001 |
| Chapter | Project Structure；章节结构身份 | 稳定 Chapter ID；章节序和归属必填，发布标签可选；正文版本另存 | 1 Volume 对多 Chapter；Chapter 可关联多 Scene、Candidate、Canonical Text | 作者创建；结构可修订，正文版本不可混入；活动→发布→归档 | 章节可含秘密，按版本授权；`06`、FR-022 |
| Scene | Project Structure；规划和生成单元 | 稳定 Scene ID；归属、顺序、目标引用必填，备注可选 | 1 Chapter 对多 Scene；1 Scene 对多 Scene Task | 作者/规划服务创建；结构身份保留；活动→归档 | 场景任务可能含秘密；`06`、FR-007 |
| Entity | Cross-domain Identity；人物/地点/组织/物品/概念的稳定锚点，不承载完整设计或 Canon 状态 | 稳定 Entity ID；类别、项目归属、生命周期必填，显示名可选 | 项目内稳定；1 Entity 对多 Alias、Design Binding、Canon Reference | 受控身份服务/作者创建；合并/拆分走治理记录；有效→失效/合并/拆分 | 名称可能敏感；`04`、`06` |
| Entity Alias | Cross-domain Identity；别名、称谓、拼写和指代 | Alias 记录身份稳定；名称、语言/范围、来源必填 | 1 Entity 对多 Alias；同一范围内别名冲突需处理 | 作者/身份服务添加新记录；失效不用覆盖旧别名 | 可能暴露秘密身份，按场景过滤；`06` |
| Entity Merge/Split Record | 身份治理；记录身份合并/拆分原因和映射 | 稳定治理记录；原 Entity、目标 Entity、关系方向、理由必填 | 1 记录对多个源/目标 Entity；不得循环合并 | 作者/身份服务发起，需审计化确认；只追加，不删除历史引用 | 高风险身份变更；`06`、FR-003 |
| Design-to-Entity Binding | 跨域映射；把 Design Object Identity 绑定到 Entity | 稳定绑定 ID；设计对象、Entity、适用 Revision 必填 | 每条绑定只连接一个 Design Object Identity 和一个 Entity；同一 Design Revision 内一个 Entity-backed Design Object 最多一个有效绑定，合并/拆分以带适用 Revision 和关系角色的多条绑定表达 | 受控设计/身份服务建立新绑定；解绑通过失效记录 | 可能暴露隐藏身份；`04`、`06` |
| Canon-to-Entity Reference | 跨域映射；把 Canon 对象中的引用绑定到 Entity | 稳定引用 ID；Canon 来源、Entity、证据范围必填 | 每条引用只连接一个 Canon 对象引用和一个 Entity；一个 Canon 对象可拥有多个引用 | 仅提交服务产生，修订通过新引用；随 Canon 记录保留 | 按读者/人物视角裁剪；`06`、FR-025 |

## 3. Author Design 实体

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Author Design Revision | Author Design Source；某次一致设计修订和生效范围 | Revision ID；草案阶段对象版本集合、差异和范围可编辑；确认/冻结后这些内容及确认依据不可变 | 1 Novel 对多 Revision；Revision 引用多个 Design Object Version | 作者/受控设计服务创建；草案→确认/冻结→生效/替代/废弃；冻结后变化产生新 Revision | 秘密设计高敏；`04`、FR-003 |
| Design Object Identity | Author Design Source；一个设计对象的稳定身份 | 稳定 Design Object ID；对象类别、Entity 关联/归属必填 | 1 Identity 对多 Version；可绑定 1 Entity 或待绑定 | 作者/规划服务提案，作者确认；活动→废弃 | 可能含秘密；`06` |
| Design Object Version | Author Design Source；对象具体版本 | 不可变 Version ID；内容、来源 Revision、状态必填，扩展属性可选但核心约束结构化 | 1 Identity 对多 Version；1 Revision 对多 Version | 作者/受控设计服务创建；不可原地修改；草案→确认→失效 | 按角色投影；`06` |
| Design Constraint | Author Design Source；硬/软规则、例外条件和适用范围 | 稳定约束身份+不可变版本；规则、严重级别、范围、证据要求必填 | 1 Design Revision 对多 Constraint；可被 Validation/Exception 引用 | 作者创建；新版本修订；确认→生效→废弃 | 高敏，尤其秘密约束；`03`、`04` |
| Outline Node | Author Design Source；大纲目标、情节点和完成判据 | 稳定 Node ID+版本；目标、前置/后置、完成证据必填 | 1 Plot Arc 对多 Node；可映射多 Scene/Canon 证据 | 作者/规划服务提案，作者确认；草案→已确认/生效→已替代/已废弃；完成状态由 Design Fulfillment State 派生 | 未发布剧情可敏感；FR-004 |
| Character Design | Author Design Source；人物身份、背景、性格、能力和语言特征 | 以 Design Object Identity/Version 表达；角色核心属性必填，细节可选 | 1 Entity 对多设计版本；可关联关系/约束 | 作者创建，新版本修订；不可删历史 | 高敏，写作只读安全投影；`06`、FR-002 |
| Location Design | Author Design Source；地点身份、层级、环境、可达性和适用规则 | 以 Design Object Identity/Version 表达；名称、层级和规则引用必填，空间细节可选 | 1 Entity 对多设计版本；可关联 World Rule 和场景 | 作者创建，新版本修订；历史出现不因废弃删除 | 地图/隐藏地点可敏感；`06`、FR-002 |
| Organization Design | Author Design Source；组织目标、阵营、等级和成员约束 | 以 Design Object Identity/Version 表达；组织规则和范围必填，成员细节可选 | 1 Entity 对多设计版本；可关联 Character/Relation 设计 | 作者创建，新版本修订；历史关系保留 | 阵营和秘密关系敏感；`06`、FR-002 |
| Item Design | Author Design Source；物品属性、能力、限制和唯一性 | 以 Design Object Identity/Version 表达；物品约束和唯一性必填，外观可选 | 1 Entity 对多设计版本；可关联 State Dimension 和 Outline | 作者创建，新版本修订；历史持有不删除 | 能力/关键物品敏感；`06`、FR-002 |
| World Rule | Author Design Source；物理/魔法/社会/技术规则 | 稳定规则身份+版本；规则、适用范围必填，例外条件可选 | 1 Revision 对多 Rule；可被 Validation 引用 | 作者确认后生效；新版本替代旧版本 | 高影响硬约束；`06` |
| Plot Arc | Author Design Source；中长期冲突、转折和结局方向 | 稳定 Arc ID+版本；目标和边界必填，节点集合可选 | 1 Novel 对多 Arc；1 Arc 对多 Outline Node | 作者/规划提案，作者确认；进行→完成/废弃 | 剧情计划敏感；`06` |
| Foreshadowing Plan | Author Design Source；伏笔线索、触发、回收和废弃条件 | 稳定伏笔 ID+版本；目标、阶段、证据要求必填 | 1 Arc/Node 对多伏笔；可映射多 Canon Evidence | 作者创建；草案→已确认/生效→已替代/已废弃；埋设/推进/回收/违反/完成状态由 Design Fulfillment State 派生 | 真相高敏，安全投影给 Agent；`04`、FR-005 |
| Secret Definition | Author Design Source；秘密真相、知情边界和揭示条件 | 稳定 Secret ID+版本；真相、禁止披露、条件、范围必填 | 可关联 Entity/Foreshadowing/Outline；1 Secret 对多安全任务投影 | 作者创建/修订；有效→揭示/废弃；历史不删 | 最高敏感，默认拒绝访问；`04`、FR-006 |
| Ending Constraint | Author Design Source；结局必须满足或禁止满足的约束 | 稳定约束 ID+版本；目标、强度、适用范围必填 | 1 Novel/Arc 对多约束；被 Validation 引用 | 作者创建；草案→已确认/生效→已替代/已废弃；满足/违反状态由 Design Fulfillment State 派生 | 高敏；`06` |

## 4. 写作执行实体

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Scene Task | Writing Execution；将场景目标编译成受控写作任务 | 稳定 Task ID+Task Version；场景、Design Revision、Canon Watermark/成功 Commit Sequence、视角、目标、秘密安全约束必填 | 1 Scene 对多 Task Version；一个 Task Version 可编译多个 Context Bundle；Task 不要求预先存在 Bundle | 场景服务创建；Task Version 先创建，后续修订生成新版本；创建→可编译→过期/关闭 | 任务可能含安全约束；`07`、`08` |
| Context Bundle | Writing Execution；冻结的实际模型输入 | 稳定 Bundle ID+不可变版本；最终编译后的有效上下文内容或受保护不可变内容引用、完整内容哈希、最终 Item 顺序、来源及版本、权限裁剪结果、安全投影策略版本、组装器版本、token/预算、Design Revision、Canon Watermark、Scene Task Version 必填 | 1 Task Version 对多 Bundle；一个 Bundle 对零到多个 Generation Run；每个 Generation Run 必须且只能引用一个 Bundle；1 Bundle 对多 Item | Context Compiler 创建；冻结后不可改；可恢复实际编译输入，不依靠重新检索 | 含受控信息，普通日志不显真相；`07`、FR-008 |
| Context Item | Writing Execution；实际进入模型的一个上下文条目 | 稳定于 Bundle 版本内；最终顺序、实际内容或不可变内容引用、来源、来源版本、入选理由、权限裁剪结果必填 | 1 Bundle 对多 Item；每项至少1 Source Reference | 编译器创建；不独立修改；随 Bundle 冻结 | 继承最严格可见性；`07` |
| Context Source Reference | Writing Execution；条目的来源记录和版本 | 引用 ID；源域、来源 ID/版本、证据范围、权限依据必填 | 1 Item 对多引用；引用只能指向允许读取的版本 | 编译器生成；追加修订，不改历史包 | 可能含秘密来源指针；`07` |
| Prompt Version | Execution/Audit；提示模板和编译规则版本 | 稳定 Prompt ID+不可变版本；模板、变量规则、发布状态必填 | Generation Run/Model Call 多对1 | 受控配置发布；版本不可覆盖 | 可能暴露策略；FR-012 |
| Model Configuration | Execution/Audit；模型、参数和随机性配置 | 稳定配置+不可变版本；模型标识、参数、策略必填 | Generation Run 多对1 | 受控发布；新版本新增 | 不记录未授权上下文；FR-012 |
| Workflow Run | Writing Execution/Audit；组织一次生成、校验、修复和审批工作流 | 稳定 Workflow Run ID；必须且只能属于一个 Scene Task Version；一个 Scene Task Version 可有零到多个 Workflow Run；可包含多个 Generation Run、Validation Run、Repair Record、Approval Record 和 Candidate Version；最多选择一个当前最终 Candidate Version；选择、替换或取消均追加不可变选择历史，历史选择不得删除或改写；转入 `approved` 时必须存在对当前最终 Candidate 有效且匹配的 Approval Record；当前最终 Candidate 改变后原 `approved` 不再有效，历史 Approval 不自动迁移；历史 `approved` 不足以绕过 Canon Commit 的再次检查 | 聚合关系和状态由 Workflow Run 组织；选择历史追加与状态变化受独立事务约束；状态不得代替 Approval Record 或 Canon Commit | 工作流服务创建；历史运行追加保留，不覆盖；原始运行记录不可由审计视图重建替代；approved 只表示工作流审批完成，不是 Canon 提交 | 运行和候选审计敏感；`04`、`08` |
| Generation Run | Writing Execution；一次生成运行 | 稳定 Run ID；Workflow Run、固定 Context Bundle、Prompt、Model、状态、输出引用必填 | 必须且只能属于一个 Workflow Run；必须且只能引用一个固定 Context Bundle；Bundle 的 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 相同；1 Bundle 对零到多个 Run；1 Run 对多 Model/Tool Call，并可产生零到多个 Candidate Version | 模型网关创建；运行中→完成/失败/取消；结果追加 | 输入/输出受权限保护；`08` |
| Model Call | Audit/Execution；单次模型调用 | 稳定调用 ID；实际渲染后的请求载荷或受保护不可变引用、请求哈希、模型/参数版本、实际响应内容或受保护引用、响应哈希、状态、重试关系、Context Bundle、Prompt Version 必填 | 1 Run 对多 Call；重试形成新的 Call 并关联原 Call | 模型网关追加；不可覆盖；可恢复受控实际输入/响应，不承诺重新调用逐字相同 | 高敏；NFR-006 |
| Tool Call | Audit/Execution；工具调用和能力结果 | 稳定调用 ID；Capability、调用者、范围、结果、失败原因必填 | 1 Run 对多 Call | Agent 工具运行时追加；不可由 Agent 改写 | 按最小披露；FR-012 |
| Cost Record | Audit；Token、成本、耗时和计量口径 | 计量记录 ID；Run/Call、输入输出量、成本口径必填 | 1 Run 对多 Cost；可关联验证/检索 | 计量服务追加；纠错新增更正记录 | 金额和模型数据受限；NFR-010 |
| Trace Span | Audit；调用链和阶段观测 | 稳定 Trace/Span ID；父子关系、阶段、开始结束、状态必填 | 1 Run 对多 Span，Span 可嵌套 | 运行时追加；不可删除历史 | 脱敏；NFR-006 |

## 5. Candidate 实体

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Candidate Version | Candidate/执行记录；候选正文与执行历史的权威记录，但不是 Canon Narrative Source | 稳定 Candidate ID+不可变版本；原始正文、正文引用、内容哈希、Workflow Run、实际适用 Context Bundle、状态必填；Generation Run 为可选直接来源 | 必须且只能属于一个 Workflow Run；必须绑定或明确继承具体 Context Bundle，且其 Scene Task Version 必须与 Workflow Run 的 Scene Task Version 相同；模型生成 Candidate 必须关联 Generation Run；修复 Candidate 必须关联同一 Workflow Run 内的前序 Candidate 和 Repair Record；人工编辑 Candidate 必须关联同一 Workflow Run 内的前序 Candidate 和 Human Change Record；修复调用模型时可同时关联 Generation Run；不得伪造 Generation Run | 写作/修复/作者编辑产生新版本；原始正文必须保留；内容变化产生新版本，不原地覆盖；旧 Validation/Approval 失效并重新进入流程；草稿→校验→待审→拒绝/过期/待提交 | 可能含秘密，不能解释为已发生事实；`08`、FR-009 |
| Narrative Assertion | Candidate 或 Canon 证据；正文中的叙事断言及确认链 | 断言 ID+版本；来源文本版本、证据范围、断言类型、确认状态必填 | 1 Text Version 对多 Assertion；可关联 Proposal 和 Canon 对象 | 抽取/提交服务追加；否定/替代通过关系 | 视来源和视角过滤；`06`、FR-013 |
| Candidate Event | Candidate；候选事件提案 | 稳定候选 ID；Assertion、事件参与者、时间关系、置信度必填 | 由 Assertion 形成；可映射0..多 Story Event | 抽取/修复产生新版本；不原地确认 | 可能泄露未确认情节；FR-013 |
| Candidate Fact Proposal | Candidate；可能成为 Canon Fact 的主张 | 稳定候选 ID；Assertion、主客体、谓词、范围、证据必填 | 由 Assertion 形成；最多按提交结果映射相关 Canon Fact | 抽取/修复产生新版本；拒绝保留 | 不等于事实；FR-013 |
| Candidate State Transition | Candidate；状态变化提案 | 稳定候选 ID；起止状态、目标 Entity、触发事件、证据必填 | 由 Assertion/Event 形成；可映射 State Transition | 抽取/修复产生新版本；不直接改状态 | 高风险；FR-013 |
| Candidate-to-Canon Mapping | Governance/Candidate；显式记录候选到 Canon 的提交映射 | 稳定 Mapping ID；Candidate、Canon Commit、目标对象、映射结果必填 | 1 Candidate 可对应多目标；1 Canon 对多 Candidate | 仅 Canon Commit 创建；追加，不修改 | 继承 Canon 权限；`09`、`08` |

## 6. 验证、审批与 Canon 实体

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Validation Run | Validation/Governance；在固定输入上执行校验 | Run ID+不可变输入绑定；候选哈希、规则版本、Design、Canon Watermark 必填 | 1 Candidate 对多 Run；Approval 至少绑定一个有效 Run | 校验服务创建；运行→完成/失败/失效；旧结果不复用 | 证据可能敏感；`08` |
| Validation Rule Version | Governance；规则和阈值版本 | 稳定规则 ID+版本；规则、严重级别、适用域必填 | 1 Run 对多 Rule Version | 受控发布；不可覆盖旧规则 | 策略敏感；`03` |
| Validation Issue | Governance；单个问题、证据和阻断级别 | Issue ID；Run、规则、证据范围、严重级别、状态必填 | 1 Run 对多 Issue；可关联 Repair/Exception | 校验服务追加；关闭需有修复/例外依据 | 可能暴露秘密；`03` |
| Validation Result | Governance；一次规则/指标的结果 | Result ID；Issue/规则、通过/失败/不确定、置信度必填 | 1 Run 对多 Result | 追加新运行，不改旧结果 | 脱敏；`03` |
| Repair Record | Execution/Governance；修复前后候选差异和重新校验链 | Record ID；原/新 Candidate、原因、差异、重校验必填 | 1 原 Candidate 对多 Repair；新 Candidate 对应一个来源修复 | 修复服务/作者创建；只追加 | 记录人工修改敏感内容；`06`、FR-018 |
| Approval Record | Governance；对明确候选内容的审批决定 | Approval ID；Candidate、内容哈希、Context Bundle、Author Design Revision、Canon Watermark/成功 Commit Sequence、Validation Run、Approval Policy Version、决定必填 | 1 Candidate 可有多次历史审批；只有全部绑定条件相同且仍为当前最终 Candidate 时才有效；提交只能选有效且匹配者 | 作者/受控审批服务创建；创建后决定及输入绑定不可修改；输入、当前选择或策略版本变化由 Approval Invalidation Record 记录并要求新 Approval | 高敏；`08`、FR-019 |
| Approval Invalidation Record | Governance；记录 Approval 因输入或策略变化失效的原因 | Invalidation ID；原 Approval、变化对象/版本、失效原因、检测者和时间必填 | 1 Approval 对多失效记录；失效后不得用于 Commit | 校验/提交服务追加；不可覆盖 | 高敏；`08`、FR-017 |
| Constraint Exception | Governance；硬约束例外授权，不是叙事事实 | Exception ID+版本；原约束、原因、范围、授权主体、生效/到期必填 | 可被 Issue、Approval、Canon Commit 引用 | 作者/授权审批创建；提议→生效→到期/撤销 | 最高治理敏感；`03`、`08` |
| Canon Commit | Canon/Governance；一次不可变正式提交账本 | Commit ID+幂等键；Workflow Run、当前最终 Candidate Version、Candidate Selection History 当前有效版本、有效 Approval Record、Approval Policy Version、Candidate 哈希、一个 Canonical Text、输入水位、成功 Commit Sequence、结果必填 | 1 Commit 必须绑定一个 Workflow Run 当前最终 Candidate；Candidate 必须属于该 Workflow Run、对应同一 Scene Task Version，且选择历史版本仍有效、Candidate 未被后续选择替换；Approval 必须覆盖并匹配 Approval Policy Version；历史 Candidate 不得依靠旧 Approval 进入 Canon；成功提交唯一幂等结果 | 仅提交服务创建；准备→提交中→已提交/失败；提交时重新验证当前选择和审批；成功始终保持 committed，反向/补偿/替代是关系而非状态 | 高敏；`08` |
| Canon Commit Item | Canon；Commit 写入的一个结构化 Canon 目标对象清单项 | Item ID；Commit、目标 Canon 对象身份或版本、对象类别、来源映射、证据必填 | 1 Commit 对零到多 Item；每个进入 Canon 的结构化对象恰有对应 Item | 仅提交事务创建；追加 | 按 Canon 权限；`08` |
| Canonical Text Identity | Canon Structure；正文逻辑身份 | 稳定文本身份；Chapter/Scene 归属必填 | 1 Chapter/Scene 对多文本身份；每次版本另存 | 提交服务创建，修订不改身份 | 正文可敏感；`06` |
| Canonical Text Version | Canon Narrative Source；正式正文版本 | Text Version ID+不可变内容；正文、Commit、证据范围和身份关系必填；不保存可变发布状态 | 1 Text Identity 对多版本；1 Commit 恰产生一个 Text Version | 仅提交服务写入；已提交不可改，修订生成新版本；发布/撤回/重新发布由 Publication Record 追加表达 | 受读者/视角控制；`08` |
| Publication Record | Canon/Governance；记录某个正式正文版本的发布、撤回和重新发布决定 | Publication ID；Canonical Text Version、Chapter、发布范围、决定、操作者和时间必填 | 1 Text Version 对多 Publication Record；不改变正文版本；当前发布状态由 Publication Record 派生 | 发布服务追加；发布/撤回用新记录，不覆盖历史 | 发布状态敏感；`02`、`08` |
| Impact Assessment | Governance/Derived；评估已发布正文修订、反向或补偿提交的影响 | Assessment ID；触发 Canon Commit、原 Publication Record、新 Canon Commit/正文版本、Canon Watermark、分析策略、状态和审计必填 | 1 触发 Commit 对多 Assessment；不属于 Canon Narrative Source | 分析服务创建；可重算，历史评估保留 | 影响范围敏感；FR-022 |
| Impact Item | Governance/Derived；Impact Assessment 识别的一个受影响对象 | Item ID；Assessment、对象类别、对象身份/版本、影响类型和建议必填 | 1 Assessment 对多 Item；对象类别限定 Chapter、Scene、Canon Fact、Story Event、State Transition、Author Design、Context Bundle 或 Projection | 分析服务追加；不自动生成 Commit 或修改下游 | 影响范围敏感；FR-022 |
| Story Event | Canon Narrative Source；确认发生的叙事事件 | Event ID+版本；参与者、发生/有效时间、证据、Commit 必填 | 由 Commit 产生；可关联多 Fact/Transition/Temporal Relation | 仅提交服务；反向/替代新建 | 可含秘密；`06` |
| Canon Fact | Canon Narrative Source；已确认的事实主张 | Fact ID+版本；Entity、谓词、值/范围、证据、Commit 必填 | 可被多 Event 支撑；可被多知识/披露证据引用 | 仅提交服务；修订关系追加 | 视披露策略；`06` |
| State Transition | Canon Narrative Source；确认的状态变化 | Transition ID；目标维度、前后状态、触发事件、有效范围、Commit 必填 | 1 Event 对多 Transition；目标 Entity/关系/物品可多种状态 | 仅提交服务；不可改，补偿产生新转换 | 角色/关系信息敏感；`06` |
| Canon Commit Sequence / Canon Watermark | Commit/Governance；成功提交的序列值及逻辑快照边界，不是独立实体 | Sequence 由成功 Commit 单调分配；Watermark 表示截至某成功 Sequence 的可见 Canon 状态 | 1 成功 Commit 推进一个 Sequence；失败/回滚请求不推进；Projection Checkpoint 独立 | 随 Commit 原子产生；不建立独立 Revision 记录 | 运行元数据；`08` |
| Supersession Relation | Canon/Governance；替代关系 | Relation ID；旧/新对象、原因、适用范围必填 | 多对多但不得形成未解释循环 | 新 Commit 创建；关系不可改 | 审计敏感；`08` |
| Reversal Relation | Canon/Governance；反向效果关系 | Relation ID；被反向对象、反向 Commit、证据必填 | 1 旧对象可多反向记录 | 新 Commit 创建；不可删除 | 高影响；`08` |
| Compensation Relation | Canon/Governance；补偿性修正关系 | Relation ID；原提交、补偿提交、原因、范围必填 | 1 原 Commit 可多补偿 | 新 Commit 创建；不可覆盖原提交 | 高影响；`08` |
| Evidence Reference | Cross-domain Evidence；正文片段、作者决定或工具证据 | Evidence ID；源版本、范围、证据类型、确认方式必填 | 1 Canon/Assertion/Validation 可多 Evidence | 抽取/提交/校验追加；原证据保留 | 内容敏感；NFR-001 |

## 7. 状态、知识、披露与时间

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| State Dimension | Author Design/受控语义注册；定义允许追踪的状态维度和语义，不代表具体 Canon 状态 | 稳定维度 ID+版本；对象类别、允许值语义、适用范围必填 | 1 Project/Design 对多维度；Canon State Transition 引用维度 | 作者设计/受控配置创建；版本化 | 可含设计秘密；`06` |
| Derived Current State | Derived；从有效 State Transition/Fact 计算当前状态 | 快照 ID+Canon Watermark；目标、值、证据链必填 | 1 Entity/Dimension/Watermark 对0..1当前结果 | 投影/查询服务生成；可丢弃重建 | 按视角过滤；非真实源 |
| Character Knowledge State | Derived Canon view；角色对事实的知识状态 | 记录 ID+角色、事实、Canon Watermark、knowledge state、证据必填；值域仅为 `known_true`、`known_false`、`unknown` | 1 Character 对多 Fact；每水位可有结果；缺少 Knowledge Evidence 推导为 unknown | 仅从 Knowledge Evidence 重建；不直接手改 | 高敏；`04` |
| Character Belief State | Derived/Canon evidence；角色相信的命题及真假状态 | 记录 ID+角色、命题、Canon Watermark、belief state、来源、有效时间必填；值域仅为 `believed_true`、`believed_false`、`unknown` | 1 Character 对多 Belief；可关联 Fact/Assertion；信念可与 Canon Fact 不一致 | 仅从 Belief Evidence 重建；不直接手改 | 高敏；`04` |
| Knowledge Evidence | Canon evidence；只证明角色知道某命题为真或为假的事件、对话或观察证据 | Evidence ID；角色、命题、来源 Text/Event、故事时间、Canon Watermark、证据范围必填 | 1 Fact/Event 对多 Knowledge Evidence；1 Character 多证据 | 仅由提交确认或受控推导产生；历史保留 | 高敏；`04` |
| Belief Evidence | Canon evidence；证明角色相信某个命题的事件、对话或观察证据 | Evidence ID；角色、命题、来源 Text/Event、故事时间、Canon Watermark、证据范围必填 | 1 Fact/Event 对多 Belief Evidence；1 Character 多证据 | 追加保留；不能作为 Canon Fact 真实性证据 | 高敏；`04` |
| Reader Disclosure Evidence | Canon evidence；正文对读者的确认/暗示/误导证据 | Evidence ID；Text Version、对象、披露级别、范围、Canon Watermark 必填 | 1 Text Version 对多 Evidence | 提交服务/披露分析产生；修订新记录 | 读者秘密高敏；`04` |
| Reader Disclosure State | Derived；特定 Canon Watermark 下读者已看到的披露状态 | 状态 ID+Canon Watermark；对象、披露状态、证据链必填 | 1 Watermark/视角对多对象结果 | 从正文/Assertion/Evidence 重建；不作独立事实源 | 对生成流程严格过滤；`04` |
| Temporal Relation | Canon Narrative Source；提交确认的事件/事实之间时间关系 | Relation ID；主体/客体、关系、source domain=canon、来源版本、证据、确定性必填 | 多对多；同一对可有修订关系 | 仅提交确认或受控修订；旧关系保留 | 可泄露情节；`06` |
| Temporal Constraint | Author Design Source；计划、允许或禁止的时间关系 | Constraint ID；关系类型、范围、source domain=author_design、来源版本、严重级别必填 | 1 Design Revision 对多 Constraint；可与 Canon Relation 做冲突检测/证据映射 | 作者设计版本化；不能原地覆盖 Canon Relation | 规则敏感；`06` |
| Time Interval | Temporal semantics；时间区间或相对窗口 | Interval ID；上下界/未知状态、source domain、来源版本、确定性必填 | Design Time Interval 或 Canon Time Interval 只能关联其同源对象；不得跨源冒充 | 提交确认或设计修订；不确定不强行精确化 | 情节敏感；`06` |
| Temporal Evidence | Evidence；时间来自正文、设计或事件的证据 | Evidence ID；source domain、来源版本、来源范围、抽取/确认方式必填；Canon Temporal Evidence 必须追溯到 Canon 文本、事件、事实或提交 | 1 Temporal Relation/Constraint/Interval 对多 Temporal Evidence；证据不能跨源替代 | 追加、不可覆盖；按来源域保留 | 内容敏感；`06` |
| Derived Timeline View | Derived；基于关系、约束、区间的查询视图 | View ID+Canon Watermark/策略版本；结果和冲突标记必填 | 1 Canon Watermark 对多视角视图 | 可完全重建；不允许作为独立写入目标 | 按视角控制；`09`、OQ-001 |
| Design Fulfillment State | Derived；指定 Canon Watermark 下 Design Object 的实现/满足状态 | State ID；Design Object、Canon Watermark、当前状态、Canon Fact/Event/Text/Evidence、策略版本、冲突/不确定状态必填 | 1 Design Object 对多 Watermark 结果；不回写 Design Revision | 可删除并从两个真实源及映射证据重算；历史评估可保留 | 设计完成度敏感；`04`、FR-004/005 |

`Character Knowledge State` 的值域仅包括 `known_true`、`known_false`、`unknown`；`Character Belief State` 的值域仅包括 `believed_true`、`believed_false`、`unknown`。缺少相应证据或派生记录时，只能解释为 `unknown`；缺少 Knowledge Evidence 不得推导为 `known_false`；Belief Evidence 不得作为客观 Canon Fact 成立的充分依据。

## 8. 投影、授权和审计实体

| 逻辑实体 | 域/权威性质；职责 | 身份、版本、主要属性；必填/可选 | 唯一性、外部引用、关系基数 | 创建/修改、生命周期、删除与审计 | 敏感性；依据 |
|---|---|---|---|---|---|
| Projection Outbox | Projection；Canon Commit 产生的投影意图 | Outbox ID；Commit、源版本、Canon Watermark、投影目标、事件哈希必填 | 1 Commit 对零到多 Outbox；每个 Outbox 只对应一个投影目标；一个 Outbox 可暂时没有 Task；同一 Outbox/目标/策略最多一个有效普通 Task | 与 Canon Commit 同事务创建；原始 Outbox 不可随意删除或重建；恢复从现存 Outbox 或 Canon Commit 创建 Rebuild Record，不伪造原 Outbox | 运行敏感；`08` |
| Projection Task | Projection；一个逻辑投影工作 | Task ID；origin、目标、策略版本、状态必填；普通 Task 关联 Outbox，重建 Task 关联 Projection Rebuild Record | origin 只能二选一；一个 Outbox 对零到一个有效普通 Task；一个 Rebuild Record 可产生一个或多个有范围的重建 Task；1 Task 对多 Attempt | 事务外创建/更新；重试不创建语义重复 Task | 不含未授权秘密；`05` |
| Projection Attempt | Projection；一次领取、执行、超时、失败或成功尝试 | Attempt ID；Task、源水位、策略版本、状态、开始/结束结果必填 | 1 Task 对多 Attempt；每次重试创建新 Attempt | Worker 追加；成功且未过期的 Attempt 才能推进 Checkpoint | 运行敏感；`05` |
| Projection Checkpoint | Projection；记录某投影已经成功应用的最高 Canon Watermark | Checkpoint ID；投影目标、规范化投影范围、策略版本、最高已应用 Canon Watermark、校验摘要必填 | 当前 Checkpoint 按“投影目标 + 规范化投影范围 + 策略版本”确定唯一当前记录；无子范围时使用根范围或默认范围 | 只能由成功且未过期 Attempt 单调推进；失败、过期或未完成 Attempt 不得推进；低水位重建只能写入暂存结果，未追平当前已发布水位不得切换为当前；只有达到不低于当前水位并通过来源、权限和结果校验后才能切换，且保留 Rebuild Record、Attempt 和校验依据 | 运行元数据；NFR-005 |
| Projection Failure | Projection；具体执行尝试的失败原因、影响范围和恢复动作 | Failure ID；Projection Attempt、错误分类、源版本、重试建议必填 | 1 Attempt 对多 Failure；不能只关联抽象 Task | Worker 追加；不改 Canon | 可能含脱敏错误；FR-023 |
| Projection Rebuild Record | Projection；从权威源重建的计划和结果 | Rebuild ID；输入水位、策略版本、范围、校验、切换结果必填 | 1 Rebuild Record 可产生一个或多个有明确范围的重建 Task | 运维/投影服务创建；计划→执行→成功/失败 | 运行元数据；NFR-005 |
| Actor/Principal | Authorization；作者、服务或 Agent 的执行身份 | 稳定 Actor ID；类别、状态、认证引用必填 | 1 Actor 对多 Role/Grant/Audit | 管理服务创建；停用不删除 | 认证敏感；FR-024 |
| Execution Role | Authorization；Writing/Validation/Approval/Projection 等职责 | 稳定 Role ID+版本；职责和默认能力必填 | 1 Role 对多 Capability/Actor | 受控配置；版本化 | 权限敏感；`02` |
| Capability | Authorization；受限读/写/执行能力 | 稳定 Capability ID；动作、资源域、条件必填 | 1 Role/Grant 对多 Capability | 安全配置发布；不可静默扩大 | 高敏；`02` |
| Capability Grant | Authorization；把能力授予 Actor/Role 的范围 | Grant ID+版本；主体、能力、Data Scope、期限必填 | 1 Actor/Role 对多 Grant | 作者/系统管理员受控修改；撤销留痕 | 高敏；`11` |
| Data Scope | Authorization；项目、场景、视角、Canon 水位和秘密范围 | Scope ID+版本；范围维度、最大水位、视角必填 | Grant/Visibility Decision 多对1 | 编译/授权服务生成；新版本替代 | 最高敏感；`07` |
| Visibility Decision | Authorization；一次读取请求的允许/拒绝及理由 | Decision ID；Actor、Scope、资源版本、动作、结果、原因必填 | 1 请求对多决定；Context Item 引用决定 | 授权服务追加；不可改 | 访问敏感；NFR-003 |
| Access Audit Record | Audit/Authorization；读取/写入/拒绝审计 | Audit ID；Actor、能力、资源、版本、结果、时间必填 | 1 Actor 对多记录 | 审计服务追加；不可覆盖 | 高敏，日志脱敏；NFR-003 |
| Human Change Record | Audit；人工修改差异、原因和影响 | Record ID；操作者、前后版本、差异、再校验必填 | 1 Candidate/Canon Commit 对多记录 | 作者操作产生；追加 | 高敏；FR-027 |
| Evaluation Result | Audit；质量评测样本、版本和结果 | Result ID；数据集/规则/模型版本、指标、样本必填 | 1 Run/Commit 对多结果 | 评测服务追加；不可覆盖 | 脱敏；`03` |

Design Studio 可以写 Author Design 和提案；Writing Agent 只能读取授权的 Context Bundle 并写 Candidate；Validation Agent 写 Validation/Repair；Approval/Commit 执行者写 Approval/Canon Commit；Projection Worker 只写投影记录。所有访问默认拒绝并产生 `Visibility Decision` 与 `Access Audit Record`。

## 9. 逻辑值域与非法组合

| 值域 | 允许语义 |
|---|---|
| source domain | `author_design`、`candidate`、`canon`、`execution`、`governance`、`projection`、`audit`、`authorization` |
| record authority | `authoritative_source`、`authoritative_record`、`derived`、`non_canon_candidate`、`audit_only` |
| lifecycle status | 非所有实体共享全部状态；各实体只能使用其定义允许的子集：设计对象使用 `draft`/`effective`/`superseded`/`deprecated`/`archived`，Canon Commit 成功后固定 `committed`，投影状态使用专属值域 |
| candidate status | `created`、`extracting`、`validated`、`needs_repair`、`pending_approval`、`approved`、`rejected`、`stale`、`mapped_to_canon` |
| workflow run status | `created`、`generating`、`validating`、`needs_repair`、`pending_approval`、`rejected`、`approved`、`failed`、`cancelled`、`expired`；不与 Candidate、Canon Commit、Projection Task 或 Projection Attempt 状态混用 |
| validation severity | `hard_blocking`、`soft_warning`、`info`、`uncertain` |
| validation result | `pass`、`fail`、`inconclusive`、`invalidated` |
| approval decision | `approved`、`rejected`、`request_revision`、`force_override`；`force_override` 必须绑定有效 Constraint Exception，新 Design Revision 消除冲突时使用普通 `approved` |
| commit result | `preparing`、`committing`、`committed`、`failed`；成功后的 `committed` 不得原地更新为 `failed`、`reversed`、`compensated` 或 `superseded`；后三者只能表示由后续不可变 Canon Commit 建立的关系语义 |
| knowledge state | 仅 `known_true`、`known_false`、`unknown`；缺少记录为 `unknown` |
| belief state | 仅 `believed_true`、`believed_false`、`unknown`；可与 Canon Fact 不一致 |
| disclosure state | `not_disclosed`、`hinted`、`partially_disclosed`、`confirmed`、`misdirected`、`superseded` |
| temporal relation | `before`、`after`、`simultaneous`、`overlaps`、`contains`、`relative_order`、`unknown` |
| projection task status | `pending`、`completed`、`cancelled`、`abandoned`、`needs_rebuild`；Task 表示逻辑投影工作 |
| projection attempt status | `processing`、`succeeded`、`retryable_failure`、`permanent_failure`、`expired`；Attempt 表示一次执行尝试 |
| permission action | `read`、`write_candidate`、`validate`、`approve`、`commit`、`project`、`administer` |
| visibility result | `allow`、`deny`、`redacted`、`filtered`、`indeterminate_deny` |

非法组合至少包括：Canon Commit 指向的 Candidate 不是对应 Workflow Run 的当前最终 Candidate，属于非法状态；Canon Commit 使用的 Candidate Selection History 版本已经失效，或 Approval Record 未绑定当前 Approval Policy Version，提交必须被拒绝；`candidate` 记录不得标为 `canon` 或 `committed`；`derived` 记录不得作为 Commit 输入事实源；`commit_result=committed` 不得被更新为 `failed`、`reversed`、`compensated` 或 `superseded`；`approval=approved` 不得绑定 stale/哈希不匹配 Candidate；`visibility=allow` 不得超出 Data Scope；`known_false` 不得由缺失 Knowledge Evidence 推导；Belief Evidence 不得升级为客观 Canon Fact；`Derived Timeline View`/`Reader Disclosure State`/`Derived Current State`/`Design Fulfillment State` 不得成为唯一写入来源；没有有效 Constraint Exception 时 `force_override` 不得进入 Canon Commit。

## 10. 变更记录

| 版本 | 日期 | 状态 | 变更摘要 |
|---|---|---|---|
| 0.1.7 | 2026-09-22 | 草案 | 补全 Canon Commit 实体目录中的当前最终 Candidate、选择版本和审批策略绑定 |
| 0.1.6 | 2026-09-22 | 草案 | 补齐实体目录中的选择历史、Scene Task 一致性和前序候选范围 |
| 0.1.5 | 2026-09-22 | 草案 | 删除重复 Workflow Run 目录行，统一执行实体关系和 Checkpoint 重建限制 |
| 0.1.0 | 2026-09-21 | 草案 | 建立项目、身份、设计、执行、候选、Canon、知识、时间、投影、授权和审计实体目录及逻辑值域 |
| 0.1.1 | 2026-09-21 | 草案 | 固定 Canon Watermark、提交基数、审批失效、可重放输入、投影尝试、知识/信念分离和设计完成度派生语义 |
| 0.1.2 | 2026-09-21 | 草案 | 补充 Belief Evidence、设计生命周期、发布记录边界、投影来源互斥、Narrative Assertion 来源和时间证据来源语义 |
| 0.1.3 | 2026-09-21 | 草案 | 拆分知识/信念与投影状态值域，明确 Checkpoint 逻辑唯一性和 committed 非法状态转换 |
| 0.1.4 | 2026-09-21 | 草案 | 补入 Workflow Run 目录项，明确 Bundle/Run 基数和规范化范围 Checkpoint 语义 |
