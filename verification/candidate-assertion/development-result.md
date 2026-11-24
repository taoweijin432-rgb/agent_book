# 第二批第七段 A：Candidate 正文断言与 Evidence

- run ceb3a295-b232-4419-8d53-1cdc8729c696；开始 2026-11-05T06:33:46.669Z；状态 completed；退出 0。
- PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2。
- 新增 Node 测试 6 顶层／46 子场景；失败 0；跳过 0。
- 旧回归独立按 001—007 声明边界运行：false；007 的 11 项授权时间专项见 legacy/run-result.md。未将数量相加表示覆盖率。
- 自有容器/卷清理 true；临时凭据/结果清理 true；泄密扫描 0。

## 迁移

```json
{
  "fresh": {
    "applied": 8,
    "replayApplied": 0
  },
  "upgrade": {
    "baseApplied": 7,
    "failedExit": 1,
    "failedLedger": 7,
    "noTestsAfterMigrationFailure": true,
    "oldDataExactAfterFailure": true,
    "oldDataExactAfterSuccess": true,
    "applied": 1,
    "replayApplied": 0,
    "reviewExactBytes": true,
    "oldApprovalUsableBeforeAndAfterAssertion": true,
    "realAuthorAssertion": true,
    "faultFacilitiesRemoved": true
  }
}
```

## 场景

| 分组 | 场景 | 结果 |
|---|---|---|
| A 真实人工登记、权限及来源 | 真实 author 人工 Candidate 原子登记并独立回读两类 Evidence 与来源链 | passed |
| A 真实人工登记、权限及来源 | writerA 无新 API 或底表权限 | passed |
| A 真实人工登记、权限及来源 | writerB 无新 API 或底表权限 | passed |
| A 真实人工登记、权限及来源 | validator 无新 API 或底表权限 | passed |
| A 真实人工登记、权限及来源 | commit 无新 API 或底表权限 | passed |
| A 真实人工登记、权限及来源 | projection 无新 API 或底表权限 | passed |
| A 真实人工登记、权限及来源 | 同角色跨 Novel author 拒绝读和登记；同 Novel 错 Workflow 拒绝 | passed |
| A 真实人工登记、权限及来源 | 测试生成及人工编辑继承测试来源都可登记，未伪造额外调用 | passed |
| A 真实人工登记、权限及来源 | writer 撤销后登记和重放拒绝，author 历史仍可读 | passed |
| B 精确 UTF-8、摘要与范围 | 中文 精确字节引用 | passed |
| B 精确 UTF-8、摘要与范围 | emoji 精确字节引用 | passed |
| B 精确 UTF-8、摘要与范围 | 组合字符 精确字节引用 | passed |
| B 精确 UTF-8、摘要与范围 | CRLF 精确字节引用 | passed |
| B 精确 UTF-8、摘要与范围 | LF 精确字节引用 | passed |
| B 精确 UTF-8、摘要与范围 | 空区间 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 越界 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 负数 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 中文起始截断 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | emoji结束截断 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 错误引用 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 换行规范化 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | Unicode规范化 不留部分记录 | passed |
| B 精确 UTF-8、摘要与范围 | 未知类型、确认/Canon/模型标志、消费方、客户端hash均拒绝 | passed |
| C 完整性、六字段去重及不可变 | 完整身份去重与不同合法 locator，消费方不在身份内 | passed |
| C 完整性、六字段去重及不可变 | 无支撑 Evidence 在真实 COMMIT 拒绝 | passed |
| C 完整性、六字段去重及不可变 | Assertion 缺支撑及缺 Evidence 关联在 COMMIT 拒绝 | passed |
| C 完整性、六字段去重及不可变 | 类型与对象 ID 各自不一致在实际 FK 拒绝 | passed |
| C 完整性、六字段去重及不可变 | 双支撑保持总数规则及类型专属 FK，不可冒用 Design | passed |
| C 完整性、六字段去重及不可变 | 错误正文hash及断言hash在插入时拒绝 | passed |
| C 完整性、六字段去重及不可变 | 跨 Novel/Workflow/Candidate 真实引用均有约束拒绝 | passed |
| C 完整性、六字段去重及不可变 | 非法 locator/kind 及 Canon/Tool/未实现子类型直接 SQL 拒绝 | passed |
| C 完整性、六字段去重及不可变 | 所有新增历史表 UPDATE/DELETE/TRUNCATE 以及底表/helper防绕过 | passed |
| D 原子提交和真实竞争 | 外层回滚无 Assertion/Evidence/请求/成功审计 | passed |
| D 原子提交和真实竞争 | 中途故障由子事务回滚，仅保留真实拒绝审计 | passed |
| D 原子提交和真实竞争 | 真实 COMMIT 延后故障全量回滚 | passed |
| D 原子提交和真实竞争 | 同身份唯一索引等待，先行事务提交 | passed |
| D 原子提交和真实竞争 | 同身份唯一索引等待，先行事务回滚 | passed |
| D 原子提交和真实竞争 | 同 Candidate 不同合法 Evidence 不争容器，首次异步 COMMIT 都成功 | passed |
| D 原子提交和真实竞争 | 同 Candidate 不同断言真实作者并发，均首次成功 | passed |
| D 原子提交和真实竞争 | 撤销先行拒绝；登记先行可完成，下一次拒绝 | passed |
| E 旧协议、Design 消费边界及审计 | 追加断言不改变旧审阅精确字节、校验和审批；不扩展覆盖 | passed |
| E 旧协议、Design 消费边界及审计 | 旧 Design Evidence/投影/Bundle 仍只接受 Design，不摄入 Candidate | passed |
| E 旧协议、Design 消费边界及审计 | auditor 仅元数据且跨 Novel/错 Task/错 Workflow 事件整体过滤，原审计保留 | passed |
| F 身份、函数路径、无残留及披露 | 默认 search_path 的受限 author 正例、固定函数所有者/ACL/路径 | passed |
| F 身份、函数路径、无残留及披露 | 故障设施均移除，约束与来源触发器未禁用 | passed |
| F 身份、函数路径、无残留及披露 | 默认日志、错误与auditor嵌套扫描，合法author读取仍保留正文片段 | passed |

