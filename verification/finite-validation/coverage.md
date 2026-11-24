# 有限校验覆盖与绑定契约

本轮真实命令为 `pnpm test`，最终结果见[运行记录](run-result.md)。旧回归为本轮执行副本，按 002、003、004 边界分别记录；所有旧迁移、旧断言及历史目录保留。

| 检查 | 固定实现 | 输入与结果 |
|---|---|---|
| selection_binding | finite-check-v1 | 实际 Workflow/Candidate/选择历史与预期；缺选择/过时请求拒绝执行 |
| body_protocol | finite-check-v1 | 实际 exact-utf8-v1、UTF-8 字节与独立 SHA-256 |
| input_bindings | finite-check-v1 | Novel/Workflow/Task/Design/Bundle/writer/水位 0 的真实关系 |
| writer_authorization | finite-check-v1 | 实际 writer 两层授权、范围、期限、撤销与 Bundle 当前性；不冒充 writer |
| bundle_payload | finite-check-v1 | 实际冻结载荷的 UTF-8 hash/字节数 |
| review_bytes | finite-check-v1 | 固定策略单候选 65536 字节覆盖上限；超限 failed，不是 token 限制 |
| 每项适用设计约束 | author-rule-unimplemented-v1 | 从 Design 范围及 Task 引用并集推导；自由文本 hard=unknown 必需且阻断，soft=unknown 非必需且明确未检查 |

必需 failed→整体 failed；否则必需 unknown→整体 unknown；全部必需 passed 才整体 passed。正常保存完整 failed/unknown 是业务结果；技术异常回滚，不伪造已完成 Run。审计 allow 表示执行操作获准，不表示结果通过。没有客户端结果、关键词剧情判断、snippet 定位、语义安全或自然语言零泄密保证。

Run 固定真实 Candidate 身份/hash、选择历史 ID/版本、Novel/Workflow/Task/Design/Bundle/hash/writer/水位、必需标志集合/摘要、结果摘要、Release、代码版本和实际 author/数据库时间。FK 与延后检查重建真实集合并验证完整性，冻结后禁止补写、改删或 TRUNCATE。最多 112 项总检查，超限整笔拒绝，不丢项。

validation-jsonb-v1 固定 PostgreSQL 18 JSONB text/UTF-8；request、check-set、results 分域 SHA-256。正文仍 exact-utf8-v1 原字节，不 trim/换行转换/Unicode 规范化；无模型 token、Generation、审批或 Canon 记录。

统一 `_val_applicable` 由 history/current/重放共用。当前性与历史 overall 分开；后续审批必须同时要求当前且 overall=passed。本段 approval_implemented=false。选择 ABA、新 Candidate、Task/Design/Bundle/授权/发布/上下文策略变化，或相同内容的新 Validation Release 身份，均不能复活原结果。未选中新编辑不改变原选择，原校验仍只覆盖原 Candidate。

锁序 gate→Novel→Task→Workflow→Release；真实 author 用现有四项管理能力触发，执行者记录 author，检查器另记 finite-validator-v1。writer 无查询/执行权，validator/commit/projection 仅保留既有身份自检。author 当前 design.read/task.read 查完整合法历史；auditor 只有本 Novel 执行元数据，实际引用资源的 Novel/Task/Workflow 分别核验。

实际并发、具体阻塞 PID、数据库期限、独立持久化回读、COMMIT/外层回滚、权限 ACL 和全通道扫描见[运行记录](run-result.md)。正例从全新设计开始明确没有 hard 约束；负例的 hard 无需显式 Task 引用，也必须从真实 Design 推导并阻断。没有删除既有夹具规则或修改旧断言。

本段无人工审批、真实模型、人物/秘密/文风语义检查、结构化提案、Canon/Outbox/投影、自动修复、强制豁免；整个第二批未完成。
