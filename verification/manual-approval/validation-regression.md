# 第二批第四段：有限确定性校验与结果绑定验收

- run：b340c18a-845a-42de-beaf-bb7922c3c1ad；时间 2026-10-21T01:56:47.069Z；退出 0；状态 completed
- PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2
- 原有回归按 002/003/004 边界执行，记录在本目录 legacy-regression.md、context-regression.md、workflow-regression.md；历史报告原字节保留。
- 本轮：6 顶层／26 子场景，失败 0，跳过 0。
- 自有容器及匿名卷清理 true；临时凭据/结果清理 true；泄密扫描 0。

## 迁移

```json
{
  "fresh": {
    "applied": 5,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 4,
    "failedExit": 1,
    "testsStartedAfterFailure": false,
    "failedLedger": 4,
    "oldDataExactAfterFailure": true,
    "applied": 1,
    "replayApplied": 0,
    "oldDataExactAfterUpgrade": true,
    "writingRevocationsPreserved": true,
    "oldCommands": true,
    "realAuthorValidation": true,
    "faultFacilitiesRemoved": true
  }
}
```

## 场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 真实 author 与有限检查结果 | 全新合法软约束任务通过，实际 author 记录与冻结输入一致 | passed |
| A 真实 author 与有限检查结果 | 适用自由文本 hard 固定 unknown 并阻断；真实超覆盖正文 failed | passed |
| A 真实 author 与有限检查结果 | writer、独立 author、auditor 及未开放服务均不能发起或冒充执行 | passed |
| A 真实 author 与有限检查结果 | 无选择、预期过时及实际跨 Novel/Workflow Candidate 拒绝 | passed |
| B 冻结集合、摘要和数据库完整性 | 必需集合与结果独立重算摘要，实际来源及绑定完整 | passed |
| B 冻结集合、摘要和数据库完整性 | 数据库拒绝遗漏/错误明细、错误 hash/绑定与伪造整体通过 | passed |
| B 冻结集合、摘要和数据库完整性 | 冻结 Run/检查/策略/请求/审计不可改删，历史不能追加检查 | passed |
| C 幂等、编辑、选择与 Release 身份 | 同键不重执行、异请求拒绝；独立正文编辑不扩展旧结果覆盖 | passed |
| C 幂等、编辑、选择与 Release 身份 | 选择变化与 A→B→A 均不恢复旧校验，新 Candidate 必须独立记录 | passed |
| C 幂等、编辑、选择与 Release 身份 | 重新发布相同规则内容使用新 Release，旧结果不复活且历史不改写 | passed |
| D 输入与授权失效后的历史 | publication 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | context-policy 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | task 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | design 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | writing-revoke 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | context-revoke 变化拒绝当前取用与重放，完整历史仍可查询 | passed |
| D 输入与授权失效后的历史 | 作者自身失权后不能用旧请求键取回结果 | passed |
| E 真实并发与数据库时点 | 校验先受保护完成，写作撤销等待；结果保存后当前适用性拒绝 | passed |
| E 真实并发与数据库时点 | 撤销先行，等待校验拒绝且无 Run | passed |
| E 真实并发与数据库时点 | 校验先行和选择先行分别得到完整顺序，无错候选校验 | passed |
| E 真实并发与数据库时点 | 等待跨过原上下文截止，观察数据库时间后释放保护并拒绝 | passed |
| F 回滚、权限、审计与完整输出扫描 | 中途故障及外层回滚，所有新增表及旧选择状态不变 | passed |
| F 回滚、权限、审计与完整输出扫描 | 真实 COMMIT 延后失败，函数返回不能被当作成功交付 | passed |
| F 回滚、权限、审计与完整输出扫描 | 审计过滤跨 Novel/Task/Workflow 资源，保留原引用与合法历史 | passed |
| F 回滚、权限、审计与完整输出扫描 | 005 后旧命令兼容；真实角色、函数 ACL、所有者、路径及约束完整 | passed |
| F 回滚、权限、审计与完整输出扫描 | 真实 CLI、日志、嵌套错误、auditor 和 PostgreSQL 日志零敏感披露 | passed |

