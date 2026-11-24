# Time Interval 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成；不会覆盖手工审计报告 `result-report.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32810` 上执行 `SELECT 1`
- 测试数据库：`time_interval_fixture`
- 测试 Schema：`time_interval_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`42`
- 测试结果状态：**未取得有效测试结果**（测试异常退出（退出码 42））
- 容器清理结果：已删除本轮容器 time-interval-fixture-76220-1792122464760；未执行全局 Docker 清理
- 临时结果清理：运行前：已删除 .test-results.json；运行后：结果文件不存在，无需清理

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 未取得有效测试结果 | 未执行 | 测试异常退出（退出码 42）；未读取或展示任何旧场景记录 | | | |

## 范围声明

- 本原型只验证 Time Interval 来源绑定及最小依赖夹具。
- 不代表正式生产 Schema，也不实现 Evidence、Projection Attempt 或完整 Canon Commit。
