# 原型收口与正式实现准备

- 文档编号：DOC-16
- 版本：0.3.0
- 状态：草案
- 更新时间：2026-10-20
- 依据：现行 [01 项目范围](01-project-vision-and-scope.md)、[02 产品需求](02-product-requirements.md)及 [00 主题权威划分](00-document-map.md)所指向的 `03`—`14`；不重新定义其业务语义。
- 参考：[15 数据库第一批实施计划](15-database-implementation-plan.md)与下列十三个独立原型。`15` 是原型实施前的历史计划，其“尚无代码、依赖未安装、测试未执行”和“第一批为 Time Interval 原型”描述不能代表当前工作区或下一批正式实现；本文件保留其历史用途，不改写或批准其待确认选型。
- 决策来源：本轮用户要求的原型收口；编制者：Codex；评审状态：待作者确认。本文件汇总证据、差异与实施建议，不取代需求、领域规范或正式技术决策。

## 1. 当前结论与证据目录

十三个独立原型已经在各自受限夹具中验证了来源完整性、数据库去重与不可变边界、审批输入绑定、请求幂等、Canon 原子写入、正文替代、投影接纳与发布，以及真实受限身份下的上下文和审计披露边界等工程风险。**尚未完成统一系统集成；原型通过不等于正式系统已经实现。** 这些结果不构成百万字零漂移、自然语言真实性、生产安全认证或所有侧信道防护保证。

本次核实读取了各原型 README、当前运行报告、相关修复证据，并定位到迁移函数和测试。以下均为**已有执行证据**，本轮没有重新执行 `pnpm prototype`、容器测试或运行器故障测试。报告所记的容器/临时结果清理是对应历史执行的结论，本轮未创建数据库容器。目录以实际工作区为准；P01—P13 仅是本文件的证据索引，不是新增模块。

计数分别保留顶层测试、参数化子场景和运行器故障验证。早期报告未单列内部循环总数时，不反推子场景数量；后期 TAP 总数可能包含顶层和子场景，不再重复计算。不相加十三个原型的测试数作为系统覆盖率。

| 原型 | 验证目标 | 最新执行结果 | 可采用结论 | 未覆盖范围 | 证据路径 |
|---|---|---|---|---|---|
| P01 `time-interval-constraints` | 八种区间来源、反向引用及归属竞争 | 当前一键报告 27/27 顶层场景通过；未单列内部参数总数。另有 4 项运行器故障验证通过 | 延后检查区间恰一绑定、同源版本/项目及对象引用；最终锁机制见下文 | 完整时间语义、Evidence 联合提交、任意事务无死锁 | [README][p01-r]；[最新运行][p01-v]；[父子锁修复][p01-f]；[故障验证][p01-fault]；[实现][p01-m]／[测试][p01-t] |
| P02 `evidence-candidate-constraints` | 五类 Candidate 来源与去重 | 18/18 顶层场景通过；内部参数未独立汇总 | Candidate 容器、Workflow、Assertion 链和实际目标共同校验；六字段唯一 | 其他来源域、完整候选生命周期、真实权限 | [README][p02-r]；[运行][p02-v]；[实现][p02-m]／[测试][p02-t] |
| P03 `evidence-canon-constraints` | 六类 Canon 来源、提交状态与版本 | 18/18 顶层场景通过；内部参数未独立汇总 | 正文版本、Commit 和内部对象采用各自来源版本映射；支持合法历史来源 | 完整 Canon 提交、Item/Mapping、正文内容及授权 | [README][p03-r]；[运行][p03-v]；[实现][p03-m]／[测试][p03-t] |
| P04 `evidence-design-constraints` | 八类设计来源与 Revision 归属 | 17/17 顶层场景通过；内部参数未独立汇总 | 类型专属 FK、实际目标与 Revision/项目一致，历史合法 Revision 可引用 | 设计草案编辑、确认/生效、秘密访问控制 | [README][p04-r]；[运行][p04-v]；[实现][p04-m]／[测试][p04-t] |
| P05 `evidence-tool-constraints` | Tool Call→Generation→Workflow/Bundle/Task 链 | 20 个顶层通过，另记 36 个参数化子场景 | Tool 版本取 Generation ID，实际目标取 Tool Call ID；响应引用不参与身份 | 真实工具、结果真实性、完整执行状态机；Bundle 可空性采用 P06 的后续口径 | [README][p05-r]；[运行][p05-v]；[实现][p05-m]／[测试][p05-t] |
| P06 `evidence-unified-constraints` | 四域共同父表、20 类来源与互斥 | 25 个顶层、358 个子场景全部通过 | 四张支撑总数恰一、父子身份一致；同库六字段唯一裁决竞争；保留 Bundle 可空 Workflow | 与 Time Interval、完整 Canon/安全上下文统一；真实工具与权限 | [README][p06-r]；[运行][p06-v]；[实现][p06-m]／[测试][p06-t] |
| P07 `projection-attempt-lifecycle` | 领取、截止接纳、过期、重试竞争 | 11 个顶层、90 个子场景全部通过 | 锁后数据库时间判定；成功接纳与 COMMIT 时间分开；重试新 Attempt | 完整 Outbox 消费、Checkpoint、外部副作用保护、真实 Worker | [README][p07-r]；[运行][p07-v]；[实现][p07-m]／[测试][p07-t] |
| P08 `projection-checkpoint-publication` | 来源资格、单调水位、staging→active | 15 个顶层、72 个子场景全部通过 | 截止前已成功接纳可延后发布；身份锁保护首次发布和切换；旧结果不覆盖 active | 增量缺口检测、完整消费调度、真实图/向量、真实权限 | [README][p08-r]；[运行][p08-v]；[实现][p08-m]／[测试][p08-t] |
| P09 `canon-commit-preconditions` | 当前候选、审批七项绑定、失效及 ABA | 6 个顶层、106 个子场景全部通过 | 选择历史版本与当前有效性共同准入；预检查不是后续提交通行证 | 正式 Canon、真实成功水位、真实审批人授权、完整校验工作流 | [README][p09-r]；[运行][p09-v]；[实现][p09-m]／[测试][p09-t] |
| P10 `canon-commit-atomic-core` | 首次正文、请求幂等与 Outbox 原子性 | 5 个顶层、79 个子场景全部通过 | 一个 Candidate/正文；成功水位、Item、必需 Outbox 与提交审计一起提交/回滚 | 非空结构化输出、正文修订、完整失败账本、真实权限/投影 | [README][p10-r]；[运行][p10-v]；[实现][p10-m]／[测试][p10-t] |
| P11 `canon-structured-mapping` | 冻结提案→三类 Canon、Evidence、Item/Mapping | 5 个顶层、112 个子场景全部通过 | 提案集合与 Validation/Approval 绑定；新 Canon 身份、实际字段转换及全输出事务封口 | 任意事实确认、非空时间、事实替代、一般状态演算、四域联合及权限 | [README][p11-r]；[运行][p11-v]；[实现][p11-m]／[测试][p11-t] |
| P12 `canon-text-supersession` | 纯正文修订链与历史保留 | 5 个顶层、130 个子场景全部通过 | 新 Candidate/Validation/Approval/Commit/正文；精确前驱与替代关系；历史重放不改当前 | 结构化撤销/补偿、Publication/Impact、级联修订、真实权限 | [README][p12-r]；[运行][p12-v]；[证据摘录][p12-e]；[实现][p12-m]／[测试][p12-t] |
| P13 `authorization-safe-context` | 真实登录、有限安全投影、Bundle、撤销及审计范围 | **修复后** 5 个顶层、119 个子场景全部通过，TAP 124；历史 109＋新增回归 10 | 真实写作/作者/校验/审计权限正例；取用重新授权；Task 与引用资源分别核对 Scope | 完整认证、任意秘密脱密、知识/披露重建、模型/Canon 集成和连接池 | [README][p13-r]；[当前运行][p13-v]；[安全证据][p13-e]；[修复前真实复现][p13-f]；[实现][p13-m]／[测试][p13-t]／[网关][p13-g] |

### 1.1 最新修复的采用顺序

P01 的历史 26/26 和最初父子锁解释不能覆盖最终修复。真实修复前实验观察到子行已锁、等待父行，随后死锁；当前代码已移除 `candidate_version_lock_before_write`。容器项目归属、Candidate 的 Workflow 归属及 committed 回退由即时守卫拒绝；无变化 UPDATE 不进入新的延后扫描。容器属性用 `FOR NO KEY UPDATE`，来源对象/区间用 `FOR UPDATE`；不把 FK 的 `KEY SHARE` 升级为父行 `FOR UPDATE`。报告中的“非法更新拒绝后创建”是顺序验证，不能算作容器先持锁的并发证明。[修复分析][p01-f]与当前[迁移][p01-m]、[27 项运行][p01-v]共同作为依据。