## 权限、并发、摘要与回滚证据

```json
{
  "path": {
    "realAuthorExecutor": true,
    "noValidatorImpersonation": true,
    "newLegalDesignWithoutHardRule": true,
    "allTechnicalChecksPassed": true,
    "softExplicitlyUnchecked": true
  },
  "results": {
    "passed": true,
    "failed": true,
    "hardUnknownBlocks": true,
    "notNaturalLanguageValidation": true
  },
  "diagnostics": [
    {
      "sqlstate": "42501",
      "functions": []
    },
    {
      "sqlstate": "42501",
      "functions": []
    },
    {
      "sqlstate": "42501",
      "functions": []
    },
    {
      "sqlstate": "42501",
      "functions": []
    },
    {
      "sqlstate": "P0001",
      "functions": [
        "public",
        "_val_record",
        "api_finite_validation"
      ]
    }
  ],
  "binding": {
    "actualFkChain": true,
    "independentCheckSetAndResultSha256": true,
    "bodyAndPayloadHashes": true
  },
  "integrity": {
    "missingDetailsRejected": true,
    "falseOverallRejected": true,
    "wrongHashesAndBindingsRejected": true,
    "independentPhysicalStateUnchanged": true
  },
  "edit": {
    "doesNotSelect": true,
    "oldResultOnlyOriginalCandidate": true,
    "sameBodyNewCandidate": true
  },
  "selection": {
    "candidateIdentityNotHash": true,
    "abaDoesNotRestore": true,
    "oldReplayNoExecution": true
  },
  "policy": {
    "sameContentNewIdentity": true,
    "oldRunNotApplicable": true,
    "historyUnchanged": true
  },
  "stale": {
    "publication": true,
    "context-policy": true,
    "task": true,
    "design": true,
    "writing-revoke": true,
    "context-revoke": true
  },
  "validationFirst": {
    "blocker": 506,
    "waiter": 507,
    "observer": 505,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true
  },
  "revocationFirst": {
    "blocker": 533,
    "waiter": 535,
    "observer": 534,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true
  },
  "validateBeforeSelection": {
    "blocker": 562,
    "waiter": 563,
    "observer": 561,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true
  },
  "selectionBeforeValidation": {
    "blocker": 590,
    "waiter": 589,
    "observer": 591,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true
  },
  "expiry": {
    "blocker": 618,
    "waiter": 619,
    "observer": 620,
    "actualBlockerConfirmed": true,
    "deadline": "2026-10-21 01:57:47.013864+00",
    "databaseObserved": "2026-10-21 01:57:47.024202+00",
    "denied": true
  },
  "rollback": {
    "midCheckFailure": true,
    "outerRollback": true,
    "allTablesAndSelectionUnchanged": true,
    "realCommitFailure": true,
    "serviceWithheldResult": true
  },
  "audit": {
    "actualResourceScope": true,
    "rawRowsPreserved": true,
    "legalHistoricalEventsRetained": true,
    "auditorNoBodyOrRule": true
  },
  "permissions": {
    "functions": 94,
    "publicExecute": 0,
    "privateHelperExecute": 0,
    "basePrivileges": 0,
    "highMemberships": 0,
    "unvalidatedConstraints": 0,
    "disabledTriggers": 0,
    "faultResidue": 0,
    "validatorBusinessPermission": false
  },
  "disclosure": {
    "logCount": 124,
    "responseCount": 124,
    "actualPgLogScanned": true,
    "cliScanned": true,
    "auditorScanned": true,
    "secretCredentialBodyAndRuleLeaks": 0
  }
}
```

## 未执行

- 没有模型、Generation、审批、结构化提案、Canon、Outbox、投影或自动修复。输入水位固定 0。
- finite-validator-v1 只验证声明覆盖；author_rule_v1 的 hard=unknown 阻断，soft=unknown 明确未检查。未做自然语言语义、token、小说质量、生产认证或性能验收。
