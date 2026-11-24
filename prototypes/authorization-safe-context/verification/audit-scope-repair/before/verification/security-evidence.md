# 最终安全验收证据摘录

本文件只提取最终 runner-result.md 的安全标签、计数、身份与 PID；不包含 canary、凭据、原始来源 ID、秘密原文或内部校验解释。

## 运行与身份

- 5 个顶层测试、109 个子场景全部通过；TAP 114；迁移/测试/最终退出码均为 0。
- 本轮角色前缀：`asc_2a7e75e1dd92`。所有密码在测试内存生成，没有写入报告。

| 主体 | 实际 session_user | 外层 current_user | 非超级用户 | 无成员关系 | 非表所有者 |
|---|---|---|---|---|---|
| author | asc_2a7e75e1dd92_author | asc_2a7e75e1dd92_author | True | True | True |
| writerA | asc_2a7e75e1dd92_writera | asc_2a7e75e1dd92_writera | True | True | True |
| writerB | asc_2a7e75e1dd92_writerb | asc_2a7e75e1dd92_writerb | True | True | True |
| peer | asc_2a7e75e1dd92_peer | asc_2a7e75e1dd92_peer | True | True | True |
| validator | asc_2a7e75e1dd92_validator | asc_2a7e75e1dd92_validator | True | True | True |
| auditor | asc_2a7e75e1dd92_auditor | asc_2a7e75e1dd92_auditor | True | True | True |
| expiring | asc_2a7e75e1dd92_expiring | asc_2a7e75e1dd92_expiring | True | True | True |
| disabled | asc_2a7e75e1dd92_disabled | asc_2a7e75e1dd92_disabled | True | True | True |

NOLOGIN 所有者不用于正例登录；作者、写作、校验、审计正例均由上述各自新连接完成。

## 具体阻塞 PID 与撤销顺序

| 场景 | 持锁 PID | 等待 PID | 观察 PID | 实际阻塞 | 第一次操作 | 恢复后的结果 |
|---|---:|---:|---:|---|---|---|
| 撤销先持稳定锁并提交，已阻塞的旧包取用拒绝 | 265 | 266 | 267 | Lock/transactionid，blockers=[265] | revocation_committed | ACCESS_DENIED |
| 取用先完成受保护判定，撤销等待，下一次取用拒绝 | 270 | 271 | 272 | Lock/transactionid，blockers=[270] | one_read_authorized_before_revocation | revocation_committed |

稳定 Gate 在撤销记录创建前即存在。先观察具体阻塞，再提交持锁事务；不依赖随机 sleep 或死锁重试。

## 实际扫描与边界计数

| 场景 | 安全证据 |
|---|---|
| 各模型实际可见通道及嵌套字段完整扫描 | {"channels": 47, "markers": 113, "leaks": 0, "nestedScan": true} |
| 候选正文与错误请求含 canary，默认日志/Trace/导出仍只用白名单 | {"logRecords": 58, "traceRecords": 58, "exportRows": 58, "rawPayloadLogging": false, "leaks": 0} |
| 拒绝审计在独立事务连接实际可读，且不记录秘密原文 | {"deniedBefore": 23, "deniedAfter": 24, "durableDenial": true, "transaction": "controlled_result_then_commit"} |
| 直接数据库拒绝与工具入口拒绝分别留证 | {"directPermissionErrors": 30, "controlledToolDenials": 33, "safeToolErrors": 5} |
| 全部辅助函数关闭 PUBLIC 执行权且受控所有者固定 search_path | {"controlledFunctions": 32, "publicExecute": 0, "noHelperBypass": true, "disabledTriggers": 0} |
| 最终模型通道/默认日志/Trace/导出再次全量泄密扫描 | {"sensitiveMarkers": 113, "modelResponses": 72, "defaultLogs": 78, "leaks": 0, "scope": "database_and_tool_boundary_not_natural_language_inference"} |

扫描包括随机原文、原文 SHA-256、来源/版本/证据 ID、标题、路径、嵌套字段；末组重新检查全部写作响应、默认日志、Trace、导出、测试证据与含故障的数据库日志。原始值不写入报告。

## 原子性与持久化

| 场景 | 阶段 / SQLSTATE / 约束 | 安全证据 |
|---|---|---|
| context_source_reference 写入失败无半成品 | INSERT | {"allPhysicalCountsBefore": {"bundles": 15, "items": 102, "refs": 102, "candidates": 3, "generations": 3}, "afterEqual": true, "noUsablePartialBundleOrCandidate": true} |
| candidate_version 写入失败无半成品 | INSERT | {"allPhysicalCountsBefore": {"bundles": 16, "items": 109, "refs": 109, "candidates": 3, "generations": 4}, "afterEqual": true, "noUsablePartialBundleOrCandidate": true} |
| 真实 COMMIT 发现缺失来源，返回前的包不对外生效 | COMMIT / P0001 / bundle_source_binding | {"functionReturned": true, "physicalCountsUnchanged": true, "before": {"bundles": 16, "items": 109, "refs": 109, "candidates": 3, "generations": 4}} |
| 同事务编译/Generation/Candidate 返回后外层回滚，全量物理计数不变 |  | {"before": {"bundles": 16, "items": 109, "refs": 109, "candidates": 3, "generations": 4}, "afterEqual": true, "outerRollback": true} |

技术故障和外层回滚没有半成品 Bundle / Item / Reference / Generation / Candidate。来源故意遗漏时函数可先返回，但真实 COMMIT 被 bundle_source_binding 拒绝，不能向模型交付该包。

拒绝审计使用普通拒绝结果并真实 COMMIT；独立连接确实读到增加的拒绝记录。直接数据库 42501 和工具固定错误另外留安全证据，不混称为已持久化的数据库拒绝审计。

## 清理与保护

- 容器清理结果：已删除本轮容器 authorization-safe-context-fixture-34425-1792461027367；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 测试故障设施 finally 删除，业务触发器未关闭；角色随本轮实例销毁。
- 前后重新枚举及 SHA-256 结果见 hash-validation.txt；实际交付见 file-manifest.txt。
- 本结果只证明所列数据库/工具边界，不证明完整认证、所有侧信道或自然语言零泄密。
