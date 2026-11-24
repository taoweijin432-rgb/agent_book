# Authorization-time repair delivery manifest

Includes actual 007, verifier/test additions, README/DOC-16, original before-snapshots and independent repair evidence. No credentials, dependencies, caches or user archives packaged.

| File | Change | SHA-256 |
|---|---|---|
| [README.md](../../README.md) | modified | `14e0105a23cc3fefaa946c8b669e40eb8883f6a4842e3a8e9e8e8b4e4552e159` |
| [db/migrations/007_test_generation.mjs](../../db/migrations/007_test_generation.mjs) | modified | `0ab3679cc9b7bedec03868009e1863939fedd41d45b01666de43869d98e7c566` |
| [docs/16-prototype-consolidation-and-implementation-plan.md](../../docs/16-prototype-consolidation-and-implementation-plan.md) | modified | `c8329d05d38b3f0a945f0783186ac7b2be2e67c7cf40d6c70769795da3b71453` |
| [scripts/verify-generation-authorization-time.mjs](../../scripts/verify-generation-authorization-time.mjs) | added | `5c155269a408680f43ec2280f98b31e000b53d254a768eb125544af7d6735d88` |
| [scripts/verify-test-generation.mjs](../../scripts/verify-test-generation.mjs) | modified | `8d14ebbf365639e8e064a7a98045a21d9c58091d156c7e1e99a63563fd6ac264` |
| [test/generation-authorization-time.mjs](../../test/generation-authorization-time.mjs) | added | `dd66691c3b821d7cccdb88ed27bc3fa8b9ee090613873459966b920e1b2aaa4d` |
| [verification/test-generation-time-repair/after-experiment.json](after-experiment.json) | added | `d3f6743ad8ce5f34a90050bb830cc7175ef07de02fdc0ec1e998b65afb66fc0d` |
| [verification/test-generation-time-repair/after/approval-regression.md](after/approval-regression.md) | added | `5323c74d6cc8166332135cc5ddc210f713161110498cb879411a119cff665b04` |
| [verification/test-generation-time-repair/after/context-regression.md](after/context-regression.md) | added | `c7a2e98eac7b5f89963e2294f4feb3e738ebebe3574e2d67756a224fa3c53227` |
| [verification/test-generation-time-repair/after/legacy-regression.md](after/legacy-regression.md) | added | `046b57782e914654afc7691af81abe491e4b3c845a9b48da8b757a4a410c9c24` |
| [verification/test-generation-time-repair/after/run-result.md](after/run-result.md) | added | `0cd72324583fe188e745a278410e11ba88cfb7ee98474153ab829cc2d805caef` |
| [verification/test-generation-time-repair/after/validation-regression.md](after/validation-regression.md) | added | `8b0eaeee1e2eaa824c99c652ad02398a4196557344d4692902289cfb4008c7fe` |
| [verification/test-generation-time-repair/after/workflow-regression.md](after/workflow-regression.md) | added | `f7aff77383edc2e4ae3d0e0cd94fbc3d0916befb3f2fb7bfc0a15b6332572391` |
| [verification/test-generation-time-repair/before-experiment.json](before-experiment.json) | added | `cd231286c52f26924f9ab751376790ef5fff9e63b49615a9b70c4a7ab7d9fc10` |
| [verification/test-generation-time-repair/before/README.md](before/README.md) | added | `b036017a0c0cafbf1585a59feeb3e7d5d34cc230158fd41897bda2f823a6bae4` |
| [verification/test-generation-time-repair/before/db/migrations/007_test_generation.mjs](before/db/migrations/007_test_generation.mjs) | added | `e5ac5d7ff9c094917d79f543b145ed88c9851ff105e353a6359b406f097a8c6c` |
| [verification/test-generation-time-repair/before/docs/16-prototype-consolidation-and-implementation-plan.md](before/docs/16-prototype-consolidation-and-implementation-plan.md) | added | `2df6ba534de20f0001229253314a9176f4ceed1450eb22fca99e79bf9ce2655d` |
| [verification/test-generation-time-repair/before/scripts/verify-generation-authorization-time.mjs](before/scripts/verify-generation-authorization-time.mjs) | added | `5c155269a408680f43ec2280f98b31e000b53d254a768eb125544af7d6735d88` |
| [verification/test-generation-time-repair/before/scripts/verify-test-generation.mjs](before/scripts/verify-test-generation.mjs) | added | `07212fd72def379f5e1fd285e8b9f6a25357c31ce886febd4935700b4a6237e2` |
| [verification/test-generation-time-repair/before/test/generation-authorization-time.mjs](before/test/generation-authorization-time.mjs) | added | `4a1756cf3519f54c30c382dd0b504e2988db1f65d94ed3362fa947ee620d301c` |
| [verification/test-generation-time-repair/before/verification/test-generation/generation-contract.md](before/verification/test-generation/generation-contract.md) | added | `f9605903b5073a89216cb265ea53fc057e13f7e343cfbb844d04420742249dd6` |
| [verification/test-generation-time-repair/before/verification/test-generation/run-result.md](before/verification/test-generation/run-result.md) | added | `63509076653498700500644aa4fba90073d87e670be43cec079d78b19ad9f283` |
| [verification/test-generation-time-repair/deployment-check.json](deployment-check.json) | added | `56d3797022a913d5d0406378295865400f4ef4079e69b29c1e0e71f624646d77` |
| [verification/test-generation-time-repair/protection-result.md](protection-result.md) | added | `fdadc42f3882052eb9b467ebc86577af35a94b7e5769138d4a623c4bf4f80b25` |
| [verification/test-generation-time-repair/repair-summary.md](repair-summary.md) | added | `6cc907dbfd7eac983d6752b165f2671c92cc48b1b18f4ca03e8dc3ddd8732f75` |
| [verification/test-generation-time-repair/workspace-before.json](workspace-before.json) | added | `20699b2725ee37cc94332d0af17b379d99f9235b35bf93f893ebc2c979aff44d` |

