# Time Interval 约束原型结果报告

> 本报告区分上一轮 `26/26` 历史基线、本轮修复前父子锁实验和本轮修复后结果。数据库实验均来自一次性空库；手动执行不等同于 `pnpm prototype` 一键流程。

## 上一轮历史基线

- 上一轮结果：`26/26` 通过。
- 本轮继续保留旧新区间、来源归属链、五类反向区间引用、独立连接回滚、三类合法共享容器创建及既有并发保护路径。

## 修复前父子锁交错实验

- 实验顺序：提交完整合法 Workflow Run、Candidate Version、Candidate Event、Time Interval 和绑定；A 执行 `UPDATE workflow_run SET project_id=project_id` 并保持未提交；B 执行 `UPDATE candidate_version SET project_id=project_id`；观察 B；再提交 A。
- 观察连接确认 B 的 `UPDATE candidate_version` 被 A 的 PID 阻塞，`wait_event_type=Lock`、`wait_event=transactionid`、`pg_blocking_pids=[A]`。
- 在 B 等待期间，独立连接执行 Candidate Version `FOR UPDATE NOWAIT`，返回 `SQLSTATE 55P03`，说明 B 已持有 Candidate Version 目标行锁。
- 释放 A 后，B 的 UPDATE 返回 `SQLSTATE 40P01`、`deadlock detected`；最终合法数据只保留原始完整关系。
- 结论：问题成立。PostgreSQL 18.6 的实际执行行为不支持“BEFORE ROW 触发器一定先取得 Workflow Run 锁、再取得 Candidate Version 行锁”的假设。原始机器结果保存在 `verification/parent-child-lock-pre-fix.json`。

## 修复方式

- 删除 `candidate_version_lock_before_write` 及其辅助函数，不再依赖 BEFORE ROW 触发器先锁父行。
- Revision、Workflow Run、Candidate Version 的项目归属变化由数据库 BEFORE UPDATE 触发器立即拒绝；Candidate Version 的 `workflow_run_id` 变化也立即拒绝。
- Canon Commit 的项目归属变化立即拒绝；已为 `committed` 的 Canon Commit 不允许回退到其他状态；`preparing → committed` 未由本原型禁止。
- 无变化 UPDATE 允许执行，并跳过新的延后关系扫描，因为该 UPDATE 不改变项目归属、容器引用或 Canon 状态。
- 容器属性校验继续使用 `FOR NO KEY UPDATE`；来源对象和 Time Interval 继续使用 `FOR UPDATE`；外键的父行 `KEY SHARE` 不再被升级为 `FOR UPDATE`。
- 实际相关身份变化不是通过跳过字段绕过，而是由数据库立即拒绝；来源对象、容器引用、项目归属和区间绑定的已有完整性校验仍保留。

## 修复后真实锁行为与边界

| 路径 | 原始 DML/FK 行为 | 修复后行为 |
|---|---|---|
| Candidate Version 相关身份 UPDATE | 执行器可能先取得 Candidate Version 目标行锁，BEFORE ROW 不能改变这一时机 | 相关身份变化在 BEFORE UPDATE 立即拒绝；无变化 UPDATE 不触发新的延后关系扫描 |
| Workflow Run/Revision 项目归属 UPDATE | 目标容器行可能已被执行器锁定 | 相关归属变化立即拒绝；不再进入父子关系锁循环 |
| Canon Commit 项目归属/已提交状态回退 | 目标 Canon Commit 行可能已被执行器锁定 | 非法治理变化立即拒绝；合法来源提交路径不受影响 |
| 合法来源创建 | 来源 FK 取得父行 `KEY SHARE`，延后校验保护父属性使用 `FOR NO KEY UPDATE` | 共享同一父容器的合法来源事务可首次提交 |

本轮结论只覆盖 Time Interval 来源完整性相关路径，不声称任意业务事务都不会死锁。

## 本轮执行环境与路径

