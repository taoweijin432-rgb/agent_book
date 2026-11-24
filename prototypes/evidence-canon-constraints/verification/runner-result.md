# Evidence Canon 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32822` 上执行 `SELECT 1`
- 测试数据库：`evidence_canon_fixture`
- 测试 Schema：`evidence_canon_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（18 个场景；18 通过；0 失败）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 evidence-canon-fixture-45114-1792136545761；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 六种 Canon 来源分别提交完整父子关系 | passed | 6 个参数化子场景真实 COMMIT 成功；正文 ID 与 Commit ID 分离；canonical_text_version、canon_commit、story_event、canon_fact、state_transition、temporal_relation 均可完整回读 |  |  |  |
| 同事务 preparing 到 committed 后可整体提交 | passed | preparing Commit、来源对象与 Evidence 同事务创建，状态更新为 committed 后真实 COMMIT 成功 |  |  |  |
| 来源 Commit 最终为 preparing 或 failed 时拒绝提交 | passed | 2 个状态子场景均在真实 COMMIT 以 23514/evidence_canon_complete 失败，且无 Evidence 半成品 |  |  |  |
| 历史已提交来源可被后续 Evidence 引用 | passed | 来源 Commit 与对象先独立提交，后续事务创建 Evidence 成功；不要求来自消费方当前 Commit |  |  |  |
| 只有 Evidence 父行时真实 COMMIT 失败 | passed | 父 INSERT 成功；COMMIT 以 23514/evidence_canon_complete 失败；独立连接确认父行未持久化 |  |  |  |
| 重复支撑、悬空 FK 与错误目标组合命中各自即时约束 | passed | 3 个即时子场景分别命中 23505/evidence_canon_source_pkey、23503/fk_evidence_canon_story_event、23514/ck_evidence_canon_source_target_shape；未混算为延后约束通过 |  |  |  |
| 父子类型与对象 ID 不一致分别延后失败 | passed | 2 个独立子场景：类型不一致保持同一文本 ID，对象不一致保持同一类型；前置关系均合法，COMMIT 以 23514/evidence_canon_complete 失败且无半成品 |  |  |  |
| 版本、项目与创建 Commit 不一致分别延后失败 | passed | 3 个单错误子场景：source_version:23514/evidence_canon_complete；project:23514/evidence_canon_complete；creating_commit:23514/evidence_canon_complete；均整体回滚 |  |  |  |
| 六字段完整身份重复由父表唯一约束拒绝 | passed | 不同 Evidence 主键的相同六字段身份在 INSERT 以 23505/uq_evidence_reference_full_identity 失败；原链保留 |  |  |  |
| 旧四字段相同但实际来源对象不同可分别提交 | passed | 旧四字段完全相同、Story Event 实际对象不同的两条 Evidence 均提交，证明旧索引非唯一 |  |  |  |
| 同一来源对象可按不同 locator 或 evidence_kind 建立证据 | passed | 同一实际来源对象的不同 locator 或 evidence_kind 均可分别提交 |  |  |  |
| Evidence、支撑、来源归属及 Commit 终态不可改写 | passed | 7 个修改子场景分别命中 evidence_canon_immutable、evidence_canon_complete 或 evidence_canon_commit_terminal；独立连接确认原合法链和两种终态保留 |  |  |  |
| public search_path 下全限定合法来源可提交 | passed | 新建直连连接 search_path=public，全部业务对象全限定；5 个函数路径已核对，合法父子真实 COMMIT 并由另一连接回读 |  |  |  |
| public search_path 下缺失支撑仍命中目标约束 | passed | 前置 INSERT 成功；COMMIT 以 23514/evidence_canon_complete 失败而非名称解析错误；新连接确认无半成品 |  |  |  |
| 未支持来源域和来源类型由父表即时拒绝 | passed | 2 个子场景分别由 ck_evidence_reference_canon_domain 和 ck_evidence_reference_canon_type 即时拒绝 |  |  |  |
| 并发相同完整身份：A 提交后 B 唯一冲突 | passed | 观察连接确认 B PID 85 被 A PID 80 阻塞；A COMMIT；B 以 23505/uq_evidence_reference_full_identity 失败；仅 A 完整链持久化 |  |  |  |
| 并发相同完整身份：A 回滚后 B 可完成 | passed | 观察连接确认 B PID 85 被 A PID 86 阻塞；A ROLLBACK；B 写入支撑并 COMMIT；仅 B 完整链持久化 |  |  |  |
| 共享已提交 Commit 的不同对象可合法并发创建 | passed | 同一已提交 Commit 下 Story Event 与 Canon Fact 的 Evidence 首次并发 COMMIT 均成功，无重试；完整父子关系与共同归属已回读 |  |  |  |

## 范围声明

- 本原型只验证 Evidence 的六种 Canon 来源、完整身份去重及最小依赖夹具。
- 不代表正式生产 Schema；不实现完整 Canon Commit、Commit Item、Mapping、Approval、Outbox、Design 或 Tool Evidence。