This manifest itself is added. Its own hash is excluded to avoid a self-hash cycle. All before/ snapshots remain byte copies with the original relative-link context.

## Unchanged review inputs

| File | SHA-256 |
|---|---|
| [package.json](../../package.json) | `56f00f0b262997695dd94d4d5d3b675462fcc9d3d5ac2147c42e96536ed07a6a` |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | `413350119bab4d4e9c17e340e82f61e2f16042755c17e035f302fc3093a5cee4` |
| [.gitignore](../../.gitignore) | `66a05bec3c68d9757ba9a8af3176b76f2868cef506bdb0833e55f040e1bf8c3e` |
| [config.example.json](../../config.example.json) | `92c700055c918d11c881ca88c09f0a7e04e03e8936f7271d876247404b630bce` |
| [provision.example.json](../../provision.example.json) | `3e3eae65e10f0f58b3162807629d385d8517a3874c3c771c5c373dddca20a85e` |
| [db/migrations/001_foundation.mjs](../../db/migrations/001_foundation.mjs) | `0435d0870e7ca9acd6ee031ddafad85810083181badbfc8b27e1fafa4d4fc0c1` |
| [db/migrations/002_design_task.mjs](../../db/migrations/002_design_task.mjs) | `a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8` |
| [db/migrations/003_safe_context.mjs](../../db/migrations/003_safe_context.mjs) | `590a87bb35c0be9263e44e939ed041c074d5d2a585e8ebd122c59e41ad665618` |
| [db/migrations/004_manual_workflow.mjs](../../db/migrations/004_manual_workflow.mjs) | `5429bafb3a5b148291981efd1107037190bb3f9419d81624fffa085c2c1d13d4` |
| [db/migrations/005_finite_validation.mjs](../../db/migrations/005_finite_validation.mjs) | `1011e9ca8ff2d76b2aad96af7551147ccb77e22af4ecab18d516914efd43b2e1` |
| [db/migrations/006_manual_approval.mjs](../../db/migrations/006_manual_approval.mjs) | `6cc8bd58feaeffb0e6d5eaf161dcec944f2e22f36ebf05d488dfaa2bbfd26867` |
| [test/test-generation.integration.test.mjs](../../test/test-generation.integration.test.mjs) | `19e8d2335614df3072dee14c966e209da099ddbca354a80863cc598fa038d798` |
