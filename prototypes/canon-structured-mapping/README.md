# 结构化 Canon 对象与 Candidate-to-Canon Mapping 原子提交

本原型承接首次正文提交，验证冻结提案、确认依据、正式正文 Evidence、三类 Canon 对象、Item、Mapping、成功水位与全部必需 Outbox 的同事务关系。它只验证有限夹具的来源、门禁、内容转换与数据库完整性，不判断自然语言真实性，不证明完整小说叙事语义或长期写作不会漂移。

## 规范对应与边界

| 规范 | 本批对应实现 |
|---|---|
| DOC-08 §2.4—2.10、§3—4 | 候选提案先校验/审批；新建 Canon 对象；提交事务内复核；完整请求幂等；所有输出同事务 |
| DOC-09 聚合/来源关系、DOC-10 候选/Canon/证据目录 | Candidate 与 Canon 分表；Assertion 是来源记录，Evidence 证明正文来源，二者不能自行使提案成为客观事实 |
| DOC-11 INV-CARDINALITY-001/002、TX-VALIDATE-001、TX-CANON-001 | 一个 Candidate、一份正文、零到多个结构化对象；每对象有 Item；Mapping 和来源完整 |
| DOC-12 §3.2、§3.3 | 三类提案、三类 Canon、四类 Item 目标支撑、Mapping 来源 XOR、正文 Canon Evidence 来源、正式六字段 Evidence 去重 |
| DOC-13 摘要规则及 Canon 原子步骤 1—18 | 分离正文/Assertion/对象/Validation/请求摘要；项目锁；真实水位；内容转换/映射回查；全部 Outbox |
| DOC-14 不可变与重放规则 | 冻结输入、原审批和成功历史不可覆盖；新集合使用新 Candidate；历史成功请求优先重放 |
| DOC-15 空库与提交边界验收方式 | 固定版本临时数据库、真实 TCP 就绪、即时与真实 COMMIT 失败区分、独立连接及阻塞 PID |

未发现影响本批正确性的实质规范冲突，没有修改正式文档。DOC-15 的环境描述是历史计划，本次按用户指定继续固定 PostgreSQL 18.6，不改变数据库产品/生产部署决策。

仅支持单 Canon 主分支、首次正文、三类一提案一目标转换：

| 来源 | 新目标 | 字段转换与限制 |
|---|---|---|
| candidate_event | story_event | event_key、subject、predicate、object_ref 原样转换；时间引用必须为 SQL NULL |
| candidate_fact_proposal | canon_fact | fact_key、proposed_value→fact_value、effective_scope 原样转换；active_from_sequence 为本次成功序号；只新增此前不存在的项目/key/scope |
| candidate_state_transition | state_transition | entity、dimension、transition_key、to_value 原样转换；from_value 必须为 SQL NULL；只初始化无历史状态的项目/entity/dimension |

本轮不允许事实覆盖/替代、历史状态变更、非空时间引用、正文修订、Temporal Relation、未知请求字段或未知提案类型。明确拒绝，不能忽略后返回成功。类型转换固定为 fixture-conversion-v1，并进入校验与提交摘要。Fact 提案的额外 subject_entity_id 用于确认依据匹配，Canon Fact 采用规范的项目/key/value/scope 字段。

## 文件、环境与运行

独立 Schema：`canon_structured_fixture`。迁移完整复制必要准入和原子正文代码后适配，没有运行时访问旧 Schema，也没有复制完整四域 Evidence。

```sh
pnpm install --frozen-lockfile --ignore-scripts --offline
pnpm prototype
node verification/verify-protected.mjs
```

固定 `node-pg-migrate@9.0.0`、`pg@8.23.0`、`postgres:18.6`，使用已有缓存离线安装，无升级。实际版本、镜像 RepoDigest、Node/pnpm/Docker、TCP 端口、READ COMMITTED、迁移/测试/最终退出码及清理见 [运行报告](verification/runner-result.md)。[交付清单](verification/file-manifest.txt) 列出实际新增及根 .gitignore 修改；[保护核验](verification/hash-validation.txt) 比较前后路径与 SHA-256。

