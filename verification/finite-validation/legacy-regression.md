# 第二批第一段：作者设计版本与场景任务验收

- run：f02bd08c-53c2-4104-83bc-77f068ac3648；时间：2026-10-20T09:16:02.295Z
- 执行：pnpm test；退出：0；状态：completed
- 镜像：postgres:18.6；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae；Node v22.23.2；PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)
- 这是本轮修复后的正式工程实际执行；历史通过、未修复 002 与原报告见 expiry-repair/before/；修复前真实复现见 expiry-repair/before-reproduction.json。
- 第一批回归：5 顶层／45 子场景；控制测试 7 个（分别统计）。
- 新增：6 顶层／34 子场景；跳过 0；结果有效 true。
- 容器/匿名卷清理 true；临时凭据/结果清理 true；泄密扫描 0。

## 迁移路径与失败边界

```json
{
  "fresh": {
    "applied": 2,
    "replayApplied": 0
  },
  "upgrade": {
    "firstBatchApplied": 1,
    "realAuthorNovels": 3,
    "expectedMigrationFailureExit": 1,
    "testsStartedAfterFailure": false,
    "rollbackPreservedAllOriginalRows": true,
    "applied": 1,
    "replayApplied": 0,
    "allHistoricalRowsUnchanged": true,
    "revocationsPreserved": true,
    "readerNotElevated": true,
    "metadataOnlyAuthorNotElevated": true,
    "independentAuthorNotElevated": true,
    "creationStartupRevocationDidNotEraseExistingNovelAuthority": true,
    "granted": 2,
    "withheld": 1,
    "faults": 0
  },
  "provenance": {
    "missingCreationEvidenceRejected": true,
    "exit": 1,
    "firstBatchIntact": true
  }
}
```

## 本轮有效期专项（运行器独立阶段，不混入 Node 数量）

