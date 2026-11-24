# 第一批正式工程与身份底座验收

- 本轮 run：9da636f2-5f3f-4aa4-b24d-dcfac10d00c2
- 时间：2026-10-20T03:11:54.667Z
- 固定镜像：postgres:18.6；postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae
- 实际 PostgreSQL：18.6 (Debian 18.6-1.pgdg13+2)
- Node：v22.23.2；pg 8.23.0；node-pg-migrate 9.0.0
- 执行：pnpm test；最终退出：0
- 正式迁移退出：0；集成测试退出：0
- 迁移安全诊断：无错误
- 集成顶层：5（通过 5／失败 0）；参数化子场景：45；失败：0；跳过：0
- 配置/运行器控制验证：7 个顶层；退出 0（单独统计，不计入数据库场景）
- 容器清理：true；临时目录/凭据/结果清理：true
- 状态：completed；结果有效：true

## 两个全新实例与迁移失败边界

```json
[
  {
    "index": 1,
    "initialized": true,
    "firstMigrationExit": 0,
    "applied": 1,
    "replayMigrationExit": 0,
    "replayApplied": 0,
    "credentialLeaks": 0
  },
  {
    "index": 2,
    "initialized": true,
    "expectedFailureExit": 1,
    "testsStartedAfterFailure": false,
    "businessObjectsAbsent": true,
    "migrationLedgerRows": 0,
    "retryExit": 0,
    "retryApplied": 1,
    "replayApplied": 0,
    "realAuthorCreateAndRead": true,
    "faultFacilitiesRemaining": 0
  }
]
```

## 实际集成场景

| 分组 | 子场景 | 状态 |
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

## 权限、事务、并发及安全证据

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
    "blocker": 173,
    "waiter": 174,
    "observer": 175,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "readFirst": {
    "blocker": 178,
    "waiter": 179,
    "observer": 180,
    "wait_event": "transactionid",
    "actualBlockerConfirmed": true,
    "release": "COMMIT"
  },
  "expiryAfterLock": {
    "blocker": 183,
    "waiter": 184,
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
    "controlledFunctions": 17,
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

## 支持与未执行范围

- 本轮为正式 agent_book Schema 与独立 agent_book_meta 迁移账本的真实空库验收，未引用原型执行结果。
- 只支持 Novel 信息范围和独立的新作品创建启动授权；无 Scene/视角/秘密/水位授权。其他三类服务只作身份自检。
- 未执行：模型、Candidate/Design 内容、Canon、投影、生产认证/部署、连接池、规模/性能、完整恢复。逻辑 Canon 边界仅为 0。
- 直接 SQL 权限异常、技术回滚和受控业务拒绝分别验证；只有受控结果提交的拒绝才声称数据库审计持久化。
- 只删除本轮带匹配标签的实例/匿名卷及本轮临时目录，未全局清理 Docker。
