# 第二批第一段交付文件清单

本轮新增/修改均为工作区中的实际文件，不另行打包。未包含真实凭据、node_modules、缓存或临时结果。初始工作区已存在的未跟踪文件不等于本轮新增。

| 状态 | 文件 | SHA-256 |
|---|---|---|
| 修改 | [README.md](../../README.md) | 2352b2ad5b67c4463ded44c210b9f2259e974c2a4e3d35c6d86ae21e903d2aac |
| 新增 | [db/migrations/002_design_task.mjs](../../db/migrations/002_design_task.mjs) | c0413da1200503567f5fa8f019070f66488b63815b80d37ef96ccf50b4f46402 |
| 修改 | [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | 81bd07b36f4cfcb7e9d9fc34c79773ebab6d339dd4c2af5e8acf20cd62fc0657 |
| 修改 | [package.json](../../package.json) | de62e49d5064aabeba4a9b516f8b9d25b298a721d6ec105283743dc4c6fb879f |
| 修改 | [scripts/migrate.mjs](../../scripts/migrate.mjs) | ab10f5eefd4c3eca0e540e2cc1b948625cf6637d7215b9e084712a767e0c3da7 |
| 新增 | [scripts/verify-design-task-protected.mjs](../../scripts/verify-design-task-protected.mjs) | f68b3875b4898a0dd27be50f520ed1c3862851d3a7fefdddd50d1ca3a960cfc2 |
| 新增 | [scripts/verify-design-task.mjs](../../scripts/verify-design-task.mjs) | 5a87efc40c338510af2a739babb70d54e85fa9a6c924009cc1f0255e404a83d8 |
| 修改 | [scripts/verify-foundation.mjs](../../scripts/verify-foundation.mjs) | 47dcc7d37ca9e2d4668b756a9bcc3fffb6ee6ba45db22e1d121b9f6bb65fc98d |
| 修改 | [src/cli.mjs](../../src/cli.mjs) | c5c6fb17c09461c2696af48ec5220d03547601d43832850b49df60cbb25a0391 |
| 新增 | [src/design-task.mjs](../../src/design-task.mjs) | 858669fb26fde88a8bc676ec7fa4d6ab6b26a470d64845b110979b9dcbeb3eba |
| 修改 | [src/foundation.mjs](../../src/foundation.mjs) | dc884181645f6c36bd6b5e442f0839246fe6d61bdb2cefa1209f14a2292db706 |
| 新增 | [test/design-task.integration.test.mjs](../../test/design-task.integration.test.mjs) | faf319e4c36d7f7442be7210d957070f5edbbe1382c2c1f9b2c9c5212b9d8572 |
| 修改 | [test/foundation.integration.test.mjs](../../test/foundation.integration.test.mjs) | 898dd2d07ccd7ac0918a566acf724028d203e58a5004940a26becb6fec1b2ee5 |
| 新增 | [verification/design-task/file-manifest.md](../../verification/design-task/file-manifest.md) | 本清单不作循环自摘要 |
| 新增 | [verification/design-task/protected-before.json](../../verification/design-task/protected-before.json) | d9ceba4234bf14f2b2484a006b231ae9fb1ef8d4875e8af42f8030b571c40f3a |
| 新增 | [verification/design-task/protection-result.md](../../verification/design-task/protection-result.md) | 5fd11b500e450b4317fabe95718d2da211d073abe8965fb539dab0112bc07c16 |
| 新增 | [verification/design-task/run-result.md](../../verification/design-task/run-result.md) | 8762648f202e3d8c94390a4680ef422148bb075fa18f0b5ab531ffadedf84df4 |

## 根配置及依赖审查

下列文件本轮未修改；作为同一正式工程的运行与审查输入保留，清单明确包含其路径和摘要。没有遗漏根 package、DOC-16 或配置边界。

| 文件 | SHA-256 |
|---|---|
| [config.example.json](../../config.example.json) | 92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce |
| [provision.example.json](../../provision.example.json) | 3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | 413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4 |
| [.gitignore](../../.gitignore) | 66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e |

## 验收口径

- 当前执行见 run-result.md：第一批 5 顶层/45 子场景、新增 6 顶层/34 子场景、7 控制测试分别统计；子场景内多值断言不另算测试数。
- 空库、已有数据升级、缺失创建证据和迁移故障是运行器独立阶段，不混入上述 Node 顶层/子场景数量。
- 开发中失败执行均非零退出并清理；本清单链接的是最终完整成功执行，不把中间失败描述为通过。
- 未重跑十三个原型；未运行模型、后续业务阶段、生产/性能/灾备验证。
- config/provision 样例是占位模板，真实一次性登录凭据只位于已清理的临时目录。
