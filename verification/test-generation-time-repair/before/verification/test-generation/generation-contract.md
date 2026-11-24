# 第二批第六段：测试生成契约与中断边界

正式实现：[007](../../db/migrations/007_test_generation.mjs)、[分阶段执行](../../src/test-generation.mjs)、[固定适配器](../../src/test-adapter.mjs)。命令精确字段见 [README](../../README.md#第二批第六段受控测试生成最小链路)；本轮实际场景/PID/回滚/迁移见 [运行结果](run-result.md)。没有新原型、第二套正文/Evidence/身份或迁移账本。

## 信任与显式授权

| 主体／边界 | 能做什么 | 不能据此宣称什么 |
|---|---|---|
| 初始化管理员 | 测试模式下显式登记真实测试 Novel，初始化单独服务 LOGIN/Actor | 不替代 author/writer 的业务正例，不给普通请求 test=true 入口 |
| author | 四项管理权限发放固定 test_generation_v1、撤销、关闭本 Novel 未决调用；当前 design.read/task.read 追溯合法历史 | novel.read 不导出生成权，不接受任意 actor/role/scope/能力集合 |
| writer | 原授权/输入有效时准备、查询、创建测试 Workflow、调用宿主受控生成、显式中断，以及原候选编辑/选择 | 无服务凭据、无任意 Prompt/响应提交权、无底表/helper/审核/审批权 |
| test-adapter-executor | 真实独立受限 LOGIN，沿用 actor_principal/actor_role/session_user；仅身份自检及固定 start/finish | 不是 writer 身份切换，无 owner/admin/成员关系/底表权限，也无其他业务入口 |
| auditor | 本 Novel audit.read 的真实资源范围元数据 | 不获得请求/响应、正文、Bundle 原文、原始规则或凭据 |
| 其余既有服务 | 保持原权限 | validator、commit、projection 未因本段扩权 |

固定授权绑定真实 context_grant、已有 Task Scope/Novel/Task/writer。四项作者支撑在稳定授权锁内以同一数据库时间取得完整记录；截止为其有限最小值、原上下文截止和请求截止的较早者。缺失/过期/撤销不能变成 NULL 无限期。四类授权 ID 的共同互斥检查覆盖旧表未来 INSERT，不能从反向插入制造歧义。

运行配置与数据库分别防守：mode=test + AB_TEST_MODE=1 是宿主入口条件，数据库另有不可变 test_novel_registration FK；会话参数、test=true 或普通配置都不能将未登记作品变成测试范围。新服务凭据仅由可信宿主管理，不在请求、日志、报告或 writer 响应中；没有生产密钥管理或主机对抗保证。

## 实际请求、响应及输入绑定

- Generation Run 绑定实际 Novel/Workflow/Task/writer/Design/水位 0、固定 Bundle/hash、原两层授权、准备时 selection_id/version、Prompt/Model 配置及协议版本；数据库真实 FK、受控构造和不可变规则保护。
- test-request-v1 是服务器从冻结 Bundle.payload_text 渲染的 PostgreSQL 18 JSONB text UTF-8；只含固定 protocol/provider/model/prompt/parameter/instruction 与获准载荷。没有原始设计/Task goal、秘密补充、客户端消息或检索输入。
- fixed-test-v1 / test-text-v1 实际执行一次确定性代码：固定标记 + 请求 SHA-256 + 固定测试片段。test-response-utf8-v1 保存实际返回的精确 UTF-8/LF；与 Candidate exact-utf8-v1 原字节相等，数据库独立计算正文摘要。
- request_text/response_text、各自 hash/bytes 受保护保存。请求 hash 不去重执行或候选；同输入新请求键仍是新 Generation/Call/Candidate。
- test-bytes-v1 仅是测试字节与实测宿主耗时，真实 token/cost 为 NULL，费用状态 not_applicable_test；没有伪造供应商响应或费用。两秒固定取消信号和数据库开始期限限制接纳。

## 状态与事务

| 关系／状态 | 持久化事实 | 后续规则 |
|---|---|---|
| prepared / dispatch_not_recorded | 准备事务冻结执行输入、实际渲染请求、单次 Call 计划、幂等记录，真实 COMMIT 完成 | 计划不等于已经调用；重放不自动继续 |
| started_result_unknown | 唯一 start_id、真实服务主体、数据库开始时间/期限已提交 | 这记录领取/派发边界，不能仅凭缺响应证明从未调用 |
| model_call_result | 实际观察到的成功/适配器失败/超时/技术异常、可能的真实响应、摘要及计量 | 从首次写入不可变；与候选接纳是两个概念 |
| accepted | 结果、真实来源 Candidate、执行终态、成功审计同事务提交 | 至多一个候选，不自动选择，不继承校验/审批 |
| input_rejected | 调用事实保存，但原授权、输入或选择版本失效 | 没有可用候选，不能向失权 writer 返回响应正文 |
| adapter_failed / technical_failed | 失败事实或接纳技术失败明确记录 | 不重写失败；新尝试必须新执行/调用身份 |
| interrupted | 当前有权 writer 或本 Novel 四项管理权限 author 显式终止 | 不覆盖原终态，迟到响应可留事实但不能生成候选 |

锁序为 gate→Novel→Task→Workflow→追加记录；准备、领取、最终接纳是独立短事务和连接，固定适配器在连接关闭后运行。只读 author 历史使用 gate/Novel 范围检查，不反向取得业务锁。没有覆盖适配器的长事务，也不依赖 BEFORE ROW 必然先于目标行锁。

接纳重查实际 writer、原测试生成/上下文 Grant、Task/Design、Bundle 原字节/hash、发布/上下文策略和准备选择版本；固定 Prompt/Model 在本段不可变，未开放任意策略发布。A→B→A 仍是不同版本而拒绝。调用期间的真实撤销/输入变化可在另一连接提交；实际响应继续保存，不能以准备检查作永久许可证。

## 中断与恢复矩阵

| 中断点 | 保留的证据／处置 | 禁止行为 |
|---|---|---|
| 准备 COMMIT 后、调用前 | prepared；同键只查状态，显式中断后新键尝试 | 不把同键重放当新调用 |
| 已领取／调用已开始但无响应 | started_result_unknown；关闭原执行，无法确认的事实保持未知 | 不推断从未调用、不伪造响应或执行成功 |
| 响应已产生、最终事务未提交／进程被杀 | 已观察响应可在独立受控事务记录；丢失响应时保留未决，不重新计算后冒充原观察值 | 不用回滚审计声称持久化，不复用终态产生候选 |
| 接纳中途或 COMMIT 技术失败 | 独立事务保存真实观察结果并记录 technical_failed；没有半候选/成功审计 | 不自动重新调用 |
| 连独立记录事务也失败 | CALL_RECORDING_UNCONFIRMED，保留可查的既有执行/开始记录，需可信处置 | 不声称失败事实已持久化 |
| 接纳提交但 CLI 未收到响应 | 同键返回既有状态/结果，候选不重复 | 不再次调用，不重新移动选择 |
| 中断之后迟到结果 | 第一次真实观察结果可保存，但原 interrupted 保持 | 不再接纳，不恢复终态 |

不承诺数据库外调用恰好一次。数据库保证候选至多接纳一次，稳定 gate、唯一 Generation/Call/Candidate、不可变终态及延后闭合共同保护。技术错误与业务输入拒绝分开；完整失败事实可以 ok=true 表示保存成功，同时 admission_state=rejected，绝不表示生成成功或获准提交。

## 来源、历史与审阅兼容

test_generated 复用 candidate_version，通过真实 Generation/Model Call FK 关联实际成功响应；普通 writer 人工入口不能伪造这些字段。人工编辑使用真实同 Workflow 前序，继承 test_root_generation_id，不伪造新的调用或改写原正文。原 edited_by 列对生成记录仅为实际请求 writer 归属；真实执行主体另外记录，origin 清楚区分人工和测试生成。

新候选不自动选择。选择测试候选后可运行 005 有限检查及 006 人工审批；必需 hard unknown/failed 仍阻断。测试生成授权撤销同事务追加既有批准的失效记录；未选中编辑不改变旧选择/批准。新审阅 approval-review-test-v1 包含测试来源，旧 approval-review-v1 按原协议重建，不向旧摘要载荷添加字段。升级专门比较旧审阅精确字节并检查旧批准仍可用。

审计分别核对记录和实际引用资源的 Novel/Task/Workflow；越界事件整体过滤、原引用保留。合法历史、无资源事件及授权标识仍可见；不以所有来源标识消失证明安全。测试写作、审阅和审计结果明确 provider=test/test_only；普通日志及错误不含载荷。

## 实测与范围

[运行报告](run-result.md) 包含实际环境/镜像、逐场景结果、具体阻塞 PID、数据库观察时间、真实 COMMIT 故障与回滚、ACL、升级和泄密扫描。故障模式由可信测试宿主/数据库故障设施注入，不能由 writer 请求启用；不是外部供应商故障或真实模型验证。真实子进程在响应产生后被终止，缺响应状态未被伪装为未调用。

旧回归按 002/003/004/005/006 边界真实执行，控制测试与有效期独立阶段分别统计；不将历史报告冒充本轮执行，也不相加成系统覆盖率。001—006 和全部原历史验收受本轮独立基线保护。

未执行真实模型/网络、自然语言质量/秘密语义、生产安全/规模/灾备；未实现自动重试、流式、工具调用、结构化提案/Assertion、相关 Evidence 全域整合、Canon/Outbox/投影。整个第二批仍未完成，测试来源不能宣称生产 Canon 准入。
