# Manual approval delivery manifest

Includes root package.json, README, DOC-16, 006, routes/runners, tests and evidence. No credentials, dependencies, caches or archive included. Unchanged lockfile/configuration examples listed separately.

| File | Change | SHA-256 |
|---|---|---|
| [README.md](../../README.md) | modified | `a9dfb3bfd24de1887b92f9196cde5c2ea86ef53ae68d3ec5ec021108059139a4` |
| [db/migrations/006_manual_approval.mjs](../../db/migrations/006_manual_approval.mjs) | added | `6cc8bd58feaeffb0e6d5eaf161dcec944f2e22f36ebf05d488dfaa2bbfd26867` |
| [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | modified | `e4aa136c5dd7a85beeaa0226c6c550644afd0346b35490976cab4cba5971d012` |
| [package.json](../../package.json) | modified | `85fc9d4eac04211ade1d867e09bab5267b555c2431e1edcb71319c9ac01a14b7` |
| [scripts/migrate.mjs](../../scripts/migrate.mjs) | modified | `f1c51f05df7ba792bf4aca0626db27fec3e9e77fea270a94844891b74e469209` |
| [scripts/verify-finite-validation.mjs](../../scripts/verify-finite-validation.mjs) | modified | `4b07ec95e459792ae2b2e4cdb49672458173cc4393283387ed99482afc118c4b` |
| [scripts/verify-manual-approval.mjs](../../scripts/verify-manual-approval.mjs) | added | `3c8fc9005769d9cf78adaa0411ccc245a99426db5a131085f5100256895540d9` |
| [src/cli.mjs](../../src/cli.mjs) | modified | `e98a411deed74317317bc10a84d6db5a28610e287c2f964b73dee196bb448467` |
| [src/foundation.mjs](../../src/foundation.mjs) | modified | `fc5d769cdade7e63708b268eba839e841e14f6fd3cd161a95f649541d7da42be` |
| [src/manual-approval.mjs](../../src/manual-approval.mjs) | added | `0510958b07ecee6ed978fcf670b256522eaaf5df8a6f092bd2cef430f70732a4` |
| [test/manual-approval.integration.test.mjs](../../test/manual-approval.integration.test.mjs) | added | `249beaa562cbac60f68f3e8a6f77db8034c1d89c73309cdd61796651b6b7fd48` |
| [test/support/approval-fixture.mjs](../../test/support/approval-fixture.mjs) | added | `86c30c663f3d200c5aa9db76d5b08c60cee5f5c8fa97de2cf44e0c1946307f9b` |
| [verification/manual-approval/approval-contract.md](approval-contract.md) | added | `c9a25408d9877ce3538e39d59ed044e6435bbf48fa483cd3da01010d4779dd5c` |
| [verification/manual-approval/context-regression.md](context-regression.md) | added | `26542c6757cbb6d8e001aef1455fc1dc9d4ff71558a9069a291169b433ef3677` |
| [verification/manual-approval/legacy-regression.md](legacy-regression.md) | added | `4c5c594803eeb0aea3b9e54c3b3ef078d83835683478e712f350afcbbb9fa69d` |
| [verification/manual-approval/protection-result.md](protection-result.md) | added | `82f44190699fcbc60c16a58365364d1c505cc6afdee408049de82d38c485d1b6` |
| [verification/manual-approval/run-result.md](run-result.md) | added | `b489b0178060eb50b347d27d1b11be212dd086924e6dcc7a08b5799e02da1599` |
| [verification/manual-approval/validation-regression.md](validation-regression.md) | added | `e77bb7b21308083844648179205788d1a6ba5042dfffeb488907518bf3c901a9` |
| [verification/manual-approval/workflow-regression.md](workflow-regression.md) | added | `338a139a74f187b03f6419bcca5660953e2eb38e71df098fb67334787ca55e48` |
| [verification/manual-approval/workspace-before.json](workspace-before.json) | added | `35472c6e03fad536de72958e0c0e337718ab57a145b4654c03fda4cd72ec1a0a` |

This manifest is itself a new file; its own digest is excluded to avoid a self-hash cycle.

## Unchanged review files

| File | SHA-256 |
|---|---|
| [.gitignore](../../.gitignore) | `66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e` |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | `413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4` |
| [config.example.json](../../config.example.json) | `92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce` |
| [provision.example.json](../../provision.example.json) | `3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e` |
| [db/migrations/001_foundation.mjs](../../db/migrations/001_foundation.mjs) | `0435d0870e7ca9acd6ee031ddafad85810083181badbfc8b27e1fafa4d4fc0c1` |
| [db/migrations/002_design_task.mjs](../../db/migrations/002_design_task.mjs) | `a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8` |
| [db/migrations/003_safe_context.mjs](../../db/migrations/003_safe_context.mjs) | `590a87bb35c0be9263e44e939ed041c074d5d2a585e8ebd122c59e41ad665618` |
| [db/migrations/004_manual_workflow.mjs](../../db/migrations/004_manual_workflow.mjs) | `5429bafb3a5b148291981efd1107037190bb3f9419d81624fffa085c2c1d13d4` |
| [db/migrations/005_finite_validation.mjs](../../db/migrations/005_finite_validation.mjs) | `1011e9ca8ff2d76b2aad96af7551147ccb77e22af4ecab18d516914efd43b2e1` |
