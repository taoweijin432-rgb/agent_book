# 第二批第二段正式安全上下文验收

- run：32065959-2e3a-48e0-9b54-2c28ffcd0994；时间 2026-10-20T09:16:02.295Z；状态 completed；最终退出 0
- PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；镜像 postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2
- 原回归在实际 002 边界执行，详见 legacy-regression.md；第一批 5/45、控制 7、第二批第一段 6/34、补授权有效期 9（运行器独立阶段）分别统计。未改写旧断言或历史报告。
- 新增集成：6 顶层／29 子场景；跳过 0；失败 0。
- 容器/匿名卷清理 true；临时凭据/结果清理 true；秘密/凭据扫描 0。

## 迁移路径

```json
{
  "fresh": {
    "applied": 3,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 2,
    "expectedFailureExit": 1,
    "testsStartedAfterFailure": false,
    "oldDataExactAfterFailedMigration": true,
    "applied": 1,
    "replayApplied": 0,
    "oldDataExactAfterUpgrade": true,
    "revocationsPreserved": true,
    "oldAuthorCommands": true,
    "newExplicitGrant": true,
    "noAutomaticWriterContext": true
  }
}
```

## 新增真实场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 正式来源、发布与真实 writer 正例 | 真实 author 创建两部作品、冻结设计和任务；秘密分布于全部原始输入 | passed |
| A 正式来源、发布与真实 writer 正例 | 未发布提案不能进入上下文；正式发布后才允许完整编译 | passed |
| A 正式来源、发布与真实 writer 正例 | 受限来源链可追溯，writer 仅见公开不透明引用与批准文字 | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 父 Evidence 缺支撑拒绝；错 Novel、Revision、类型和父子身份拒绝 | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 第二个 writer 在自己的作品正例；两个作者、作品和 writer 交叉均拒绝 | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 同 Novel 不同 Scene/人物/Task 的真实引用不能借用当前 Scope | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 元数据读取不导出上下文；writer 不能发布、读底表或调用内部函数 | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 真实错误来源、错 Task、人物类型和客户端秘密/snippet/旧策略参数均拒绝 | passed |
| B 范围隔离、正式 Evidence 和拒绝 | 缺必需投影、来源范围缺口或字节超限不生成可用半成品 | passed |
| C 冻结完整性、幂等与事务 | 同请求重放返回同一包，异请求拒绝；请求不能插入自定义 Item | passed |
| C 冻结完整性、幂等与事务 | 相同来源的旧发布前驱不能覆盖新发布；相同载荷也须重新编译 | passed |
| C 冻结完整性、幂等与事务 | 缺少未列入任务引用的适用硬约束仍阻断，恢复发布才可重新编译 | passed |
| C 冻结完整性、幂等与事务 | 数据库拒绝缺 Item、缺来源、错误 hash 和错误顺序，独立读取无半成品 | passed |
| C 冻结完整性、幂等与事务 | Bundle、Item、来源、Evidence、发布和治理历史普通 DML 不可变 | passed |
| C 冻结完整性、幂等与事务 | 编译中途故障和外层回滚不留 Bundle、Item、来源或成功审计 | passed |
| C 冻结完整性、幂等与事务 | 真实 COMMIT 延后故障：函数可返回，服务不能交付可用结果 | passed |
| D 撤销、期限和真实并发 | 原撤销入口可撤销新授权：撤销先持保护，等待取包拒绝 | passed |
| D 撤销、期限和真实并发 | 编译先受保护完成，撤销等待；下一次取用及旧请求重放拒绝 | passed |
| D 撤销、期限和真实并发 | 投影撤销先持保护，等待编译拒绝并保留原发布历史 | passed |
| D 撤销、期限和真实并发 | 取包先受保护完成，投影撤销等待；下一次取包拒绝 | passed |
| D 撤销、期限和真实并发 | 等待期间跨过授权期限，观察数据库时间后释放保护仍拒绝 | passed |
| E 变更失效、历史审计与范围 | 策略变化拒绝旧 writer 包；旧来源和历史发布仍可追溯 | passed |
| E 变更失效、历史审计与范围 | 任务版本改变后旧输入失效，重新授权和发布才能编译新版本 | passed |
| E 变更失效、历史审计与范围 | Design 生效版本改变后旧包拒绝；包和原历史任务不改写 | passed |
| E 变更失效、历史审计与范围 | 审计分别验证记录 Task 与实际资源：跨 Novel 资源与错 Task 事件不返回，合法记录保留 | passed |
| E 变更失效、历史审计与范围 | 拒绝审计真实提交，独立连接可读，writer 不可伪造 | passed |
| F 权限元数据、日志及完整输出扫描 | 新任务授权继承有限作者支撑截止，不因 NULL 请求变为永久授权 | passed |
| F 权限元数据、日志及完整输出扫描 | 003 后旧命令仍可用；真实角色、函数 ACL、所有者及约束正常 | passed |
| F 权限元数据、日志及完整输出扫描 | 随机秘密、受限来源标识、嵌套错误、CLI 和日志全通道扫描 | passed |

