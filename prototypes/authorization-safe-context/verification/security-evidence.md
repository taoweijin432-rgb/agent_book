# 审计资源 Scope 修复安全证据

## 四个阶段分开记录

1. 历史：旧运行 109 个子场景通过。旧报告与安全证据保存于 `audit-scope-repair/before/verification/`，不能据此宣称已覆盖本次缺陷。
2. 修复前真实复现：原代码逐字节核对，新实例、原夹具、真实 writerA 与 auditor。跨项目过滤审计 1 条，其他水位/类别/命题检查满足，A 审计读取实际带出 B 标识 1 条，嵌套检查为 true；原审计不变。原始标识和 canary 均未输出。
3. 修复后新增：10 个回归全部执行并通过，见下表。
4. 本轮完整运行：五组 119 个子场景通过，保留全部历史 109 项，无遗漏。TAP 含 5 个顶层合计 124。

## 新增回归实际结果

| 场景 | 状态 | 只含安全标签、布尔与计数的证据 |
|---|---|---|
| 修复回归：场景受限审计员为真实独立 LOGIN | passed | {"realRestrictedLogin":true,"noRoleMembership":true,"noOwnedTables":true,"sceneRestricted":true,"viewpointStillTaskBound":true} |
| 修复回归：A 任务审计不得返回 B 的真实资源标识 | passed | {"foreignFilterAudits":6,"otherWatermarkClassPropositionChecksPass":true,"requestAllowed":true,"nestedForeignIdentifiers":0,"originalAuditPreserved":true,"foreignSourceRefsTested":1} |
| 修复回归：场景 越界事件与来源均不可随结果返回 | passed | {"rawEvents":1,"sourceRows":1,"taskRequestAllowed":true,"nestedForbiddenIdentifiers":0,"originalAuditPreserved":true,"sourceTaskAlsoOutsideSceneOrWatermark":true} |
| 修复回归：水位 越界事件与来源均不可随结果返回 | passed | {"rawEvents":6,"sourceRows":1,"taskRequestAllowed":true,"nestedForbiddenIdentifiers":0,"originalAuditPreserved":true,"sourceTaskAlsoOutsideSceneOrWatermark":true} |
| 修复回归：类别 越界事件与来源均不可随结果返回 | passed | {"rawEvents":6,"sourceRows":10,"taskRequestAllowed":true,"nestedForbiddenIdentifiers":0,"originalAuditPreserved":true,"sourceTaskAlsoOutsideSceneOrWatermark":false} |
| 修复回归：命题 越界事件与来源均不可随结果返回 | passed | {"rawEvents":6,"sourceRows":10,"taskRequestAllowed":true,"nestedForbiddenIdentifiers":0,"originalAuditPreserved":true,"sourceTaskAlsoOutsideSceneOrWatermark":false} |
| 修复回归：允许资源、无资源普通事件和项目级资源仍可追溯 | passed | {"authorizedEventsRetained":true,"authorizedSourceIdentifiersRetained":true,"nullResourceEventsRetained":true,"projectLevelSourcesRetained":true} |
| 修复回归：合法旧版本来源不受当前业务检索过滤器影响 | passed | {"notCurrentBusinessVersion":true,"legalFrozenHistoricalSource":true,"historicalEventAndSourceRetained":true,"originalAuditPreserved":true} |
| 修复回归：写作身份仍不能读审计，B 任务与其他人物视角仍拒绝 | passed | {"writingAuditDenied":true,"foreignTaskDenied":true,"taskViewpointCheckRetained":true} |
| 修复回归：新内部范围判断缺目标默认拒绝且无公开执行旁路 | passed | {"missingResourceDenied":true,"writerHelperDenied":true,"auditorHelperDenied":true} |

跨场景/超水位的来源由合法的其他场景/高水位 Task 编译，因此 source_refs 的父 Task 也被过滤；类别/命题反例的来源父 Task 在 Scope 内。事件反例均由允许 Task 真实引用越界资源，隔离资源字段检查。没有关闭约束或制造非法 Bundle 来源。

## 原有撤销竞争继续实际执行

| 场景 | 持锁 PID | 等待 PID | 观察 PID | 具体阻塞 | 结果 |
|---|---:|---:|---:|---|---|
| 撤销先持稳定锁并提交，已阻塞的旧包取用拒绝 | 307 | 308 | 309 | Lock/transactionid | ACCESS_DENIED |
| 取用先完成受保护判定，撤销等待，下一次取用拒绝 | 312 | 313 | 314 | Lock/transactionid | revocation_committed |

## 原有审计持久化、完整性及扫描

| 场景 | 证据 |
|---|---|
| 拒绝审计在独立事务连接实际可读，且不记录秘密原文 | {"deniedBefore":23,"deniedAfter":24,"durableDenial":true,"transaction":"controlled_result_then_commit"} |
| 真实 COMMIT 发现缺失来源，返回前的包不对外生效 | {"functionReturned":true,"physicalCountsUnchanged":true,"before":{"bundles":20,"items":152,"refs":152,"candidates":3,"generations":4}} |
| 同事务编译/Generation/Candidate 返回后外层回滚，全量物理计数不变 | {"before":{"bundles":20,"items":152,"refs":152,"candidates":3,"generations":4},"afterEqual":true,"outerRollback":true} |
| 全部辅助函数关闭 PUBLIC 执行权且受控所有者固定 search_path | {"controlledFunctions":33,"publicExecute":0,"noHelperBypass":true,"disabledTriggers":0} |
| 最终模型通道/默认日志/Trace/导出再次全量泄密扫描 | {"sensitiveMarkers":123,"modelResponses":77,"defaultLogs":92,"leaks":0,"scope":"database_and_tool_boundary_not_natural_language_inference"} |

权限正例仍由真实登录执行；初始化管理员只用于夹具和受限核验。新内部函数和所有辅助函数的所有者、固定 search_path、PUBLIC/写作权限继续被全量枚举检查。

## 原始审计与历史来源

- 修复只过滤读取的整条不可见事件；未清空引用、删除或改写过滤审计。新增核心/范围/历史场景均独立读取原始行作逐字段前后比较。
- 对 NULL 引用的普通事件保留原 Task 授权；允许项目级资源和允许来源标识均实际保留。
- 合法 v1 先冻结为来源，再追加 v2；v1 已非当前业务检索版本，审计事件和 source_refs 仍可追溯。

## 保护及清理

- 使用本轮独立 `audit-scope-repair/protected-sha256-before.txt`，不覆盖历史清单。保护运行器、网关、依赖、锁文件、根 .gitignore、正式文档和十二个旧原型。
- 保护核验及实际文件变更见 `audit-scope-repair/hash-validation.txt` 与 `file-manifest.txt`。
- 容器清理结果：已删除本轮容器 authorization-safe-context-fixture-52714-1792462310695；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 复现实例及其临时模块/结果也已清理；无全局 Docker 清理，无 Git 暂存/提交/推送/reset/clean。
- 只修复当前原型的审计读取资源边界，不宣称完成正式整合、完整认证、所有侧信道或自然语言零泄密保证。
