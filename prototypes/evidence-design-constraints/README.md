# Evidence Author Design 来源约束原型

## 1. 定位与边界

本目录是 `docs/12`—`docs/14` 中 Evidence Author Design 来源规则的独立数据库约束夹具，Schema 固定为 `evidence_design_constraint_fixture`。它不是正式生产 Schema，也不实现 Time Interval、秘密访问控制、设计审批、生效/发布流程、其他 Evidence 域或写作应用。

夹具只接受八种来源：`author_design_revision`、`design_object_version`、`design_constraint`、`outline_node`、`world_rule`、`temporal_constraint`、`foreshadowing_plan`、`ending_constraint`。父表 CHECK 拒绝非 `author_design` 域及集合外类型。

## 2. 来源映射

| 来源类型 | 实际目标列 | Revision 容器 | 父 `source_version_id` |
|---|---|---|---|
| `author_design_revision` | `source_author_design_revision_id` | `author_design_revision_id`，两列值相同 | Revision ID |
| `design_object_version` | `source_design_object_version_id` | `author_design_revision_id` | Revision ID |
| `design_constraint` | `source_design_constraint_id` | `author_design_revision_id` | Revision ID |
| `outline_node` | `source_outline_node_id` | `author_design_revision_id` | Revision ID |
| `world_rule` | `source_world_rule_id` | `author_design_revision_id` | Revision ID |
| `temporal_constraint` | `source_temporal_constraint_id` | `author_design_revision_id` | Revision ID |
| `foreshadowing_plan` | `source_foreshadowing_plan_id` | `author_design_revision_id` | Revision ID |
| `ending_constraint` | `source_ending_constraint_id` | `author_design_revision_id` | Revision ID |

八个类型专属目标列恰一非空，并等于支撑行及父行的 `source_object_id`。Revision 类型的目标 ID 与容器 ID 相同；其余七类目标必须属于容器 Revision。`author_design_revision_id` 是容器列，不计入八个目标列的互斥数量。Evidence、Revision 和实际目标必须属于同一项目。

## 3. 数据库强制位置

| 规则 | 实现位置 | 失败阶段 |
|---|---|---|
| 六字段完整身份唯一 | `uq_evidence_reference_full_identity` | 冲突父行 INSERT；并发时等待后裁决 |
| 旧四字段查询 | `idx_evidence_reference_legacy_lookup` | 非唯一索引，不拒绝不同实际对象 |
| 一对一支撑 | `evidence_design_source` 主键兼父 FK | 重复支撑或悬空父行 INSERT |
| 类型与恰一目标列组合 | `ck_evidence_design_source_target_shape` | 支撑行 INSERT/UPDATE |
| 类型专属对象存在 | 八个具名目标 FK、Revision 容器 FK | 支撑行 INSERT/UPDATE |
| 恰一支撑、父子身份、版本、项目和 Revision 归属 | 默认延后约束触发器，标识 `evidence_design_complete` | 真实 COMMIT |
| Evidence 和支撑追加不可变 | `evidence_design_immutable` | UPDATE/DELETE 语句 |
| Revision 项目与七类目标的项目/Revision 归属保护 | `evidence_design_complete` BEFORE 触发器及 FK | UPDATE/DELETE 语句 |

完整去重身份为：

```text
(source_domain, source_version_id, source_object_type,
 source_object_id, locator, evidence_kind)
```

父表唯一约束直接裁决并发重复，不采用“先查询、没有再插入”。`locator` 和 `evidence_kind` 在夹具中使用稳定非空文本，正式格式不在本批决定。

五个 PL/pgSQL 函数固定函数级 `search_path` 为：

```text
pg_catalog, evidence_design_constraint_fixture, pg_temp
```

函数不依赖调用连接路径，也不使用 `SECURITY DEFINER`。测试使用新的直连连接、`search_path=public` 和全限定业务对象名验证合法提交及缺失支撑的目标失败。

本夹具只把项目和 Revision 归属字段设为不可变；没有 Revision 状态列或状态门槛，也没有冻结设计内容。历史合法 Revision 可被后续事务中的 Evidence 引用，不要求是当前生效版本。创建校验不额外请求排他 Revision 锁；并发测试只证明列出的三条路径，不承诺任意业务事务不存在死锁。

## 4. 运行

前置环境：Docker、Node.js `>=22.23.2`、pnpm。固定依赖为 `node-pg-migrate@9.0.0`、`pg@8.23.0`，固定镜像为 `postgres:18.6`。

```bash
pnpm install --frozen-lockfile
pnpm prototype
```

运行器会清理本原型旧结果，启动仅绑定 `127.0.0.1` 随机端口的一次性实例，经宿主机 TCP 在统一期限内执行真实 `SELECT 1`，从空库迁移并以显式 `READ COMMITTED` 运行测试，最后写入 `verification/runner-result.md`，删除本轮容器及 `.test-results.json`。只有迁移、测试、全部场景、报告写入和资源清理均成功才返回 `0`。

## 5. 与正式 Schema 的差异

- ID 使用 `text`，未决定正式 ID 类型。
- `project_id` 在 Evidence、Revision 和七类设计对象中是归属验证夹具字段。
- 七类设计对象只保留主键、项目和 Revision；不展开内容、状态、Plot Arc 或 Entity 关系。
- 不存在 Revision 审批、生效状态或当前指针；原型不会把 draft 可编辑内容一概冻结。
- 迁移只建结构，全部测试数据由测试事务创建。
- 未实现 Time Interval、秘密访问控制、设计审批/发布、Tool/Candidate/Canon Evidence 或正式恢复流程。

## 6. 结果记录

`verification/runner-result.md` 记录最后一次真实一键运行的版本、镜像 digest、退出码、顶层场景证据与清理结果。`verification/protected-sha256-before.txt` 和 `protected-sha256-after.txt` 用于核验 `docs/00—15` 及三个既有原型未被修改。
