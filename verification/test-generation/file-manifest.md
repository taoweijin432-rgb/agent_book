# Test generation delivery manifest

All actual modifications and additions for this task. No credentials, dependencies, caches or archive included. Configuration samples and lockfile remain unchanged and are listed separately.

| File | Change | SHA-256 |
|---|---|---|
| [README.md](../../README.md) | modified | `b036017a0c0cafbf1585a59feeb3e7d5d34cc230158fd41897bda2f823a6bae4` |
| [db/migrations/007_test_generation.mjs](../../db/migrations/007_test_generation.mjs) | added | `e5ac5d7ff9c094917d79f543b145ed88c9851ff105e353a6359b406f097a8c6c` |
| [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | modified | `2df6ba534de20f0001229253314a9176f4ceed1450eb22fca99e79bf9ce2655d` |
| [package.json](../../package.json) | modified | `56f00f0b262997695dd94d4d5d3b675462fcc9d3d5ac2147c42e96536ed07a6a` |
| [scripts/migrate.mjs](../../scripts/migrate.mjs) | modified | `efd44e697e4d9abf9ae5a7790f29b6058bd2d3c2022da59bd6c9c9606408cb23` |
| [scripts/test-generation-initialize.mjs](../../scripts/test-generation-initialize.mjs) | added | `8d6cb31e559810066a7bb5b6364c1a0cac8a59facdd8442985a72f6f607c74c7` |
| [scripts/verify-manual-approval.mjs](../../scripts/verify-manual-approval.mjs) | modified | `568be3a54a50502260951030859dc5bfa478d6af5cf43d5875b9134dbce86c67` |
| [scripts/verify-test-generation.mjs](../../scripts/verify-test-generation.mjs) | added | `07212fd72def379f5e1fd285e8b9f6a25357c31ce886febd4935700b4a6237e2` |
| [src/cli.mjs](../../src/cli.mjs) | modified | `909d832d51796c094a52a289b80314b265efbc8026e50f46b41ea140f4afec02` |
| [src/foundation.mjs](../../src/foundation.mjs) | modified | `b92c45906c729e5589e307ee1f7cf125075a66810855fff4e293b139608d176c` |
| [src/test-adapter.mjs](../../src/test-adapter.mjs) | added | `3c9d44b3410c352513db561ac911ea8b0857baeaf00736990039b5e83abc1b55` |
| [src/test-generation.mjs](../../src/test-generation.mjs) | added | `0728bdff05c427f046a28fb813132f8129e088aeb09cdcebf01f277ae41bee06` |
| [test/support/generation-fixture.mjs](../../test/support/generation-fixture.mjs) | added | `5982cb45aad1558bbb8f30bc6c80d7b97c6fd21142e708981dcfb3fb9627942f` |
| [test/test-generation.integration.test.mjs](../../test/test-generation.integration.test.mjs) | added | `19e8d2335614df3072dee14c966e209da099ddbca354a80863cc598fa038d798` |
| [verification/test-generation/approval-regression.md](approval-regression.md) | added | `300810dcda6f7c459b0d70cf44588df5c04c85b89217039eedce3d3b6e750969` |
| [verification/test-generation/context-regression.md](context-regression.md) | added | `58b43ff7d590455bcb6243e63d0d3f2961da74e642d8cbefaafed2818c46c382` |
| [verification/test-generation/generation-contract.md](generation-contract.md) | added | `f9605903b5073a89216cb265ea53fc057e13f7e343cfbb844d04420742249dd6` |
| [verification/test-generation/legacy-regression.md](legacy-regression.md) | added | `95542fdbed005730bcbdd89c5463f2ef6a9f5c2d052873c7a6916bbba4be6ec2` |
| [verification/test-generation/protection-result.md](protection-result.md) | added | `bb7f9ef592ee9c91641718cd00b7d9330db62c92365a395907e9f5622845877f` |
| [verification/test-generation/run-result.md](run-result.md) | added | `63509076653498700500644aa4fba90073d87e670be43cec079d78b19ad9f283` |
| [verification/test-generation/validation-regression.md](validation-regression.md) | added | `35ca74b15d777f282776c8b2d1fc5a376a4fa8a0bbc645ac3ac5407a20e66bd6` |
| [verification/test-generation/workflow-regression.md](workflow-regression.md) | added | `bc29578fd3ed429c95050b557838cfde83dd0f91a2c0066ae3672a7caf48a831` |
| [verification/test-generation/workspace-before.json](workspace-before.json) | added | `41685379393583b2ed98a64482fb38faede88013490913a5536b2b3f857aba45` |

This manifest is itself added; its own hash is excluded to avoid a self-hash cycle.

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
| [db/migrations/006_manual_approval.mjs](../../db/migrations/006_manual_approval.mjs) | `6cc8bd58feaeffb0e6d5eaf161dcec944f2e22f36ebf05d488dfaa2bbfd26867` |