P13 的历史 [109 项报告][p13-old]不能证明后来发现的审计漏洞已被覆盖。修复前在原代码、新实例中由真实 writerA 编译、真实 auditor 读取，实测 A 审计带出 1 条 B 资源标识；原始审计没有改动。修复后对 `events` 和 `source_refs` 正向检查实际资源，新增 10 项并保留原 109 项全部执行。[阶段比较][p13-compare]记录原场景无遗漏；当前结论采用 119 项报告，不能退回旧结论。

## 2. 规范与原型对照

下表结论按主题区分“已验证且与规范一致”“仅验证了受限子集”“夹具实现，不能直接迁移”“存在差异，需要决定”。同一原型可能在不同主题上属于不同类别；“已验证”只指链接所列的确定性关系，不包含自然语言语义正确性。

| 主题 | 规范位置 | 原型实现/测试位置 | 对齐结论 | 正式实现注意事项 |
|---|---|---|---|---|
| 双真实源与 Candidate/Canon 分离 | [04 §1—3](04-dual-source-of-truth-spec.md)、[06 §5—6](06-narrative-data-model.md)、[11 INV-SOURCE-001／INV-CANDIDATE-001](11-data-invariants-and-transaction-boundaries.md) | P11 [迁移][p11-m] `write_structured_outputs`、`expected_canon_fields`；[测试][p11-t] A/B/C；P13 [测试][p13-t] A | **仅验证了受限子集**：候选保留、新建 Canon 目标；写作真实身份无 Canon/Design 写权限 | 统一实体 ID/FK，禁止按同名表拼接十三套 Schema；设计内容不能因 Canon 更新自动回写；P13 的 canon resource 只是访问夹具 |
| Time Interval 来源完整性 | [12 §3.3](12-relational-physical-schema.md#33-多态引用与跨域完整性选择)、[13 §6.1](13-database-constraints-indexes-and-concurrency.md#61-时间区间与证据的物理检查) | P01 [迁移][p01-m] `validate_time_interval_source`、`reject_container_identity_update`、`lock_time_interval_container`；[测试][p01-t] 缺绑定 COMMIT、旧新区间、共享容器、父子无变化更新 | **已验证且与规范一致**的来源完整性与最终锁机制；**存在差异，需要决定**：来源绑定不可变尚未落实（D13） | 只在未提交事务允许缺绑定；合入 Canon 时重新验证整体锁序，不能恢复 BEFORE ROW 先父后子假设；来源身份与 Evidence 版本不可混同 |
| 四域 Evidence 来源、身份去重和不可变边界 | [12 §3.3](12-relational-physical-schema.md#33-多态引用与跨域完整性选择)、[13 §6.1](13-database-constraints-indexes-and-concurrency.md#61-时间区间与证据的物理检查)、[14 §4.1](14-data-lifecycle-migration-and-recovery.md#41-恢复范围) | P02—P05 各 `validate_evidence_*`；P06 [迁移][p06-m] `validate_evidence_source`／`reject_evidence_mutation`、[测试][p06-t] A—E | **已验证且与规范一致**：四支撑总数恰一，六字段唯一，历史合法来源可用，消费方不参与身份 | 使用共同父表唯一约束；旧四字段只有检索索引；类型专属 FK、容器映射和延后检查不能被裸 ID 替代；来源保护不能误冻设计草案内容 |
| 审批绑定、输入失效和 ABA | [08 §2.8—2.9](08-canon-commit-protocol.md)、[12 §4.2](12-relational-physical-schema.md#42-context-bundlecandidate-和-approval)、[13 §5](13-database-constraints-indexes-and-concurrency.md#5-并发与锁定原则) | P09 [迁移][p09-m] `record_approval`／`check_admission`／`lock_scope`；[测试][p09-t] C 人工编辑、同正文不同身份、A→B→A，D 首次失效竞争；P10 [测试][p10-t] B 事务内复核 | **已验证且与规范一致**：七项绑定、不可变失效、选择版本与实时准入；**仅验证受限子集**的硬问题和人工 actor | 真实授权必须从 P13 的身份边界接入，不能信任请求 actor；无失效行时仍有共同稳定锁；历史 Approval 重放不等于恢复有效性 |
| 请求幂等与 Canon Watermark | [08 §3](08-canon-commit-protocol.md#3-幂等并发与版本冲突)、[12 §4.3](12-relational-physical-schema.md#43-canon-commit-与水位)、[13 §2.1／§4](13-database-constraints-indexes-and-concurrency.md) | P10 [迁移][p10-m] `canonical_request`／`current_watermark`／`commit_text`；[测试][p10-t] A/D；P12 [测试][p12-t] E v3 后重放 v2 | **已验证且与规范一致**：同键同摘要返回原输出、异摘要拒绝；失败不推进；**存在差异，需要决定**：夹具水位 +1、摘要编码及成功账本子集 | 规范只要求严格单调，不要求无空洞；历史摘要按原版本核验，不能引入当前指针重新解释；新请求仍检查当前输入 |
| 正文、结构化对象、Item、Mapping 和 Outbox 原子提交 | [08 §2.9—2.12／§4](08-canon-commit-protocol.md)、[11 INV-CARDINALITY-001/002、TX-CANON-001](11-data-invariants-and-transaction-boundaries.md)、[13 §4](13-database-constraints-indexes-and-concurrency.md#4-canon-commit-18-个原子步骤的物理承接) | P10 `assert_commit_complete`；P11 [迁移][p11-m] `assert_item_target`／`assert_evidence`／`assert_commit_complete`，`created_transaction`；[测试][p11-t] C/D/E；P10 [测试][p10-t] C | **仅验证了受限子集**：首次正文、三类一对一转换、初始化 Fact/State、正文 Evidence；中途失败和真实 COMMIT 均整体回滚 | 正式约束必须枚举实际输出集合；每结构化目标有 Item/Mapping，正文 Item 无需伪造提案 Mapping；对外成功须等真实 COMMIT；派生状态留在事务外 |
| 纯正文替代与历史保留 | [08 §4—5](08-canon-commit-protocol.md)、[12 关系目标及 supersession 表](12-relational-physical-schema.md)、[14 §3.1](14-data-lifecycle-migration-and-recovery.md#31-业务事实修订与-schema-迁移分离) | P12 [迁移][p12-m] `candidate_revision_intent`／`assert_text_chain`／`assert_revision_admission`；[测试][p12-t] A—E；[故障摘录][p12-e] | **仅验证了受限子集**：未发布、两端无结构化 Canon 的单正文身份修订；原成功记录不变 | 修订意图、原因、旧目标进入冻结/校验摘要；旧版本唯一后继；不能把纯正文替代解释为事实撤销、发布后修订或下游自动改写 |
| Projection Attempt 与接纳时点 | [13 TX-PROJECTION-003／§5](13-database-constraints-indexes-and-concurrency.md)、[14 §2.1](14-data-lifecycle-migration-and-recovery.md#21-运行记录的可变边界与-attempt-过期控制) | P07 [迁移][p07-m] `guard_attempt_update`／`lock_attempt`／`retry_attempt`；[测试][p07-t] C 锁等待跨截止、接受后 COMMIT/ROLLBACK，D 竞争 | **已验证且与规范一致**：取锁后 `clock_timestamp()` 严格早于截止才能成功，同一时间写 ended_at；重试新 ID | 不用 now()/Worker 时间；UPDATE 执行器已锁目标，触发器不再反向拿 Task；成功接纳、事务提交、后续发布是三个时点 |
| Checkpoint 与投影发布 | [09 §5.5](09-database-logical-model.md#55-outbox-与投影)、[12 projection_checkpoint](12-relational-physical-schema.md)、[13 TX-PROJECTION-002/004](13-database-constraints-indexes-and-concurrency.md)、[14 §4.2](14-data-lifecycle-migration-and-recovery.md#42-派生投影恢复) | P08 [迁移][p08-m] `result_problem`／`guard_publication_receipt`／`publish_result`；[测试][p08-t] A—E | **夹具实现，不能直接迁移**：完整快照、收据派生只读 Checkpoint、权限替身；接纳和单调发布规则已验证 | 成功 ended_at < expires_at 后，发布不重判当前截止；区分当前 Canon C、active A、结果 R、重建目标 G；完整快照跳水位不证明增量无缺口；补全全状态 Outbox 消费 |
| 身份、权限、安全投影、Bundle 冻结与撤销 | [04 §6](04-dual-source-of-truth-spec.md#6-伏笔与秘密生命周期)、[07 §6—8](07-context-assembly-spec.md)、[12 授权／上下文](12-relational-physical-schema.md)、[13 INV-AUTH／TX-CONTEXT-001](13-database-constraints-indexes-and-concurrency.md) | P13 [迁移][p13-m] `caller`／`authorize`／`api_compile_context`／`check_bundle`、Bundle 完整性守卫；[测试][p13-t] A—E；[网关][p13-g] `dispatch` | **已验证且与规范一致**的真实连接身份、ACL、冻结/重新授权、撤销稳定锁；**夹具实现，不能直接迁移**的资源/认知和有限投影 | 正式来源回到共同 Evidence；秘密/授权/知识或信念/读者披露四分；缺记录 unknown；安全约束也须过披露判断；预算不足拒绝；旧包不是永久凭据 |
| 审计读取范围和默认日志边界 | [07 §6—7](07-context-assembly-spec.md)、[11 §6](11-data-invariants-and-transaction-boundaries.md#6-授权与可见性)、[13 INV-AUTH-001／访问审计](13-database-constraints-indexes-and-concurrency.md)、[14 §3.3](14-data-lifecycle-migration-and-recovery.md#33-原始载荷哈希受保护引用与最小审计证据) | P13 [迁移][p13-m] `audit_resource_in_scope`／`api_read_audit`／`deny`；[测试][p13-t] `auditScopeRegressions`／`noAuditIdentifiers`、D/E；[修复证据][p13-e] | **已验证且与规范一致**：Task 和非空引用资源分别检查；不可见事件整体过滤，合法历史及 NULL 普通事件保留；默认日志白名单 | events/source_refs 都检查存在、项目、场景、水位、类别、非空命题；项目级资源依 Scope 规则允许，不给资源另加人物语义；不能套 active/当前版本过滤器；拒绝审计须真实提交 |

### 2.1 同名对象和实现选择不能直接合并

1. **版本含义按关系区分。** P01 的 Time Interval `source_version_id` 取被选来源对象 ID；P06 Evidence 的 Design/Candidate/Tool 分别取 Revision/Candidate/Generation，Canon 正文取正文版本、内部对象取创建 Commit。均有各自规范映射，不能用一个通用“version_id 相等”替代；Temporal Evidence 与区间的“版本兼容”还需明确跨来源对象/容器版本的判定，尚无联合原型证明。P13 `resource/source_version_id` 不是正式 Evidence 身份，需回接真实 FK。[P01 校验][p01-m]、[P06 映射][p06-r]及 [12 §3.3](12-relational-physical-schema.md#33-多态引用与跨域完整性选择)是迁移依据。
2. **Bundle 与 Workflow。** P05 的 `context_bundle.workflow_run_id` 必填且相等，P06 已改为可空、有值才核对，仍强制 Task/项目一致；采用后者与 [12 §4.4](12-relational-physical-schema.md#44-workflow-run-与-scene-task-version-一致性)一致的边界。P13 Bundle 另有编译主体/Grant，正式复用还需当前授权，不能仅凭 Task 相同共享。
3. **当前指针和运行状态。** P09—P12 用历史与只读视图派生当前 Candidate/正文，P08 用收据派生 Checkpoint；[12](12-relational-physical-schema.md)列出受控当前指针和运行状态。派生实现可保证样本一致，但不能把 selected/unselected 当完整 Workflow 状态，也不能照搬夹具收据表为新领域权威。选择派生或物化指针须在相应正式迁移前决定，并保持历史/指针同事务、可对账。
4. **不可变不是禁止全部状态变化。** P09—P12 将草案 Design 和完成的 Validation 输入夹具整体追加不可变；规范允许设计草案编辑和运行记录受控完成。P01 只冻结容器治理身份，P04 不冻结设计内容；P06 原值 UPDATE 可成功，P09 的某些不可变表连原值 UPDATE 也拒绝。正式实现按 [14 §2—2.1](14-data-lifecycle-migration-and-recovery.md)分离身份/输入、运行状态与终态，不一概复制触发器。
5. **锁的组合尚未实测。** P09—P12 项目锁还枚举锁全项目 Workflow/候选/审批/校验，是保守夹具；P06 依不可变来源与唯一约束，不增加排他容器锁；P13 使用 policy/actor Gate；P08 使用 Task→Attempt→Rebuild→发布身份。正式系统须先确定各命令共同锁序，尤其提交授权和撤销竞争，避免 Gate→Novel 与 Novel→Gate 反向。保留稳定锁处理“失效/撤销行尚不存在”；不得把十三套局部无死锁结论外推到整合。
6. **权限结论分开采用。** P01—P12 的管理连接、invoker 函数和普通 DML 测试证明约束，不能证明真实权限隔离。P13 采用真正非所有者 LOGIN、NOLOGIN 受控函数所有者、固定安全 search_path、撤销 PUBLIC EXECUTE、`session_user` 映射；未用 RLS。P01 的旧夹具路径包含 `public`，也不能直接升级为 SECURITY DEFINER。正式运行角色不得继承所有者/迁移凭据，内部辅助函数不得成为公开旁路。
7. **摘要与封口。** 各夹具有不同的 `validation-input-v1`、structured/supersession request 及 `safe-payload-v1`，多用 PostgreSQL JSONB 文本字节；不能把同名 hash 当同一内容。Bundle 摘要针对实际模型可见字节，隐藏来源摘要单独受限；正式网关包装后的真实请求另存 Model Call 摘要。`created_transaction xid8` 是数据库内同事务追加保护的夹具方案，不是调用者权限；跨进程、迁移/恢复与正式写入口需重新验证。
8. **业务确认和状态关联仍缺整合。** P11 的 `fixture_world_record` 只证明确定字段相等；State 初始化转换没有完整触发 Story Event/历史状态演算，[06 §5](06-narrative-data-model.md)及 [10 §5—7](10-logical-entity-catalog.md)要求事件、状态、证据语义关联。不能仅改夹具表名就称为正式事实确认或状态治理。明确差异、影响及决策阶段见第 6 部分。

审计修复的证据也有精确范围：类别/命题的 `source_refs` 反例父 Task 在 Scope 内；合法 Bundle 完整性不允许越场景/未来来源挂在该父 Task，因此这两类来源反例由合法的其他 Task 编译，父 Task 亦被排除。事件反例则在允许 Task 上隔离了引用资源条件。正式集成应保留这些前置条件说明和嵌套检查，不将测试描述扩大为所有组合已独立隔离。[安全证据][p13-e]

## 3. 首版支持范围

以下是依据现行需求提出的**首版交付切片建议，待评审**，不是将全部 FR 标记为完成。首版以单用户、单项目、单 Canon 主分支的可审计写作闭环为目标；测试仍使用两个项目/主体检查隔离，不扩展多租户产品。自动审批保持关闭。任何未支持操作须在入口明确拒绝并记录安全原因，不能退化为覆盖历史、修改既有成功提交或忽略请求字段。

| 能力 | 首版处理方式 | 依据 | 暂不支持时的明确行为 |
|---|---|---|---|
| 单用户、单项目、单 Canon 主分支 | 一个作者入口、一个活动项目；模块和 ID 保留项目归属，成功提交在 Novel 锁下串行；候选可并行形成 | [01 §4—6](01-project-vision-and-scope.md)、[00 OQ-002/004](00-document-map.md)、[13 §5](13-database-constraints-indexes-and-concurrency.md#5-并发与锁定原则) | 拒绝分支/Commit Group/跨场景批量提交及租户参数，不把并行候选变成并行覆盖 |
| 作者设计与场景任务 | 基础层级、稳定 Entity；设计草案编辑→作者确认冻结→新 Revision；场景 Task Version 固定 Design、Canon、受限人物视角、读者范围、目标和预算 | FR-001—008；[04](04-dual-source-of-truth-spec.md)、[12 作者设计和 Task](12-relational-physical-schema.md) | 未实现的复杂设计生命周期/自动目标完成判断返回不支持或待作者处理，不把设计目标记成已发生事实 |
| 经授权的安全上下文与来源 | 结构化查询/必要关键词、受控有限投影规则；Bundle/Item/正式 Evidence 来源、实际字节和版本；每次取用重新授权；人物知识/信念和披露只消费可核实的版本来源 | FR-006/008/010/012；[07](07-context-assembly-spec.md)、P13 | 无规则、认知/披露来源不足、冲突或预算无法容纳必要约束则排除或阻断编译；不自动概括秘密；历史/复杂状态无法重建不装作已知 |
| 候选、校验和人工审批 | 不可变正文/提案冻结；新编辑/修复版本；当前选择及历史；确定性硬门禁、版本化校验结果和软问题人工审阅；作者真实身份批准 | FR-013—018；[08 §2.4—2.9](08-canon-commit-protocol.md)、P09/P11/P13 | 未实现的硬规则无法判断则阻断或待人工补证，不能以 pass 夹具代替；自动批准/无依据 force_override 拒绝 |
| 首次正文及受限结构化产物 | 首版必须有首次正文原子提交。结构化首个增量建议先开放有明确作者确认依据的 Story Event，再逐项开放新增 Fact 和状态初始化；每类上线前补正式语义测试 | FR-019/020、[08 §2.10](08-canon-commit-protocol.md)、P10/P11；P11 不构成全部三类必须同时上线的理由 | 未上线类型、未确认 Assertion、事实覆盖、无触发事件的状态、非空时间引用直接拒绝；空结构化集合须明确，不能静默丢提案 |
| 纯正文修订 | 建议首版后段支持未发布正文、旧新 Commit 均无结构化 Canon 的单身份修订；新意图/候选/校验/审批/Commit 与 supersession，原版本保留 | [08 §4—5](08-canon-commit-protocol.md)、[14 §3.1](14-data-lifecycle-migration-and-recovery.md#31-业务事实修订与-schema-迁移分离)、P12 | 任一端有结构化效果、目标过时、已发布或有待评估依赖时拒绝；不擅自撤销事实或覆盖旧正文 |
| Outbox 与可重建投影 | Canon 同事务写版本化配置要求的目标集合；数据库后台消费者、Attempt 与完整快照、单调 Checkpoint；查询同时显示 Canon/投影水位及落后 | FR-023；[05 §4—5](05-system-architecture.md)、[13 TX-PROJECTION-*](13-database-constraints-indexes-and-concurrency.md)、P07/P08/P10 | 失败只重试/显式重建，不修改 Canon 成功；未实现目标或无法回查来源则不发布；不强制 graph/vector 两个夹具目标成为正式必需目标 |
| 审计、调用追踪和成本 | 受限审计入口同时检查 Task 与资源；白名单常规日志；保留实际调用请求/响应受保护内容、版本、hash、Token/耗时和计量版本；未知费用标未知 | FR-012/024—027、NFR-003/004/006/010；[14 §3.3](14-data-lifecycle-migration-and-recovery.md#33-原始载荷哈希受保护引用与最小审计证据)、P13 | 未授权审计事件过滤/请求拒绝；缺载荷引用或密钥时标部分不可重放，不能伪造费用、精确重放或安全解释 |
| 非线性时间线 | 保留 relative/unknown/区间表达；完整非线性推理仍待确认 | [00 OQ-001](00-document-map.md)、[06 §5.1](06-narrative-data-model.md#51-状态类别与-timeline) | 请求完整非线性推演拒绝；不补造绝对日期 |
| 未提交草稿依赖、多分支 | 沿用 OQ-002/003：首版不启用；同 Workflow 人工编辑前序链不等于跨草稿事实上下文 | [00](00-document-map.md)、[07 §8](07-context-assembly-spec.md#8-可重放与模型窗口兼容) | 不召回其他未提交草稿充作事实，不自动合并分支 |
| 结构化撤销/补偿与复杂历史演算 | 建议延后；未来必须新 Commit/显式关系及重建，保留 FR-021 的未交付状态 | [08 §4/7](08-canon-commit-protocol.md)、[11 INV-CANON-002](11-data-invariants-and-transaction-boundaries.md) | 暂拒绝 reversal/compensation、已有 Fact/State 修订及任意历史状态查询；不能用纯正文 supersession 替代 |
| 发布后级联重写 | 沿用 OQ-006：不自动改后文。首版建议暂不开放 Publication 与发布后修订，留作后续受控交付 | [00](00-document-map.md)、FR-022、[08 §5](08-canon-commit-protocol.md#5-已发布章节修改与历史事实失效) | 发布/发布后修订入口未实现即拒绝；未来开放时须先有 Publication/Impact，仍只出影响清单和任务，不自动写下游 |

真实图/向量、全知叙述、通用自然语言秘密检测、完整知识/信念/披露历史重建、Entity 合并拆分和自动审批均不是本次原型通过后自动附带的首版能力。建议按上表逐项关闭；作者如调整首版范围，先评审对应缺口，不把“已有表设计”当作已经实现。

## 4. 正式实现顺序

最多四批，围绕**同一个模块化单体、同一套正式 Schema、同一迁移账本**增加能力。领域边界为设计、写作执行/校验审批、Canon、授权、投影、可观测性；不是为十三个原型分别建立正式服务。CLI 或简单服务接口足够完成首次闭环，完整网页界面不是前提。以下保留四批计划；第一批已按本轮用户授权实施，状态见 4.1。其余批次仍为计划，未因底座通过而标记完成。

### 4.1 第一批：工程与身份基础，建立第一个正式可运行底座

**本轮实现状态：已完成首批本地工程与身份权限验收，非生产就绪。** 用户本任务已采纳 D01/D02 的本地首批契约；实现为根单体入口、`src/`、`db/migrations/`、`scripts/`、`test/`，正式 `agent_book` Schema 与独立 `agent_book_meta.schema_migrations` 账本，没有复制原型 Schema。实际命令/角色矩阵见 [根 README](../README.md)，本轮独立执行结果见 [正式验收](../verification/foundation/run-result.md)，保护检查见 [保护核验](../verification/foundation/protection-result.md)。原型报告仍仅是历史证据。

本批 `data_scope` 的 Novel FK 非空，只支持 `foundation-scope-v1` 的 Novel 范围；Scene/视角/秘密/水位请求明确拒绝。新作品尚无 FK 目标，因此另用只允许创建新身份的 `novel_creation_authorization` 及其追加撤销记录承接初始化启动授权，不引入全作品 Scope。创建作品只给当前作者固定的读取/撤销能力，不接收任意主体、角色或权限范围；作者另可无主体参数地撤销自己的有效创建启动授权。首批稳定单行授权锁串行化已实现命令，锁后判定真实有效期；D06 的未来 Novel/Workflow/Canon 组合锁序仍未解决。

本轮不生成候选、不写 Canon、不投影或调用模型；无 Canon 模块时仅返回逻辑水位 0，并明确 `canon_status=not_implemented`。以下交付/验收条目保留为首批计划与对应核验口径：

- **交付物**：确认技术选择后建立单体入口、配置边界、统一依赖/锁文件、迁移命名与账本、测试入口；第一组正式迁移只落项目 Novel/Volume/Chapter/Scene、稳定 Entity 和 Actor/Role/Capability/Grant/Scope/撤销/访问审计所需核心关系。统一 ID/项目外键、时间与版本列约定；没有成功 Canon 时仅返回逻辑边界 0，不造 committed 夹具账本。提供初始化、身份自检、创建/查询授权项目及撤销测试授权的受控 CLI/服务接口。
- **依赖**：第 6 部分 D01、D02 已由本任务确认并用于本地首批。采用 Node.js ESM、pnpm、pg、node-pg-migrate、node:test；本地固定 PostgreSQL 18.6 及已记录 digest，不作生产/长期补丁批准。初始化管理员和迁移身份独立于运行角色。
- **支持/不支持**：使用真实受限 author、writer、validator、commit-service、projection-worker、auditor 登录及 NOLOGIN 所有者，按实际已开放功能给最小 EXECUTE；未实现入口不给权。默认无底表权限、无高权限成员关系、无 BYPASSRLS/CREATEDB/CREATEROLE；受控函数固定路径、撤销 PUBLIC，主体来自可信连接映射。首批不生成候选、不写 Canon、不调用模型、不投影，不把这些命令伪装为可用。
- **验收**：新空库执行正式迁移；升级/失败停留可解释；管理员仅初始化/核验。真实 author 成功创建/读取许可项目；writer/auditor 等不能直写设计/授权/审计或调用内部函数；伪造 actor、Scope、会话参数及 SET ROLE 不提权；撤销前后状态可观察、拒绝审计在提交后由独立连接读取。测试角色/数据库每轮隔离，真实阻塞 PID 加有限超时，失败清理不算成功。未实现操作明确返回安全的不支持结果。
- **可观察结果**：从一个正式工程入口可重建空库、查到一组真实身份及许可范围，正例能成功、反例不能越权；只有初始化/结构和授权记录，Canon 水位仍为 0。根正式资产已由本任务授权创建；完整写作闭环尚未开始。

### 4.2 第二批：设计→安全 Bundle→候选→校验→人工审批

**第二批第一段完成；整个第二批未完成。** 本轮用户授权在同一正式工程追加 [002 迁移](../db/migrations/002_design_task.mjs)，[001](../db/migrations/001_foundation.mjs) 保持原字节。真实 author 已能创建结构/Entity、创建与编辑草案、确认冻结生效、创建场景任务及追加版本、查询历史；[正式验收](../verification/design-task/run-result.md) 与第一批历史报告分别保留。Bundle、Workflow、Generation、Candidate、Validation、Approval、Evidence 全域整合及模型均未启用。

- **草案与正式版本**：可编辑 `design_draft` 工作记录使用预期编辑号；冻结时生成从首次插入即不可变的 Revision、人物版本、Entity Binding 与 author_rule_v1 约束。`design_activation` 历史和 `design_head` 指针承接生效/替代，不修改冻结正文或摘要。旧 Revision 派生新草案，旧任务仍绑定原版本。仅人物设计、Novel/Scene/character 范围规则；其他设计、例外、秘密/伏笔及规则执行明确不支持。
- **权限演进**：新增 structure.manage、design.read/edit/freeze、task.read/create/append，仅给指定 Novel 有有效 Grant 的真实 author。novel.read 不导出设计/任务权；其他五类运行角色不自动扩权。既有作品补权只认唯一可信创建审计及真实作者关系，并要求原 novel.read 与 grant.revoke 均仍有效；撤销/到期不恢复，新增授权不晚于原有效期。创建记录不足/歧义停止升级，需运维评审具体历史，不猜测归属。
- **本段 D04/D05/D06 契约**：`ab-jsonb-v1` 固定 UTF-8、SHA-256 和 PostgreSQL 18 JSONB 表示，分别使用 request/frozen/task 域前缀；字段、集合顺序及字节见 [README](../README.md#摘要幂等事务与锁序)，原 canonical_text 与协议持久化，数据库重建关系集合校验实际摘要。请求摘要不含重试新 UUID/时间；同 Actor/Novel/operation/request_key 同请求重放、异请求拒绝，重放仍重查权限。锁序为稳定授权 gate→Novel→head→Draft，或 gate→Novel→Task，预期当前 Revision/Task 前驱防止丢失更新。这里只确认本段实现契约，不批准未来 Bundle/Canon 的全部待决语义。
- **任务边界**：稳定 scene_task 与不可变版本通过真实复合 FK 绑定 Scene/Novel、当前 Revision、character 和本 Revision 约束；旧绑定不覆盖。仅逻辑 Canon 水位 0、有限人物、线性/committed_only、task-reader-v1/no_disclosure_claim；读者字段为作者输入，不代表已披露，预算只是整数保存校验。全知/分支/草稿依赖、非零水位、未知参数拒绝。
- **验证与剩余门槛**：真实空库及第一批既有作品/撤销数据升级、原 5/45 与 7 控制测试回归、新增真实身份/并发阻塞 PID/中途及 COMMIT 回滚/摘要/泄密扫描见本轮报告。无本段剩余实现阻断；进入下一段前仍须决定安全投影、编译策略、Bundle 来源与预算契约，不将这些夹具外能力视为已实现。

- **交付物**：在同 Schema 增加设计草案/冻结 Revision、真实约束及安全投影规则发布、Task/Workflow、Bundle/Item/来源、Generation/Model Call 的执行契约、不可变候选与人工编辑/修复关系、Assertion/提案冻结、Validation 与人工 Approval/Invalidation；CLI 展示安全上下文、候选、冲突和审批绑定。接入共同 Evidence 父表及实际需要的 Design/Candidate/Tool 来源；尚未实施的来源类型明确关闭，不能只建无 FK 的占位表。
- **依赖**：第一批身份；D03—D06 在对应迁移/入口启用前决定，尤其摘要字节协议、指针/运行状态和 Novel/Gate 组合锁序。已冻结 Design、Task 和输入 Canon 边界；初期无 Canon 用 0，后续同一读取接口接真实账本。
- **支持/不支持**：先用显式标记的确定性测试模型适配器验证流程，保存实际测试请求/响应并标记 provider=test；不得称为真实模型验证或将其执行记录混入正式作品。模型候选仍要真实来源链，人工编辑引用真实前序及修改记录，不伪造 Generation；外部模型留到第四批。校验仅已声明的确定规则，不能把任意 pass 参数作为正式批准依据；未知硬条件阻断，自动审批与无例外强制覆盖关闭。
- **验收**：有限且经评审的秘密样本；先授权再排序、异常 snippet 重建；实际模型载荷字节/hash/顺序和正式 Evidence FK 可查；人物认知/披露来源不足拒绝；撤销/到期/策略变化拒绝旧包。真实作者审批，真实写作身份不能批准/读秘密/读受限审计；人工编辑、提案或输入变化、ABA 都必须新校验/审批。真实 COMMIT 缺 Item/来源拒绝且无半成品；默认日志/嵌套错误/审计 ID 用禁止标识扫描。
- **可观察结果**：CLI 能显示一个来源可追踪、权限有效的候选及人工审批，Canon 仍未写入；测试输出明确“流程验证、非真实模型”。同 Workflow/Task/Bundle 的统一链替代原型各自的最小同名表。

### 4.3 第三批：Canon 原子提交与最小后台投影闭环

- **交付物**：正式 Commit/正文身份版本、成功水位、Item 及类型支撑、Mapping、统一四域 Evidence/时间来源约束的实际所需分支、版本化幂等协议和必需 Outbox 配置；同事务最小提交审计。新增数据库后台消费者的全状态 Task 复用协议、Attempt/Failure、隔离完整快照、Checkpoint/active 查询及显式重建入口。建议先正文空集合闭环，再受限结构化输出，最后纯正文修订，均在同一迁移序列演进。
- **依赖**：第二批真实审批和安全 Bundle；D05—D10、D13 中对应提交生命周期、来源语义、投影及修订决定在启用前解决。统一已实现来源的 FK/延后检查，不得把 P11 单一正文来源版本复制为另一个 Evidence 父表。
- **支持/不支持**：提交服务真实受限角色才能写 Canon；普通 writer 不获得 invoker 原型的写表权。新请求事务内重查选择、审批、Scope、Design、真实 Canon 水位和提案确认依据，COMMIT 完成才响应成功。支持配置内最小数据库投影目标，不强制真实图/向量；完整快照来自真实 Canon 边界，不能用“最高事件水位”假装增量全处理。纯正文修订受第 3 部分限制，未开放类型明确拒绝。
- **验收**：执行第 5 部分端到端路径和集成反例；中途故障、真实 COMMIT 故障与外层回滚后独立读取全部物理输出表、当前状态、审计/失效数；合法完整提交必须成功。旧成功重放返回原输出，不改变当前正文/水位；重启消费者恢复 Outbox，Task 终态不被重复消息复活。Canon 成功后投影失败保持 Canon，Attempt 接纳后晚发布合法、旧 Attempt 不覆盖新 active。
- **可观察结果**：一个正式 CLI 路径可从设计做到 Canon 与数据库投影，查询明确同时给出 Canon 水位、active 水位、Attempt/失败和 lag。证明数据库内消费/发布与可恢复链，不宣称真实外部存储的原子切换或召回质量。

### 4.4 第四批：真实模型、最小作者操作入口和质量评测

- **交付物**：受控模型适配器、Prompt/配置版本、真实请求/响应受保护存储、超时和重试身份、Token/耗时/成本记录；CLI 或简单服务串联生成、编辑、校验、审批、提交、投影查询和来源解释。建立作者标注的硬冲突/秘密/文风等评测样本、模型与规则版本及规模运行记录。
- **依赖**：第三批确定性闭环；模型/供应商、受保护载荷与密钥方案、实际 token 预算、费用计量口径和评测集先确认。需要真实外部图/向量时另评审目标发布协议，不作为这批默认前提。
- **支持/不支持**：网络调用在数据库事务外；重试新 Call/Attempt，真实输出保存新 Candidate；首版审批全部由人工操作触发；未来自动审批须在基准、阈值、策略及授权正式确认后另行启用。模型不确定性、未知费用或缺失载荷引用明确标记；不承诺同输入逐字重现，不允许模型跳过硬门禁。
- **验收**：真实模型走同一个安全 Bundle/候选/审批/Canon 路径，不替换为管理员通道；故障和撤销不暴露原始秘密；实际渲染请求、响应、Candidate、审批与成功输出可追踪。按 [03 指标](03-drift-definition-and-quality-model.md)区分检出、误报、漏报、逃逸、人工修改和成本/时延，逐步开展第 5 部分规模层级，不预设无依据阈值。
- **可观察结果**：作者可完成一次真实模型辅助写作与正式提交，查看调用、费用计量和问题证据；确定性工程通过与小说质量报告分别展示，未交付 FR 保持未完成。

## 5. 集成验收与验证边界

### 5.1 一条可执行的端到端验收路径

未来第三批开始执行确定性版本、第四批再用真实模型复用；本轮仅定义步骤。所有操作使用同一正式 Schema 和受限入口，独立核验连接只读确认最终结果，不代替权限正例。测试初始化可有第二项目作为越权反例。

| 顺序 | 执行动作与主体 | 必须观察的结果 |
|---|---|---|
| 1 | author 创建设计草案、冻结 Revision、场景任务和 Workflow | 稳定 Scene/Entity 与 Task Version；固定 Design、Canon 水位 0、视角和读者边界；Canon 无新增 |
| 2 | writer 调用 Task 编译入口 | 新冻结 Bundle；安全载荷字节/hash/有序 Item 可核；来源追踪只在受限区；不能提交自选已过滤内容 |
| 3 | 受控网关使用 Bundle 形成候选版本 | 第二批测试适配器/第四批真实 Model Call 如实标记；实际请求/响应及模型/Prompt/参数版本可恢复；Candidate 正文不可覆盖 |
| 4 | validator 抽取 Assertion/受支持提案、冻结集合并校验 | 正文定位、对象摘要、来源/确认依据、规则和输入 hash 完整；不确定/失败不放行；反馈给 writer 重新安全投影 |
| 5 | author 选择最终 Candidate 并人工批准 | 选择历史版本；Approval 七项绑定及真实操作者；无自动批准，审批不推进 Canon |
| 6 | commit-service 用稳定幂等键请求提交并完成真实 COMMIT | 新 Commit/一个正文版本、对应结构化对象与 Item/Mapping/Evidence、单调成功水位和最小审计全部持久化；旧 Candidate 保留 |
| 7 | 在步骤 6 的同一事务写入必需目标 Outbox | 独立连接看到精确目标集合、来源 Commit/水位/范围/策略/事件摘要；不能存在 Canon 成功但漏目标的状态 |
| 8 | 后台消费 Outbox，领取 Attempt，事务外构建隔离结果，接纳并发布 | Task 来源互斥/复用；ended_at < expires_at；真实结果 hash/来源授权有效；短事务内单调推进 Checkpoint/active |
| 9 | author/授权查询入口读取正文和投影状态，auditor 查询来源 | Canon 与 active 水位均与实际记录一致，落后则显示 lag/降级；审计 Task 与引用资源各自过 Scope；重启后仍可查同一链 |

验收保存每步公开安全标识、受限核验结果和最终状态；错误/日志证据只用标签、计数和布尔。授权来源 ID 可以在授权审计中出现，越界 ID、秘密标题/路径/嵌套字段不可以；不能要求所有来源标识都消失来制造通过。

### 5.2 必须联测的反例与正例

| 场景 | 操作与预期 | 核验位置 |
|---|---|---|
| 人工编辑后复用旧结果 | 新 Candidate 引用同 Workflow 前序及编辑记录；旧 Validation/Approval 拒绝，即使正文 hash 相同也不跨身份继承 | 当前选择、审批绑定/失效与 Canon 无新增；重新校验批准后正例成功 |
| 输入版本/选择变化及 ABA | 依次改变提案、Design、Canon、Bundle、规则/校验器/审批策略；A→B→A 不恢复旧批准；提交事务内再检查 | 原 Approval/Validation 未改写；新请求被阻断；预检查记录不能当许可证 |
| 同幂等键异内容 | 原成功后同 key 同请求返回原 Commit/全部输出；改变任一摘要输入拒绝 | 不增加正文、Item、Mapping、Outbox 或水位；历史成功重放不回退当前正文；重放本身仍需当前读取权限 |
| 中途错误、真实 COMMIT 失败、外层回滚 | 在正文/部分对象/第二条 Outbox 之后注入测试故障；另构造 INSERT 成功但延后检查失败 | 新独立连接直接计数全部输出表及失效/审计、当前正文/水位，与之前相同；不能只从 Commit JOIN 而漏孤立行；同 key 可重试 |
| Canon 成功后投影失败 | 已完成 COMMIT 后让 Worker 失败，再重试新 Attempt | Canon 永久 committed、原 Outbox 保留；失败审计与待处理可见，下一次有效结果可发布 |
| 旧 Attempt 与新发布竞争 | 旧执行迟到写隔离区、已失效来源、较低水位、同水位异摘要；另测截止前接纳/截止后发布 | 旧结果不覆盖新 active；相同水位同摘要幂等；比较的是受锁保护的当前 active，不是先前缓存 |
| 上下文越权、撤销与旧包 | 伪造 actor/项目/场景/视角/水位/策略；未知投影；跨主体取包；撤销先行与取用先行两种真实阻塞顺序 | 真实 LOGIN 正/反例；确认具体阻塞 PID 后释放；撤销先提交则等待者拒绝，取用先判定仅完成本次，下一次拒绝 |
| 审计资源越界与日志污染 | 允许 A Task 的真实过滤事件引用 B 或另一场景资源；分别超水位/类别/命题；恶意 snippet/标题/metadata/校验解释/SQL 错误 | events 与 source_refs 嵌套检查禁止标识；合法 A/历史来源及 NULL 普通事件正例保留；原始审计不改；默认日志从开始即白名单，泄密扫描不打印 canary |
| 拒绝审计与技术回滚 | 业务拒绝用受控结果提交审计，再独立读取；技术失败及直接权限错误单独记录 | 不把“先 audit 后 RAISE”事务回滚说成持久化；日志不能附原 SQL/参数/秘密；审计不可由 writer 伪造 |
| 重启与 Outbox 重复消费 | Canon 提交后、Task 创建前停止消费者；也在 processing 时停止；重新启动重复投递同 Outbox | 从持久 Outbox 恢复；查询全部 Task 状态、复用 pending、显式恢复 needs_rebuild、completed 返回结果、cancelled/abandoned 不复活；过期重试新 Attempt；无重复有效 Task/有效发布 |
| 连接复用和跨模块锁序 | 同入口交替主体/项目；若正式引入连接池则先验证归还时事务/身份/GUC 清理；同时运行授权撤销、审批失效、提交及发布 | 无跨主体缓存复用/凭据切换；稳定锁首次存在；有限超时、具体 PID 和顺序证据；不靠随机 sleep/死锁重试声称通过 |

每个负例须确认其他前置条件合法，记录实际失败阶段；SQLSTATE/具名约束、受控业务拒绝和超时分别统计。预期失败不代表所有语义都测过；合法正例必须通过。整合后的元数据核验至少包含 FK/唯一/默认延后触发器、函数所有者/固定路径/ACL、无禁用约束和无故障设施残留。

### 5.3 三层验证不能互相替代

| 层级 | 能证明什么 | 仍不能证明什么 |
|---|---|---|
| 数据库约束与确定性规则 | 当前原型及未来统一 Schema 的关系、身份、摘要、事务、竞争和有限披露规则 | 未集成模块的相互作用；模型语义；任意自然语言秘密或外部存储安全 |
| 真实模型接入及流程集成 | 实际安全输入→模型调用→候选→人工审批→提交/投影的运行链、故障恢复与成本记录 | 同输入逐字输出、小说长期一致性、文学质量或生产安全认证 |
| 小说质量、长期一致性与规模评测 | 标注集上的检出/误报/漏报/逃逸、秘密暴露机会、抽取质量、文风/人工修改和成本/耗时趋势 | 未测试作品/模型/规模的普遍保证；“零漂移”或自然语言零泄密 |

按 [01 §8](01-project-vision-and-scope.md#8-规模验证层级)：10 万字为功能回归基准，100 万字为完整长篇基准，500 万字为目标压力基准，均指累计正式正文，不是单次上下文。本轮没有执行这三层级规模实验；质量、成本、延迟和容量阈值继续待真实基准确定，不能由原型用例数量推导。备份恢复、密钥失效、载荷保留与生产连接池/负载验证仍按 [14](14-data-lifecycle-migration-and-recovery.md)另行验收。

## 6. 差异清单与进入实现的门槛

下列均是具体差异/未决建议，不静默修改受保护规范。第一批阻断仅指在第 4.1 批正式迁移/授权入口落地前必须确认的事项；其余在相关能力实施前解决即可。对尚未批准的技术或产品范围不作既成决定。

| 编号 | 具体问题 | 影响范围 | 是否阻塞第一批实现 | 建议 | 需要决策的阶段 |
|---|---|---|---|---|---|
| D01 | 正式数据库/语言/迁移类别原为待确认；本任务已确认本地首批 | 迁移、运行和本地验收 | **本地首批已解除** | PostgreSQL；Node.js 原生 ESM JavaScript；pnpm 11.18.0、pg 8.23.0、node-pg-migrate 9.0.0、node:test。锁文件保留已验证传递版本；本地镜像固定 postgres:18.6 及既有 digest | 用户本任务决定；生产部署、支持/补丁策略另评审 |
| D02 | 本任务已确认首批统一身份和权限契约，并已落地 | 核心表、作品隔离、登录映射与对象所有权 | **本地首批已解除** | Novel 为唯一作品根；应用 crypto.randomUUID() 生成业务 UUID，角色/能力代码和登录名自然标识映射到 UUID。Volume/Entity→Novel FK，Chapter/Scene 冗余 Novel 与父复合 FK。Actor 从 session_user 映射；migrator 独立且仅有 owner SET 成员关系；NOLOGIN owner 持有对象；六类运行 LOGIN 无高权属性/所有权/成员关系。Scope 只支持真实 Novel，创建启动授权单独建模；无池、无管理员回退，固定函数路径/PUBLIC EXECUTE 撤销 | 用户本任务决定；本轮真实身份、FK、ACL 与撤销验收；其他待决问题不因此批准 |
| D03 | P13 把 `resource` 及认知/披露作为有版本输入，未用正式 Evidence/Canon FK；有限投影/字符预算不处理任意秘密和模型 token 窗口 | 正式 Bundle、检索、校验反馈及历史可追溯性 | 否 | 第二批回接真实 Design/Candidate/Canon 来源和 Evidence，项目/Task 固定 POV；未知规则/来源拒绝。有限作者批准规则明确声明覆盖集；真实 token 预算和复杂状态重建另验收 | 第二批来源/编译迁移前；真实模型预算第四批 |
| D04 | P05 Bundle 强制 Workflow，P06 已修正可空；P09/P08 当前指针视图与 DOC-12 可变指针物理方案不同；Workflow selected/unselected 不是完整状态机 | 执行关系、并发选择、当前投影 | 否 | 采用规范 Task 一致性与可空 Workflow；建议正式当前指针受控物化并同事务追加历史、对账，或明确批准派生方案；运行状态按规范单独建模。不能用早期更窄夹具收缩正式基数 | 第二批 Workflow/Bundle 前；Checkpoint 物理选择第三批 |
| D05 | 多个摘要协议、locator 格式和 `created_transaction` 封口；模型输入/受限来源摘要分层不同 | Bundle、Validation、Approval、幂等请求、迁移恢复 | 否 | 第二批固定实际可见字节/版本化序列化及字符定位协议；正文/提案/请求摘要分开。历史摘要按原版本；事务封口须与受限入口、恢复/迁移路径共同验证，不对外暴露 XID 作授权 | 第二批首次持久化 Bundle/Validation 前；第三批请求/封口前 |
| D06 | 管理连接提交夹具无真实授权；P13 Gate 与 Novel/来源/发布锁尚未统一；全项目枚举锁比规范所需更保守 | 提交、授权撤销、审批失效和死锁/吞吐 | 否：第一批只确定其授权核心锁 | 建议重叠命令统一前序锁；第二批形成含 Gate/Novel 的锁序清单并实测，第三批接 commit/worker 真实权限。首版保留 Novel 串行提交，是否缩小全项目后序锁由正确性/基准决定；不依赖不存在的失效行 | 第二批开始重叠写入前；第三批联测；优化可后移 |
| D07 | P09—P12 整体不可变的 draft/已完成 Validation，与规范允许草案编辑/运行状态推进不同；P10—P12 只保存 committed 分支，水位固定 +1 | 设计、执行状态、失败账本和幂等重试 | 否 | 草案/运行/终态分开；只在成功事务确认成功序号，不承诺无空洞。失败请求用独立受限运行/审计事务保存，不伪造成 Canon 成功；明确 failed 账本与相同 key 重试的正式契约，避免失败行永久占键。成功历史永不回退 | 第二批设计/Validation 状态；第三批 Canon 迁移前 |
| D08 | P11 观察记录/固定转换替代完整确认规则，State 初始化缺完整触发事件链；P12 只支持无结构化两端，且没有 Publication/Impact | 事实真实性、状态来源、修订范围 | 否 | 初期正文＋受控 Event；Fact/State 启用前确定作者确认依据、真实触发事件及冲突规则。暂拒绝历史状态改变/结构化补偿；纯正文修订限未发布且无结构化影响；未实现 FR-021/022 不标完成 | 第三批各类型上线前；复杂修订后续产品决策 |
| D09 | P07/P08 未实现 DOC-13 全历史状态的 Outbox 创建/复用协议；P08 完整快照与收据/权限替身不是正式增量/外部发布 | 重启恢复、重复消费、快照完整性和发布水位 | 否 | 第三批实现来源锁下全状态复用、真实权威快照与最小数据库投影；同水位冲突拒绝，标 Canon/active 落后；未来增量缺口和外部版本切换另设计验收，不复制测试权限 allow 记录 | 第三批消费/发布前；外部图/向量未来评审 |
| D10 | 审计 Scope 历史109存在真实标识披露；修复后119已覆盖，不能用“Task 同项目”恢复旧实现；审计历史与业务当前性不同 | 受限审计、来源元数据、日志/错误 | 否 | 固化 P13 修复为集成必测：实际资源存在及完整 Scope、整事件过滤、NULL 普通事件/合法旧版本保留；新内部 helper 不公开。业务拒绝提交审计，技术回滚/直接权限错误另记；默认日志白名单 | 第一批审计入口基础；第二/三批资源引用读取前 |
| D11 | OQ-001—006 和规模阈值尚有开放项，首版受限切片不是需求全集 | 非线性、多分支、草稿依赖、多场景冲突、自动审批、发布后影响/重写 | 否 | 沿用第 3 部分默认拒绝/关闭及单主分支；建议先不开放 Publication、结构化撤销和复杂历史演算；作者评审首版切片，保留需求缺口。阈值用标注集/真实规模确定 | 对应能力前产品评审；质量/规模第四批以后 |
| D12 | 正式认证、密钥/载荷存储、连接池、安全运维和备份恢复未验证；原型内存凭据/零连接池不够生产 | 真模型内容、秘密保留/恢复、生产安全与可用性 | 否：第一批限本地隔离身份边界 | 第一批不引入高权凭据共享；第二批按敏感度保护内容，第四批真调用前定凭据与载荷方案。生产前完成恢复演练、RPO/RTO/保留决策、ACL/连接池及泄密复核；未知成本标未知 | 真模型/外部载荷前及生产上线前；性能/灾备参数不阻塞本地骨架 |
| D13 | DOC-12 `time_interval_source` 要求身份/来源/绑定不可变；P01 的绑定 UPDATE 可先成功、由延后完整性裁决，未实现这项即时不可变边界。Time Interval 与 Evidence 的来源版本含义不同，Temporal Evidence 兼容规则未联合验证 | 时间来源、历史保护、Temporal Evidence 与 Canon 整合 | 否：首批不写时间来源 | 正式实现遵循规范对已建立绑定追加不可变；若需要创建事务内调整，先明确允许阶段，禁止历史重绑。以 P01 的“更新来源绑定同时校验旧区间和新区间”测试及迁移 `validate_time_interval_trigger` 为差异证据，不能称已经通过不可变验收；补来源/容器版本兼容表和真实联合提交测试。保留最终锁修复，不以放宽归属解决冲突 | 第三批实际时间来源/Temporal Evidence 启用前；若仍未决定，该分支拒绝 |

### 6.1 启动判断

**第一批已按本任务授权完成本地正式底座及真实验收；本文件整体仍为草案。** D01/D02 在本地首批的阻断已解除，契约与实际入口见 4.1 和对应行；生产选型/认证/长期补丁未批准。第二批第一段已按 4.2 的本轮授权完成；无需新增独立原型，完成后停止，不自动开始第二批其余部分。

没有发现必须退回“第一轮九份文档一致性修订”的理由，也未发现现有证据足以证明统一集成已完成。D03—D10、D13 在各自迁移/能力启用前解决；D11 的未来能力、D12 的生产部署/灾备及规模参数可以推迟到对应阶段。尚未决定的操作先明确不支持；这不取消规范中的需求，不应将本文件的建议写成已经批准的变更。

### 6.2 首次 Git 基线方案

原收口轮检查时的 Git 状态有 `.gitignore`、`docs/`、`prototypes/` 和根级两个历史原型压缩包未跟踪；不能用未跟踪等于没有用户内容。首次基线应先逐文件审阅，包含现行 `docs/00`—`16`（含保留历史用途的 `15`）、十三个原型的源代码/迁移/测试/运行器/README、依赖清单与锁文件、经检查无敏感数据的最终运行及修复证据、来源/保护清单，以及根 `.gitignore` 中有效的保护规则。原型迁移保留在各自目录，不能登记为正式迁移。

排除安装依赖与包缓存（`node_modules`、`.pnpm-store` 等及缓存别名）、数据库目录/数据卷/dump、临时 `.test-results.json`、本轮临时核验文件、机器缓存（如 `.DS_Store`）、编辑器临时文件和凭据/环境文件；密码、连接串、API Key、密钥、真实模型/秘密原始载荷和随机 canary 原文不得入库。报告里的合成来源 ID 与受保护生产数据需区分，不能无审查全量加入日志/Trace。历史 zip（根目录及原型中的归档）建议先排除首次代码基线，确认内容与用途后再决定是否归档，避免缓存/依赖/凭据重复入库；本轮不改 `.gitignore` 或删除这些文件。

正式工程已由本任务授权创建；首次基线方案应将统一工程、正式迁移、测试、依赖锁及本任务采纳的技术契约一并审阅后纳入，仍不自动执行提交。首次基线前核对 Markdown 链接、文件清单与敏感信息，保留用户现有文件；本轮只制定方案，未执行暂存、提交、推送、reset、clean 或远程配置。

### 6.3 原收口轮文档验收记录与首批增量

原收口轮：核实十三个实际目录、README/当前运行报告及关键实现/测试位置，采用 P01 最终锁修复与 P13 审计 Scope 修复后的结论；引用历史执行，不重跑容器。仅新增本文件、最小同步文档地图；文件集合和 SHA-256 保护核验及 Markdown 链接检查使用临时文件，不新增永久报告目录。所有 `01`—`15`、原型（含依赖/报告）、根文件继续只读；未增加第三方组件、业务代码、独立原型或正式迁移。最终静态检查结果随本轮交付说明报告，不将其冒充数据库/模型/规模测试。

首批增量：本任务已创建正式业务工程和首组迁移，真实执行 `pnpm test`，结果单独记录在 `verification/foundation/`；不以此前静态检查或原型通过替代。`docs/00`—`15` 与十三个原型仍只读，根依赖/样例/忽略规则仅在本任务授权范围内新增或调整；Git 未暂存、提交或配置远程。

| 版本 | 日期 | 状态 | 变更摘要、原因、影响与决策来源 |
|---|---|---|---|
| 0.3.0 | 2026-10-20 | 草案 | 第二批第一段完成：正式设计草案/冻结版本与场景任务，记录本段权限、摘要、锁序及升级验收；其余第二批未完成 |
| 0.2.0 | 2026-10-20 | 草案 | 按用户第一批正式实现任务采纳本地 D01/D02 契约，记录正式底座及独立验收，修正首版人工审批/未来自动审批口径；仅更新本文件，其他批次和生产决策仍待评审 |
| 0.1.0 | 2026-10-20 | 草案 | 按用户本轮要求汇总十三个原型当前证据、规范对照、首版建议、四批实施/集成验收及差异门槛；仅参考现行规范，影响文档地图，待作者评审 |

[p01-r]: ../prototypes/time-interval-constraints/README.md
[p01-v]: ../prototypes/time-interval-constraints/verification/runner-result.md
[p01-f]: ../prototypes/time-interval-constraints/result-report.md
[p01-fault]: ../prototypes/time-interval-constraints/verification/runner-fault-verification.md
[p01-m]: ../prototypes/time-interval-constraints/migrations/001_time_interval_fixture.mjs
[p01-t]: ../prototypes/time-interval-constraints/test/time-interval.test.mjs
[p02-r]: ../prototypes/evidence-candidate-constraints/README.md
[p02-v]: ../prototypes/evidence-candidate-constraints/verification/runner-result.md
[p02-m]: ../prototypes/evidence-candidate-constraints/migrations/001_evidence_candidate_fixture.mjs
[p02-t]: ../prototypes/evidence-candidate-constraints/test/evidence-candidate.test.mjs
[p03-r]: ../prototypes/evidence-canon-constraints/README.md
[p03-v]: ../prototypes/evidence-canon-constraints/verification/runner-result.md
[p03-m]: ../prototypes/evidence-canon-constraints/migrations/001_evidence_canon_fixture.mjs
[p03-t]: ../prototypes/evidence-canon-constraints/test/evidence-canon.test.mjs
[p04-r]: ../prototypes/evidence-design-constraints/README.md
[p04-v]: ../prototypes/evidence-design-constraints/verification/runner-result.md
[p04-m]: ../prototypes/evidence-design-constraints/migrations/001_evidence_design_fixture.mjs
[p04-t]: ../prototypes/evidence-design-constraints/test/evidence-design.test.mjs
[p05-r]: ../prototypes/evidence-tool-constraints/README.md
[p05-v]: ../prototypes/evidence-tool-constraints/verification/runner-result.md
[p05-m]: ../prototypes/evidence-tool-constraints/migrations/001_evidence_tool_fixture.mjs
[p05-t]: ../prototypes/evidence-tool-constraints/test/evidence-tool.test.mjs
[p06-r]: ../prototypes/evidence-unified-constraints/README.md
[p06-v]: ../prototypes/evidence-unified-constraints/verification/runner-result.md
[p06-m]: ../prototypes/evidence-unified-constraints/migrations/001_evidence_unified_fixture.mjs
[p06-t]: ../prototypes/evidence-unified-constraints/test/evidence-unified.test.mjs
[p07-r]: ../prototypes/projection-attempt-lifecycle/README.md
[p07-v]: ../prototypes/projection-attempt-lifecycle/verification/runner-result.md
[p07-m]: ../prototypes/projection-attempt-lifecycle/migrations/001_projection_attempt_fixture.mjs
[p07-t]: ../prototypes/projection-attempt-lifecycle/test/projection-attempt.test.mjs
[p08-r]: ../prototypes/projection-checkpoint-publication/README.md
[p08-v]: ../prototypes/projection-checkpoint-publication/verification/runner-result.md
[p08-m]: ../prototypes/projection-checkpoint-publication/migrations/001_projection_checkpoint_fixture.mjs
[p08-t]: ../prototypes/projection-checkpoint-publication/test/projection-checkpoint.test.mjs
[p09-r]: ../prototypes/canon-commit-preconditions/README.md
[p09-v]: ../prototypes/canon-commit-preconditions/verification/runner-result.md
[p09-m]: ../prototypes/canon-commit-preconditions/migrations/001_preconditions.mjs
[p09-t]: ../prototypes/canon-commit-preconditions/test/preconditions.test.mjs
[p10-r]: ../prototypes/canon-commit-atomic-core/README.md
[p10-v]: ../prototypes/canon-commit-atomic-core/verification/runner-result.md
[p10-m]: ../prototypes/canon-commit-atomic-core/migrations/001_canon_commit_atomic_fixture.mjs
[p10-t]: ../prototypes/canon-commit-atomic-core/test/canon-commit-atomic.test.mjs
[p11-r]: ../prototypes/canon-structured-mapping/README.md
[p11-v]: ../prototypes/canon-structured-mapping/verification/runner-result.md
[p11-m]: ../prototypes/canon-structured-mapping/migrations/001_canon_structured_fixture.mjs
[p11-t]: ../prototypes/canon-structured-mapping/test/canon-structured.test.mjs
[p12-r]: ../prototypes/canon-text-supersession/README.md
[p12-v]: ../prototypes/canon-text-supersession/verification/runner-result.md
[p12-e]: ../prototypes/canon-text-supersession/verification/evidence-summary.md
[p12-m]: ../prototypes/canon-text-supersession/migrations/001_canon_text_supersession_fixture.mjs
[p12-t]: ../prototypes/canon-text-supersession/test/canon-text-supersession.test.mjs
[p13-r]: ../prototypes/authorization-safe-context/README.md
[p13-v]: ../prototypes/authorization-safe-context/verification/runner-result.md
[p13-e]: ../prototypes/authorization-safe-context/verification/security-evidence.md
[p13-f]: ../prototypes/authorization-safe-context/verification/audit-scope-repair/reproduction-before.md
[p13-old]: ../prototypes/authorization-safe-context/verification/audit-scope-repair/before/verification/runner-result.md
[p13-compare]: ../prototypes/authorization-safe-context/verification/audit-scope-repair/scenario-comparison.json
[p13-m]: ../prototypes/authorization-safe-context/migrations/001_authorization_safe_context.mjs
[p13-t]: ../prototypes/authorization-safe-context/test/authorization-safe-context.test.mjs
[p13-g]: ../prototypes/authorization-safe-context/lib/tool-gateway.mjs
