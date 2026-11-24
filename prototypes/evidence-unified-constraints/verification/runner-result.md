# 四域 Evidence 联合约束原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- 实际运行时间（Asia/Shanghai）：2026/10/19 11:44:18
- pnpm：11.18.0
- Docker：Docker version 29.4.0, build 9d7ad9f
- 最终退出码：0
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32834` 上执行 `SELECT 1`
- 测试数据库：`evidence_unified_fixture`
- 测试 Schema：`evidence_unified_constraint_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（25 个顶层测试；25 通过；0 失败；358 个参数化子场景）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 evidence-unified-fixture-46483-1792381452467；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| A：20 种来源完整提交及独立连接回读 | passed | 详见实测子场景 |  |  |  |
| A：Canon 同事务终态与历史 committed 来源 | passed | 详见实测子场景 |  |  |  |
| B：四域缺支撑只在真实 COMMIT 拒绝 | passed | 详见实测子场景 |  |  |  |
| B：单支撑错域 12 个方向 | passed | 详见实测子场景 |  |  |  |
| B：六种双支撑组合和四表同时存在 | passed | 详见实测子场景 |  |  |  |
| B：同表主键与无父支撑 FK 即时拒绝 | passed | 详见实测子场景 |  |  |  |
| C：四域相同 ID 文本与域内同 ID 不同类型 | passed | 详见实测子场景 |  |  |  |
| C：六字段去重、旧四字段及 locator/kind 变体 | passed | 详见实测子场景 |  |  |  |
| C：父子类型不一致与对象 ID 不一致独立验证 | passed | 详见实测子场景 |  |  |  |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 | passed | 详见实测子场景 |  |  |  |
| C：类型 FK、必填字段和父域类型行级检查 | passed | 详见实测子场景 |  |  |  |
| D：Design Revision、版本及项目独立负例 | passed | 详见实测子场景 |  |  |  |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 | passed | 详见实测子场景 |  |  |  |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 | passed | 详见实测子场景 |  |  |  |
| D：Tool Generation 映射与执行范围 | passed | 详见实测子场景 |  |  |  |
| D：Bundle Workflow 可空边界 | passed | 详见实测子场景 |  |  |  |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 | passed | 详见实测子场景 |  |  |  |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE | passed | 详见实测子场景 |  |  |  |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 | passed | 详见实测子场景 |  |  |  |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 | passed | 详见实测子场景 |  |  |  |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT | passed | 详见实测子场景 |  |  |  |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 | passed | 详见实测子场景 |  |  |  |
| E：新建 public 路径直连的完整性与不可变保护 | passed | 详见实测子场景 |  |  |  |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 | passed | 详见实测子场景 |  |  |  |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 | passed | 详见实测子场景 |  |  |  |

## 参数化子场景统计

| 分组 | 子场景数 |
|---|---:|
| A：20 种来源完整提交及独立连接回读 | 20 |
| A：Canon 同事务终态与历史 committed 来源 | 2 |
| B：四域缺支撑只在真实 COMMIT 拒绝 | 4 |
| B：单支撑错域 12 个方向 | 12 |
| B：六种双支撑组合和四表同时存在 | 7 |
| B：同表主键与无父支撑 FK 即时拒绝 | 8 |
| C：四域相同 ID 文本与域内同 ID 不同类型 | 4 |
| C：六字段去重、旧四字段及 locator/kind 变体 | 16 |
| C：父子类型不一致与对象 ID 不一致独立验证 | 6 |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 | 38 |
| C：类型 FK、必填字段和父域类型行级检查 | 33 |
| D：Design Revision、版本及项目独立负例 | 5 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 | 8 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 | 8 |
| D：Tool Generation 映射与执行范围 | 11 |
| D：Bundle Workflow 可空边界 | 8 |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 | 20 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE | 109 |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 | 7 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 | 8 |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT | 4 |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 | 4 |
| E：新建 public 路径直连的完整性与不可变保护 | 7 |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 | 4 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 | 5 |
| 合计 | 358 |

## 实测子场景与失败阶段

