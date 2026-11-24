# 第二批第五段：审批契约、失效矩阵与验证边界

本轮在同一 `agent_book` Schema 与账本中新增 [006](../../db/migrations/006_manual_approval.mjs)；不修改 001—005。业务入口见 [README](../../README.md#第二批第五段人工审批与追加失效)，实际场景及 PID/时间见 [运行结果](run-result.md)。文档与实现均限人工候选路径，不是完整小说生成系统或 Canon 准入许可。

## 身份与确认

- session_user 映射实际 author；批准、拒绝、撤回、审批策略发布均要求目标 Novel 的 design.read、design.freeze、task.read、task.create 当前有效。
- 审阅、合法历史与当前检查要求当前 design.read/task.read；auditor 仅 audit.read 元数据；其余运行登录无审批 API 权。校验作者可以同时审批，不保证双人复核。
- 审阅从真实冻结 Candidate/Bundle/Validation/Design/Task/选择关系重建，不复制正文权威源。approval-review-v1 协议与实际审阅摘要持久化。
- approval-jsonb-v1 在 PostgreSQL 18 上按 UTF-8 编码 `approval-jsonb-v1:域` + LF + JSONB text，以 SHA-256 计算 review/request/policy 摘要。请求摘要无重试新 UUID/时间。正文和 Bundle 摘要仍是原实际精确字节 hash。
- 请求须确认真实 review_hash 和完整未检查软项集合（按 UUID 排序、无重复）。只能证明明确提交确认，不能验证实际阅读/理解。没有自由文本理由、任意策略代码、force、score 或客户端 pass 入口。
- 六项技术必需检查及所有实际适用硬约束都必须 passed；failed/必需 unknown/缺明细拒绝批准。软项保持 unknown，不改写为自动通过。完整 failed/unknown 结果可人工拒绝。

## 冻结关系与代次

| 类别 | 实际关系／保护 |
|---|---|
| 七类规范绑定 | Candidate UUID/hash、Bundle UUID/hash、Design Revision、输入水位 0、Validation Run、审批策略版本/Release、真实作者/决定 |
| 额外绑定 | Novel/Workflow/Task、选择历史 UUID/版本、校验 Release/批次、审阅摘要/软项、四项实际支撑 Grant ID/共同截止 |
| 决定 | approve/reject/withdraw 不可变追加，独立 decision_version/CAS、前驱、当前指针与关联子表同事务闭合 |
| 校验批次 | 006 后真实新 Run 生成单调 epoch；不得按时间戳猜当前。005 历史 Run 和原 current_applicable 语义保持，升级后审批须新校验 |
| 原批准 | 不更新 status、不删改；撤回、首条永久失效或后续决定使其不可用；重新批准必须新人工操作 |
| 未选中编辑 | 不移动当前选择，不继承批准；旧批准仍只描述原选中候选 |
| 幂等 | Actor/Novel/operation/Workflow（发布按 Novel）/key；重放重新授权，异请求拒绝，旧决定不移动指针，旧批准不能返回为可用 |

实际支撑在一个数据库判定时间取得完整四项 Grant；共同截止为所有有限截止的最早值。仅四项均明确无限期才为 NULL；少项或期限已过不是无限期。原 ID 撤销/到期后，换发新授权不复活原批准。数据库外键、受控构造、即时冻结与延后完整性共同保护这些关系，不允许客户端盖章。

## 失效矩阵

| 变化 | 同事务处理／检查 | 永久失效原因 |
|---|---|---|
| 当前选择变化，包括 A→B→A | Workflow UPDATE 完成后，检查所有真实绑定并追加首条失效；回滚则全部回滚 | SELECTION_CHANGED |
| 同 Workflow 新 Validation Run | Run 与 epoch/当前校验指针同时追加；005 校验幂等重放不生成新 epoch | NEW_VALIDATION |
| 当前 Task / Design 切换 | 原入口已持 gate，AFTER 实际 DML 检查 | INPUT_CHANGED |
| 安全发布撤销/替代 | 按真实 publication→proposal→Novel 回查后检查；新 Bundle 本身不改旧包 | INPUT_CHANGED |
| 上下文、校验或审批策略发布 | 新 Release UUID/代次即变化；相同内容不恢复旧结果 | POLICY_CHANGED |
| 原 writer 写作/上下文授权撤销 | 回查真实 Grant/Scope/Novel，原 ID 保留，不采用换发 Grant | AUTHORIZATION_CHANGED |
| 实际作者支撑撤销 | 原 capability_grant ID 回查，四项任一撤销即不可用 | AUTHORIZATION_CHANGED |
| 后续批准、拒绝或撤回 | 决定头与历史同时推进；旧批准立即不可用 | DECISION_REPLACED；撤回另有实际关联 |
| 授权时间到期 | 首次有权的受保护检查当次拒绝、幂等写真实发现时间；不依赖后台扫描 | DETECTED_UNAVAILABLE |

本段每个批准保留首条永久失效，不尝试收集其失效之后的全部原因，也不假装提供完整变化对象/trigger_version 多事件归因账本。后续如需要完整归因，应前向扩展；已有首次失效不能删除或清空。统一 `_ap_usable` / `approval:current` 每次重新验证真实选择、校验批次/完整 passed、输入/策略、原两层 writer 授权、原四项作者支撑、当前决定与撤回/失效。`not_commit_permit=true` 明确未来 Canon 必须在自己的提交事务重查。

## 锁、事务与审计

- API 锁序：稳定 authorization gate → Novel → Task → Workflow → 校验 Release → 审批 Release → 审批状态，随后追加决定/明细/审计。发布为 gate→Novel 后追加。所有当前变更入口先持共同 gate。
- AFTER 触发器观察实际 DML 后补失效，不反向请求 Novel/Task/Workflow 锁；不借 BEFORE ROW 假设证明锁序。只承诺已实现入口的保守串行边界，不承诺未来全系统无死锁。
- 真实 COMMIT 完成才交付成功。中途 P0001、延后 COMMIT 失败、外层回滚均独立快照检查所有业务表；已有选择和旧批准也不能被污染。
- 业务拒绝以受控结果提交审计；技术异常回滚，直接 SQL 权限错误单独核验。审计 allow 表示操作获准，不等于批准/检查通过。
- 审计正向检查记录 Novel/Task/Workflow 与实际资源完整归属，跨 Novel、错 Workflow 事件整体过滤，原始引用保留。合法同 Novel 另一 Workflow 的授权历史标识仍可返回，不能把全部来源标识消失当作安全。
- 默认日志固定白名单；CLI 错误、auditor、实际 PostgreSQL 日志和验收报告扫描正文/规则/秘密/凭据。许可 author 审阅正文是受保护业务输出；不宣称自动脱密人工正文。

## 本轮执行与调试记录

- 首次当前路径运行发现撤回内部 SQL 字段歧义（42702），修正限定表字段；审计测试同步区分错误范围事件与合法同作品资源。随后当前路径 6 组/35 子场景全部通过，专属资源清理成功。
- 首次完整 `pnpm test`（run `f24a7eda-9959-449b-944e-0df48c73db45`）旧回归与新 35 子场景均通过，但已有 005 数据升级失败，整体验收退出 1；泄密总扫描尚未完成，未将其宣称为成功。实例及临时资源清理成功。
- 定位升级失败为 55006：已有 Workflow 回填产生待处理延后检查，阻止后续 DDL。将回填移到全部 DDL/触发器创建后；未关闭约束、未修改旧迁移。单独实测升级/故障回滚/重复迁移/真实审批通过，再执行完整回归，最终结果以 run-result.md 为准。
- 旧边界结果是本轮实际重新执行，并复制到本目录 legacy/context/workflow/validation-regression.md；原历史文件保持原字节。控制测试、有效期运行器专项和 Node 顶层/子场景分别统计，不相加成系统覆盖率。

未执行真实模型、自然语言秘密/剧情/人物/文风质量、生产认证/规模/灾备；未实现 Canon、Outbox、Generation、结构化提案、自动审批/修复、约束豁免。本段审批通过不表示这些能力已实现。