运行器沿用已验证模式，只适配名称、路径、Schema 和范围声明。启动本轮独占容器，随机密码与 localhost 随机端口，通过宿主机 TCP SELECT 1 的有限就绪检查，新建空库迁移、执行测试并验证本轮结果结构；始终清理本轮容器及临时结果、保存报告，失败状态不会被成功清理覆盖，不全局清理 Docker。

## 冻结集合与校验

完整提案先写入三张 Candidate 表，Assertion、来源支撑和确认依据先存在，再调用 `freeze_candidate(candidate_id)`。它数据库回查当前完整集合，生成 candidate_submission_manifest，记录实际内容及摘要。空集合也生成明确的 members=[] 清单。

清单按提案类型和稳定 ID 以 C 排序保存：类型/ID、实际提案字段及重算 object_hash、完整 Assertion/来源支撑、确认依据和观察记录。冻结入口还核对全部 Candidate Assertion 都有正确来源。直接 INSERT 清单也必须等于数据库实际集合及其摘要，不能伪造空集合。

第一次 Validation 必须已经冻结，校验输入函数与 INSERT 守卫都会核对。冻结后普通 INSERT 不能再增加该 Candidate 的提案、Assertion、来源或确认依据；UPDATE/DELETE/TRUNCATE 始终拒绝。变化必须创建新 Candidate、新 Validation、新 Approval，即使正文相同。输入写入与冻结共用 Novel→Workflow/历史→Candidate 的稳定锁，不能在读取集合后无锁追加。

Validation、普通人工审批、提交均绑定具体 Candidate。审批保留规范七项绑定，不增设可替代归属的 Workflow 字段；有效性实时由当前选择、版本、输入、Validation、规则/策略及失效记录共同决定。ABA 保留失效，不恢复旧审批。当前 Canon 水位仍只来自本项目成功 Commit 的最大序号，无成功记录为 0，没有可独立设置水位的 baseline 接口。

## 最小确认规则与 Assertion 来源

narrative_assertion 保留实际 assertion_payload、直接观察/谎言/传闻/未知类型、正文来源 hash、字符 locator、自身 hash、摘要和抽取器版本；narrative_assertion_candidate_source 是同 Candidate 的真实来源支撑。locator 使用 0 起始、end 不含的 PostgreSQL 字符区间，quote 必须精确等于实际正文切片；不是字节偏移。

fixture_world_record 是明确的隔离测试观察依据，固定 fixture-observation-v1，绑定项目、真实 Entity、predicate、实际 JSON value 和数据库 hash。assertion_confirmation_basis 必须引用这条记录，按 fixture-confirm-v1 检查：Assertion 是 direct_observation、项目相同、Assertion payload 与记录的 subject/predicate/value **全部相同**。

三类提案还必须匹配所属 Assertion 的 subject/predicate/value：Event 的 value 为 object_ref；Fact 为 proposed_value；State 为 to_value，predicate 为维度身份。提案、Assertion、Entity、维度和项目关系分别核对。确认依据 ID、Assertion hash、观察记录 ID/hash 形成不可变 basis_hash，并进入冻结集合。

谎言、传闻、未知或无依据的陈述即使 Validation 夹具结果为 pass，也不能获得普通人工批准/提交资格。一个客户端 confirmed=true、Assertion 存在或置信度不能替代该依据链。观察记录本身是测试输入，不是已实现的作者授权服务或自然语言事实判定器。

## 五种摘要与请求规则

`digest_text` 是实际 UTF-8 字节的 SHA-256、小写十六进制。JSON 摘要使用 PostgreSQL 18 JSONB 的 ::text 编码；数组顺序、对象规范化及版本字符串属于本夹具协议，不宣称跨数据库通用编码。

