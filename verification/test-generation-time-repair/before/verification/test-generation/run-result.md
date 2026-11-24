# 第二批第六段：受控测试生成验收

- run：3fb72a42-6bd7-41ae-a08e-2e30a62a7fc3；时间 2026-10-23T08:06:44.472Z；退出 0；状态 completed
- 执行 pnpm test；PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2；provider=test。
- 原有回归按 002/003/004/005/006 边界真实重新执行，副本分别为 legacy/context/workflow/validation/approval-regression.md；全部原历史文件保持原字节。
- 本轮 6 顶层／32 子场景，失败 0，跳过 0。控制测试及有效期运行器专项另计，不汇总为系统覆盖率。
- 自有容器及匿名卷清理 true；临时凭据及结果清理 true；泄密扫描 0。

## 迁移

```json
{
  "fresh": {
    "applied": 7,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 6,
    "failedExit": 1,
    "testsStartedAfterFailure": false,
    "failedLedger": 6,
    "oldDataExactAfterFailure": true,
    "applied": 1,
    "replayApplied": 0,
    "oldColumnsAndRowsPreserved": true,
    "onlyNewExecutorRoleAddedToOldCatalog": true,
    "revocationsPreserved": true,
    "oldReviewExactBytes": true,
    "oldApprovalStillUsable": true,
    "realWriterGeneration": true,
    "faultFacilitiesRemoved": true
  }
}
```

## 场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 显式权限、测试范围和实际字节 | 真实 author 授权和 writer 单次生成，精确请求响应与候选完整且不自动选择 | passed |
| A 显式权限、测试范围和实际字节 | 只有元数据、上下文或人工写作权不足；非测试作品与普通配置拒绝 | passed |
| A 显式权限、测试范围和实际字节 | 跨作品／writer／Bundle／Task、未知适配器参数及自报响应拒绝 | passed |
| A 显式权限、测试范围和实际字节 | 授权 ID 双向防歧义，有限支撑不扩为无限期 | passed |
| B 事务外调用与失效重检 | generation-revoke 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | context-revoke 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | task 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | design 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | publication 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | policy 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | selection-aba 在适配器阶段完成，最终拒绝且保留实际响应 | passed |
| B 事务外调用与失效重检 | 授权在调用阶段跨截止：数据库时间确认后拒绝，不丢真实输出 | passed |
| C 幂等、竞争、中断与迟到 | 同键重放不调用，异内容拒绝，同输入新身份仍可独立执行 | passed |
| C 幂等、竞争、中断与迟到 | 准备提交后调用前中断：保留原执行，重放不补调用 | passed |
| C 幂等、竞争、中断与迟到 | 调用已登记但无响应：明确未决，终止后真实迟到响应只留事实 | passed |
| C 幂等、竞争、中断与迟到 | writer 已失权的未决调用可由当前有管理权限的 author 终止，迟到结果不接纳 | passed |
| C 幂等、竞争、中断与迟到 | 真实子进程在响应产生后中断：无响应不能当作从未调用 | passed |
| C 幂等、竞争、中断与迟到 | 超时、适配器拒绝与技术异常分别记录，不覆盖失败 | passed |
| C 幂等、竞争、中断与迟到 | 两个同键准备真实阻塞后仅一个新执行，成功接纳响应丢失后不重调 | passed |
| C 幂等、竞争、中断与迟到 | 接纳与撤销双向真实竞争，确认阻塞 PID 后提交 | passed |
| D 来源、校验、人工审批及旧协议 | 选择测试候选后真实校验和人工批准，新审阅协议明确 test 来源 | passed |
| D 来源、校验、人工审批及旧协议 | 人工编辑继承真实测试来源，不伪造新调用；未选择不影响原批准 | passed |
| D 来源、校验、人工审批及旧协议 | 测试输出没有自动通过权：必需 hard unknown 仍不能人工批准 | passed |
| D 来源、校验、人工审批及旧协议 | 测试生成授权撤销同事务使已批准结果失效，历史仍可追溯 | passed |
| D 来源、校验、人工审批及旧协议 | 007 后旧人工命令与 approval-review-v1 原字节重建保持兼容 | passed |
| E 原子性、真实 COMMIT 和数据库约束 | 准备中途故障、真实 COMMIT 失败与外层回滚均不留下半执行 | passed |
| E 原子性、真实 COMMIT 和数据库约束 | 接纳外层回滚不留下调用结果、候选、终态及成功审计，之后独立记录真实响应 | passed |
| E 原子性、真实 COMMIT 和数据库约束 | 接纳中途故障及真实 COMMIT 失败：独立事务保留调用事实，不伪造接纳 | passed |
| E 原子性、真实 COMMIT 和数据库约束 | 缺调用、错来源、改删/TRUNCATE 和普通 DML 伪造均被拒绝 | passed |
| F 真实权限、审计范围与披露 | 受限执行审计核对实际资源 Novel/Task/Workflow，保留原引用及合法历史 | passed |
| F 真实权限、审计范围与披露 | 旧角色不扩权；独立 executor 无底表/owner/helper 权限，路径和约束无残留 | passed |
| F 真实权限、审计范围与披露 | CLI、日志、错误、auditor 与实际 PostgreSQL 日志无正文/原设计/凭据泄露 | passed |