## 并发、来源、预算及回滚证据

```json
{
  "path": {
    "realAuthorPublish": true,
    "realWriterCompileAndRead": true,
    "allFourRequiredItems": true,
    "rawTaskGoalNotCopied": true,
    "actualBytesAndHashVerified": true,
    "tokenBudgetNotClaimed": true
  },
  "sources": {
    "completeFormalFKChain": true,
    "hiddenSourceIdentifiersAbsent": true,
    "auditorTracePositive": true,
    "sameNovelWrongRevisionRejected": true
  },
  "evidenceIdentity": {
    "sixFieldsUnique": true,
    "consumerExcluded": true,
    "secondTaskAndWriterReuse": true,
    "missingSupportAndForeignRevisionDenied": true
  },
  "requiredProjection": {
    "allApplicableHardRulesRequired": true,
    "taskConstraintRequired": true,
    "unbackedCharacterExcluded": true,
    "byteBudgetRejectsWholeBundle": true
  },
  "integrity": {
    "missingItem": true,
    "missingSource": true,
    "wrongHash": true,
    "wrongOrder": true,
    "publicReferenceDistinctFromInternalId": true,
    "independentPhysicalCountsUnchanged": true,
    "historicalAppendWithNewPublicationDenied": true
  },
  "technicalDiagnostics": [
    {
      "operation": "context:compile",
      "sqlstate": "P0001",
      "functions": [
        "public",
        "_ctx_compile",
        "api_safe_context"
      ]
    },
    {
      "operation": "context:audit",
      "sqlstate": "42501",
      "functions": []
    },
    {
      "operation": "context:audit",
      "sqlstate": "42501",
      "functions": []
    },
    {
      "operation": "context:audit",
      "sqlstate": "42501",
      "functions": []
    }
  ],
  "atomicity": {
    "midItemFailure": true,
    "outerRollback": true,
    "realCommitFailure": true,
    "serviceWaitsForCommit": true,
    "allPhysicalRowsUnchanged": true
  },
  "grantRevokeFirst": {
    "blocker": 266,
    "waiter": 265,
    "observer": 267,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "compileBeforeGrantRevoke": {
    "blocker": 271,
    "waiter": 270,
    "observer": 272,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "projectionRevokeFirst": {
    "blocker": 278,
    "waiter": 280,
    "observer": 279,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "readBeforeProjectionRevoke": {
    "blocker": 290,
    "waiter": 291,
    "observer": 289,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "expiryAfterLock": {
    "blocker": 299,
    "waiter": 300,
    "sourceDeadline": "2026-10-20 09:16:32.610505+00",
    "databaseObservedAfterDeadline": "2026-10-20 09:16:32.611204+00",
    "actualBlockerConfirmed": true,
    "deniedAfterExpiry": true
  },
  "history": {
    "policyChangeInvalidatesWriter": true,
    "restrictedHistoryReadable": true,
    "newPublicationRequired": true,
    "taskChangeInvalidatesWriter": true,
    "designChangeInvalidatesWriter": true,
    "bundleBytesUnchanged": true
  },
  "auditScope": {
    "foreignResourcesAndMismatchedTaskEventsFiltered": true,
    "legitimateOtherTaskResourceRetained": true,
    "ordinaryAndLegalHistoryRetained": true,
    "rawAuditReferencesPreserved": true
  },
  "denialAudit": {
    "independentlyCommitted": true,
    "writerCannotForge": true
  },
  "delegation": {
    "finiteSourceExpiryPreserved": true,
    "missingSourceNeverMeansUnlimited": true
  },
  "databasePermissions": {
    "controlledFunctions": 61,
    "publicExecute": 0,
    "privateHelperExecute": 0,
    "runtimeBasePrivileges": 0,
    "highPrivilegeMemberships": 0,
    "allOwnedByNoLoginOwner": true,
    "unvalidatedConstraints": 0,
    "disabledTriggers": 0,
    "faultFacilities": 0
  },
  "disclosure": {
    "randomCanaryNeverPrinted": true,
    "rawGoalNameMotivationRulesTitlesCovered": true,
    "completeNestedWriterResponses": 52,
    "defaultLogRecords": 152,
    "credentialAndSecretLeaks": 0,
    "naturalLanguageInferenceNotClaimed": true
  }
}
```

## 未执行与边界

- 不实现 Workflow、Generation、模型调用、候选、校验、审批、Canon、投影消费或外部检索；没有人物知识/读者披露历史，不做自然语言泄密识别。
- 安全投影是作者批准的有限指令，不是 Canon Fact；只支持三个真实 Author Design 来源类型。字节预算不代表实际 token 窗口或模型调用准入。
- 仅清理本轮匹配标签的容器、匿名卷和临时文件；生产、灾备与规模测试未执行。
