# 四域 Evidence 来源互斥、完整性与统一去重

本目录是在新 Schema `evidence_unified_constraint_fixture` 中联合验证已有规则的独立夹具。只有一个共同 `evidence_reference`，四张来源表的主键均为该共同父表的外键；所有来源目标、容器、消费方及迁移账本均在本 Schema。运行时不导入旧原型、不连接业务数据库。

规范按 [docs/00](../../docs/00-document-map.md) 的主题权威规则处理：[docs/12 §3.3](../../docs/12-relational-physical-schema.md#33-多态引用与跨域完整性选择) 提供逐类型映射，[docs/13 §6.1](../../docs/13-database-constraints-indexes-and-concurrency.md#61-时间区间与证据的物理检查) 提供约束与去重方案，[docs/14 §2、§2.1](../../docs/14-data-lifecycle-migration-and-recovery.md) 提供来源及执行记录保留边界。旧原型仅作为已经验证的实现依据，不覆盖这些定义。

## 20 种来源的映射

下表的“目标列”均为来源支撑表中的实际目标列，并有指向同 Schema 真实目标表的类型专属 FK。父 `source_object_type/source_object_id` 必须等于所选实际目标类型及 ID。

| 来源域 | 类型及实际目标表 | 支撑表实际目标列 | 容器列 | 父 `source_version_id` |
|---|---|---|---|---|
| author_design | author_design_revision | source_author_design_revision_id | author_design_revision_id；与目标相同 | Revision ID |
| author_design | design_object_version | source_design_object_version_id | author_design_revision_id | Revision ID |
| author_design | design_constraint | source_design_constraint_id | author_design_revision_id | Revision ID |
| author_design | outline_node | source_outline_node_id | author_design_revision_id | Revision ID |
| author_design | world_rule | source_world_rule_id | author_design_revision_id | Revision ID |
| author_design | temporal_constraint | source_temporal_constraint_id | author_design_revision_id | Revision ID |
| author_design | foreshadowing_plan | source_foreshadowing_plan_id | author_design_revision_id | Revision ID |
| author_design | ending_constraint | source_ending_constraint_id | author_design_revision_id | Revision ID |
| candidate | candidate_version | candidate_version_id | 本类型无独立容器 | Candidate Version ID |
| candidate | candidate_event | source_candidate_event_id | candidate_version_id | Candidate Version ID |
| candidate | candidate_fact_proposal | source_candidate_fact_proposal_id | candidate_version_id | Candidate Version ID |
| candidate | candidate_state_transition | source_candidate_state_transition_id | candidate_version_id | Candidate Version ID |
| candidate | narrative_assertion | source_assertion_id | candidate_version_id | Candidate Version ID |
| canon | canonical_text_version | canonical_text_version_id | canon_commit_id | 正文版本 ID |
| canon | canon_commit | canon_commit_id | 本类型无独立容器 | Commit ID |
| canon | story_event | source_story_event_id | canon_commit_id | Commit ID |
| canon | canon_fact | source_canon_fact_id | canon_commit_id | Commit ID |
| canon | state_transition | source_state_transition_id | canon_commit_id | Commit ID |
| canon | temporal_relation | source_temporal_relation_id | canon_commit_id | Commit ID |
| tool | tool_call | tool_call_id | 经 Tool Call 到 generation_run_id | Generation Run ID |

各域保留以下归属检查：

- Design：八种类型专属目标列恰一匹配，所选列显式 `IS NOT NULL`，杜绝全空目标通过 NULL CHECK。目标属于指定 Revision，目标、Revision 与 Evidence 的项目一致。Revision 容器列不计入八个实际目标列。
- Candidate：直接引用版本时四个子目标列全空；引用子对象时只有对应子目标列非空，且其 Candidate 容器同时存在。目标、Candidate、Workflow 与 Evidence 的项目一致。Assertion 必须为 Candidate 域，且其 `narrative_assertion_candidate_source` 指向相同 Candidate，并保持版本相等。
- Canon：正文及内部对象与 Commit 容器同时存在；直接引用 Commit 时正文和四类内部目标全空。正文/内部对象必须由指定 Commit 创建，项目一致，最终状态为 `committed`。正文版本映射与 Commit ID 映射分别检查，保留同事务 `preparing→committed` 和历史 committed 来源。
- Tool：实际对象固定为 Tool Call；父版本等于其 Generation Run ID，测试明确使二者 ID 不同。Tool、Generation、Workflow、Bundle、任务版本与 Evidence 的项目一致；Workflow 与 Bundle 的任务版本一致。Bundle 的 `workflow_run_id` 可空，有值时必须等于 Generation 的 Workflow；为空时仍核对整个任务/项目范围。

最小来源表沿用旧夹具的 `text` ID 和归属字段（例如 Design Constraint 的夹具主键为 `design_constraint_id`），不扩展内容、完整生命周期或正式生产列定义。Candidate 不要求 Generation；共用 Workflow 只增加 Tool 执行范围验证所需的任务版本 FK。

## 跨四表恰一来源

`validate_evidence_source` 先用 `UNION ALL` 汇总四张支撑表，要求总行数严格为 1；随后验证该行所属域等于父 `source_domain`，最后调用对应域的详细校验。所有联合完整性错误统一为 `23514/evidence_source_complete`，数量错误包含 `support_count`，错域错误包含父域和支撑域。

共同父表和四张支撑表各有覆盖 `INSERT/UPDATE/DELETE` 的 `DEFERRABLE INITIALLY DEFERRED` 约束触发器。父行插入成功不代表可以独立提交，最终必须在真实 `COMMIT` 前完成来源关系。支撑主键、父 FK、实际目标 FK、必填列和目标组合 CHECK 则即时执行。

Evidence 父行和四张支撑表的实际修改/删除以 `23514/evidence_source_immutable` 拒绝。原值 UPDATE 可执行；五张表另有语句级 BEFORE TRUNCATE 保护，防止清空支撑表绕过行级触发器。实际来源的主键、项目、Revision/Candidate/Commit/执行输入绑定由 BEFORE 触发器保护，指向既有来源的删除由 FK 拒绝；Assertion 来源支撑同样追加不可变。保护字段原值 UPDATE 合法。Canon committed/failed 终态不能改写（`23514/evidence_canon_commit_terminal`）；Tool 非空响应引用不能覆盖，NULL 响应可首次写入。

没有新增排他容器锁。新父行由主键及唯一身份裁决；既有合法父行已有一条不可变支撑，因此每个追加错误支撑的并发事务都能看到“原支撑 + 自己的新支撑”，自身即违反数量规则，不依赖看到另一个事务未提交的支撑。

所有九个数据库函数固定函数级路径 `pg_catalog, evidence_unified_constraint_fixture, pg_temp`，不使用 `SECURITY DEFINER`。验收从 `pg_proc.proconfig` 读取实际保存值，从 `pg_trigger` 核验五个默认延后触发器及其全部写事件。

## 统一去重

共同父表的六列均为 NOT NULL，具名唯一约束固定为：

```text
uq_evidence_reference_full_identity
(source_domain, source_version_id, source_object_type,
 source_object_id, locator, evidence_kind)
```

旧四字段只有非唯一索引 `idx_evidence_reference_legacy_lookup`。项目、消费方及 Tool 的 `source_ref` 均不进入唯一身份；没有跨域共用 ID 的额外唯一限制。不同域的相同 ID 文本、同域不同类型的相同对象 ID、相同旧四字段但不同对象、不同 locator 或 kind 均可建立独立 Evidence。消费方通过 `evidence_reference_id` 共享同一父记录。

## 复用与文件

| 文件 | 用途及复用依据 |
|---|---|
| `migrations/001_evidence_unified_fixture.mjs` | 四个旧原型的来源表、类型专属 FK/CHECK、逐类型详细校验；新增共同父表、四表计数分派及统一保护；Bundle Workflow 保留文档可空性 |
| `test/evidence-unified.test.mjs` | 参数化分组，复用独立连接、真实 COMMIT、观察连接及 PID 阻塞证据模式；子场景数量按实际执行累计 |
| `scripts/run-prototype.mjs` | 从 Tool 已验证运行器复制后适配本原型名称、Schema、报告及子场景证据；保留就绪期限、结果有效性、失败状态和资源清理机制 |
| `package.json`、`pnpm-lock.yaml` | 固定 `node-pg-migrate@9.0.0`、`pg@8.23.0`，锁文件直接复用 Tool 原型 |
| `verification/runner-result.md` | 最后一次真实运行的环境、digest、退出码、顶层结果、子场景 SQLSTATE/约束/阶段及并发证据 |
| `verification/verify-protected.mjs` | 对初始清单重算哈希、检查受保护文件集合及 `.gitignore` 精确追加 |
| `verification/protected-sha256-before.txt`、`protected-sha256-after.txt` | docs/00—15、五个旧原型（不含安装依赖）和根文件的前后 SHA-256 |
| `verification/gitignore-before.txt`、`gitignore-before.sha256`、`gitignore-after.sha256` | 根 `.gitignore` 原文及前后哈希 |
| `verification/hash-validation.txt`、`git-status-before.txt`、`git-status-after.txt` | 保护核验结果和 Git 初始/最终状态 |

最终新增文件清单保存到 `verification/file-manifest.txt`。除根 `.gitignore` 追加指定条目外，所有交付均在本目录。

## 执行与验收证据

要求 Docker、本地 `postgres:18.6` 镜像、Node.js `>=22.23.2` 和 pnpm。运行目录为本目录：

```sh
pnpm install --frozen-lockfile
pnpm prototype
node verification/verify-protected.mjs
```

运行器生成随机口令，只创建本轮命名的一次性容器，绑定 `127.0.0.1` 随机端口；经宿主机 TCP 执行有统一 30 秒期限及连接清理预留的 `SELECT 1`。空库迁移包括本 Schema 内的迁移账本。测试连接均新建直连、`search_path=public`、全限定业务表名，事务显式 `READ COMMITTED`，有 8 秒语句超时、6 秒锁超时和 5 秒等待观察期限。

运行前删除旧结果；迁移成功才启动测试；只读取本轮结果，保留迁移/测试失败退出状态。报告写入、全部测试、结果有效性和容器/临时结果清理全部成功才退出 0。仅操作本轮容器，不执行 Docker 全局清理。`migrate:down` 删除夹具业务对象，保留 Schema 与迁移账本以记录回退；本轮验收使用空库正向迁移。

验收分组覆盖：

- A：20 种来源分别真实提交、独立连接回读父行、四表总数及实际目标/版本/容器；Canon 同事务终态与历史来源。
- B：四域缺支撑、12 个错域方向、六种双表组合、四表同时存在；所有支撑目标真实、自身 FK/CHECK 合法；同表重复/无父 FK 即时失败。
- C：跨域/域内类型 ID 文本碰撞、四域六字段唯一性及身份变体；Design/Candidate/Canon 的类型错误和对象 ID 错误分别隔离；全空目标/错误组合与 FK/必填值验证。直接引用 Candidate Version 或 Canon Commit 时，目标与必填容器为同一列，子目标全空本身合法，因此用“非法多目标”和“目标 ID 与合法容器不等”验证这两种分支；其余 17 个有独立目标列的分支明确将全部实际目标列设为 NULL，保留合法容器值。
- D：逐域关键语义、Bundle 可空边界、不可变与来源归属保护、原值 UPDATE、消费方共享。
- E：每域重复身份竞争各测 A 提交与 A 回滚，实际观察 `pg_stat_activity` 的 Lock 等待及具体阻塞者 PID；每域共享合法容器、不同对象的首次真实异步 COMMIT 均成功，无死锁重试；每域既有 Evidence 被两个事务追加其他域支撑时，两次首次异步 COMMIT 均失败且原父子完整保留。另有 public 路径直连和数据库元数据核验。

结果数量、错误阶段和具体 PID 均以 [运行报告](verification/runner-result.md) 为准，不预填通过数。Node 测试器的总 test 数包含顶层测试和子场景，报告分别列出两者。并发轮询的短间隔只控制查询频率，不能替代实际阻塞证据。

## 范围与剩余限制

本轮只实现上述独立约束夹具，不实现 Time Interval 联合模型、完整 Canon Commit/Bundle 生命周期、Projection Attempt、真实 Agent、权限系统、真实工具执行或正式生产迁移。`source_ref` 仅验证非空，不验证载荷内容、可访问性或保留介质。未进行生产负载基准、完整数据库恢复演练或完整业务状态机测试；这些属于后续范围，不能从本报告推定已经完成。并发结论仅覆盖报告中实际执行的竞争路径。

未修改正式文档、五个既有原型或根依赖；未执行 Git 暂存、提交、推送、reset 或 clean。验收完成即停止本批。