## 真实权限、提交、并发及失败阶段

```json
{
  "failures": [
    {
      "label": "writerA helper",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "writerB helper",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "validator helper",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "commit helper",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "projection helper",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "missing evidence support",
      "stage": "commit",
      "sqlstate": "23514",
      "constraint": "evidence_source_complete"
    },
    {
      "label": "missing assertion support",
      "stage": "commit",
      "sqlstate": "23503",
      "constraint": "assertion_source_required"
    },
    {
      "label": "missing assertion link",
      "stage": "commit",
      "sqlstate": "23503",
      "constraint": "assertion_evidence_required"
    },
    {
      "label": "wrong type only",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "evidence_candidate_parent"
    },
    {
      "label": "wrong object only",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "evidence_candidate_parent"
    },
    {
      "label": "double support",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "evidence_design_source_evidence_reference_id_novel_id_auth_fkey"
    },
    {
      "label": "wrong body hash",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "assertion_content_integrity"
    },
    {
      "label": "wrong assertion hash",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "assertion_content_integrity"
    },
    {
      "label": "wrong workflow",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "assertion_candidate_owner"
    },
    {
      "label": "wrong novel",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "assertion_candidate_owner"
    },
    {
      "label": "wrong assertion candidate",
      "stage": "statement",
      "sqlstate": "23503",
      "constraint": "evidence_assertion_owner"
    },
    {
      "label": "unsupported evidence",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "evidence_supported_shape"
    },
    {
      "label": "unsupported evidence",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "evidence_supported_shape"
    },
    {
      "label": "unsupported evidence",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "evidence_supported_shape"
    },
    {
      "label": "canon unsupported",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "evidence_supported_shape"
    },
    {
      "label": "tool unsupported",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "evidence_supported_shape"
    },
    {
      "label": "narrative_assertion UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "narrative_assertion_candidate_source UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_candidate_source DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_candidate_source TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_candidate_source runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "evidence_candidate_source UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "evidence_candidate_source DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "evidence_candidate_source TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "evidence_candidate_source runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "narrative_assertion_evidence UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_evidence DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_evidence TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "narrative_assertion_evidence runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "assertion_command_request UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_command_request DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_command_request TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_command_request runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "assertion_access_audit UPDATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_access_audit DELETE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_access_audit TRUNCATE",
      "stage": "statement",
      "sqlstate": "23514",
      "constraint": "foundation_immutable"
    },
    {
      "label": "assertion_access_audit runtime",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "internal execute",
      "stage": "statement",
      "sqlstate": "42501",
      "constraint": null
    },
    {
      "label": "real author COMMIT",
      "stage": "commit",
      "sqlstate": "23514",
      "constraint": "test_commit"
    }
  ],
  "races": [
    {
      "blocker": 353,
      "waiter": 355,
      "observer": 354,
      "actualBlockingConfirmed": true,
      "firstRollback": false
    },
    {
      "blocker": 358,
      "waiter": 357,
      "observer": 359,
      "actualBlockingConfirmed": true,
      "firstRollback": true
    },
    {
      "blocker": 364,
      "waiter": 363,
      "observer": 365,
      "actualBlockingConfirmed": true,
      "firstRollback": false
    },
    {
      "blocker": 388,
      "waiter": 389,
      "observer": 390,
      "actualBlockingConfirmed": true,
      "firstRollback": false
    },
    {
      "blocker": 416,
      "waiter": 417,
      "observer": 415,
      "actualBlockingConfirmed": true,
      "firstRollback": false
    }
  ],
  "realAuthor": {
    "atomicChain": true,
    "independentConnection": true,
    "noSemanticTruth": true
  },
  "generation": {
    "actualCall": true,
    "humanEditKeepsTestOrigin": true,
    "noExtraGeneration": true
  },
  "dedup": {
    "sixFields": true,
    "differentLocator": true,
    "consumerSharing": true
  },
  "outerRollback": true,
  "midFault": {
    "noPartial": true,
    "denialPersisted": true
  },
  "realCommit": {
    "sqlstate": "23514",
    "constraint": "test_commit",
    "noSuccessDelivered": true,
    "allRowsRolledBack": true
  },
  "differentEvidenceFirstCommit": true,
  "legacyReview": {
    "exactBytes": true,
    "approvalUnchanged": true,
    "assertionsExcluded": true
  },
  "designConsumptionUnchanged": true,
  "audit": {
    "nestedScopeChecks": true,
    "originalReferencesRetained": true,
    "noContent": true
  },
  "acl": {
    "realLogins": true,
    "noTableAccess": true,
    "noRoleMembership": true,
    "fixedOwnerAndPath": true,
    "noPublicExecute": true
  },
  "noFaultFacilities": true,
  "disclosure": {
    "leaks": 0,
    "protectedAuthorReadPositive": true,
    "rawSqlAndPayloadNotLogged": true
  }
}
```

## 未执行与边界

- 仅 Candidate 正文、narrated_claim_v1、人工作业；未执行语义真实性判断、自动抽取、三类结构化提案、Canon/Tool Evidence、真实模型或生产部署验证。
- 旧校验与审批不覆盖本轮追加断言。未执行生产负载、完整恢复和全侧信道测试。
