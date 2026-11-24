# Tool Evidence 约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32831` 上执行 `SELECT 1`
- 测试数据库：`evidence_tool_fixture`
- 测试 Schema：`evidence_tool_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（20 个顶层测试；20 通过；0 失败；36 个参数化子场景）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 evidence-tool-fixture-29817-1792380354021；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| 合法 Tool Evidence 引用已提交执行链 | passed | Generation Run ID 与 Tool Call ID 不同；Evidence 父子真实 COMMIT；独立连接回读完整执行归属链 |  |  |  |
| 同一事务创建执行链、Tool Call 和 Evidence | passed | Scene Task Version、Workflow、Bundle、Generation、Tool Call 与 Evidence 在同一 READ COMMITTED 事务整体提交 |  |  |  |
| 历史已存在 Tool Call 可在后续事务创建 Evidence | passed | 较早独立提交的 Tool Call 后续仍可形成 Evidence；原型没有 latest 或 succeeded 门槛 |  |  |  |
| 只有 Evidence 父行时真实 COMMIT 失败 | passed | 父 INSERT 成功；真实 COMMIT 命中 23514/evidence_tool_complete；独立连接确认无半成品 |  |  |  |
| 支撑主键、Tool Call FK、必填列及父域类型即时约束 | passed | 8 个即时负例分别命中目标 PK/FK/NOT NULL/CHECK；三个必填字段为 NULL 均在 INSERT 阶段以 23502 拒绝，空 source_ref 命中具名 CHECK；独立连接确认无半成品 |  |  |  |
| 父对象 ID 与支撑 Tool Call 不一致在 COMMIT 失败 | passed | 两个 Tool Call 均存在且同 Generation/项目，仅父对象 ID 与支撑 Tool Call 不同；COMMIT 命中 23514/evidence_tool_complete |  |  |  |
| 父 source_version_id 使用另一真实 Generation 时 COMMIT 失败 | passed | 错误版本是同项目真实 Generation ID，Tool Call 与支撑一致；仅父版本映射错误并在 COMMIT 被拒绝 |  |  |  |
| 项目、Workflow、Bundle 与 Scene Task Version 归属错误分别延后失败 | passed | 4 个单一归属负例均使用真实 FK 对象并在 COMMIT 命中 23514/evidence_tool_complete：Evidence 项目、Bundle Workflow、Bundle 项目、Scene Task Version |  |  |  |
| 六字段完整身份重复由唯一约束即时拒绝 | passed | 不同 Evidence 主键的相同六字段身份在父 INSERT 命中 23505/uq_evidence_reference_full_identity；原链保留 |  |  |  |
| 旧四字段相同而 Tool Call 不同可分别提交 | passed | 同 Generation、locator、evidence_kind 但 Tool Call ID 不同的两条 Evidence 均提交；旧四字段索引非唯一 |  |  |  |
| 同一 Tool Call 的 locator 或 evidence_kind 不同可分别创建 | passed | 同一 Tool Call 的两个 locator 和两个 evidence_kind 形成 3 个合法完整身份 |  |  |  |
| 两个消费方共享同一 Evidence | passed | 两个消费方仅通过 Evidence ID 共享同一父子链；Evidence 1 条、消费引用 2 条 |  |  |  |
| Evidence 与 Tool 来源支撑的修改和删除均被拒绝 | passed | 父行和支撑的 UPDATE/DELETE 均即时命中 23514/evidence_tool_immutable；独立连接确认原链保留 |  |  |  |
| Tool Call 及上层执行容器的来源保护字段不可改绑 | passed | 14 个身份、项目、输入绑定及既有结果实际变化在 UPDATE 阶段命中 23514/evidence_tool_complete；未依赖延后扫描或 BEFORE 先锁父行假设 |  |  |  |
| 删除被 Evidence 引用的 Tool Call 由 FK 拒绝 | passed | Tool Call DELETE 即时命中 23503/fk_evidence_tool_call；独立连接确认来源链保留 |  |  |  |
| 来源保护字段的无变化 UPDATE 合法提交 | passed | Generation Run 与 Tool Call 的受保护字段原值 UPDATE 首次 COMMIT 成功；实际变化才拒绝 |  |  |  |
| public search_path 下全限定 SQL 命中合法、缺支撑和不可变规则 | passed | 新建直连连接 search_path=public；5 个函数路径固定；全限定合法 COMMIT、缺支撑 23514/evidence_tool_complete、不可变 23514/evidence_tool_immutable 均符合预期 |  |  |  |
| 并发相同完整身份：A 提交后 B 唯一冲突 | passed | 观察连接确认 B PID 84 被 A PID 80 阻塞；A COMMIT 后 B 命中 23505/uq_evidence_reference_full_identity；仅 A 完整链持久化 |  |  |  |
| 并发相同完整身份：A 回滚后 B 完成父子关系 | passed | 观察连接确认 B PID 84 被 A PID 85 阻塞；A ROLLBACK 后 B 完成支撑并 COMMIT；仅 B 完整链持久化 |  |  |  |
| 同一 Generation 下不同 Tool Call 可合法并发创建 Evidence | passed | A PID 80 与 B PID 84 提交前均无阻塞者；同 Generation 不同 Tool Call 首次异步 COMMIT 均成功、无重试；独立连接确认两套完整链 |  |  |  |

## 参数化子场景统计

| 分组 | 子场景数 |
|---|---:|
| immediate_constraint_variants | 8 |
| ownership_mismatch_variants | 4 |
| locator_and_kind_variants | 3 |
| evidence_immutability_variants | 4 |
| source_protection_variants | 14 |
| public_search_path_variants | 3 |
| 合计 | 36 |

## 范围声明

- 本原型只验证 Tool Evidence 的 Tool Call 来源、完整身份去重及最小执行归属夹具。
- 不代表正式生产 Schema；不实现真实工具调用、能力授权、外部 source_ref 内容验证、其他 Evidence 域、完整 Canon Commit 或正式生产 Schema。
