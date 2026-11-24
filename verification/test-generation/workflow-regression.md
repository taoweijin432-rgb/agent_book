# 第二批第三段：人工 Workflow 与不可变 Candidate 验收

- run：fcc153bc-044a-46cb-8d20-98b35adb7b3d；时间 2026-10-23T08:06:44.476Z；退出 0；状态 completed
- PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2
- 原有回归按 002/003 边界执行，记录在本目录 legacy-regression.md、context-regression.md；历史报告原字节保留。
- 本轮：6 顶层／29 子场景，失败 0，跳过 0。
- 自有容器及匿名卷清理 true；临时凭据/结果清理 true；泄密扫描 0。

## 迁移

```json
{
  "fresh": {
    "applied": 4,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 3,
    "failedExit": 1,
    "testsStartedAfterFailure": false,
    "failedLedger": 3,
    "oldDataExactAfterFailure": true,
    "applied": 1,
    "replayApplied": 0,
    "oldDataExactAfterUpgrade": true,
    "baseAndContextRevocationsPreserved": true,
    "oldAuthorAndWriterCommands": true,
    "newWorkflowTrueRestrictedLogin": true,
    "faultFacilitiesRemoved": true
  }
}
```

## 场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 真实人工路径与精确正文 | 上下文权不导出写作权，真实作者显式发放后建立人工 Workflow | passed |
| A 真实人工路径与精确正文 | 人工录入、编辑新身份、相同正文不同身份，不自动选择 | passed |
| A 真实人工路径与精确正文 | 正文按字节幂等，CRLF/LF和Unicode不同请求；空白、非法字符及上限拒绝 | passed |
| A 真实人工路径与精确正文 | writer 仅得公开候选信息，author 可来源追溯，auditor 无正文 | passed |
| B 真实归属与入口边界 | 两个 Novel、writer、author 交叉读写及授权均拒绝 | passed |
| B 真实归属与入口边界 | 同 Novel 不同 Task 和原上下文 Grant 的真实 Bundle 不可错绑 | passed |
| B 真实归属与入口边界 | 实际存在的跨 Workflow 前序与选择、缺前序均拒绝 | passed |
| B 真实归属与入口边界 | 数据库复合 FK 拒绝错 writer/Task/Bundle/前序，普通登录底表与 helper 拒绝 | passed |
| B 真实归属与入口边界 | 请求 actor/role/Scope/Bundle 覆盖及后续未实现入口明确拒绝 | passed |
| C 选择版本、ABA 与并发 | 显式 A→B→A 递增选择版本，旧请求重放不移动指针 | passed |
| C 选择版本、ABA 与并发 | 两真实事务竞争相同期望选择版本，仅一个成功 | passed |
| C 选择版本、ABA 与并发 | 写作授权与旧两类授权 ID 双向无歧义 | passed |
| D 授权期限、撤销与实际阻塞 | 上下文有限期与作者有限支撑分别约束新授权，原记录保持 | passed |
| D 授权期限、撤销与实际阻塞 | 写作授权撤销先提交，等待候选操作拒绝且正文不可回放 | passed |
| D 授权期限、撤销与实际阻塞 | 候选先完成受保护操作，撤销等待；之后选择和读取拒绝 | passed |
| D 授权期限、撤销与实际阻塞 | 原上下文授权撤销后新授权、创建、编辑、选择、读取和重放全部拒绝 | passed |
| D 授权期限、撤销与实际阻塞 | 原上下文授权实际到期，持久化写作授权不变但真实作者发放和 writer 取用拒绝 | passed |
| D 授权期限、撤销与实际阻塞 | 等待中跨越写作截止，观察实际数据库时间后释放保护仍拒绝 | passed |
| E Bundle 失效与历史 | publication 变化后所有 writer 操作与重放拒绝，author 历史保留 | passed |
| E Bundle 失效与历史 | policy 变化后所有 writer 操作与重放拒绝，author 历史保留 | passed |
| E Bundle 失效与历史 | task 变化后所有 writer 操作与重放拒绝，author 历史保留 | passed |
| E Bundle 失效与历史 | design 变化后所有 writer 操作与重放拒绝，author 历史保留 | passed |
| F 原子性、数据库权限与披露 | 中途故障和外层回滚不留新增物理行或成功审计 | passed |
| F 原子性、数据库权限与披露 | 真实 COMMIT 延后故障，函数返回不等于服务成功；选择历史与指针全回滚 | passed |
| F 原子性、数据库权限与披露 | 冻结记录 UPDATE/DELETE/TRUNCATE 拒绝，输入及不完整选择无法普通 DML 改绑 | passed |
| F 原子性、数据库权限与披露 | 审计核验实际资源 Novel/Task/Workflow，错范围整条过滤且原记录保留 | passed |
| F 原子性、数据库权限与披露 | 004 后旧关键命令可用；真实身份、所有者、ACL、固定路径与故障设施核验 | passed |
| F 原子性、数据库权限与披露 | 真实 CLI 提交人工正文，标准输出与安全日志分离，嵌套错误不带正文 | passed |
| F 原子性、数据库权限与披露 | 默认日志、错误、完整嵌套输出不泄露正文标记、原始设计或受限标识 | passed |

