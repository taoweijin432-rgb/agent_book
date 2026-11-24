# Evidence Canon 来源约束原型

## 1. 定位与边界

本目录是 `docs/12`—`docs/14` 中 Evidence Canon 来源规则的独立数据库约束夹具，Schema 固定为 `evidence_canon_constraint_fixture`。它不是正式生产 Schema，也不实现完整 Canon Commit、Commit Item、Mapping、Approval、Projection Outbox、Design/Tool Evidence 或写作应用。

夹具只接受六种 Canon 来源：`canonical_text_version`、`canon_commit`、`story_event`、`canon_fact`、`state_transition`、`temporal_relation`。父表 CHECK 会拒绝非 Canon 域及集合外类型。

## 2. 来源映射

| 来源类型 | 实际目标 | 必须同时存在的容器 | 父 `source_version_id` | 其他目标列 |
|---|---|---|---|---|
| `canonical_text_version` | `canonical_text_version_id` | `canon_commit_id` | 正文版本 ID | 四个内部对象目标为空 |
| `canon_commit` | `canon_commit_id` | 无独立容器 | Commit ID | 正文及四个内部对象目标为空 |
| `story_event` | `source_story_event_id` | `canon_commit_id` | Commit ID | 正文及其余内部对象目标为空 |
| `canon_fact` | `source_canon_fact_id` | `canon_commit_id` | Commit ID | 正文及其余内部对象目标为空 |
| `state_transition` | `source_state_transition_id` | `canon_commit_id` | Commit ID | 正文及其余内部对象目标为空 |
| `temporal_relation` | `source_temporal_relation_id` | `canon_commit_id` | Commit ID | 正文及其余内部对象目标为空 |

`canon_commit_id` 在正文和内部对象类型中是容器，不计入实际目标列互斥数量；在 `canon_commit` 类型中它自身就是实际目标。父 `source_object_type/source_object_id` 始终匹配实际目标，而不是容器。

## 3. 数据库强制位置

| 规则 | 实现位置 | 失败阶段 |
|---|---|---|
| 六字段完整身份唯一 | `uq_evidence_reference_full_identity` | 冲突父行 INSERT；并发时等待后裁决 |
| 旧四字段查询 | `idx_evidence_reference_legacy_lookup` | 非唯一索引，不拒绝不同实际对象 |
| 一对一支撑 | `evidence_canon_source` 主键兼父 FK | 重复支撑或悬空父行 INSERT |
| 目标列组合 | `ck_evidence_canon_source_target_shape` | 支撑行 INSERT/UPDATE |
| 类型专属对象存在 | 正文及四类内部对象具名 FK、Commit FK | 支撑行 INSERT/UPDATE |
| 恰一支撑、父子身份、版本、项目、创建 Commit、`committed` 状态 | 默认延后约束触发器，标识 `evidence_canon_complete` | 真实 COMMIT |
| Evidence 和支撑追加不可变 | `evidence_canon_immutable` | UPDATE/DELETE 语句 |
| 来源项目和创建 Commit 不可变 | `evidence_canon_complete` BEFORE 触发器及 FK | UPDATE/DELETE 语句 |
| Commit 终态不可改写 | `evidence_canon_commit_terminal` | UPDATE 语句 |

完整去重身份为：

```text
(source_domain, source_version_id, source_object_type,
 source_object_id, locator, evidence_kind)
```

父表唯一约束直接处理并发重复，不采用“先查询、没有再插入”。`locator` 与 `evidence_kind` 使用稳定非空文本，仅服务本夹具；正式定位格式不在本批决定。

五个数据库函数固定函数级 `search_path` 为：

```text
pg_catalog, evidence_canon_constraint_fixture, pg_temp
```

函数不依赖调用连接路径，也不使用 `SECURITY DEFINER`。测试会用新建直连连接、`search_path=public` 和全限定业务对象名验证合法提交及缺失支撑失败。

## 4. Commit 状态边界

夹具允许 `preparing`、`committed`、`failed`：

- `preparing → committed` 和 `preparing → failed` 允许；
- `committed` 与 `failed` 是终态，只允许保持原状态；
- Evidence 提交判定时，来源 Commit 必须为 `committed`；
- preparing Commit、来源对象、Evidence 可在同一事务创建，随后更新为 committed 再整体提交；
- 已提交历史来源可在后续事务创建 Evidence。

这些规则只验证 Evidence 来源所需的状态边界，不代表完整 Canon Commit 协议。

来源关系在夹具中不可变，因此创建校验不额外请求排他容器锁。这里仅验证明确列出的三条并发路径，不承诺任意业务事务都不会死锁。

## 5. 运行

前置环境：Docker、Node.js `>=22.23.2`、pnpm。固定依赖为 `node-pg-migrate@9.0.0`、`pg@8.23.0`，固定镜像为 `postgres:18.6`。

```bash
pnpm install --frozen-lockfile
pnpm prototype
```

运行器会清理本原型旧结果，启动仅绑定 `127.0.0.1` 随机端口的一次性实例，经宿主机 TCP 在统一期限内执行真实 `SELECT 1`，从空库迁移并以显式 `READ COMMITTED` 运行测试，最后写入 `verification/runner-result.md`，删除本轮容器及 `.test-results.json`。只有迁移、测试、所有场景、报告和清理全部成功才返回 `0`。

## 6. 与正式 Schema 的差异

- ID 使用 `text`，未决定正式 ID 类型。
- `project_id` 在 Evidence 父表中是夹具归属字段。
- Canon Commit、正文和四类内部对象只保留本批完整性验证字段。
- 夹具允许直接插入终态，便于建立历史测试数据；这不代表正式提交接口。
- 迁移只建结构，全部测试数据由事务创建。
- 未实现 Canon Ledger、Commit Item、Mapping、正文内容、审批和 Outbox。

## 7. 结果记录

`verification/runner-result.md` 记录最后一次真实一键运行的版本、镜像 digest、退出码、顶层场景证据与清理结果。`verification/protected-sha256-before.txt` 和 `protected-sha256-after.txt` 用于核验 `docs/00—15` 及两个既有原型未被修改。
