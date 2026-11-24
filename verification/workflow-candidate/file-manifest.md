# 第二批第三段：实际交付文件与摘要

7 个既有文件最小修改，11 个新增；本清单自身免列摘要，避免自引用。根 package、README、DOC-16 均列入，必要配置保持原样；不包含真实凭据、依赖或缓存，不创建 ZIP。

| 状态 | 文件 | SHA-256 |
|---|---|---|
| 修改 | [README.md](../../README.md) | `755c783819797ed39af5a02ca020843093be8d38826acf88685f1e05ad53ad92` |
| 修改 | [package.json](../../package.json) | `b8659c2ed0f6e3230ba06c635d5c15403fa6898a780e9f9b649093c7ed6bd294` |
| 修改 | [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | `4216cee110744ee69982a498431f418508e9a29da2781bafe33eccb514d3143a` |
| 修改 | [scripts/migrate.mjs](../../scripts/migrate.mjs) | `107dff276970c0e2e884f5aecdd651f471b9bbc94d93c74aaeb6f0240962f5bc` |
| 修改 | [scripts/verify-safe-context.mjs](../../scripts/verify-safe-context.mjs) | `890a47f01dfd4eb0209a30288ddb0cd3a3495b72531bdc05f563d2047539ae0c` |
| 修改 | [src/cli.mjs](../../src/cli.mjs) | `91dc6593ce1d581bfdb398f24d84f64f891156202b8a4cd19fbbade71c29b74a` |
| 修改 | [src/foundation.mjs](../../src/foundation.mjs) | `dcaf9167b41897443afc61df8bd79fdf616798a26fd6d4381699a4fcface8c7b` |
| 新增 | [db/migrations/004_manual_workflow.mjs](../../db/migrations/004_manual_workflow.mjs) | `5429bafb3a5b148291981efd1107037190bb3f9419d81624fffa085c2c1d13d4` |
| 新增 | [src/manual-workflow.mjs](../../src/manual-workflow.mjs) | `b73f034489dee18744b3d3c5bb74c300cd40adc57bb858c2f1600b8e888184de` |
| 新增 | [test/support/context-fixture.mjs](../../test/support/context-fixture.mjs) | `65e588144dff17b0065588f42cf6da8f29a11fdcead1df538da28e7aa462581f` |
| 新增 | [test/workflow-candidate.integration.test.mjs](../../test/workflow-candidate.integration.test.mjs) | `bf316e2972f8807663d663422f9b0cf2cf4c2897d956bd4b12b1f2cd8b78f5ef` |
| 新增 | [scripts/verify-workflow-candidate.mjs](../../scripts/verify-workflow-candidate.mjs) | `cf1c4d4e1710399dec148ba8a005bb10b4c46c158212c7f477fca787bfe8bfa6` |
| 新增 | [verification/workflow-candidate/workspace-before.json](../../verification/workflow-candidate/workspace-before.json) | `3be779c25b606bc1bb53d679d0eed57de954c188bcaca94cbb04a884bbb18b41` |
| 新增 | [verification/workflow-candidate/run-result.md](../../verification/workflow-candidate/run-result.md) | `7e96b7ac76ff5e56ad7eb096ba4550194974017626030fb926c019c621fa1402` |
| 新增 | [verification/workflow-candidate/legacy-regression.md](../../verification/workflow-candidate/legacy-regression.md) | `b3f0613cd430cc7ac6a928a5afe53fbcc06291bb237125841a258daada05d9b8` |
| 新增 | [verification/workflow-candidate/context-regression.md](../../verification/workflow-candidate/context-regression.md) | `768b874accd1bddb5c94c0998823ae7292f5b81152ddeea852ea063860024a26` |
| 新增 | [verification/workflow-candidate/protection-result.md](../../verification/workflow-candidate/protection-result.md) | `6dd36fe9d6435c87dbd48996eeb9a6501c35c72181180ca5b70eeea32f491264` |
| 新增 | [verification/workflow-candidate/file-manifest.md](../../verification/workflow-candidate/file-manifest.md) | 自身免列 |

## 必要但未修改的运行输入

| 文件 | SHA-256（与本轮前相同） |
|---|---|
| [config.example.json](../../config.example.json) | `92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce` |
| [provision.example.json](../../provision.example.json) | `3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e` |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | `413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4` |
| [.gitignore](../../.gitignore) | `66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e` |

## 已执行证据与契约

- [本轮 004 验收](run-result.md)：空库 001→004，已有 003 数据升级/失败整体回滚/重复迁移；新 6 顶层／29 子场景，0 失败、0 跳过。
- [本轮 003 边界回归](context-regression.md)：6 顶层／29 子场景；[本轮 002 边界回归](legacy-regression.md)：第一批 5／45、控制 7、设计任务 6／34，另有运行器独立有效期专项 9。各自为本轮真实执行副本，原历史目录不改写，不合并计数。
- [保护核验](protection-result.md)与[本轮开始前基线](workspace-before.json)。
- 授权：真实 author 的四项管理支撑＋原 context_grant→固定 manual_workflow_v1；捕获实际有效支撑并继承最早有限截止。普通 novel.read、上下文权均不足；原撤销命令支持新授权，三类 Grant ID 双向无歧义。
- 人工来源：manual_input_v1 固定同 Novel/Task/Design/writer/Bundle；human_input 与同 Workflow 前序的 human_edit 产生不同身份，没有 Generation 或 Candidate Evidence 占位。
- 正文：exact-utf8-v1 保存精确 UTF-8，不 trim/改换行/Unicode 规范化；数据库重新 SHA-256，262144 字节保护上限。同正文也可新身份，默认日志不含正文，人工输入不自动脱密。
- 选择：独立 selection_version 从 0 递增；CAS＋当前指针/历史同事务，ABA 新版本；稳定请求重放仍授权且不重新移动指针。gate→Novel→Task→Workflow；真实 COMMIT 后才交付成功。
- 历史：失效输入下 writer 创建/写入/选择/读取/重放拒绝；author 当前 design.read/task.read 可追溯正文，auditor 的 Novel audit.read 仅执行/选择审计，逐项检查实际资源范围。
- 精确 CLI 字段及支持边界见[README](../../README.md#第二批第三段人工-workflow-与不可变-candidate)；[DOC-16](../../docs/16-prototype-consolidation-and-implementation-plan.md#42-第二批设计安全-bundle候选校验人工审批)保持 0.5.0 草案，仅标记第二批第三段完成，整个第二批未完成。
