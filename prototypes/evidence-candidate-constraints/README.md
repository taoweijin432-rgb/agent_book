# Evidence Candidate 来源约束原型

## 1. 定位与边界

本目录是 `docs/12`—`docs/14` 中 Evidence Candidate 来源规则的**独立约束验证夹具**，数据库 Schema 固定为 `evidence_candidate_constraint_fixture`。它不是正式生产 Schema，也不实现完整 Evidence 系统、Design/Canon/Tool 来源、Projection Attempt、完整 Canon Commit 或写作工作流。

本批只接受五种 `source_object_type`：

- `candidate_version`
- `candidate_event`
- `candidate_fact_proposal`
- `candidate_state_transition`
- `narrative_assertion`

父表 CHECK 会拒绝其他来源域和来源类型，避免夹具接受尚未实现校验的来源。`locator` 与 `evidence_kind` 在夹具中使用非空稳定文本，仅用于验证身份与唯一性；其正式格式不在本批决定。

## 2. 来源映射

| 类型 | 实际目标 | Candidate 容器 | 必填目标 | 必须为空的子对象目标 |
|---|---|---|---|---|
| `candidate_version` | `candidate_version_id` | 无独立容器 | `source_object_id=candidate_version_id` | Event、Fact Proposal、State Transition、Assertion 全部为空 |
| `candidate_event` | `source_candidate_event_id` | `candidate_version_id` | 目标列非空且等于 `source_object_id` | 其余三个子对象目标为空 |
| `candidate_fact_proposal` | `source_candidate_fact_proposal_id` | `candidate_version_id` | 目标列非空且等于 `source_object_id` | 其余三个子对象目标为空 |
| `candidate_state_transition` | `source_candidate_state_transition_id` | `candidate_version_id` | 目标列非空且等于 `source_object_id` | 其余三个子对象目标为空 |
| `narrative_assertion` | `source_assertion_id` | `candidate_version_id` | 目标列非空且等于 `source_object_id` | 其余三个子对象目标为空 |

五类父记录的 `source_version_id` 都等于 Candidate Version ID。Assertion 还必须是 Candidate 域，并由 `narrative_assertion_candidate_source` 指向同一 Candidate Version。Candidate、Workflow Run、目标对象和 Evidence 必须属于同一项目。

## 3. 数据库强制位置

| 规则 | 数据库位置 | 失败阶段 |
|---|---|---|
| 六字段完整身份唯一 | `evidence_reference.uq_evidence_reference_full_identity` | 冲突父行 `INSERT`；并发时由唯一索引等待后裁决 |
| 旧四字段检索 | `idx_evidence_reference_legacy_lookup` | 非唯一索引，不拒绝不同实际来源对象 |
| 支撑行一对一 | `evidence_candidate_source` 主键兼父 FK | 重复支撑行或悬空父行 `INSERT` |
| 类型与目标列组合 | `ck_evidence_candidate_source_target_shape` | 支撑行 `INSERT`/`UPDATE` |
| 类型专属对象存在 | 四个具名目标 FK、Candidate Version FK | 支撑行 `INSERT`/`UPDATE` |
| 恰一支撑、父子身份、Candidate/项目/Workflow/Assertion 链一致 | `DEFERRABLE INITIALLY DEFERRED` 约束触发器，标识 `evidence_candidate_complete` | 真实 `COMMIT` |
| Evidence 与来源支撑追加不可变 | `evidence_candidate_immutable` BEFORE 触发器 | 修改语句 |
| 被引用对象的项目、Candidate、Workflow 归属不可变 | `evidence_candidate_complete` BEFORE 触发器及 FK | 修改/删除语句 |

五个 PL/pgSQL 函数都固定函数级 `search_path` 为
`pg_catalog, evidence_candidate_constraint_fixture, pg_temp`。因此触发器和辅助函数不依赖调用连接的路径；没有使用 `SECURITY DEFINER`。回归测试会从新建直连连接将会话路径设为 `public`，并以全限定表名分别验证合法提交、缺失支撑的提交失败以及两类不可变保护。

完整去重身份固定为：

```text
(source_domain, source_version_id, source_object_type,
 source_object_id, locator, evidence_kind)
```

不存在“先查询、没有再插入”的并发唯一性窗口。多个消费方只引用 `evidence_reference_id`，不进入去重身份。

本原型没有机械复制 Time Interval 原型的全部锁。来源所有权字段在夹具中不可变；创建时依靠 FK、行级 CHECK、延后完整性触发器和父表唯一索引。合法事务共享同一 Candidate 时不额外请求排他容器锁。这里仅验证本批列出的竞争路径，不宣称任意业务事务不存在死锁。

父子类型不一致与对象 ID 不一致是两个独立负例子场景：前者在不同目标表创建相同文本 ID，只改变类型；后者保持同一类型，只改变对象 ID。两者都会在 COMMIT 前先断言目标存在、Candidate/项目一致、支撑 CHECK/FK 合法及父子记录已成功插入。

## 4. 运行

前置环境：Docker、Node.js `>=22.23.2`、pnpm。依赖固定为 `node-pg-migrate@9.0.0` 和 `pg@8.23.0`，测试镜像固定为 `postgres:18.6`。

```bash
pnpm install --frozen-lockfile
pnpm prototype
```

一键运行器会：

1. 删除本原型自己的旧 `.test-results.json`；
2. 启动名称唯一、仅绑定 `127.0.0.1` 随机端口的一次性 PostgreSQL 容器；
3. 在宿主机 TCP 路径执行有总期限的真实 `SELECT 1`；
4. 从空库执行迁移，再以显式 `READ COMMITTED` 运行测试；
5. 解析本轮新结果，并将报告写入 `verification/runner-result.md`；
6. 只删除本轮容器和临时结果文件。

只有迁移、测试命令、所有场景、本轮结果有效性、报告写入和两项资源清理全部成功，运行器才以 `0` 退出。测试不会关闭约束，也不会临时安装触发器。

## 5. 夹具与正式 Schema 的差异

- ID 使用 `text`，仅便于可读测试；未决定正式 ID 物理类型。
- `project_id` 在 Evidence 父表中作为夹具归属字段，用于直接验证跨表项目一致性。
- Workflow Run、Candidate Version、Candidate 子对象、Assertion 和两个消费方表只保留本批校验所需字段。
- 来源对象所有权字段在夹具内直接设为不可变；正式系统仍需结合完整生命周期与授权设计决定写入接口。
- 迁移只创建结构；所有验收数据由测试事务创建。

## 6. 结果记录

`verification/runner-result.md` 是最后一次一键运行的机器生成报告，记录实际镜像 digest、PostgreSQL/Node 版本、退出码、场景证据和清理结果。`verification/protected-sha256-before.txt` 与 `protected-sha256-after.txt` 用于证明本批未修改受保护文档和上一批原型。
