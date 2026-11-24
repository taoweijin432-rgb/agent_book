# 本轮实际文件与 SHA-256

初始 424 文件；原字节保持 417，修改 7，删除 0，越界 0。旧 001—007、旧测试、docs/00—15、十三个原型、旧验收及依赖锁保持原字节。

本目录 workspace-before.json 为本轮新建保护基线，未重建或覆盖历史基线。枚举跳过依赖/缓存/.git 与符号链接。delivery.zip 只含本清单和本轮实际修改/新增文件；不含自身、package-check.json、依赖、凭据或临时结果。归档/清单 SHA-256 由外部 package-check.json 记录，避免自引用；该校验信封不列自身 hash。

| 仓库相对路径 | SHA-256 |
|---|---|
| README.md | 984431e05c7a24029a6cdbeb80cc67a603de03bede26174c722afbcb9abc6736 |
| db/migrations/008_candidate_assertion.mjs | a2f66a3f79f7cf9f749d96c07b08ba4d2909c9b6eaa716624ba49265fb9b4b38 |
| docs/16-prototype-consolidation-and-implementation-plan.md | 94d67fe8356300cc40208ab9e6326406f311431d723fad6cb46c796622ffe88d |
| package.json | 424216c5ca29e5e1ddb04e2f1691a9b3de96e4bc068bbf67a776653c43edba07 |
| scripts/migrate.mjs | 1ee38c5e2ba2eafa57892b2815240f5de8fa4792d8d07d2b5afac6338fad4941 |
| scripts/verify-candidate-assertion-protected.mjs | f196057f7844eea4f6aa20d0221057460655830dea860a3fadeb6011e9117131 |
| scripts/verify-candidate-assertion.mjs | 83750f2c9dcdbab43fcc01d1c6a4d8c2d8e6b853e75283f3edcc60d447a8dddc |
| scripts/verify-test-generation.mjs | 11acf8d773ed4b085c66c9556cb2a5e2fe0bb2b2ccd1c27e1790dc985dbb0c50 |
| src/candidate-assertion.mjs | 8736c798957071efe6df71e18dd352c2ddc1be2982a043de57e95ffb288e273d |
| src/cli.mjs | 43b6ab7e1a061138e1afce70cdbc3a8604860c2429d31181ef6fa3caf61415e5 |
| src/foundation.mjs | a47d754abd9e828219274898d1249667f99612f94a63c03f12468c031d5bb6d4 |
| test/candidate-assertion.integration.test.mjs | 6660c9f03340f659e4b8f968f46952f4108118a7b90a075c81edba9aa0ff918f |
| verification/candidate-assertion/assertion-contract.md | 9ff014b9e8123cfd45f3fd6c60bd565f4f6cc073f34f29c529d1bf5a02acbe33 |
| verification/candidate-assertion/completion.md | a3f5c8be48b91d2b2397b24ce412c000aba09e322f18f6db68c2106d65849262 |
| verification/candidate-assertion/development-result.md | ba5b151bb20a86f2587e75b7b57628dc5cef39d0c5a1572f89ee90097a4e68ba |
| verification/candidate-assertion/final-checks.json | 5846e0736e49a9ed9970eb6be1e18fa3b9a331a5d6db404fca3a43ec4f38517a |
| verification/candidate-assertion/legacy/approval-regression.md | f07ccb4bae0993baba08bbcd826a091be4349b4a8d582aa92e478a9d2105db5a |
| verification/candidate-assertion/legacy/context-regression.md | 793e93d984c9496e1d26a330bfdb43383a4852b719fbe6dde677899bf436fc23 |
| verification/candidate-assertion/legacy/legacy-regression.md | c4be8b4eb795e2ddaae65f833b15312ca9104b12e4014885b571a5b3a4b3ba0a |
| verification/candidate-assertion/legacy/run-result.md | 5e73b8bc231859ad41d33cc169f219694526edabfa7df1a085cdbfd4e1274f6c |
| verification/candidate-assertion/legacy/validation-regression.md | a92ec8183942d8efd80a3ae5ecb074bdea41dfbf315386af6b538b98237c92f7 |
| verification/candidate-assertion/legacy/workflow-regression.md | 16bea8d36569bfec85424768f2f46b7257b41557f8d63e0681d4fa1490c0cc32 |
| verification/candidate-assertion/protection-result.json | de88f14502d5fe8aab4b4e0f57942e915ef3b654cc4162ee4ee5a0ff18125b2a |
| verification/candidate-assertion/run-result.md | ed2091c871c9afd5816cef8340f87fb57b42cd33d80e1fa428da6bc87bc71904 |
| verification/candidate-assertion/workspace-before.json | 6d298688bbdb1cd4cd9e60823f278d1729e127e1741f2a44b5f8dcd34bcd1a90 |

清单自身不列自身 hash；delivery.zip 外部摘要见 package-check.json。