```json
{
  "stage": "runner_independent_expiry_regressions",
  "count": 9,
  "passed": 9,
  "failed": 0,
  "skipped": 0,
  "sharedUpgrade": {
    "migrationExit": 0,
    "seededNovels": 4,
    "withheldNovels": 2,
    "sourceHistoryUnchanged": true,
    "replayApplied": 0,
    "facilities": 0
  },
  "cases": [
    {
      "name": "both_finite_different_deadlines",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": "2026-10-20 09:17:14.381411+00",
        "observed_at": "2026-10-20 09:16:14.388613+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": "2026-10-20 09:17:44.381411+00",
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": "2026-10-20 09:17:14.381411+00",
            "revoked": false
          }
        ]
      },
      "expectedExpiry": "2026-10-20 09:17:14.381411+00",
      "capabilities": [
        {
          "capability_key": "design.edit",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "design.freeze",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "design.read",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "structure.manage",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "task.append",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "task.create",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        },
        {
          "capability_key": "task.read",
          "expires_at": "2026-10-20 09:17:14.381411+00",
          "effective_at": "2026-10-20 09:16:15.063028+00"
        }
      ],
      "disposition": "seeded",
      "ledger": 2,
      "realAuthorAllowed": true,
      "realAuthorError": null,
      "sameUpgrade": true
    },
    {
      "name": "read_finite_revoke_unlimited",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": "2026-10-20 09:17:14.41718+00",
        "observed_at": "2026-10-20 09:16:14.424406+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": null,
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": "2026-10-20 09:17:14.41718+00",
            "revoked": false
          }
        ]
      },
      "expectedExpiry": "2026-10-20 09:17:14.41718+00",
      "capabilities": [
        {
          "capability_key": "design.edit",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "design.freeze",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "design.read",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "structure.manage",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "task.append",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "task.create",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        },
        {
          "capability_key": "task.read",
          "expires_at": "2026-10-20 09:17:14.41718+00",
          "effective_at": "2026-10-20 09:16:15.062478+00"
        }
      ],
      "disposition": "seeded",
      "ledger": 2,
      "realAuthorAllowed": true,
      "realAuthorError": null,
      "sameUpgrade": true
    },
    {
      "name": "read_unlimited_revoke_finite",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": "2026-10-20 09:17:14.45465+00",
        "observed_at": "2026-10-20 09:16:14.461523+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": "2026-10-20 09:17:14.45465+00",
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": null,
            "revoked": false
          }
        ]
      },
      "expectedExpiry": "2026-10-20 09:17:14.45465+00",
      "capabilities": [
        {
          "capability_key": "design.edit",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "design.freeze",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "design.read",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "structure.manage",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "task.append",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "task.create",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        },
        {
          "capability_key": "task.read",
          "expires_at": "2026-10-20 09:17:14.45465+00",
          "effective_at": "2026-10-20 09:16:15.0601+00"
        }
      ],
      "disposition": "seeded",
      "ledger": 2,
      "realAuthorAllowed": true,
      "realAuthorError": null,
      "sameUpgrade": true
    },
    {
      "name": "both_unlimited",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": null,
        "observed_at": "2026-10-20 09:16:14.500392+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": null,
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": null,
            "revoked": false
          }
        ]
      },
      "expectedExpiry": null,
      "capabilities": [
        {
          "capability_key": "design.edit",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "design.freeze",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "design.read",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "structure.manage",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "task.append",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "task.create",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        },
        {
          "capability_key": "task.read",
          "expires_at": null,
          "effective_at": "2026-10-20 09:16:15.061903+00"
        }
      ],
      "disposition": "seeded",
      "ledger": 2,
      "realAuthorAllowed": true,
      "realAuthorError": null,
      "sameUpgrade": true
    },
    {
      "name": "initially_expired",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": "2026-10-20 09:16:14.779536+00",
        "observed_at": "2026-10-20 09:16:14.537233+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": null,
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": "2026-10-20 09:16:14.779536+00",
            "revoked": false
          }
        ],
        "databaseObservedExpiredBeforeMigration": "2026-10-20 09:16:14.796038+00"
      },
      "expectedExpiry": "2026-10-20 09:16:14.779536+00",
      "capabilities": [],
      "disposition": "withheld_revoked_or_expired",
      "ledger": 2,
      "realAuthorAllowed": false,
      "realAuthorError": "ACCESS_DENIED",
      "sameUpgrade": true
    },
    {
      "name": "initially_revoked",
      "status": "passed",
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": null,
        "observed_at": "2026-10-20 09:16:14.916247+00",
        "sources_valid": false,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": null,
            "revoked": true
          },
          {
            "capability_key": "novel.read",
            "expires_at": null,
            "revoked": true
          }
        ]
      },
      "expectedExpiry": null,
      "capabilities": [],
      "disposition": "withheld_revoked_or_expired",
      "ledger": 2,
      "realAuthorAllowed": false,
      "realAuthorError": "ACCESS_DENIED",
      "sameUpgrade": true
    },
    {
      "name": "eligible_then_expired_before_seed",
      "status": "passed",
      "synchronization": {
        "migrationPid": 91,
        "blockerPid": 90,
        "wait_event": "advisory",
        "actualStageConfirmed": true,
        "stage": "DDL_execution_after_up_eligibility_before_seed_inserts",
        "sourceDeadline": "2026-10-20 09:16:19.524742+00",
        "databaseObservedAfterDeadline": "2026-10-20 09:16:19.537267+00",
        "release": "COMMIT"
      },
      "migrationExit": 1,
      "failedUpgrade": {
        "grants": [],
        "ledger": 1,
        "disposition": null,
        "faultFacilities": 0
      },
      "retryExit": 0,
      "retry": {
        "casePrerequisites": {
          "source_count": 2,
          "other_prerequisites": true,
          "creation_provenance": true,
          "first_deadline": "2026-10-20 09:16:19.524742+00",
          "observed_at": "2026-10-20 09:16:16.731636+00",
          "sources_valid": true,
          "source_expiries": [
            {
              "capability_key": "grant.revoke",
              "expires_at": null,
              "revoked": false
            },
            {
              "capability_key": "novel.read",
              "expires_at": "2026-10-20 09:16:19.524742+00",
              "revoked": false
            }
          ]
        },
        "expectedExpiry": null,
        "capabilities": [],
        "disposition": "withheld_revoked_or_expired",
        "ledger": 2,
        "realAuthorAllowed": false,
        "realAuthorError": "ACCESS_DENIED"
      },
      "sourceHistoryUnchanged": true,
      "facilities": 0
    },
    {
      "name": "seeded_finite_then_expired_before_commit",
      "status": "passed",
      "synchronization": {
        "migrationPid": 91,
        "blockerPid": 90,
        "wait_event": "advisory",
        "actualStageConfirmed": true,
        "stage": "all_seed_inserts_completed_before_immutable_triggers_and_commit",
        "sourceDeadline": "2026-10-20 09:16:24.086517+00",
        "databaseObservedAfterDeadline": "2026-10-20 09:16:24.103068+00",
        "release": "COMMIT"
      },
      "migrationExit": 0,
      "casePrerequisites": {
        "source_count": 2,
        "other_prerequisites": true,
        "creation_provenance": true,
        "first_deadline": "2026-10-20 09:16:24.086517+00",
        "observed_at": "2026-10-20 09:16:21.293349+00",
        "sources_valid": true,
        "source_expiries": [
          {
            "capability_key": "grant.revoke",
            "expires_at": "2026-10-20 09:16:24.086517+00",
            "revoked": false
          },
          {
            "capability_key": "novel.read",
            "expires_at": null,
            "revoked": false
          }
        ]
      },
      "expectedExpiry": "2026-10-20 09:16:24.086517+00",
      "capabilities": [
        {
          "capability_key": "design.edit",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "design.freeze",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "design.read",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "structure.manage",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "task.append",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "task.create",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        },
        {
          "capability_key": "task.read",
          "expires_at": "2026-10-20 09:16:24.086517+00",
          "effective_at": "2026-10-20 09:16:21.392908+00"
        }
      ],
      "disposition": "seeded",
      "ledger": 2,
      "realAuthorAllowed": false,
      "realAuthorError": "ACCESS_DENIED",
      "sourceHistoryUnchanged": true,
      "facilities": 0
    },
    {
      "name": "failure_on_fourth_seed_row",
      "status": "passed",
      "failureExit": 1,
      "observedInsertAttempts": 4,
      "wholeUpgradeRolledBack": true,
      "migrationLedgerAfterFailure": 1,
      "upgradeTableAfterFailureAbsent": true,
      "grantsAfterFailure": 0,
      "retryExit": 0,
      "retry": [
        {
          "casePrerequisites": {
            "source_count": 2,
            "other_prerequisites": true,
            "creation_provenance": true,
            "first_deadline": null,
            "observed_at": "2026-10-20 09:16:25.874344+00",
            "sources_valid": true,
            "source_expiries": [
              {
                "capability_key": "grant.revoke",
                "expires_at": null,
                "revoked": false
              },
              {
                "capability_key": "novel.read",
                "expires_at": null,
                "revoked": false
              }
            ]
          },
          "expectedExpiry": null,
          "capabilities": [
            {
              "capability_key": "design.edit",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "design.freeze",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "design.read",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "structure.manage",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "task.append",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "task.create",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            },
            {
              "capability_key": "task.read",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.118908+00"
            }
          ],
          "disposition": "seeded",
          "ledger": 2,
          "realAuthorAllowed": true,
          "realAuthorError": null
        },
        {
          "casePrerequisites": {
            "source_count": 2,
            "other_prerequisites": true,
            "creation_provenance": true,
            "first_deadline": null,
            "observed_at": "2026-10-20 09:16:25.908557+00",
            "sources_valid": true,
            "source_expiries": [
              {
                "capability_key": "grant.revoke",
                "expires_at": null,
                "revoked": false
              },
              {
                "capability_key": "novel.read",
                "expires_at": null,
                "revoked": false
              }
            ]
          },
          "expectedExpiry": null,
          "capabilities": [
            {
              "capability_key": "design.edit",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "design.freeze",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "design.read",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "structure.manage",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "task.append",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "task.create",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            },
            {
              "capability_key": "task.read",
              "expires_at": null,
              "effective_at": "2026-10-20 09:16:26.120075+00"
            }
          ],
          "disposition": "seeded",
          "ledger": 2,
          "realAuthorAllowed": true,
          "realAuthorError": null
        }
      ],
      "sourceHistoryUnchanged": true,
      "facilities": 0
    }
  ]
}
```

