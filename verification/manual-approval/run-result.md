# 第二批第五段：人工审批与失效管理验收

- run：1ce8760f-2ea2-4b34-b39b-2459cb7cf545；时间 2026-10-21T01:56:47.066Z；退出 0；状态 completed
- PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2
- 原有回归按 002/003/004/005 边界执行，记录在本目录 legacy-regression.md、context-regression.md、workflow-regression.md、validation-regression.md；历史报告原字节保留。
- 本轮：6 顶层／35 子场景，失败 0，跳过 0。
- 自有容器及匿名卷清理 true；临时凭据/结果清理 true；泄密扫描 0。

## 迁移

```json
{
  "fresh": {
    "applied": 6,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 5,
    "failedExit": 1,
    "testsStartedAfterFailure": false,
    "failedLedger": 5,
    "oldDataExactAfterFailure": true,
    "applied": 1,
    "replayApplied": 0,
    "oldDataExactAfterUpgrade": true,
    "revocationsPreserved": true,
    "oldValidationStillApplicable": true,
    "legacyNotElectedByTimestamp": true,
    "newRealAuthorReviewAndApprove": true,
    "faultFacilitiesRemoved": true
  }
}
```

## 场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 真实审阅与人工决定 | 真实 author 获取精确审阅包，确认完整软项后批准 | passed |
| A 真实审阅与人工决定 | 七类绑定及选择／校验代次、审阅协议和实际授权一致 | passed |
| A 真实审阅与人工决定 | writer／服务／auditor／跨 Novel author 无审批或审阅权限 | passed |
| A 真实审阅与人工决定 | failed、必需 unknown、缺校验不能批准，但完整负结果可人工拒绝 | passed |
| A 真实审阅与人工决定 | 伪造摘要、缺失/重复软项、force/pass/审批人覆盖均拒绝 | passed |
| B 决定代次、撤回、幂等与 ABA | 同键同请求重放不重复，异请求冲突；未选中编辑不继承批准 | passed |
| B 决定代次、撤回、幂等与 ABA | A→B→A 显式失效不可恢复，同正文新候选须新校验新批准 | passed |
| B 决定代次、撤回、幂等与 ABA | 撤回、后续拒绝及旧决定重放不恢复旧批准 | passed |
| B 决定代次、撤回、幂等与 ABA | 新 Validation Run 采用代次，使旧批准失效但不改 005 历史语义 | passed |
| B 决定代次、撤回、幂等与 ABA | 相同内容审批或校验策略新 Release 永不复活旧批准 | passed |
| C 输入、授权与到期发现 | task 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | design 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | publication 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | context-policy 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | writer-revoke 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | context-revoke 显式变更同事务失效，历史保留 | passed |
| C 输入、授权与到期发现 | 捕获真实四项支撑，作者授权撤销及换发不复活原批准 | passed |
| C 输入、授权与到期发现 | 作者有限支撑到期首次发现、重复检查幂等且不伪造发现时间 | passed |
| C 输入、授权与到期发现 | writer 两层有限授权到期使批准当次不可用 | passed |
| D 实际并发与行锁 | selection 与审批 审批先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | selection 与审批 变更先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | validation 与审批 审批先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | validation 与审批 变更先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | revocation 与审批 审批先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | revocation 与审批 变更先行，实际 PID 阻塞后裁决 | passed |
| D 实际并发与行锁 | 两人工批准竞争相同期望决定版本，仅一个成功 | passed |
| D 实际并发与行锁 | 等待跨作者支撑期限，确认数据库时间后释放保护并拒绝 | passed |
| E 原子性和数据库防绕过 | 选择及新校验外层回滚，变更和失效同时回滚 | passed |
| E 原子性和数据库防绕过 | 批准中途故障和外层回滚不留决定、指针、授权明细或成功审计 | passed |
| E 原子性和数据库防绕过 | 真实 COMMIT 延后失败：函数返回与成功交付分离，旧批准及失效关系不受污染 | passed |
| E 原子性和数据库防绕过 | 缺失授权或批准支撑、错误冻结绑定、伪造批准在数据库被拒绝 | passed |
| E 原子性和数据库防绕过 | 冻结历史改删/TRUNCATE、底表与内部函数均不能绕过 | passed |
| F 审计边界、兼容与披露 | 历史审计核验真实资源范围，越界整条过滤，合法历史和原始引用保留 | passed |
| F 审计边界、兼容与披露 | 006 后旧关键入口兼容；真实角色、ACL、NOLOGIN 所有者、路径和故障设施核验 | passed |
| F 审计边界、兼容与披露 | 真实 CLI 和全通道默认输出不泄露正文、Bundle、规则、理由或凭据 | passed |

## 权限、并发、摘要与回滚证据