## 权限、并发、摘要与回滚证据

```json
{
  "manual": {
    "realAuthorAndWriter": true,
    "originExplicit": true,
    "noGenerationRecords": true,
    "metadataOnlyAndContextOnlyDenied": true,
    "sameBodyNewIdentity": true,
    "exactUtf8HashAndReadback": true,
    "noImplicitSelection": true
  },
  "textProtocol": {
    "name": "exact-utf8-v1",
    "maxBytes": 262144,
    "independentlyHashed": true,
    "newlineAndUnicodePreserved": true
  },
  "ownership": {
    "sameNovelOtherTask": true,
    "sameNovelOtherWriter": true,
    "wrongOriginalContextGrant": true
  },
  "selection": {
    "abaNewSelectionVersion": true,
    "oldReplayDoesNotMoveHead": true,
    "editDoesNotSelect": true
  },
  "selectionRace": {
    "blocker": 225,
    "waiter": 223,
    "observer": 224,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "grantIds": {
    "allThreeTypesBothDirections": true
  },
  "validity": {
    "contextFinitePreserved": true,
    "authorFinitePreserved": true,
    "nullRequestNotUnlimited": true,
    "oldGrantAndRevocationPreserved": true
  },
  "revokeFirst": {
    "blocker": 308,
    "waiter": 309,
    "observer": 307,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "operationFirst": {
    "blocker": 334,
    "waiter": 336,
    "observer": 335,
    "actualBlockerConfirmed": true,
    "wait_event": "transactionid"
  },
  "parentExpiry": {
    "deadline": "2026-10-23 08:07:27.617372+00",
    "databaseObserved": "2026-10-23 08:07:27.629342+00",
    "limitedGrantUnchanged": true,
    "realWriterDenied": true
  },
  "expiryWait": {
    "blocker": 546,
    "waiter": 544,
    "observer": 545,
    "actualBlockerConfirmed": true,
    "deadline": "2026-10-23 08:07:29.806047+00",
    "databaseObserved": "2026-10-23 08:07:29.806711+00",
    "denied": true
  },
  "staleInputs": {
    "publication": {
      "allWriterActionsAndReplayDenied": true,
      "historicalBodyUnchanged": true
    },
    "policy": {
      "allWriterActionsAndReplayDenied": true,
      "historicalBodyUnchanged": true
    },
    "task": {
      "allWriterActionsAndReplayDenied": true,
      "historicalBodyUnchanged": true
    },
    "design": {
      "allWriterActionsAndReplayDenied": true,
      "historicalBodyUnchanged": true
    }
  },
  "diagnostics": [
    {
      "operation": "candidate:input",
      "sqlstate": "P0001",
      "functions": [
        "public",
        "_wf_write",
        "api_manual_workflow"
      ]
    }
  ],
  "rollback": {
    "midInsert": true,
    "outerRollback": true,
    "allNewTablesAndPointersUnchanged": true,
    "realCommitFailure": true,
    "functionReturnedBeforeCommit": true,
    "serviceWithheldSuccess": true
  },
  "audit": {
    "taskAndActualResourceIndependentlyScoped": true,
    "wrongWorkflowAndForeignNovelFiltered": true,
    "rawReferencesPreserved": true,
    "denialIndependentlyCommitted": true,
    "noBodyForAuditor": true
  },
  "database": {
    "controlledFunctions": 77,
    "publicExecute": 0,
    "privateHelperExecute": 0,
    "baseTablePrivileges": 0,
    "highPrivilegeMemberships": 0,
    "unvalidatedConstraints": 0,
    "disabledTriggers": 0,
    "faultResidue": 0
  },
  "cli": {
    "realCommitBeforeResponse": true,
    "authorizedBodyOnlyOnStdout": true,
    "logAndNestedErrorLeaks": 0
  },
  "databaseLog": {
    "actualDockerLogScanned": true,
    "credentialBodyAndSourceLeaks": 0
  },
  "disclosure": {
    "logs": 176,
    "fullResponses": 176,
    "errors": 78,
    "defaultLogAndErrorLeaks": 0,
    "rawDesignAndHiddenIdentifiers": 0,
    "bodyOnlyInAuthorizedBusinessResponses": true,
    "noAutomaticDeclassification": true
  }
}
```

## 未执行

- 没有模型、Generation、校验、审批、结构化提案、Canon、Outbox、投影或跨 Workflow 草稿依赖。输入水位固定 0。
- 人工正文是受保护业务内容，不做自动脱密；exact-utf8-v1 上限 262144 字节仅为入口保护；未做 token、长篇质量、生产认证、灾备或性能验收。