## 场景结果

| 分组 | 场景 | 结果 |
|---|---|---|
| A 正式身份与作品正反例 | 真实 author CLI 创建返回后已完成 COMMIT，独立连接可读 | passed |
| A 正式身份与作品正反例 | 独立 author B 创建第二作品，跨作品授权拒绝 | passed |
| A 正式身份与作品正反例 | 受信初始化登记 writer/auditor 最小范围；真实 writer 读取成功 | passed |
| A 正式身份与作品正反例 | 真实 authorA 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | 真实 writerA 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | 真实 auditorA 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | 真实 validator 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | 真实 commit 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | 真实 projection 身份自检来自 session_user | passed |
| A 正式身份与作品正反例 | writer 不能创建作品、撤销授权或调用授权初始化器 | passed |
| A 正式身份与作品正反例 | 无授权、已到期、已撤销及停用身份拒绝，有效授权保留正例 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 actor_id 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 role 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 scope 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 scene_id 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 viewpoint_id 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 secret_scope 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 不支持或伪造 max_canon_watermark 明确拒绝 | passed |
| B 数据库边界与伪造输入 | 可控会话变量不改变真实主体 | passed |
| B 数据库边界与伪造输入 | 运行登录不能 SET ROLE 到高权限身份 | passed |
| B 数据库边界与伪造输入 | 运行登录不能 SET ROLE 到高权限身份 | passed |
| B 数据库边界与伪造输入 | 运行登录不能 SET ROLE 到高权限身份 | passed |
| B 数据库边界与伪造输入 | 运行登录不能 SET SESSION AUTHORIZATION 到所有者 | passed |
| B 数据库边界与伪造输入 | writer 底表或内部函数直接访问拒绝 | passed |
| B 数据库边界与伪造输入 | writer 底表或内部函数直接访问拒绝 | passed |
| B 数据库边界与伪造输入 | writer 底表或内部函数直接访问拒绝 | passed |
| B 数据库边界与伪造输入 | writer 底表或内部函数直接访问拒绝 | passed |
| B 数据库边界与伪造输入 | writer 底表或内部函数直接访问拒绝 | passed |
| B 数据库边界与伪造输入 | writer 伪造审计、授权以及 Governance 修改均无权限 | passed |
| B 数据库边界与伪造输入 | validator、commit-service、projection-worker 未实现业务无执行权 | passed |
| B 数据库边界与伪造输入 | Volume/Chapter/Scene 归属由真实 FK 拒绝，不计作权限正例 | passed |
| B 数据库边界与伪造输入 | 归属、Scope 与授权历史普通 DML 不可改绑 | passed |
| C 创建原子性及真实 COMMIT | 创建事务内返回后外层回滚，不留下作品、Scope、授权或成功审计 | passed |
| C 创建原子性及真实 COMMIT | 第二项初始授权写入故障，真实入口安全报错且全量回滚 | passed |
| C 创建原子性及真实 COMMIT | 撤销后审计写入故障同事务回滚，原授权仍有效 | passed |
| C 创建原子性及真实 COMMIT | 函数返回后真实 COMMIT 延后故障，服务不交付成功或半成品 | passed |
| D 稳定锁、撤销与期限 | 撤销先持锁并提交，等待中的真实 writer 判定拒绝 | passed |
| D 稳定锁、撤销与期限 | 许可判定先完成可完成本次，撤销等待后生效，下一次拒绝 | passed |
| D 稳定锁、撤销与期限 | 等待中跨过授权期限，取锁后使用数据库实时时间拒绝 | passed |
| E 审计范围、元数据与披露 | 业务拒绝审计真实提交，由独立连接读取 | passed |
| E 审计范围、元数据与披露 | 审计检查记录作品及实际资源，保留普通事件和原始引用 | passed |
| E 审计范围、元数据与披露 | 作者不能撤销其他作品授权，创建接口不能指定他人或既有 Scope | passed |
| E 审计范围、元数据与披露 | 作者只能撤销自己的新作品启动授权，既有作品读取仍按 Novel Grant 判断 | passed |
| E 审计范围、元数据与披露 | 逐角色属性、成员关系、所有者、ACL、函数路径及触发器核验 | passed |
| E 审计范围、元数据与披露 | 日志、CLI 错误、数据库日志与验收输出不披露随机凭据 | passed |
| F 作者结构、草案、冻结与任务正例 | 真实作者创建结构及 Entity，第二作者独立作品 | passed |
| F 作者结构、草案、冻结与任务正例 | 可编辑草案：受控预期版本更新，人物与约束归属检查 | passed |
| F 作者结构、草案、冻结与任务正例 | 冻结完整集合并生效，独立受限连接可回读来源关系 | passed |
| F 作者结构、草案、冻结与任务正例 | 创建稳定任务与追加版本，当前指针及历史绑定同事务 | passed |
| F 作者结构、草案、冻结与任务正例 | 真实 CLI 读许可设计并经过 COMMIT；输出与安全日志分离 | passed |
| G 跨作品、类型、范围与权限 | 独立 author 跨作品读取、编辑、冻结与任务均拒绝且不披露摘要 | passed |
| G 跨作品、类型、范围与权限 | writer 元数据正例不等于设计权限；其他服务及审计员无设计入口权 | passed |
| G 跨作品、类型、范围与权限 | 实际存在的跨 Novel Scene、人物和约束引用分别拒绝 | passed |
| G 跨作品、类型、范围与权限 | 实际存在的跨作品 Revision 与草案引用拒绝；B 的完整设计正例 | passed |
| G 跨作品、类型、范围与权限 | 同 Novel 错 Revision 约束、错误人物类型与结构 FK 独立拒绝 | passed |
| G 跨作品、类型、范围与权限 | 数据库复合 FK 直接拒绝错绑（独立于入口参数检查） | passed |
| G 跨作品、类型、范围与权限 | 请求 actor/role/scope、全知/分支/草稿依赖、非零水位及后续命令拒绝 | passed |
| H 不可变、历史、摘要与幂等 | 冻结后编辑拒绝；版本、约束、绑定、归属与 TRUNCATE 拒绝普通 DML | passed |
| H 不可变、历史、摘要与幂等 | 旧 Revision 派生新草案，历史内容与旧任务绑定保持不变 | passed |
| H 不可变、历史、摘要与幂等 | 同键同请求返回原结果；不同请求拒绝，重放不倒退当前指针 | passed |
| H 不可变、历史、摘要与幂等 | 结构与编辑请求重放不重复写入，服务新 UUID 不影响请求摘要 | passed |
| H 不可变、历史、摘要与幂等 | 冻结集合不能在历史 Revision 上追加条目，延后完整性检查拒绝 | passed |
| H 不可变、历史、摘要与幂等 | 按原协议独立核验所有持久化摘要，UUID/时间不进入重试请求摘要 | passed |
| I 实际连接竞争与版本前驱 | 同草案并发编辑：预期版本仅允许一方成功 | passed |
| I 实际连接竞争与版本前驱 | 编辑先于冻结：旧编辑号冻结拒绝且没有错配摘要 | passed |
| I 实际连接竞争与版本前驱 | 冻结先于编辑：旧草案不可再编辑 | passed |
| I 实际连接竞争与版本前驱 | 两草案竞争当前生效版本：预期当前 Revision 阻止丢失更新 | passed |
| I 实际连接竞争与版本前驱 | 同任务竞争追加：仅一个当前前驱成功 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 冻结集合中途故障，全量回滚 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 当前指针切换中途故障，全量回滚 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 任务追加中途故障，不留版本或部分当前指针 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 函数已返回后真实 COMMIT 故障；服务不交付成功，完整回滚 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 任务追加真实 COMMIT 延后故障，历史与当前指针全部回滚 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 外层回滚不留下冻结内容或成功审计 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 撤销先提交，等待的新增结构命令拒绝 | passed |
| J 中途与 COMMIT 故障、授权竞争 | 新增业务先受保护完成，撤销等待；后续操作与历史重放均拒绝 | passed |
| K 数据库安全与输出边界 | 新增函数所有者、固定路径、PUBLIC/角色 ACL 与底表权限 | passed |
| K 数据库安全与输出边界 | 拒绝审计独立连接可读；许可审计不含设计载荷或任意细粒度引用 | passed |
| K 数据库安全与输出边界 | 固定日志、嵌套错误、数据库日志与报告扫描零秘密/凭据披露 | passed |

