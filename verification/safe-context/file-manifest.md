# 第二批第二段实际文件交付清单

同一正式工程追加 003；不打包凭据、依赖或缓存。文件可直接按下列链接审查；7 个既有文件修改，10 个文件新增。SHA-256 对应本轮最终内容；本清单自身免列摘要，避免自引用。

| 状态 | 文件 | SHA-256 |
|---|---|---|
| 修改 | [README.md](../../README.md) | `18503b03b4629e02682463dabb12eb6251799d9182b9d8f73bed1b125ca871b5` |
| 修改 | [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | `88100ad2f764beadb7e66c07264a0d852bc3b9977f7856004ea4e390a16de06e` |
| 修改 | [package.json](../../package.json) | `f0fd538d59cc15e524f730ce701e99ad2170937206a0eb29fa3f14613f0acc5c` |
| 修改 | [scripts/migrate.mjs](../../scripts/migrate.mjs) | `ecc1d7ba94790551476f40edcc46fabfdfbc18d3696bd4175fe49b9cff886144` |
| 修改 | [scripts/verify-design-task.mjs](../../scripts/verify-design-task.mjs) | `9c1a74461150c4e94415f3778ef5e36a59767c415fdcb02d8a66677c0650f622` |
| 修改 | [src/cli.mjs](../../src/cli.mjs) | `3891cc86350a09f490b7246270fbe5ba4d704bbe353d4a86cb1b92c78756fed3` |
| 修改 | [src/foundation.mjs](../../src/foundation.mjs) | `042b54c306d0920413c21dd4f88f589ddff3f9423c32b2b90094a5bebe43a704` |
| 新增 | [db/migrations/003_safe_context.mjs](../../db/migrations/003_safe_context.mjs) | `590a87bb35c0be9263e44e939ed041c074d5d2a585e8ebd122c59e41ad665618` |
| 新增 | [src/safe-context.mjs](../../src/safe-context.mjs) | `d412e4ca320e497a03847bf246dd7236c6d3c7d8f9b9fb9a98e8d0deeed3b2ab` |
| 新增 | [scripts/verify-safe-context.mjs](../../scripts/verify-safe-context.mjs) | `b54e669aefe83befd03f1a1f57a346373cb2583efbbb3dd7e62631dc4e1b5b51` |
| 新增 | [test/safe-context.integration.test.mjs](../../test/safe-context.integration.test.mjs) | `38da3d06e0ee065e9cba90578c9ac1bae1a1547742bc28d7db303789ad7fbce1` |
| 新增 | [test/support/design-fixture.mjs](../../test/support/design-fixture.mjs) | `566e59294ce39d76261d4042bd931ec03236f64dd59f3c304b3a50194d6718c2` |
| 新增 | [verification/safe-context/workspace-before.json](../../verification/safe-context/workspace-before.json) | `3a0fd11ec9373bf20e2e1faaa2f6231edc20eff7ff2af6bccd580236aef8e41c` |
| 新增 | [verification/safe-context/legacy-regression.md](../../verification/safe-context/legacy-regression.md) | `879970ddddea4a514bab913cea22435f0e189f3d32e2161f70f9de4659859ed7` |
| 新增 | [verification/safe-context/run-result.md](../../verification/safe-context/run-result.md) | `9e08c034f38619130ac5bb2443e44d9c2a856fc71a275af1efdbebc985290168` |
| 新增 | [verification/safe-context/protection-result.md](../../verification/safe-context/protection-result.md) | `6b5d4d137532a65b67060d4c6127b31a4c34192c12a2a60aa4c674b46917c503` |
| 新增 | [verification/safe-context/file-manifest.md](../../verification/safe-context/file-manifest.md) | 自身免列 |

## 运行所需但未修改的审查输入

继续使用原精确版本及锁文件；配置仅为无真实凭据的样例，没有新增秘密配置。

| 文件 | SHA-256（与修复前相同） |
|---|---|
| [config.example.json](../../config.example.json) | `92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce` |
| [provision.example.json](../../provision.example.json) | `3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e` |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | `413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4` |
| [.gitignore](../../.gitignore) | `66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e` |

## 结果与边界

- [本轮 003 迁移、权限及新增验收](run-result.md)：6 顶层／29 子场景，0 失败、0 跳过；包括实际阻塞 PID、数据库期限、真实 COMMIT 故障及持久化审计证据。
- [本轮 002 边界原回归](legacy-regression.md)：第一批 5／45、控制 7、第二批第一段 6／34；另有 9 个运行器独立有效期专项。分别统计，不汇总为系统覆盖率。这里保留的是本轮执行记录副本，历史目录原报告未修改。
- [保护核验](protection-result.md)与[本轮开始前基线](workspace-before.json)。
- 新模块包含有限作者批准投影、正式 Design Evidence 子集和冻结上下文；未实现候选、审批、Canon、模型或整个第二批。
