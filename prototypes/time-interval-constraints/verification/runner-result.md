# Time Interval 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成；不会覆盖手工审计报告 `result-report.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32813` 上执行 `SELECT 1`
- 测试数据库：`time_interval_fixture`
- 测试 Schema：`time_interval_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（27 个场景；27 通过；0 失败）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 time-interval-fixture-44401-1792129465935；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 八种来源类型的合法创建路径 | passed | COMMIT 成功；8 种 source_type 各自绑定数量为 1 |  |  |  |
| 区间无绑定时 INSERT 成功但 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；区间未持久化 |  |  |  |
| 顺序重复绑定使用不同主键并因 time_interval_id 唯一约束失败 | passed | INSERT SQLSTATE 23505；constraint uq_time_interval_source_interval；原绑定数量仍为 1 |  |  |  |
| 即时 CHECK 失败记录 SQLSTATE 与约束名 | passed | INSERT SQLSTATE 23514；constraint ck_time_interval_source_target_shape |  |  |  |
| 即时 FK 失败记录 SQLSTATE 与约束名 | passed | INSERT SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey |  |  |  |
| 即时约束合法但跨项目归属在 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| 来源对象区间引用更新破坏关系时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| 更新来源绑定同时校验旧区间和新区间 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；回滚后旧区间绑定保留，新区间未持久化 |  |  |  |
| 合法更新区间元数据仍可提交 | passed | COMMIT 成功；绑定仍指向同一区间 |  |  |  |
| Temporal Constraint 所属 Revision 归属不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| Candidate Version 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| Workflow Run 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| Canon Commit 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete |  |  |  |
| Author Design Revision 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 |  |  |  |
| Candidate Version 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 |  |  |  |
| Workflow Run 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 |  |  |  |
| Canon Commit 项目归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 |  |  |  |
| 已绑定 Canon Commit 从 committed 改为 preparing 不能提交 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；状态仍为 committed |  |  |  |
| 五类区间引用对象不得借用其他对象的区间 | passed | INSERT 路径和 UPDATE 路径均在 COMMIT 以 SQLSTATE 23514；constraint time_interval_source_complete 拒绝；原合法绑定保留 |  |  |  |
| 删除被绑定来源对象不能成功提交 | passed | DELETE SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey；原绑定保留 |  |  |  |
| 删除绑定不能提交留下孤立区间 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；原绑定保留 |  |  |  |
| 合法来源并发创建默认延后 COMMIT | passed | Author Design Revision: A/B COMMIT 成功；intervals=race_interval_temporal_constraint_1792129468500_256,race_interval_temporal_constraint_1792129468501_259; observed_lock_samples=1 \| Workflow Run: A/B COMMIT 成功；intervals=race_interval_candidate_event_1792129468531_269,race_interval_candidate_event_1792129468532_272; observed_lock_samples=0 \| Canon Commit: A/B COMMIT 成功；intervals=race_interval_story_event_1792129468551_281,race_interval_story_event_1792129468552_284; observed_lock_samples=0 |  |  |  |
| 父子无变化更新不形成反向等待 | passed | A/B COMMIT 成功；observed_lock_samples=0 |  |  |  |
| 容器非法更新被即时拒绝后来源可合法创建 | passed | Author Design Revision: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Workflow Run: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Candidate Version: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Canon Commit: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry |  |  |  |
| 并发归属保护：来源绑定先持锁，容器后尝试 | passed | Author Design Revision: writer blocked by PID 82; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Workflow Run: writer blocked by PID 80; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Candidate Version: writer blocked by PID 82; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Canon Commit: writer blocked by PID 80; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Candidate Version: writer blocked by PID 82; wait=transactionid; source=rollback; container UPDATE rejected 23514/time_interval_source_complete |  |  |  |
| 两个连接竞争同一区间主键：A 提交则 B 冲突 | passed | B wait_event_type=Lock; wait_event=transactionid; B SQLSTATE 23505；constraint time_interval_pkey；final binding count=1 |  |  |  |
| 两个连接竞争同一区间主键：A 回滚则 B 完成 | passed | B wait_event_type=Lock; wait_event=transactionid; A ROLLBACK 后 B COMMIT 成功；final binding count=1 |  |  |  |

## 范围声明

- 本原型只验证 Time Interval 来源绑定及最小依赖夹具。
- 不代表正式生产 Schema，也不实现 Evidence、Projection Attempt 或完整 Canon Commit。