| 摘要 | 实际输入 |
|---|---|
| Candidate content_hash | 实际正文 UTF-8 |
| Assertion assertion_hash | `[fixture-assertion-v1, 实际 Assertion 行去除 assertion_hash]`，包含 locator、payload、来源正文 hash 和版本 |
| Proposal object_hash | `[fixture-proposal-v1, 提案类型, 实际提案行去除 object_hash]`；包含具体提案/Candidate/Assertion 身份和实际业务字段 |
| Validation input_hash | `[validation-structured-v1, 原正文/Task/Bundle/Design/Canon/规则输入摘要, 冻结清单 hash, 数据库实际清单, fixture-conversion-v1]` |
| Commit payload_hash | `[canon-structured-request-v1, 项目, 规范化请求, 数据库不可变输入对象]`，完整包括冻结集合、所有来源/确认记录及转换版本 |

观察记录 hash 对实际行去除 record_hash 后计算；确认 basis_hash 对规则版本、依据 ID、Assertion hash、观察记录 ID/hash 计算。所有摘要数据库计算或重算核对，正文摘要、Assertion 自身摘要、来源正文摘要和提案摘要不混用。测试使用五种不同实际值，并分别验证错误替换。

请求为继承的首次正文契约，structured_outputs 改为类型/ID 数组：

```json
{
  "digest_spec_version": "canon-structured-request-v1",
  "mode": "initial_text",
  "workflow_id": "真实 Workflow ID",
  "candidate_version_id": "真实 Candidate ID",
  "selection_version": 1,
  "approval_id": "真实 Approval ID",
  "input_canon_watermark": 0,
  "canonical_text_identity_id": "真实正文身份 ID",
  "projection_config_id": "fixture-targets-v1",
  "structured_outputs": [
    {"type": "candidate_event", "id": "真实提案 ID"}
  ]
}
```

提案元素必须恰为 type/id，只允许三类来源；按类型、稳定 ID 以 C 排序规范化。同集合换序摘要相同；重复同类型/ID 显式 duplicate_proposal，绝不静默去重。不同类型允许相同文本 ID，用于体现类型身份，正常 Canon 写入生成新的 UUID。

新请求的集合必须与 Validation 覆盖的冻结集合精确相等。客户端不能传转换后的事实值/状态值覆盖数据库提案内容。摘要继续覆盖 Candidate 正文、Workflow/请求选择版本、Task/Bundle、Approval/Validation 及绑定、Design/规则/审批策略、预期输入水位、目标正文身份和不可变必需目标配置；不加入重放时的当前选择/当前水位/当前失效记录。

同项目/key 同摘要优先重放原全部输出，即使水位、选择、审批已变化；异摘要拒绝。原失败事务没有持久记录，同 key 可重试。新请求仍实时重查全部当前资格，不自动重基陈旧输入。

## Evidence、对象、Item 与 Mapping

正文 Item 的 target_type 是规范的 canonical_text；实际正文实体是 canonical_text_version，二者没有合并术语。每个 Commit 恰有一个正文 Item，使用部分唯一索引 one_text_item；已移除对全部 Item 的 UNIQUE(canon_commit_id)。Item 总数为 1 + 冻结提案数。

每个结构化提案生成独立的新 Canon 对象、一个 Item、一个 Mapping。Mapping 通过 canon_commit_item_id 到达目标，不能用裸 Canon 目标 ID 代替；Item.source_mapping_id 与 Mapping 的 Item 外键双向一致。正文 Item 无需也不允许伪造提案 Mapping。

四类 Item 支撑表合计必须恰一行，支撑类型/ID、实际 Canon 对象/项目/Commit、源提案转换值都精确匹配。Mapping 的 Candidate、源提案、Workflow、Commit 和 Item 一致；candidate_object_hash 是重算提案摘要，candidate_content_hash 是重算所属正文摘要。来源支撑为单独表，三类 FK 列 num_nonnulls=1；来源类型、对象 ID 与实际非空 FK、Mapping 都一致。

Evidence 只实现本批需要的 Canon 正文来源，指向本次新正文版本：source_version_id 与 source_object_id 必须都是正文版本 ID，不能用 Commit ID；evidence_canon_source 同时通过 FK 连接正文版本和本 Commit。实际 quote/字符 locator 必须匹配对应 Assertion 和新正文。