## 权限、字节、并发及回滚证据

```json
{
  "wire": {
    "actualRenderedBytes": true,
    "independentHashes": true,
    "deterministicActualOutput": true,
    "rawDesignExcluded": true,
    "tokensUnmeasured": true,
    "costNotApplicable": true,
    "oneCandidateNoAutoSelection": true
  },
  "authority": {
    "realSupportingCutoff": true,
    "missingNeverUnlimited": true,
    "symmetricIdIsolation": true
  },
  "outsideTransaction": {
    "generation-revoke": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "context-revoke": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "task": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "design": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "publication": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "policy": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    },
    "selection-aba": {
      "otherActiveTransactions": 0,
      "changeCommittedBeforeAdapterReturned": true,
      "responseRetainedNoAdmission": true
    }
  },
  "expiry": {
    "deadline": "2026-10-23 08:08:26.689067+00",
    "databaseObserved": "2026-10-23T08:08:26.709Z",
    "noCandidate": true
  },
  "idempotency": {
    "sameKeyNoInvocation": true,
    "differentRequestDenied": true,
    "sameBytesNewIdentities": true
  },
  "interruptionAuthority": {
    "revokedWriterDenied": true,
    "currentScopedAuthorCanTerminate": true,
    "lateFactsRetainedNoCandidate": true
  },
  "processInterruption": {
    "responseActuallyProduced": true,
    "processKilled": true,
    "noInventedResponse": true,
    "explicitUnresolvedHistory": true
  },
  "prepareCas": {
    "blocker": 868,
    "waiter": 870,
    "observer": 869,
    "actualBlockingConfirmed": true
  },
  "deliveryLoss": {
    "acceptedCommitPreserved": true,
    "replayNoInvocation": true,
    "atMostOne": true
  },
  "finishCas": {
    "blocker": 880,
    "waiter": 879,
    "observer": 878,
    "actualBlockingConfirmed": true
  },
  "admissionFirst": {
    "blocker": 911,
    "waiter": 909,
    "observer": 910,
    "actualBlockingConfirmed": true
  },
  "revokeFirst": {
    "blocker": 940,
    "waiter": 941,
    "observer": 942,
    "actualBlockingConfirmed": true
  },
  "integration": {
    "selectedThenRealValidation": true,
    "explicitManualApproval": true,
    "testReviewVersion": true,
    "notCanon": true,
    "generationRevocationInvalidatesApprovalInSameTransaction": true
  },
  "lineage": {
    "humanEditInheritsRoot": true,
    "noInventedCall": true,
    "noAutomaticSelectionOrInheritance": true
  },
  "legacy": {
    "originalReviewPayloadBytes": true,
    "originalDigest": true,
    "manualAndContextAndValidationAndApproval": true
  },
  "prepareRollback": {
    "midTransaction": true,
    "realCommitFailure": true,
    "outerRollback": true,
    "noInvocation": true
  },
  "finalRollback": {
    "allPhysicalRowsUnchangedAfterRollback": true,
    "realFactsSeparatelyPersisted": true
  },
  "admissionFailure": {
    "midTransaction": true,
    "realDeferredCommitFailure": true,
    "independentFacts": true,
    "noCandidateOrSuccessAudit": true
  },
  "audit": {
    "actualScope": true,
    "originalReferencesRetained": true,
    "testOnlyMetadata": true,
    "authorizedHistoryVisible": true
  },
  "acl": {
    "functions": 153,
    "publicExecute": 0,
    "basePrivileges": 0,
    "helperPermissions": 0,
    "highMemberships": 0,
    "disabledConstraints": 0,
    "faultResidue": 0,
    "executorSeparate": true
  },
  "disclosure": {
    "defaultLogs": 150,
    "actualPgLogs": true,
    "cliAndNestedErrors": true,
    "auditor": true,
    "leaks": 0,
    "authorizedBusinessResponsesSeparated": true
  }
}
```

## 未执行与边界

- 固定工程内测试适配器，没有外部网络、真实模型、工具调用、自动重试、流式输出、结构化提案、Canon、Outbox 或投影。
- 不承诺数据库外调用恰好一次；数据库候选至多接纳一次。测试字节计量不等于 token/真实费用；没有自然语言质量或生产安全保证。
