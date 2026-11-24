# 第二批第四段实际交付文件与摘要

7 个既有文件最小修改、13 个新增。清单自身免列摘要，避免自引用；根 package、README、DOC-16 均包含，必要配置保留原样，无真实凭据、依赖目录或缓存。

| 状态 | 文件 | SHA-256 |
|---|---|---|
| 修改 | [README.md](../../README.md) | `7e8108b80984a763ea156637acce125cf76c08974c4d1f8e745b9461889a5728` |
| 修改 | [package.json](../../package.json) | `27f4bc357e2a4bccf3eaeb1e7ed06c6d9007388d8f2dd88795bc367bfa534dec` |
| 修改 | [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | `55a0050d8571db699a1eccfe04d58b27a8724f665b26a81f954ca45f3613bd90` |
| 修改 | [scripts/migrate.mjs](../../scripts/migrate.mjs) | `701a2e99cf08bc6964d80481405164fd1a4ec94e9a689163faeb6b543480a7fe` |
| 修改 | [scripts/verify-workflow-candidate.mjs](../../scripts/verify-workflow-candidate.mjs) | `02ef4e0a480471576927b873cc00e639e326887929b4f02159ed83c1bc99271d` |
| 修改 | [src/cli.mjs](../../src/cli.mjs) | `6dd16a5568b6845dd5ff39e39a9aa89728b741c01fbd52fe8120e3498145c3c6` |
| 修改 | [src/foundation.mjs](../../src/foundation.mjs) | `f594c0b2a5184601ab85b44c1cd5e3dacb87b3af5e169b78b6c8a3592ccca0d6` |
| 新增 | [db/migrations/005_finite_validation.mjs](../../db/migrations/005_finite_validation.mjs) | `1011e9ca8ff2d76b2aad96af7551147ccb77e22af4ecab18d516914efd43b2e1` |
| 新增 | [src/finite-validation.mjs](../../src/finite-validation.mjs) | `9cadd79aef0e7dea3e0b8654fa66a463735045587eeef77e66c47e5c7b6f9888` |
| 新增 | [test/support/validation-fixture.mjs](../../test/support/validation-fixture.mjs) | `e6cc4b25c1d7e190f9d61133e1e065ad8e6b595f2a99b8304a5ee51f557a88f1` |
| 新增 | [test/finite-validation.integration.test.mjs](../../test/finite-validation.integration.test.mjs) | `053eb4913772b9ea220d9c3a2d0058b1d5e728e7698cb0b7e24f7127f042b5be` |
| 新增 | [scripts/verify-finite-validation.mjs](../../scripts/verify-finite-validation.mjs) | `fc2c6cdce6264cdfabb462aa374334e296961eab3fc71d02023ec7b6ff99b4ad` |
| 新增 | [verification/finite-validation/workspace-before.json](../../verification/finite-validation/workspace-before.json) | `3b0cc94d33a98e6a9f36516d9edd1a02c3dedbca26f365cce75dc22b64089915` |
| 新增 | [verification/finite-validation/run-result.md](../../verification/finite-validation/run-result.md) | `882fe38c202029de4a8752675afb36a7fbd123f15055f9eb6365aca70d48914d` |
| 新增 | [verification/finite-validation/legacy-regression.md](../../verification/finite-validation/legacy-regression.md) | `d7691f7945e9cd2802e71e810cde8a00feb191ad791b6c058b802dcc689285d9` |
| 新增 | [verification/finite-validation/context-regression.md](../../verification/finite-validation/context-regression.md) | `85da57855a0f535d4fefd6b91becb4bedf062946e24ef2a96763446d061d2ee7` |
| 新增 | [verification/finite-validation/workflow-regression.md](../../verification/finite-validation/workflow-regression.md) | `0ba17c6ee437d197f63f5e3077c00e4d32df2e56460a3d71c62d37798cf07c66` |
| 新增 | [verification/finite-validation/coverage.md](../../verification/finite-validation/coverage.md) | `43ffbdc3d056dc4715dc245af47ace73c5cb194bbeec7d759781af1a2c90b0af` |
| 新增 | [verification/finite-validation/protection-result.md](../../verification/finite-validation/protection-result.md) | `fd036f12b6e1096589ba889be457d4de87ec19d4bf1b8e136ffdaff88f826375` |
| 新增 | [verification/finite-validation/file-manifest.md](../../verification/finite-validation/file-manifest.md) | 自身免列 |

## 未修改但必要的运行输入

| 文件 | SHA-256（与本轮前相同） |
|---|---|
| [config.example.json](../../config.example.json) | `92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce` |
| [provision.example.json](../../provision.example.json) | `3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e` |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | `413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4` |
| [.gitignore](../../.gitignore) | `66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e` |

## 结果与契约

- [覆盖清单、结果语义、冻结绑定及当前适用性](coverage.md)。真实执行者为 author，validator 不获业务权；unknown 硬规则无豁免。
- [本轮 005 验收](run-result.md)：6 顶层／26 子场景，零失败/零跳过；真实 SQL 迁移、COMMIT、PID、时点、权限与泄密证据。
- [本轮 004 边界回归](workflow-regression.md)：6／29；[本轮 003 边界回归](context-regression.md)：6／29；[本轮 002 边界回归](legacy-regression.md)：5／45、7 控制、6／34，另 9 个独立有效期专项。各自是本轮实际执行副本，历史目录不改写，数量不相加表示覆盖率。
- [保护核验](protection-result.md)及[本轮前基线](workspace-before.json)。
- 精确 CLI 字段见 [README](../../README.md#第二批第四段有限确定性校验覆盖契约)，状态见 [DOC-16](../../docs/16-prototype-consolidation-and-implementation-plan.md#42-第二批设计安全-bundle候选校验人工审批)：0.6.0 草案，仅第二批第四段完成，整个第二批未完成。