## 新增权限、并发、回滚及摘要证据

```json
{
  "authorPath": {
    "realRestrictedLogin": true,
    "structureAndEntityCreatedThroughAPI": true,
    "completeThroughAppendedTaskVersion": true
  },
  "references": {
    "foreignNovelScene": true,
    "foreignNovelCharacter": true,
    "nonCharacterViewpoint": true,
    "wrongRevisionConstraint": true,
    "foreignNovelParent": true
  },
  "history": {
    "oldRevisionRetained": true,
    "oldTaskBindingRetained": true,
    "currentSeparateFromFrozenContent": true
  },
  "digests": {
    "protocol": "ab-jsonb-v1",
    "requestCount": 39,
    "frozenCount": 5,
    "taskVersionCount": 4,
    "allIndependentlyRehashed": true,
    "actualRelationalPayloadMatched": true
  },
  "concurrentEdit": {
    "blocker": 345,
    "waiter": 344,
    "observer": 346,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "editThenFreeze": {
    "blocker": 349,
    "waiter": 350,
    "observer": 351,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "freezeThenEdit": {
    "blocker": 355,
    "waiter": 356,
    "observer": 354,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "competingDrafts": {
    "blocker": 363,
    "waiter": 362,
    "observer": 364,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "competingTaskVersions": {
    "blocker": 367,
    "waiter": 369,
    "observer": 368,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "rollback": {
    "midFreeze": true,
    "headSwitch": true,
    "taskAppend": true,
    "realCommitFailure": true,
    "functionReturnedBeforeFailedCommit": true,
    "physicalCountsAndPointersUnchanged": true,
    "taskRealCommitFailure": true
  },
  "revokeThenBusiness": {
    "blocker": 412,
    "waiter": 413,
    "observer": 411,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "businessThenRevoke": {
    "blocker": 415,
    "waiter": 416,
    "observer": 417,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "permissions": {
    "controlledFunctions": 35,
    "ownerOnly": true,
    "publicExecute": 0,
    "privateHelperExecute": 0,
    "runtimeTablePrivileges": 0,
    "unvalidatedConstraints": 0,
    "disabledTriggers": 0,
    "faultResidue": 0
  },
  "audit": {
    "independentlyCommittedDenial": true,
    "onlyNovelResourcesForNewOperations": true,
    "noDesignPayload": true
  },
  "disclosure": {
    "randomDesignCanaryInternalOnly": true,
    "authorizedReadPositive": true,
    "channelsScanned": [
      "logs",
      "CLI errors",
      "nested denials",
      "database logs",
      "evaluation/report"
    ],
    "markers": 33,
    "leaks": 0
  }
}
```