- 执行日期：`2026-09-28`。
- PostgreSQL 镜像：`postgres:18.6`；Server：`18.6 (Debian 18.6-1.pgdg13+2)`。
- 镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`。
- Node.js：`v22.23.2`；`node-pg-migrate@9.0.0`；`pg@8.23.0`。
- 事务隔离级别：`READ COMMITTED`。
- 实际迁移命令：`pnpm run migrate:up`，退出码 `0`。
- 实际测试命令：`pnpm test`，退出码 `0`。
- 执行路径：一次性容器→宿主机映射 TCP `SELECT 1`→空库→迁移→测试；未把 `pnpm prototype` 写成一键通过。
- 本轮容器已清理；未执行全局 Docker 清理。

## 本轮测试结果

本轮共 `27` 个场景，`27` 通过，`0` 失败，`0` 跳过，`0` 未执行。原始 Node 测试结果保存在 `verification/test-results-parent-child-post-fix.json`。

| 场景 | 状态 | 关键证据 | SQLSTATE | 约束 |
|---|---|---|---|---|
| 八种来源类型的合法创建路径 | passed | COMMIT 成功；8 种 source_type 各自绑定数量为 1 |  |  |
| 区间无绑定时 INSERT 成功但 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；区间未持久化 | 23514 | time_interval_source_complete |
| 顺序重复绑定使用不同主键并因 time_interval_id 唯一约束失败 | passed | INSERT SQLSTATE 23505；constraint uq_time_interval_source_interval；原绑定数量仍为 1 | 23505 | uq_time_interval_source_interval |
| 即时 CHECK 失败记录 SQLSTATE 与约束名 | passed | INSERT SQLSTATE 23514；constraint ck_time_interval_source_target_shape | 23514 | ck_time_interval_source_target_shape |
| 即时 FK 失败记录 SQLSTATE 与约束名 | passed | INSERT SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey | 23503 | time_interval_source_candidate_event_id_fkey |
| 即时约束合法但跨项目归属在 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| 来源对象区间引用更新破坏关系时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| 更新来源绑定同时校验旧区间和新区间 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；回滚后旧区间绑定保留，新区间未持久化 | 23514 | time_interval_source_complete |
| 合法更新区间元数据仍可提交 | passed | COMMIT 成功；绑定仍指向同一区间 |  |  |
| Temporal Constraint 所属 Revision 归属不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| Candidate Version 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| Workflow Run 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| Canon Commit 归属链不一致时 COMMIT 失败 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete | 23514 | time_interval_source_complete |
| Author Design Revision 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 | 23514 | time_interval_source_complete |
| Candidate Version 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 | 23514 | time_interval_source_complete |
| Workflow Run 归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 | 23514 | time_interval_source_complete |
| Canon Commit 项目归属更新不能破坏已绑定来源 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留 | 23514 | time_interval_source_complete |
| 已绑定 Canon Commit 从 committed 改为 preparing 不能提交 | passed | UPDATE SQLSTATE 23514；constraint time_interval_source_complete；状态仍为 committed | 23514 | time_interval_source_complete |
| 五类区间引用对象不得借用其他对象的区间 | passed | INSERT 路径和 UPDATE 路径均在 COMMIT 以 SQLSTATE 23514；constraint time_interval_source_complete 拒绝；原合法绑定保留 | 23514 | time_interval_source_complete |
| 删除被绑定来源对象不能成功提交 | passed | DELETE SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey；原绑定保留 | 23503 | time_interval_source_candidate_event_id_fkey |
| 删除绑定不能提交留下孤立区间 | passed | COMMIT SQLSTATE 23514；constraint time_interval_source_complete；原绑定保留 | 23514 | time_interval_source_complete |
| 合法来源并发创建默认延后 COMMIT | passed | Author Design Revision: A/B COMMIT 成功；intervals=race_interval_temporal_constraint_1790576613488_256,race_interval_temporal_constraint_1790576613488_259; observed_lock_samples=0 \| Workflow Run: A/B COMMIT 成功；intervals=race_interval_candidate_event_1790576613510_269,race_interval_candidate_event_1790576613511_272; observed_lock_samples=1 \| Canon Commit: A/B COMMIT 成功；intervals=race_interval_story_event_1790576613819_281,race_interval_story_event_1790576613821_284; observed_lock_samples=0 |  |  |
| 父子无变化更新不形成反向等待 | passed | A/B COMMIT 成功；observed_lock_samples=0 |  |  |
| 并发归属保护：容器先持锁，来源绑定后尝试 | passed | Author Design Revision: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Workflow Run: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Candidate Version: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Canon Commit: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry \| Candidate Version: container UPDATE immediately rejected 23514/time_interval_source_complete; source COMMIT succeeded; no retry |  |  |
| 并发归属保护：来源绑定先持锁，容器后尝试 | passed | Author Design Revision: writer blocked by PID 114; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Workflow Run: writer blocked by PID 116; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Candidate Version: writer blocked by PID 114; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Canon Commit: writer blocked by PID 116; wait=transactionid; source=commit; container UPDATE rejected 23514/time_interval_source_complete \| Candidate Version: writer blocked by PID 114; wait=transactionid; source=rollback; container UPDATE rejected 23514/time_interval_source_complete |  |  |
| 两个连接竞争同一区间主键：A 提交则 B 冲突 | passed | B wait_event_type=Lock; wait_event=transactionid; B SQLSTATE 23505；constraint time_interval_pkey；final binding count=1 | 23505 | time_interval_pkey |
| 两个连接竞争同一区间主键：A 回滚则 B 完成 | passed | B wait_event_type=Lock; wait_event=transactionid; A ROLLBACK 后 B COMMIT 成功；final binding count=1 |  |  |

## 回滚和独立连接证据

- 四项容器归属更新测试现在在 `UPDATE` 语句阶段以 `23514/time_interval_source_complete` 失败；独立连接确认原项目归属、来源对象、区间和绑定保留。
- 已提交 Canon Commit 回退测试现在在 `UPDATE` 语句阶段失败；独立连接确认状态仍为 `committed`。
- 持锁事务提交/回滚、共享父容器合法来源创建和无变化父子 UPDATE 均首次执行完成，没有自动重试。

## 哈希机器证据

- `verification/protected-docs-sha256-before.txt` 和 `verification/protected-docs-sha256-after.txt` 均由机器从实际文件生成。
- `verification/hash-validation.txt` 自动确认：16 个文件、路径集合完整、无重复、每个哈希匹配 `^[0-9a-f]{64}$`、本轮前后清单相同。
- 当前没有 Git 提交或可独立复核的更早物理文件快照，因此只能声明“本轮前后未变化”；不能验证更早历史报告与文件状态的关系。
- 上一轮报告中错误或不完整的哈希文本不再作为核验依据；本表直接来自本轮 after 清单。

| 文档 | SHA-256 |
|---|---|
| `docs/00-document-map.md` | `3d922d63bef9902bb2c9784f90abfccf239ae4ee16fec6d173104726f01b4e2b` |
| `docs/01-project-vision-and-scope.md` | `e2a81d8b4c2452f1411aa6f77b5d553b0a527cc1ef160e50f568d45c65e18b4f` |
| `docs/02-product-requirements.md` | `dc4576db7829c6de0c1b510fbb1bd0bc1197427e0c38aa9f7c474f88dd41797f` |
| `docs/03-drift-definition-and-quality-model.md` | `e190edcdc9ea016588ad08e4be78fd5a1f10642ea6be1d6524a5b12918257a88` |
| `docs/04-dual-source-of-truth-spec.md` | `ac98eb7b9f256c055fea94bb6488dd33e6f858293909d2865df7a1f5a122f930` |
| `docs/05-system-architecture.md` | `25f43ba742a0f61b0f48b87261434fa1842c017ce19ce4606a12296d17ae4566` |
| `docs/06-narrative-data-model.md` | `832c2864351636834220fbfe3d32936f7f1b35b6faeefe3721b60d10cf485783` |
| `docs/07-context-assembly-spec.md` | `8b2b3fd5453de82ae7f86e92bb531e4bf27669749acd1c7dce64c83bc34b6319` |
| `docs/08-canon-commit-protocol.md` | `6bc04984ddf037dd97af30a9b7038891a7655fd31745ed9e61a38bd81039bfce` |
| `docs/09-database-logical-model.md` | `1d8c41dd7b322ed090e3ff45e27b28c2947c0d8cfad28dac345a0c6e5ac88f3f` |
| `docs/10-logical-entity-catalog.md` | `d11dce1b05c7a752af6886015163d096f850db994baefdd451f3f673eb82da18` |
| `docs/11-data-invariants-and-transaction-boundaries.md` | `63c272830b8c9fe3085516c0c6153da70740fe1eee3328eb32057f6914fb3f9a` |
| `docs/12-relational-physical-schema.md` | `a1020cd592687d608c13cb4f343befab5df75674bc9be938a71185c5d83efc10` |
| `docs/13-database-constraints-indexes-and-concurrency.md` | `0fd29ecb94d1b9d3c3f6c9e541476caad3e0026e2df2e4851ab9fdcea3f813fc` |
| `docs/14-data-lifecycle-migration-and-recovery.md` | `8fd8386ab3a40f409506939e4f949b8a9263afb32b4b0b89fccd2c02331fbf28` |
| `docs/15-database-implementation-plan.md` | `5ba96ba44fc8b4f7a3434068c1a5e6d44a9f818140cd8933594fda6ba75fdf6d` |

## 未解决问题

- 运行器的 TCP 就绪检查、Node 版本动态记录、旧结果文件清理等专项问题仍留待下一轮。
- 本轮未进入 Evidence、Projection Attempt、完整 Canon Commit 或正式生产 Schema。
- 本轮未声称全系统死锁自由。