```json
{
  "manual": {
    "realAuthor": true,
    "sameAuthorValidationAllowed": true,
    "explicitConfirmationOnly": true,
    "softNotAutomaticallyPassed": true
  },
  "bindings": {
    "sevenFrozenClasses": true,
    "selectionAndValidationEpoch": true,
    "actualAuthorityIds": true,
    "independentReviewDigest": true,
    "noSecondBodyAuthority": true
  },
  "idempotency": {
    "sameRequestNoDuplicate": true,
    "differentRequestDenied": true,
    "unselectedEditNoInheritance": true
  },
  "aba": {
    "oldApprovalNeverRestored": true,
    "newManualDecisionRequired": true
  },
  "decisions": {
    "withdrawalAppended": true,
    "rejectionBlocksOld": true,
    "stableCasVersions": true,
    "oldReplayDoesNotMoveHead": true
  },
  "validationEpoch": {
    "explicitMonotonicGeneration": true,
    "newRunInvalidates": true,
    "old005SemanticsPreserved": true
  },
  "policy": {
    "sameContentNewApprovalRelease": true,
    "newValidationRelease": true,
    "noOldRevival": true
  },
  "inputs": {
    "task": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    },
    "design": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    },
    "publication": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    },
    "context-policy": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    },
    "writer-revoke": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    },
    "context-revoke": {
      "invalidationBeforeRead": true,
      "replacementCannotRevive": true
    }
  },
  "authority": {
    "actualGrantIdsCaptured": true,
    "revocationAndReplacementNoRevival": true,
    "newApprovalUsesNewSupport": true
  },
  "expiryDetection": {
    "deadline": "2026-10-21 01:58:00.61155+00",
    "databaseObserved": "2026-10-21 01:58:00.626805+00",
    "detectedAt": "2026-10-21T01:58:00.664Z",
    "onePermanentInvalidation": true,
    "finiteSupportNeverUnlimited": true
  },
  "writerExpiry": {
    "deadline": "2026-10-21 01:58:05.248195+00",
    "databaseObserved": "2026-10-21 01:58:05.259451+00",
    "immediatelyDenied": true
  },
  "selectionApprovalFirst": {
    "blocker": 873,
    "waiter": 872,
    "observer": 874,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "selectionChangeFirst": {
    "blocker": 905,
    "waiter": 906,
    "observer": 904,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "validationApprovalFirst": {
    "blocker": 934,
    "waiter": 936,
    "observer": 935,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "validationChangeFirst": {
    "blocker": 967,
    "waiter": 965,
    "observer": 966,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "revocationApprovalFirst": {
    "blocker": 997,
    "waiter": 996,
    "observer": 995,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "revocationChangeFirst": {
    "blocker": 1028,
    "waiter": 1027,
    "observer": 1026,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "decisionCas": {
    "blocker": 1057,
    "waiter": 1056,
    "observer": 1058,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "waitExpiry": {
    "blocker": 1091,
    "waiter": 1090,
    "observer": 1092,
    "actualBlockerConfirmed": true,
    "deadline": "2026-10-21 01:58:10.838909+00",
    "databaseObserved": "2026-10-21 01:58:10.847606+00"
  },
  "rollback": {
    "selectionAndInvalidation": true,
    "newValidationEpochAndInvalidation": true,
    "midApproval": true,
    "realCommitFailure": true,
    "oldApprovalAndAllPhysicalRowsUnchanged": true
  },
  "diagnostics": [
    {
      "op": "approval:approve",
      "sqlstate": "P0001",
      "functions": [
        "public",
        "_ap_write_decision",
        "api_manual_approval"
      ]
    }
  ],
  "integrity": {
    "missingAssociation": true,
    "missingAuthority": true,
    "wrongHashBundleAndReview": true,
    "forgedApprovalRejected": true
  },
  "audit": {
    "actualResourceScope": true,
    "rawAuditPreserved": true,
    "legalHistoricalApprovalMetadata": true
  },
  "permissions": {
    "functions": 121,
    "publicExecute": 0,
    "helperExecute": 0,
    "basePrivileges": 0,
    "highMemberships": 0,
    "disabledTriggers": 0,
    "unvalidatedConstraints": 0,
    "faultResidue": 0,
    "nonAuthorApprovalPermissions": false
  },
  "disclosure": {
    "logs": 180,
    "responses": 180,
    "actualPgLogScanned": true,
    "cliScanned": true,
    "auditorScanned": true,
    "leaks": 0,
    "authorizedReviewIsProtectedBusinessOutput": true
  }
}
```

## 未执行

- 没有模型、Generation、自动审批、结构化提案、Canon、Outbox、投影、自动修复或约束豁免。输入水位固定 0。
- 有限人工审批不能证明作者实际阅读/理解；hard unknown 不可批准，软项仅明确人工确认，不声称自动检查通过。未做自然语言语义、token、小说质量、生产认证或性能验收。