| 分组 / 子场景 | 状态 | 阶段 | SQLSTATE | 约束 | 证据 |
|---|---|---|---|---|---|
| A：20 种来源完整提交及独立连接回读 / author_design_revision | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 author_design_revision 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / design_object_version | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 design_object_version 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / design_constraint | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 design_constraint 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / outline_node | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 outline_node 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / world_rule | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 world_rule 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / temporal_constraint | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 temporal_constraint 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / foreshadowing_plan | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 foreshadowing_plan 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / ending_constraint | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 ending_constraint 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / candidate_version | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 candidate_version 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / candidate_event | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 candidate_event 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / candidate_fact_proposal | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 candidate_fact_proposal 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / candidate_state_transition | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 candidate_state_transition 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / narrative_assertion | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 narrative_assertion 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / canonical_text_version | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 canonical_text_version 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / canon_commit | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 canon_commit 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / story_event | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 story_event 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / canon_fact | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 canon_fact 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / state_transition | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 state_transition 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / temporal_relation | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 temporal_relation 目标、版本/容器及四表总支撑=1 |
| A：20 种来源完整提交及独立连接回读 / tool_call | passed |  |  |  | COMMIT 成功；独立直连回读父行、实际 tool_call 目标、版本/容器及四表总支撑=1 |
| A：Canon 同事务终态与历史 committed 来源 / preparing→committed 同事务 | passed |  |  |  | preparing 来源、正文与 Evidence 一起创建，切换 committed 后整体提交 |
| A：Canon 同事务终态与历史 committed 来源 / 历史来源后续创建 Evidence | passed |  |  |  | 来源与 Evidence 使用不同事务提交；旧 committed Commit 可复用 |
| B：四域缺支撑只在真实 COMMIT 拒绝 / author_design | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_105 support_count=0; expected 1；父 INSERT 成功；独立连接确认无父子半成品 |
| B：四域缺支撑只在真实 COMMIT 拒绝 / candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_111 support_count=0; expected 1；父 INSERT 成功；独立连接确认无父子半成品 |
| B：四域缺支撑只在真实 COMMIT 拒绝 / canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_115 support_count=0; expected 1；父 INSERT 成功；独立连接确认无父子半成品 |
| B：四域缺支撑只在真实 COMMIT 拒绝 / tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_122 support_count=0; expected 1；父 INSERT 成功；独立连接确认无父子半成品 |
| B：单支撑错域 12 个方向 / author_design→candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_130 support_domain=candidate; parent_domain=author_design；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / author_design→canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_136 support_domain=canon; parent_domain=author_design；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / author_design→tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_145 support_domain=tool; parent_domain=author_design；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / candidate→author_design | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_153 support_domain=author_design; parent_domain=candidate；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / candidate→canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_161 support_domain=canon; parent_domain=candidate；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / candidate→tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_172 support_domain=tool; parent_domain=candidate；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / canon→author_design | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_178 support_domain=author_design; parent_domain=canon；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / canon→candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_186 support_domain=candidate; parent_domain=canon；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / canon→tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_195 support_domain=tool; parent_domain=canon；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / tool→author_design | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_204 support_domain=author_design; parent_domain=tool；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / tool→candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_215 support_domain=candidate; parent_domain=tool；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：单支撑错域 12 个方向 / tool→canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_224 support_domain=canon; parent_domain=tool；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚 |
| B：六种双支撑组合和四表同时存在 / author_design+candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_232 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / author_design+canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_238 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / author_design+tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_247 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / candidate+canon | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_255 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / candidate+tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_266 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / canon+tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_275 support_count=2; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：六种双支撑组合和四表同时存在 / author_design+candidate+canon+tool | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_290 support_count=4; expected 1；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚 |
| B：同表主键与无父支撑 FK 即时拒绝 / author_design/duplicate | passed | support INSERT | 23505 | evidence_design_source_pkey | duplicate key value violates unique constraint "evidence_design_source_pkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / author_design/orphan | passed | support INSERT | 23503 | evidence_design_source_evidence_reference_id_fkey | insert or update on table "evidence_design_source" violates foreign key constraint "evidence_design_source_evidence_reference_id_fkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / candidate/duplicate | passed | support INSERT | 23505 | evidence_candidate_source_pkey | duplicate key value violates unique constraint "evidence_candidate_source_pkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / candidate/orphan | passed | support INSERT | 23503 | evidence_candidate_source_evidence_reference_id_fkey | insert or update on table "evidence_candidate_source" violates foreign key constraint "evidence_candidate_source_evidence_reference_id_fkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / canon/duplicate | passed | support INSERT | 23505 | evidence_canon_source_pkey | duplicate key value violates unique constraint "evidence_canon_source_pkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / canon/orphan | passed | support INSERT | 23503 | evidence_canon_source_evidence_reference_id_fkey | insert or update on table "evidence_canon_source" violates foreign key constraint "evidence_canon_source_evidence_reference_id_fkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / tool/duplicate | passed | support INSERT | 23505 | evidence_tool_source_pkey | duplicate key value violates unique constraint "evidence_tool_source_pkey" |
| B：同表主键与无父支撑 FK 即时拒绝 / tool/orphan | passed | support INSERT | 23503 | evidence_tool_source_evidence_reference_id_fkey | insert or update on table "evidence_tool_source" violates foreign key constraint "evidence_tool_source_evidence_reference_id_fkey" |
| C：四域相同 ID 文本与域内同 ID 不同类型 / 四域共享版本/对象/locator/kind 文本 | passed |  |  |  | 四个真实来源对象共享 ID 文本；四条父记录与各自单一支撑均提交成功，无跨域共用 ID 唯一限制 |
| C：四域相同 ID 文本与域内同 ID 不同类型 / world_rule+design_constraint | passed |  |  |  | 仅实际类型不同，其余五字段相同；两种真实目标均存在并提交 |
| C：四域相同 ID 文本与域内同 ID 不同类型 / candidate_event+candidate_fact_proposal | passed |  |  |  | 仅实际类型不同，其余五字段相同；两种真实目标均存在并提交 |
| C：四域相同 ID 文本与域内同 ID 不同类型 / story_event+canon_fact | passed |  |  |  | 仅实际类型不同，其余五字段相同；两种真实目标均存在并提交 |
| C：六字段去重、旧四字段及 locator/kind 变体 / author_design/完整六字段重复 | passed | parent INSERT | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity" |
| C：六字段去重、旧四字段及 locator/kind 变体 / author_design/同版本旧四字段同但实际对象不同 | passed |  |  |  | 同域、同来源类型/版本、同 locator/kind；两个实际对象分别提交 |
| C：六字段去重、旧四字段及 locator/kind 变体 / author_design/locator 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / author_design/evidence_kind 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / candidate/完整六字段重复 | passed | parent INSERT | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity" |
| C：六字段去重、旧四字段及 locator/kind 变体 / candidate/同版本旧四字段同但实际对象不同 | passed |  |  |  | 同域、同来源类型/版本、同 locator/kind；两个实际对象分别提交 |
| C：六字段去重、旧四字段及 locator/kind 变体 / candidate/locator 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / candidate/evidence_kind 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / canon/完整六字段重复 | passed | parent INSERT | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity" |
| C：六字段去重、旧四字段及 locator/kind 变体 / canon/同版本旧四字段同但实际对象不同 | passed |  |  |  | 同域、同来源类型/版本、同 locator/kind；两个实际对象分别提交 |
| C：六字段去重、旧四字段及 locator/kind 变体 / canon/locator 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / canon/evidence_kind 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / tool/完整六字段重复 | passed | parent INSERT | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity" |
| C：六字段去重、旧四字段及 locator/kind 变体 / tool/同版本旧四字段同但实际对象不同 | passed |  |  |  | 同域、同来源类型/版本、同 locator/kind；两个实际对象分别提交 |
| C：六字段去重、旧四字段及 locator/kind 变体 / tool/locator 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：六字段去重、旧四字段及 locator/kind 变体 / tool/evidence_kind 不同 | passed |  |  |  | 其余五个身份字段相同，真实 COMMIT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / author_design/type_only_same_id | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_410 parent identity does not match its Author Design source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / author_design/object_only_same_type | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_415 parent identity does not match its Author Design source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / candidate/type_only_same_id | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_421 parent identity does not match its Candidate source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / candidate/object_only_same_type | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_428 parent identity does not match its Candidate source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / canon/type_only_same_id | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_432 parent identity does not match its Canon source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：父子类型不一致与对象 ID 不一致独立验证 / canon/object_only_same_type | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_437 parent identity does not match its Canon source row；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功 |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / author_design_revision/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / author_design_revision/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / design_object_version/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / design_object_version/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / design_constraint/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / design_constraint/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / outline_node/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / outline_node/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / world_rule/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / world_rule/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / temporal_constraint/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / temporal_constraint/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / foreshadowing_plan/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / foreshadowing_plan/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / ending_constraint/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / ending_constraint/wrong_combination | passed | support INSERT | 23514 | ck_evidence_design_source_target_shape | new row for relation "evidence_design_source" violates check constraint "ck_evidence_design_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_version/wrong_combination | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_version/wrong_container_target_id | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_event/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_event/wrong_combination | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_fact_proposal/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_fact_proposal/wrong_combination | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_state_transition/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / candidate_state_transition/wrong_combination | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / narrative_assertion/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / narrative_assertion/wrong_combination | passed | support INSERT | 23514 | ck_evidence_candidate_source_target_shape | new row for relation "evidence_candidate_source" violates check constraint "ck_evidence_candidate_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canonical_text_version/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canonical_text_version/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canon_commit/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canon_commit/wrong_container_target_id | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / story_event/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / story_event/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canon_fact/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / canon_fact/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / state_transition/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / state_transition/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / temporal_relation/all_actual_targets_null | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：逐分支全空实际目标及错误组合在 INSERT 拒绝 / temporal_relation/wrong_combination | passed | support INSERT | 23514 | ck_evidence_canon_source_target_shape | new row for relation "evidence_canon_source" violates check constraint "ck_evidence_canon_source_target_shape" |
| C：类型 FK、必填字段和父域类型行级检查 / author_design_revision/悬空实际目标 FK | passed | support INSERT | 23503 | evidence_design_source_author_design_revision_id_fkey | insert or update on table "evidence_design_source" violates foreign key constraint "evidence_design_source_author_design_revision_id_fkey" |
| C：类型 FK、必填字段和父域类型行级检查 / design_object_version/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_object_version | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_object_version" |
| C：类型 FK、必填字段和父域类型行级检查 / design_constraint/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_constraint | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_constraint" |
| C：类型 FK、必填字段和父域类型行级检查 / outline_node/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_outline_node | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_outline_node" |
| C：类型 FK、必填字段和父域类型行级检查 / world_rule/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_world_rule | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_world_rule" |
| C：类型 FK、必填字段和父域类型行级检查 / temporal_constraint/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_temporal_constraint | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_temporal_constraint" |
| C：类型 FK、必填字段和父域类型行级检查 / foreshadowing_plan/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_foreshadowing_plan | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_foreshadowing_plan" |
| C：类型 FK、必填字段和父域类型行级检查 / ending_constraint/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_design_ending_constraint | insert or update on table "evidence_design_source" violates foreign key constraint "fk_evidence_design_ending_constraint" |
| C：类型 FK、必填字段和父域类型行级检查 / candidate_version/悬空实际目标 FK | passed | support INSERT | 23503 | evidence_candidate_source_candidate_version_id_fkey | insert or update on table "evidence_candidate_source" violates foreign key constraint "evidence_candidate_source_candidate_version_id_fkey" |
| C：类型 FK、必填字段和父域类型行级检查 / candidate_event/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_candidate_event | insert or update on table "evidence_candidate_source" violates foreign key constraint "fk_evidence_candidate_event" |
| C：类型 FK、必填字段和父域类型行级检查 / candidate_fact_proposal/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_candidate_fact_proposal | insert or update on table "evidence_candidate_source" violates foreign key constraint "fk_evidence_candidate_fact_proposal" |
| C：类型 FK、必填字段和父域类型行级检查 / candidate_state_transition/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_candidate_state_transition | insert or update on table "evidence_candidate_source" violates foreign key constraint "fk_evidence_candidate_state_transition" |
| C：类型 FK、必填字段和父域类型行级检查 / narrative_assertion/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_candidate_assertion | insert or update on table "evidence_candidate_source" violates foreign key constraint "fk_evidence_candidate_assertion" |
| C：类型 FK、必填字段和父域类型行级检查 / canonical_text_version/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_text_version | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_text_version" |
| C：类型 FK、必填字段和父域类型行级检查 / canon_commit/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_commit | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_commit" |
| C：类型 FK、必填字段和父域类型行级检查 / story_event/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_story_event | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_story_event" |
| C：类型 FK、必填字段和父域类型行级检查 / canon_fact/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_fact | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_fact" |
| C：类型 FK、必填字段和父域类型行级检查 / state_transition/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_state_transition | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_state_transition" |
| C：类型 FK、必填字段和父域类型行级检查 / temporal_relation/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_canon_temporal_relation | insert or update on table "evidence_canon_source" violates foreign key constraint "fk_evidence_canon_temporal_relation" |
| C：类型 FK、必填字段和父域类型行级检查 / tool_call/悬空实际目标 FK | passed | support INSERT | 23503 | fk_evidence_tool_call | insert or update on table "evidence_tool_source" violates foreign key constraint "fk_evidence_tool_call" |
| C：类型 FK、必填字段和父域类型行级检查 / source_domain/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "source_domain" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / source_version_id/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "source_version_id" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / source_object_type/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "source_object_type" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / source_object_id/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "source_object_id" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / locator/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "locator" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / evidence_kind/NOT NULL | passed | parent INSERT | 23502 |  | null value in column "evidence_kind" of relation "evidence_reference" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / parent CHECK {"source_domain":"unknown"} | passed | parent INSERT | 23514 | ck_evidence_reference_domain_type | new row for relation "evidence_reference" violates check constraint "ck_evidence_reference_domain_type" |
| C：类型 FK、必填字段和父域类型行级检查 / parent CHECK {"source_object_type":"story_event"} | passed | parent INSERT | 23514 | ck_evidence_reference_domain_type | new row for relation "evidence_reference" violates check constraint "ck_evidence_reference_domain_type" |
| C：类型 FK、必填字段和父域类型行级检查 / parent CHECK {"locator":" "} | passed | parent INSERT | 23514 | ck_evidence_reference_locator_nonempty | new row for relation "evidence_reference" violates check constraint "ck_evidence_reference_locator_nonempty" |
| C：类型 FK、必填字段和父域类型行级检查 / parent CHECK {"evidence_kind":" "} | passed | parent INSERT | 23514 | ck_evidence_reference_kind_nonempty | new row for relation "evidence_reference" violates check constraint "ck_evidence_reference_kind_nonempty" |
| C：类型 FK、必填字段和父域类型行级检查 / tool/tool_call_id=null | passed | support INSERT | 23502 |  | null value in column "tool_call_id" of relation "evidence_tool_source" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / tool/source_ref=null | passed | support INSERT | 23502 |  | null value in column "source_ref" of relation "evidence_tool_source" violates not-null constraint |
| C：类型 FK、必填字段和父域类型行级检查 / tool/source_ref=" " | passed | support INSERT | 23514 | ck_evidence_tool_source_ref_nonempty | new row for relation "evidence_tool_source" violates check constraint "ck_evidence_tool_source_ref_nonempty" |
| D：Design Revision、版本及项目独立负例 / parent_version | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_768 parent identity does not match its Author Design source row；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Design Revision、版本及项目独立负例 / target_revision | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_774 target does not belong to the selected revision and project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Design Revision、版本及项目独立负例 / parent_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_780 revision and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Design Revision、版本及项目独立负例 / target_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_786 revision and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Design Revision、版本及项目独立负例 / revision_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_794 revision and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / parent_version | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_804 parent identity does not match its Candidate source row；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / target_candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_814 target does not belong to the selected Candidate and project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / parent_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_824 Candidate, Workflow Run, and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / target_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_834 Candidate, Workflow Run, and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / workflow_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_844 Candidate, Workflow Run, and project ownership do not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / assertion_wrong_candidate | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_854 Narrative Assertion Candidate source chain does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / assertion_missing_chain | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_864 Narrative Assertion Candidate source chain does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Candidate 容器、Workflow 与 Assertion 支撑链 / assertion_wrong_domain | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_874 Narrative Assertion Candidate source chain does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / creating_commit | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_880 target, version, project, or creating Commit does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / text_creating_commit | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_886 target, version, project, or creating Commit does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / text_version_uses_commit | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_892 target, version, project, or creating Commit does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / internal_version_uses_text | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_899 target, version, project, or creating Commit does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / parent_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_905 Commit is absent, not committed, or outside the project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / target_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_911 Commit is absent, not committed, or outside the project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / preparing | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_917 Commit is absent, not committed, or outside the project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Canon 创建 Commit、正文/Commit 版本映射与终态 / failed | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_923 Commit is absent, not committed, or outside the project；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / parent_generation | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_935 parent identity does not match its Tool Call source；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / version_uses_tool_id | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_943 parent identity does not match its Tool Call source；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / object_id | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_952 parent identity does not match its Tool Call source；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / parent_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_960 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / tool_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_968 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / generation_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_976 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / workflow_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_984 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / bundle_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_992 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / workflow_task_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1000 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / task_version | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1009 Workflow Run and Context Bundle use different Scene Task Versions；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Tool Generation 映射与执行范围 / bundle_workflow | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1018 Generation Run and Context Bundle use different Workflow Runs；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空合法 | passed |  |  |  | Bundle.workflow_run_id=NULL；Generation→Workflow 与 Bundle Task/项目一致；COMMIT 成功 |
| D：Bundle Workflow 可空边界 / 同 Workflow 合法 | passed |  |  |  | Bundle 关联 Generation 同一 Workflow；COMMIT 成功 |
| D：Bundle Workflow 可空边界 / 不同 Workflow 非法 | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1040 Generation Run and Context Bundle use different Workflow Runs；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空仍校验 task | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1049 Workflow Run and Context Bundle use different Scene Task Versions；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空仍校验 bundle_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1057 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空仍校验 workflow_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1065 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空仍校验 generation_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1073 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：Bundle Workflow 可空边界 / 为空仍校验 task_project | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1081 execution project ownership does not match；父/支撑 INSERT 成功，独立连接确认整体回滚 |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / author_design/evidence_reference/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / author_design/evidence_reference/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / author_design/evidence_design_source/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_design_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / author_design/evidence_design_source/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_design_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / author_design/多消费方共享 | passed |  |  |  | 3 个消费方共用同一 Evidence；完整身份父行数=1、四表总支撑=1 |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / candidate/evidence_reference/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / candidate/evidence_reference/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / candidate/evidence_candidate_source/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_candidate_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / candidate/evidence_candidate_source/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_candidate_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / candidate/多消费方共享 | passed |  |  |  | 3 个消费方共用同一 Evidence；完整身份父行数=1、四表总支撑=1 |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / canon/evidence_reference/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / canon/evidence_reference/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / canon/evidence_canon_source/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_canon_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / canon/evidence_canon_source/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_canon_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / canon/多消费方共享 | passed |  |  |  | 3 个消费方共用同一 Evidence；完整身份父行数=1、四表总支撑=1 |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / tool/evidence_reference/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / tool/evidence_reference/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / tool/evidence_tool_source/UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_tool_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / tool/evidence_tool_source/DELETE | passed | DELETE | 23514 | evidence_source_immutable | evidence_tool_source rows are append-only |
| D：父行及四类支撑修改/删除拒绝，多个消费方共享 / tool/多消费方共享 | passed |  |  |  | 3 个消费方共用同一 Evidence；完整身份父行数=1、四表总支撑=1 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / author_design_revision/revision_1116/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | author_design_revision.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / author_design_revision/revision_1116/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | author_design_revision.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / author_design_revision/revision_1116/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_object_version/design_object_version_1121/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_object_version.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_object_version/design_object_version_1121/design_object_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_object_version.design_object_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_object_version/design_object_version_1121/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_object_version.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_object_version/design_object_version_1121/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_constraint/design_constraint_1123/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_constraint.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_constraint/design_constraint_1123/design_constraint_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_constraint.design_constraint_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_constraint/design_constraint_1123/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | design_constraint.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / design_constraint/design_constraint_1123/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / outline_node/outline_node_1125/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | outline_node.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / outline_node/outline_node_1125/outline_node_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | outline_node.outline_node_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / outline_node/outline_node_1125/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | outline_node.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / outline_node/outline_node_1125/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / world_rule/world_rule_1127/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | world_rule.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / world_rule/world_rule_1127/world_rule_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | world_rule.world_rule_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / world_rule/world_rule_1127/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | world_rule.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / world_rule/world_rule_1127/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_constraint/temporal_constraint_1129/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_constraint.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_constraint/temporal_constraint_1129/temporal_constraint_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_constraint.temporal_constraint_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_constraint/temporal_constraint_1129/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_constraint.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_constraint/temporal_constraint_1129/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / foreshadowing_plan/foreshadowing_plan_1131/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | foreshadowing_plan.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / foreshadowing_plan/foreshadowing_plan_1131/foreshadowing_plan_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | foreshadowing_plan.foreshadowing_plan_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / foreshadowing_plan/foreshadowing_plan_1131/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | foreshadowing_plan.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / foreshadowing_plan/foreshadowing_plan_1131/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / ending_constraint/ending_constraint_1133/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | ending_constraint.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / ending_constraint/ending_constraint_1133/ending_constraint_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | ending_constraint.ending_constraint_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / ending_constraint/ending_constraint_1133/revision_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | ending_constraint.revision_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / ending_constraint/ending_constraint_1133/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_version/candidate_1138/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_version.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_version/candidate_1138/candidate_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_version.candidate_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_version/candidate_1138/workflow_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_version.workflow_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_version/candidate_1138/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_event/candidate_event_1145/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_event.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_event/candidate_event_1145/candidate_event_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_event.candidate_event_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_event/candidate_event_1145/candidate_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_event.candidate_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_event/candidate_event_1145/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_fact_proposal/candidate_fact_proposal_1147/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_fact_proposal.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_fact_proposal/candidate_fact_proposal_1147/candidate_fact_proposal_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_fact_proposal.candidate_fact_proposal_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_fact_proposal/candidate_fact_proposal_1147/candidate_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_fact_proposal.candidate_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_fact_proposal/candidate_fact_proposal_1147/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_state_transition/candidate_state_transition_1149/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_state_transition.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_state_transition/candidate_state_transition_1149/candidate_state_transition_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_state_transition.candidate_state_transition_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_state_transition/candidate_state_transition_1149/candidate_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | candidate_state_transition.candidate_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / candidate_state_transition/candidate_state_transition_1149/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion/narrative_assertion_1151/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | narrative_assertion.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion/narrative_assertion_1151/assertion_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | narrative_assertion.assertion_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion/narrative_assertion_1151/source_domain 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | narrative_assertion.source_domain source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion/narrative_assertion_1151/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion_candidate_source/narrative_assertion_1151/candidate_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_immutable | narrative_assertion_candidate_source rows are append-only |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion_candidate_source/narrative_assertion_1151/source_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_immutable | narrative_assertion_candidate_source rows are append-only |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / narrative_assertion_candidate_source/narrative_assertion_1151/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1136/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | scene_task_version.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1136/scene_task_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | scene_task_version.scene_task_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1136/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1137/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1137/workflow_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.workflow_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1137/scene_task_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.scene_task_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1137/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canonical_text_version/canonical_text_version_1157/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canonical_text_version.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canonical_text_version/canonical_text_version_1157/canonical_text_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canonical_text_version.canonical_text_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canonical_text_version/canonical_text_version_1157/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canonical_text_version.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canonical_text_version/canonical_text_version_1157/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_commit/commit_1154/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canon_commit.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_commit/commit_1154/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canon_commit.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_commit/commit_1154/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / story_event/story_event_1161/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | story_event.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / story_event/story_event_1161/story_event_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | story_event.story_event_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / story_event/story_event_1161/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | story_event.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / story_event/story_event_1161/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_fact/canon_fact_1163/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canon_fact.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_fact/canon_fact_1163/canon_fact_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canon_fact.canon_fact_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_fact/canon_fact_1163/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | canon_fact.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / canon_fact/canon_fact_1163/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / state_transition/state_transition_1165/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | state_transition.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / state_transition/state_transition_1165/state_transition_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | state_transition.state_transition_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / state_transition/state_transition_1165/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | state_transition.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / state_transition/state_transition_1165/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_relation/temporal_relation_1167/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_relation.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_relation/temporal_relation_1167/temporal_relation_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_relation.temporal_relation_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_relation/temporal_relation_1167/canon_commit_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | temporal_relation.canon_commit_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / temporal_relation/temporal_relation_1167/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | tool_call.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/tool_call_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | tool_call.tool_call_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/generation_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | tool_call.generation_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/tool_name 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | tool_call.tool_name source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/request_ref 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | tool_call.request_ref source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/response_ref 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | Tool Call existing result cannot be overwritten |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / tool_call/tool_call_1179/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1170/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | scene_task_version.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1170/scene_task_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | scene_task_version.scene_task_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / scene_task_version/task_1170/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1171/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1171/workflow_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.workflow_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1171/scene_task_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | workflow_run.scene_task_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / workflow_run/workflow_1171/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / context_bundle/bundle_1172/context_bundle_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | context_bundle.context_bundle_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / context_bundle/bundle_1172/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | context_bundle.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / context_bundle/bundle_1172/scene_task_version_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | context_bundle.scene_task_version_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / context_bundle/bundle_1172/workflow_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | context_bundle.workflow_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / context_bundle/bundle_1172/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / generation_run/generation_1173/generation_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | generation_run.generation_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / generation_run/generation_1173/project_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | generation_run.project_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / generation_run/generation_1173/workflow_run_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | generation_run.workflow_run_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / generation_run/generation_1173/context_bundle_id 实际变化 | passed | UPDATE | 23514 | evidence_source_complete | generation_run.context_bundle_id source identity/ownership is immutable |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / generation_run/generation_1173/无变化 UPDATE | passed |  |  |  | 全部来源保护字段保持原值；UPDATE 与 COMMIT 成功 |
| D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE / Assertion 来源支撑删除 | passed | DELETE | 23514 | evidence_source_immutable | narrative_assertion_candidate_source rows are append-only |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / author_design/被引用实际目标删除 | passed | DELETE | 23503 | fk_evidence_design_world_rule | update or delete on table "world_rule" violates foreign key constraint "fk_evidence_design_world_rule" on table "evidence_design_source" |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / candidate/被引用实际目标删除 | passed | DELETE | 23503 | fk_evidence_candidate_event | update or delete on table "candidate_event" violates foreign key constraint "fk_evidence_candidate_event" on table "evidence_candidate_source" |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / canon/被引用实际目标删除 | passed | DELETE | 23503 | fk_evidence_canon_story_event | update or delete on table "story_event" violates foreign key constraint "fk_evidence_canon_story_event" on table "evidence_canon_source" |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / tool/被引用实际目标删除 | passed | DELETE | 23503 | fk_evidence_tool_call | update or delete on table "tool_call" violates foreign key constraint "fk_evidence_tool_call" on table "evidence_tool_source" |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / committed/终态不可变 | passed | UPDATE | 23514 | evidence_canon_commit_terminal | Committed and failed states are terminal |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / failed/终态不可变 | passed | UPDATE | 23514 | evidence_canon_commit_terminal | Committed and failed states are terminal |
| D：来源删除 FK、Commit 终态和 Tool 响应首次写入 / Tool response_ref 从 NULL 首次写入 | passed |  |  |  | 保留 Tool 来源原型的首次响应写入边界；已有非空响应覆盖另有负例 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / author_design/A COMMIT | passed | B parent INSERT after lock wait | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity"；A PID=585, B PID=587; pg_stat_activity={"pid":587,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[585]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / author_design/A ROLLBACK | passed | B COMMIT |  |  | A 回滚后 B 完成来源支撑并首次提交成功；A PID=591, B PID=593; pg_stat_activity={"pid":593,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[591]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / candidate/A COMMIT | passed | B parent INSERT after lock wait | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity"；A PID=597, B PID=599; pg_stat_activity={"pid":599,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[597]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / candidate/A ROLLBACK | passed | B COMMIT |  |  | A 回滚后 B 完成来源支撑并首次提交成功；A PID=604, B PID=605; pg_stat_activity={"pid":605,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[604]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / canon/A COMMIT | passed | B parent INSERT after lock wait | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity"；A PID=610, B PID=611; pg_stat_activity={"pid":611,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[610]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / canon/A ROLLBACK | passed | B COMMIT |  |  | A 回滚后 B 完成来源支撑并首次提交成功；A PID=616, B PID=617; pg_stat_activity={"pid":617,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[616]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / tool/A COMMIT | passed | B parent INSERT after lock wait | 23505 | uq_evidence_reference_full_identity | duplicate key value violates unique constraint "uq_evidence_reference_full_identity"；A PID=621, B PID=623; pg_stat_activity={"pid":623,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[621]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域重复身份 A 提交/回滚的真实阻塞证据 / tool/A ROLLBACK | passed | B COMMIT |  |  | A 回滚后 B 完成来源支撑并首次提交成功；A PID=627, B PID=629; pg_stat_activity={"pid":629,"state":"active","wait_event_type":"Lock","wait_event":"transactionid","blockers":[627]}；独立连接确认仅获胜者完整父子关系持久化 |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT / author_design | passed | first asynchronous COMMIT |  |  | 共享容器=revision_1292; PID=635,634; 首次结果=fulfilled,fulfilled; 无重试；观察=[{"pid":634,"state":"idle in transaction","blockers":[]},{"pid":635,"state":"idle in transaction","blockers":[]}]；独立连接回读两套完整父子关系 |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT / candidate | passed | first asynchronous COMMIT |  |  | 共享容器=candidate_1300; PID=641,642; 首次结果=fulfilled,fulfilled; 无重试；观察=[{"pid":641,"state":"idle in transaction","blockers":[]},{"pid":642,"state":"idle in transaction","blockers":[]}]；独立连接回读两套完整父子关系 |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT / canon | passed | first asynchronous COMMIT |  |  | 共享容器=commit_1306; PID=649,648; 首次结果=fulfilled,fulfilled; 无重试；观察=[{"pid":648,"state":"idle in transaction","blockers":[]},{"pid":649,"state":"idle in transaction","blockers":[]}]；独立连接回读两套完整父子关系 |
| E：四域共享合法容器、不同实际对象首次异步 COMMIT / tool | passed | first asynchronous COMMIT |  |  | 共享容器=generation_1315; PID=656,655; 首次结果=fulfilled,fulfilled; 无重试；观察=[{"pid":655,"state":"idle in transaction","blockers":[]},{"pid":656,"state":"idle in transaction","blockers":[]}]；独立连接回读两套完整父子关系 |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 / author_design | passed | both asynchronous COMMIT | 23514 | evidence_source_complete | PID=665,664; 两次支撑 INSERT 均成功；首次 COMMIT 均拒绝=[{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1323 support_count=2; expected 1"},{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1323 support_count=2; expected 1"}]；原父行/原支撑保留，四表总计=1 |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 / candidate | passed | both asynchronous COMMIT | 23514 | evidence_source_complete | PID=673,672; 两次支撑 INSERT 均成功；首次 COMMIT 均拒绝=[{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1335 support_count=2; expected 1"},{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1335 support_count=2; expected 1"}]；原父行/原支撑保留，四表总计=1 |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 / canon | passed | both asynchronous COMMIT | 23514 | evidence_source_complete | PID=680,681; 两次支撑 INSERT 均成功；首次 COMMIT 均拒绝=[{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1343 support_count=2; expected 1"},{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1343 support_count=2; expected 1"}]；原父行/原支撑保留，四表总计=1 |
| E：既有合法 Evidence 被两个事务追加其他域错误支撑 / tool | passed | both asynchronous COMMIT | 23514 | evidence_source_complete | PID=688,690; 两次支撑 INSERT 均成功；首次 COMMIT 均拒绝=[{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1356 support_count=2; expected 1"},{"code":"23514","constraint":"evidence_source_complete","message":"Evidence evidence_1356 support_count=2; expected 1"}]；原父行/原支撑保留，四表总计=1 |
| E：新建 public 路径直连的完整性与不可变保护 / author_design/public 合法提交 | passed |  |  |  | 全新 pg.Client，search_path=public，所有业务表使用全限定名；独立连接回读完整映射 |
| E：新建 public 路径直连的完整性与不可变保护 / candidate/public 合法提交 | passed |  |  |  | 全新 pg.Client，search_path=public，所有业务表使用全限定名；独立连接回读完整映射 |
| E：新建 public 路径直连的完整性与不可变保护 / canon/public 合法提交 | passed |  |  |  | 全新 pg.Client，search_path=public，所有业务表使用全限定名；独立连接回读完整映射 |
| E：新建 public 路径直连的完整性与不可变保护 / tool/public 合法提交 | passed |  |  |  | 全新 pg.Client，search_path=public，所有业务表使用全限定名；独立连接回读完整映射 |
| E：新建 public 路径直连的完整性与不可变保护 / public 缺支撑 COMMIT | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1387 support_count=0; expected 1 |
| E：新建 public 路径直连的完整性与不可变保护 / public 多支撑 COMMIT | passed | COMMIT | 23514 | evidence_source_complete | Evidence evidence_1391 support_count=2; expected 1 |
| E：新建 public 路径直连的完整性与不可变保护 / public 不可变 UPDATE | passed | UPDATE | 23514 | evidence_source_immutable | evidence_reference rows are append-only |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 / 全部数据库函数固定路径，无 SECURITY DEFINER | passed |  |  |  | 实际 pg_proc 核验=[{"proname":"protect_source_ownership","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"raise_evidence_source_complete","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"reject_evidence_mutation","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_candidate","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_canon","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_design","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_source","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_source_trigger","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false},{"proname":"validate_evidence_tool","proconfig":["search_path=pg_catalog, evidence_unified_constraint_fixture, pg_temp"],"prosecdef":false}] |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 / 共同父表及四支撑表全部写路径默认延后 | passed |  |  |  | 实际 pg_trigger 核验=[{"relname":"evidence_candidate_source","tgname":"evidence_candidate_source_complete","tgtype":29,"tgdeferrable":true,"tginitdeferred":true},{"relname":"evidence_canon_source","tgname":"evidence_canon_source_complete","tgtype":29,"tgdeferrable":true,"tginitdeferred":true},{"relname":"evidence_design_source","tgname":"evidence_design_source_complete","tgtype":29,"tgdeferrable":true,"tginitdeferred":true},{"relname":"evidence_reference","tgname":"evidence_reference_complete","tgtype":29,"tgdeferrable":true,"tginitdeferred":true},{"relname":"evidence_tool_source","tgname":"evidence_tool_source_complete","tgtype":29,"tgdeferrable":true,"tginitdeferred":true}] |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 / 六字段唯一身份且旧四字段索引非唯一 | passed |  |  |  | [{"conname":"uq_evidence_reference_full_identity","definition":"UNIQUE (source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind)"}]；{"indisunique":false,"definition":"CREATE INDEX idx_evidence_reference_legacy_lookup ON evidence_unified_constraint_fixture.evidence_reference USING btree (source_domain, source_version_id, locator, evidence_kind)"} |
| E：实际保存的函数路径、触发器、唯一身份及 Schema 边界 / 所有业务 FK 均指向本 Schema，单一 Evidence 父表，Bundle Workflow 可空 | passed |  |  |  | 75 个业务 FK 全在本 Schema；空库无旧原型 Schema；Bundle Workflow 列可空 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 / evidence_reference | passed | TRUNCATE | 23514 | evidence_source_immutable | 语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 / evidence_design_source | passed | TRUNCATE | 23514 | evidence_source_immutable | 语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 / evidence_candidate_source | passed | TRUNCATE | 23514 | evidence_source_immutable | 语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 / evidence_canon_source | passed | TRUNCATE | 23514 | evidence_source_immutable | 语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留 |
| D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护 / evidence_tool_source | passed | TRUNCATE | 23514 | evidence_source_immutable | 语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留 |

## 范围声明

- 本原型验证四域 20 种 Evidence 来源、跨四表恰一支撑、完整身份去重及最小来源归属夹具。
- 不代表正式生产 Schema；不实现真实工具调用、能力授权、外部 source_ref 内容验证、Time Interval 联合模型、完整 Canon Commit 或正式生产 Schema。