Evidence 使用规范六字段唯一身份 `(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind)`；仅有一个来源支撑表且父 ID 为主键，提交前检查存在，形成恰一来源。相同正文片段可由多个对象共享，正常混合提交只建一份该片段 Evidence。未被对象使用的额外 Evidence 也不能进入本批输出。Evidence 证明正文来源，不独立证明客观事实成立。

## 事务、数据库防绕过与 Outbox

锁序保留 Novel→Workflow/选择历史→Candidate→Approval→Validation→正文身份/Canon 目标，同层稳定 ID 排序。提交函数在同一调用事务完成：项目锁与幂等判断、实时准入/冻结集合/初始业务范围复核、正文、Evidence、Canon 对象、Item/目标支撑、Mapping/来源、成功序号及审批失效审计、全部 Outbox。随后由调用方真实 COMMIT。

所有相关表具有普通 DML 守卫和不可变保护。跨表完整性使用 DEFERRABLE INITIALLY DEFERRED 约束触发器，在真实 COMMIT 处核对完整集合、数量、归属、类型、ID、摘要、实际转换值及关系。合法完整的直接 DML 正例可以提交，不能通过禁止所有变化冒充实现。缺正文/支撑的循环 FK 仍保留其实际失败阶段。

成功 Commit 保存数据库在 INSERT 守卫写入的 created_transaction xid8；核心及新增输出的 INSERT 必须属于创建该 Commit 的同一数据库事务。因此后续普通 INSERT 不能给历史 Commit 增加对象、Evidence、Item、Mapping 或来源。该值来自 pg_current_xact_id()，不是客户端会话授权开关；核心记录不可修改，不能把旧值改成当前值。创建事务内的非法追加仍由完整集合检查拒绝。

所有函数固定 `pg_catalog, canon_structured_fixture, pg_temp`，没有 SECURITY DEFINER。保护针对正常启用触发器的普通 DML，不宣称抵抗数据库所有者关闭触发器或修改 Schema。

数据库配置仍强制 fixture_graph/fixture-graph-v1、fixture_vector/fixture-vector-v1 两类目标。事件为 fixture_canon_structured_committed_v1，除原项目/Scene/正文/成功水位/请求摘要外，还保存 fixture-complete-output-v1 清单及 output_hash：实际 Canon 字段、全部 Item/目标、Mapping/来源、Evidence/来源及可恢复正文版本身份。输出集合排序后计算事件摘要；它不再仅表示正文变化。缺目标、多目标、事件/范围/策略/摘要错绑都不能持久化。不创建 Projection Task/Attempt 或调用外部存储。

函数 result=created_in_transaction 或 replayed，含 requires_outer_commit=true、原 Commit/正文/Item/Outbox 身份及完整输出清单；函数返回不等于外层事务持久成功。COMMIT 异常不得被转成成功响应。

## 错误与失败阶段

业务拒绝为 P0001，constraint 与原因标识一致；FK/唯一/CHECK 保留实际 23503/23505/23514。报告区分 INSERT、审批、提交入口及真实 COMMIT；提前被保护拒绝时不关闭约束伪造前置状态。

| 类别 | 主要标识 |
|---|---|
| 冻结与请求 | candidate_set_not_frozen、candidate_set_frozen、frozen_manifest_mismatch、frozen_set_changed、request_frozen_set_mismatch、proposal_set_entry、duplicate_proposal |
| 来源/确认 | assertion_source_hash、assertion_actual_hash、assertion_source_candidate、assertion_source_missing、proposal_assertion_candidate/content、proposal_actual_hash、confirmation_rule_mismatch、proposal_confirmation_missing |
| 范围 | event_time_not_supported、state_history_not_supported、fact_initial_only、state_initial_only |
| 实时提交资格 | stale_canon_watermark、admission_approval_invalidated、admission_selection_version_conflict、admission_approval_candidate_identity 等 |
| Item/Mapping | commit_item_count、item_target_cardinality/type/id、mapping_source_missing/type/id、mapping_candidate_workflow、mapping_object_hash/content_hash、item_mapping_missing、mapping_item_backref、mapping_frozen_set、text_item_mapping_forbidden |
| 实际 Canon/Evidence | canon_object_scope、canon_conversion_content、canon_source_identity_reused、evidence_source_missing/scope、evidence_locator、evidence_unused |
| 历史与幂等 | historical_output_append、immutable_表名、commit_idempotency_conflict |