## 第一批本轮回归证据

```json
{
  "databaseRejections": {
    "23503": 3,
    "23514": 15,
    "42501": 18,
    "42883": 1
  },
  "ownership": {
    "legalHierarchy": true,
    "foreignNovelChapterDenied": true,
    "foreignNovelSceneDenied": true,
    "missingNovelVolumeDenied": true
  },
  "atomicity": {
    "functionReturnedInsideTransaction": true,
    "serviceWaitsForCommit": true,
    "physicalCountsUnchanged": true
  },
  "revokeFirst": {
    "blocker": 174,
    "waiter": 175,
    "observer": 176,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "readFirst": {
    "blocker": 179,
    "waiter": 180,
    "observer": 181,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "expiryAfterLock": {
    "blocker": 184,
    "waiter": 185,
    "expiredByDatabaseClock": true
  },
  "denialAudit": {
    "independentlyCommitted": true,
    "before": 1,
    "after": 2
  },
  "auditScope": {
    "foreignNovelAndGrantIdentifiersAbsent": true,
    "ordinaryAndAllowedResourceRetained": true,
    "rawAuditPreserved": true,
    "unsupportedResourceDenied": true
  },
  "databasePermissions": {
    "runtimeLogins": 14,
    "noMemberships": true,
    "controlledFunctions": 35,
    "publicExecute": 0,
    "allTablesOwnedByNoLoginOwner": true,
    "ownerCannotLogin": true,
    "migratorSetOnlyOwnerMembership": true,
    "runtimeBaseTablePrivileges": 0,
    "noUnvalidatedConstraints": true,
    "noDisabledTriggersOrFaults": true
  },
  "disclosure": {
    "defaultLogRecords": 47,
    "credentialMarkers": 32,
    "leaks": 0,
    "rawSqlOrPrivateErrorsReturned": false,
    "technicalFailureLogs": 7,
    "businessOrInputDenialLogs": 25
  }
}
```

## 未执行和边界

- 无真实模型、Bundle、Workflow、候选、校验、审批、Canon、Evidence 全域、投影、生产认证和规模测试。
- 任务预算只校验结构/数值，读者范围不代表实际披露；设计约束只保存作者意图，不执行自然语言规则。
- 只清理本轮带匹配标签的容器、匿名卷和临时目录；第一批历史验收文件保持只读。
