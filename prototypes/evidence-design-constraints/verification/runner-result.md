# Evidence Author Design 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32826` 上执行 `SELECT 1`
- 测试数据库：`evidence_design_fixture`
- 测试 Schema：`evidence_design_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（17 个场景；17 通过；0 失败）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 evidence-design-fixture-6781-1792378780164；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 八种 Author Design 来源分别提交完整父子关系 | passed | 8 个参数化子场景真实 COMMIT 成功；Revision 直接目标等于容器，七类对象 ID 均不同于 Revision：author_design_revision、design_object_version、design_constraint、outline_node、world_rule、temporal_constraint、foreshadowing_plan、ending_constraint |  |  |  |
| 八种来源的实际目标列全空均由 CHECK 即时拒绝 | passed | 8 个参数化子场景均在支撑 INSERT 即时命中 23514/ck_evidence_design_source_target_shape，独立连接确认无父行或支撑半成品：author_design_revision、design_object_version、design_constraint、outline_node、world_rule、temporal_constraint、foreshadowing_plan、ending_constraint |  |  |  |
| 只有 Evidence 父行时真实 COMMIT 失败 | passed | 父 INSERT 成功；真实 COMMIT 以 23514/evidence_design_complete 失败；独立连接确认无半成品 |  |  |  |
| 重复支撑、悬空目标 FK 与错误目标组合命中即时约束 | passed | 3 个即时负例分别命中 23505/evidence_design_source_pkey、23503/fk_evidence_design_world_rule、23514/ck_evidence_design_source_target_shape，未混算为延后失败 |  |  |  |
| 父子类型与对象 ID 不一致分开在真实 COMMIT 失败 | passed | 2 个独立子场景：类型负例保持相同文本 ID，对象负例保持同一类型；目标/FK/Revision/项目及父子 INSERT 均先断言合法，COMMIT 均命中 23514/evidence_design_complete |  |  |  |
| 错误 source_version、目标 Revision 或项目分别延后失败 | passed | 3 个独立延后负例：source_version:23514/evidence_design_complete；target_revision:23514/evidence_design_complete；project:23514/evidence_design_complete；独立连接确认均整体回滚 |  |  |  |
| 历史合法 Revision 来源可在后续事务创建 Evidence | passed | Revision 与来源对象先独立提交，后续事务创建 Evidence 成功；没有 current/effective 状态门槛 |  |  |  |
| 六字段完整身份重复由父表唯一约束拒绝 | passed | 不同 Evidence 主键的相同六字段身份以 23505/uq_evidence_reference_full_identity 拒绝；原父子链保留 |  |  |  |
| 旧四字段相同但实际对象不同可分别提交 | passed | source_domain/source_version_id/locator/evidence_kind 相同而实际对象不同的两条记录均提交；旧四字段索引非唯一 |  |  |  |
| 同一实际对象可使用不同 locator 或 evidence_kind | passed | 同一来源对象的不同 locator 或 evidence_kind 形成 3 个合法完整身份 |  |  |  |
| Evidence、支撑和来源归属修改被拒绝并保留原链 | passed | Evidence/支撑 UPDATE 命中 23514/evidence_design_immutable；来源项目/Revision 归属修改命中 23514/evidence_design_complete；独立连接确认原链保留 |  |  |  |
| public search_path 下全限定合法父子关系可提交 | passed | 新建直连连接 search_path=public；5 个函数路径固定；全限定业务 SQL 合法 COMMIT 并由另一新连接回读 |  |  |  |
| public search_path 下缺失支撑命中目标延后约束 | passed | 全限定父 INSERT 成功；COMMIT 命中 23514/evidence_design_complete 而非名称解析错误；新连接确认无半成品 |  |  |  |
| 未支持来源域和来源类型由父表 CHECK 即时拒绝 | passed | 非 author_design 域和八类集合外类型分别被父表 CHECK 即时拒绝 |  |  |  |
| 并发相同完整身份：A 提交后 B 唯一冲突 | passed | 观察连接确认 B PID 85 被 A PID 80 阻塞；A COMMIT 后 B 命中 23505/uq_evidence_reference_full_identity；仅 A 完整父子链持久化 |  |  |  |
| 并发相同完整身份：A 回滚后 B 可完成 | passed | 观察连接确认 B PID 85 被 A PID 86 阻塞；A ROLLBACK 后 B 完成支撑并 COMMIT；仅 B 完整父子链持久化 |  |  |  |
| 共享 Revision 的不同设计对象可合法并发创建 | passed | 共享同一 Revision 的 World Rule 与 Design Constraint 首次并发 COMMIT 均成功，无重试；独立连接确认两套父子关系及共同 Revision/项目 |  |  |  |

## 范围声明

- 本原型只验证 Evidence 的八种 Author Design 来源、完整身份去重及最小依赖夹具。
- 不代表正式生产 Schema；不实现设计审批/生效流程、Time Interval、秘密访问控制、其他 Evidence 域或正式生产 Schema。
