# Evidence Candidate 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32821` 上执行 `SELECT 1`
- 测试数据库：`evidence_candidate_fixture`
- 测试 Schema：`evidence_candidate_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（18 个场景；18 通过；0 失败）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 evidence-candidate-fixture-4680-1792133654856；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 五种 Candidate 来源分别提交完整父子关系 | passed | 真实 COMMIT 成功；candidate_version、candidate_event、candidate_fact_proposal、candidate_state_transition、narrative_assertion 均可从独立连接读取完整父子身份 |  |  |  |
| public search_path 下全限定合法父子关系可提交 | passed | 新建直连连接固定 search_path=public；全部对象名带 Schema；合法父子关系真实 COMMIT 并由另一新连接回读 |  |  |  |
| public search_path 下只有父行仍在 COMMIT 拒绝 | passed | 前置 INSERT 成功；真实 COMMIT 以 23514/evidence_candidate_complete 失败；新连接确认无父行半成品 |  |  |  |
| public search_path 下不可变与归属保护仍生效 | passed | 新连接 public 路径下 Evidence UPDATE 命中 23514/evidence_candidate_immutable，来源归属 UPDATE 命中 23514/evidence_candidate_complete；原链保留 |  |  |  |
| 只有 Evidence 父行时真实 COMMIT 失败 | passed | 父 INSERT 成功；COMMIT 以 23514/evidence_candidate_complete 失败；独立连接确认父行未持久化 |  |  |  |
| 重复支撑行、悬空 FK 与错误目标组合命中各自即时约束 | passed | 即时失败分别为 23505/evidence_candidate_source_pkey、23503/fk_evidence_candidate_event、23514/ck_evidence_candidate_source_target_shape；均未被误算为延后检查 |  |  |  |
| 父子类型或对象 ID 不一致在真实 COMMIT 失败 | passed | 2 个独立子场景：类型不一致保持同一对象文本 ID，对象不一致保持同一类型；前置目标/Candidate/项目及父子 INSERT 均已断言，COMMIT 均以 23514/evidence_candidate_complete 失败且无半成品 |  |  |  |
| 错误 Candidate、项目或 Workflow 归属分别在 COMMIT 失败 | passed | candidate:23514/evidence_candidate_complete；project:23514/evidence_candidate_complete；workflow:23514/evidence_candidate_complete；每个反例仅改变一个归属条件并整体回滚 |  |  |  |
| Assertion Candidate 来源链错误不能只凭 Assertion ID 通过 | passed | Assertion 与支撑 ID 均存在，但 Candidate 来源支撑指向另一版本；COMMIT 以 23514/evidence_candidate_complete 失败 |  |  |  |
| 六字段完整身份重复由父表唯一约束拒绝 | passed | 不同 Evidence 主键的相同六字段身份在 INSERT 以 23505/uq_evidence_reference_full_identity 失败；原记录保留 |  |  |  |
| 旧四字段相同但实际来源对象不同可分别提交 | passed | source_domain/source_version_id/locator/evidence_kind 相同而 source_object_id 不同的两条记录均提交；旧四字段索引非唯一 |  |  |  |
| 同一来源对象可按不同 locator 或 evidence_kind 建立证据 | passed | 同一实际来源对象的 2 个 locator 与 2 个 evidence_kind 组合均可提交 |  |  |  |
| 两个消费方可共享同一 Evidence | passed | 两个最小消费引用均提交且只存在一个 Evidence；消费方不进入去重身份 |  |  |  |
| Evidence、来源绑定与被引用对象归属均不可变 | passed | 身份和支撑修改以 23514/evidence_candidate_immutable 拒绝；来源对象、Candidate Version 与 Workflow Run 归属修改以 23514/evidence_candidate_complete 拒绝；独立连接确认原链保留 |  |  |  |
| 未支持来源域和来源类型由夹具即时拒绝 | passed | 非 candidate 域及五类集合外的对象类型均在父 INSERT 被 CHECK 拒绝 |  |  |  |
| 并发相同完整身份：A 提交后 B 唯一冲突 | passed | 观察连接确认 B PID 89 被 A PID 80 阻塞；A COMMIT；B 以 23505/uq_evidence_reference_full_identity 失败；仅 A 父子关系持久化 |  |  |  |
| 并发相同完整身份：A 回滚后 B 可完成 | passed | 观察连接确认 B PID 89 被 A PID 90 阻塞；A ROLLBACK；B 随后写入支撑并 COMMIT，完整父子关系持久化 |  |  |  |
| 共享 Candidate 的不同来源可合法并发创建 | passed | 共享 Candidate Version 的不同合法对象首次并发 COMMIT 均成功，无重试；独立连接确认两套完整父子关系与共同容器 |  |  |  |

## 范围声明

- 本原型只验证 Evidence 的五种 Candidate 来源、完整身份去重及最小依赖夹具。
- 不代表正式生产 Schema；不实现 Design、Canon、Tool Evidence、Projection Attempt 或完整 Canon Commit。