## 五组验收与回滚证据

实际数量来自 [运行报告](verification/runner-result.md)，顶层与参数化子场景分开统计，不把每次断言重复算作新场景。本次 5 个顶层测试、112 个参数化子场景全部通过：A 7、B 26、C 54、D 6、E 19；迁移、测试和最终退出码均为 0，临时容器及结果文件已清理。

| 分组 | 验收内容 |
|---|---|
| A | 空集合；三类单独；两 Event 加 Fact/State 混合；独立连接读取完整内容；集合换序重放与重复提案拒绝 |
| B | 冻结追加/伪清单、第一次 Validation、同正文不同 Candidate/集合、旧 Validation/Approval/提案、确认规则、真实来源/跨项目、五种摘要与错误替换、Fact/State/Event 范围 |
| C | 合法完整直接 DML；缺 Item/目标/Mapping 来源/Evidence 来源；类型/ID 独立反例；实际 Canon 值漂移；项目/Workflow/Candidate/双向关系；XOR；正文 Item 无 Mapping；Evidence 去重；不可变 UPDATE/DELETE/TRUNCATE |
| D | 正文与 Evidence 后、部分 Canon 对象后、第二条 Outbox 故障；Item/Mapping 不完整的真实 COMMIT；函数返回后 ROLLBACK；同 key 恢复后重试 |
| E | 同请求 A COMMIT 后重放/A ROLLBACK 后新提交；不同结构化摘要冲突；不同 key 同水位竞争；当前选择/审批/ABA；历史全输出重放；后续 INSERT 不能扩充历史；不同项目首轮并发；实际函数路径、索引和触发器 |

类型反例使用不同类型、相同文本 ID；ID 反例保持类型相同，引用两个真实对象。测试先断言真实 FK 目标、XOR 和类型/ID 条件，全部 INSERT 通过即时约束后才执行真实 COMMIT；报告保存这些前置断言的实际数据及最终 SQLSTATE/约束。没有用悬空 FK 替代这两类反例。

故障设施仅在测试中创建，finally 删除触发器和函数；不增加提交入口故障开关，不关闭业务约束。异常 detail 记录所属 Commit 的正文/Evidence/对象/Mapping/Outbox 已写数量，证明故障发生位置。回滚验证使用新的独立连接，既比较项目当前正文、水位、提交、审批失效与审计，也逐表比较 15 张输出表的全库前后物理行数，避免只经 Commit 关联查询而遗漏孤立残留。既有其他项目数据保持不变。

并发使用三个独立直连连接，先取 PID，再启动等待查询；观察 pg_stat_activity 的 Lock 和 pg_blocking_pids 确认实际 blocker 后释放 A。连接 5 秒、语句 8 秒、锁 6 秒、阻塞观察 4.5 秒，显式 READ COMMITTED、search_path=public、全限定业务对象。没有随机 sleep 猜竞争或死锁重试。报告保留阻塞 PID、等待事件/时间、释放方式和全部输出身份。

## 保护与剩余限制

修改前生成保护清单；最终重新枚举比较 SHA-256、路径集合、新增、遗漏、重复路径，单独比较 .gitignore 原字节加唯一指定行。保护 docs/00—15、全部十个既有原型、根依赖及其他仓库文件；排除 .git、node_modules、本新增目录及指向它的缓存别名，按初始口径跟随旧缓存符号链接。数量按路径计算，多个别名不代表多个物理文件，没有重建初始清单掩盖差异。

本轮没有剩余验收阻断。未执行 Git 暂存、提交、推送、reset 或 clean；本轮验收完成后停止。仍未实现正文修订/替代/反向/补偿、完整 Assertion 确认工作流、时间区间与完整状态演算、冲突自动合并、全四域 Evidence、真实权限/Agent/界面/生产 Schema/外部投影。观察依据和硬规则是明确的有限夹具，不外推为所有结构化叙事语义已经验证。
