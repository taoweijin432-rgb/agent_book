# 修复前真实复现

原迁移与原测试文件均先与本轮 before 快照逐字节核对；仅在临时模块中复用原初始化夹具并注册复现场景，原仓库代码未改。全新一次性 PostgreSQL 18.6 实例，角色和数据库均为本轮专属。

- migrationSucceeded: true
- testSucceeded: true
- originalCodeUnchanged: true
- originalFixtures: true
- writerRealLogin: true
- auditorRealLogin: true
- crossProjectFilteredAuditRows: 1
- otherWatermarkClassPropositionConditionsPass: true
- auditApiSucceeded: true
- crossProjectEventsReturned: 1
- nestedForeignIdentifierPresent: true
- originalAuditUnchanged: true
- containerRemoved: true
- temporaryResultsRemoved: true

实测结论：缺陷已复现。真实 auditor 读取 A 的审计时返回了 B 的资源标识；其他范围条件满足，原跨项目过滤审计保持不变。

证据只保留标签、布尔与计数；无资源 ID、canary 或原始审计内容。未覆盖历史 109 场景报告；未修改运行器或工具网关。
