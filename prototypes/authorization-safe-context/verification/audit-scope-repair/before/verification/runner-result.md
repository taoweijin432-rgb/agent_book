# 权限与秘密安全上下文集中验证原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 本轮专属角色前缀：`asc_2a7e75e1dd92`（密码仅在测试内存中）
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- 实际运行时间（Asia/Shanghai）：2026/10/20 09:50:33
- pnpm：11.18.0
- Docker：Docker version 29.4.0, build 9d7ad9f
- 最终退出码：0
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32862` 上执行 `SELECT 1`
- 测试数据库：`authorization_safe_context`
- 测试 Schema：`authorization_safe_context_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（5 个顶层测试；5 通过；0 失败；109 个参数化子场景）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 authorization-safe-context-fixture-34425-1792461027367；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| A 真实登录身份与写入边界 | passed | 详见安全标签与计数；未输出秘密值 |  |  |  |
| B 秘密、人物视角与检索 | passed | 详见安全标签与计数；未输出秘密值 |  |  |  |
| C Bundle 来源、冻结与复用授权 | passed | 详见安全标签与计数；未输出秘密值 |  |  |  |
| D 默认日志、错误与拒绝审计 | passed | 详见安全标签与计数；未输出秘密值 |  |  |  |
| E 撤销竞争、连接隔离与失败清理 | passed | 详见安全标签与计数；未输出秘密值 |  |  |  |

## 参数化子场景统计

| 分组 | 子场景数 |
|---|---:|
| A 真实登录身份与写入边界 | 58 |
| B 秘密、人物视角与检索 | 15 |
| C Bundle 来源、冻结与复用授权 | 21 |
| D 默认日志、错误与拒绝审计 | 6 |
| E 撤销竞争、连接隔离与失败清理 | 9 |
| 合计 | 109 |

## 实测子场景与失败阶段

| 分组 / 子场景 | 状态 | 阶段 | SQLSTATE | 约束 | 证据 |
|---|---|---|---|---|---|
| A 真实登录身份与写入边界 / author 为独立受限登录身份 | passed |  |  |  | {"identity":"author","login":"asc_2a7e75e1dd92_author","effectiveUser":"asc_2a7e75e1dd92_author","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / writerA 为独立受限登录身份 | passed |  |  |  | {"identity":"writerA","login":"asc_2a7e75e1dd92_writera","effectiveUser":"asc_2a7e75e1dd92_writera","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / writerB 为独立受限登录身份 | passed |  |  |  | {"identity":"writerB","login":"asc_2a7e75e1dd92_writerb","effectiveUser":"asc_2a7e75e1dd92_writerb","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / peer 为独立受限登录身份 | passed |  |  |  | {"identity":"peer","login":"asc_2a7e75e1dd92_peer","effectiveUser":"asc_2a7e75e1dd92_peer","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / validator 为独立受限登录身份 | passed |  |  |  | {"identity":"validator","login":"asc_2a7e75e1dd92_validator","effectiveUser":"asc_2a7e75e1dd92_validator","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / auditor 为独立受限登录身份 | passed |  |  |  | {"identity":"auditor","login":"asc_2a7e75e1dd92_auditor","effectiveUser":"asc_2a7e75e1dd92_auditor","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / expiring 为独立受限登录身份 | passed |  |  |  | {"identity":"expiring","login":"asc_2a7e75e1dd92_expiring","effectiveUser":"asc_2a7e75e1dd92_expiring","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / disabled 为独立受限登录身份 | passed |  |  |  | {"identity":"disabled","login":"asc_2a7e75e1dd92_disabled","effectiveUser":"asc_2a7e75e1dd92_disabled","nonSuperuser":true,"noBypassRls":true,"noRoleMembership":true,"ownedTables":0} |
| A 真实登录身份与写入边界 / 真实作者读取其授权设计，跨项目拒绝 | passed |  |  |  | author_design_positive=true; foreign_project_denied=true; secret_value_omitted |
| A 真实登录身份与写入边界 / 真实写作身份取得安全包并写入授权 Candidate | passed |  |  |  | {"safeBundle":true,"authorizedCandidate":true,"realWorkflowTaskBundle":true} |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 resource | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 design_revision | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 data_scope | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 capability_grant | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 safe_projection_rule | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 context_source_reference | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 access_audit_record | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接读取 validation_result | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 caller 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 current_policy 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 authorize 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 digest 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 grant_live 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 projection 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 audit 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 内部辅助函数 assert_bundle 无执行权 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 resource | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 design_revision | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 capability_grant | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 data_scope | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 access_audit_record | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 context_bundle | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 context_item | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 context_source_reference | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能直接写入 candidate_version | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 写作身份不能调用 read_design 高权限入口 | passed | tool_boundary |  |  | restricted_function_execute_denied; safe_external_error |
| A 真实登录身份与写入边界 / 写作身份不能调用 validate 高权限入口 | passed | tool_boundary |  |  | restricted_function_execute_denied; safe_external_error |
| A 真实登录身份与写入边界 / 写作身份不能调用 manage_grant 高权限入口 | passed | tool_boundary |  |  | restricted_function_execute_denied; safe_external_error |
| A 真实登录身份与写入边界 / 写作身份不能调用 read_audit 高权限入口 | passed | tool_boundary |  |  | restricted_function_execute_denied; safe_external_error |
| A 真实登录身份与写入边界 / 伪造 actor_id 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 scope_id 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 project_id 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 scene_id 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 viewpoint_id 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 canon_watermark 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 policy_version 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 伪造 filtered_context 不能提权 | passed |  |  |  | request_extra_fields_denied |
| A 真实登录身份与写入边界 / 真实未授权 Task task_b 拒绝 | passed |  |  |  | server_task_scope_or_pov_watermark_denied |
| A 真实登录身份与写入边界 / 真实未授权 Task task_other_viewpoint 拒绝 | passed |  |  |  | server_task_scope_or_pov_watermark_denied |
| A 真实登录身份与写入边界 / 真实未授权 Task task_future 拒绝 | passed |  |  |  | server_task_scope_or_pov_watermark_denied |
| A 真实登录身份与写入边界 / 真实未授权 Task task_peer 拒绝 | passed |  |  |  | server_task_scope_or_pov_watermark_denied |
| A 真实登录身份与写入边界 / 会话参数不能伪造数据库主体 | passed |  |  |  | custom_guc_ignored; session_user_identity_retained |
| A 真实登录身份与写入边界 / 不能 SET ROLE owner | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 不能 SET ROLE author | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 不能 SET ROLE validator | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 不能 SET ROLE postgres | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / 不能 SET SESSION AUTHORIZATION 为高权限身份 | passed | direct_database | 42501 |  | permission_or_immutability_rejected |
| A 真实登录身份与写入边界 / Candidate 入口核对真实 Workflow、Task、Bundle 与 Generation | passed |  |  |  | three_real_cross_binding_negatives; no_output_growth |
| B 秘密、人物视角与检索 / 原始秘密不可见，批准线索与不泄露身份的安全约束可见 | passed |  |  |  | {"items":7,"safetyGuard":true,"safeClue":true,"sensitiveMarkersChecked":113,"leaks":0} |
| B 秘密、人物视角与检索 / 人物已知但读者未披露，只呈现批准线索 | passed |  |  |  | known_true + reader_clue => safe_clue |
| B 秘密、人物视角与检索 / 读者已披露但人物无知识证据 | passed |  |  |  | excluded_without_asserting_explicit_ignorance |
| B 秘密、人物视角与检索 / 缺少否定知识证据 | passed |  |  |  | excluded_without_asserting_explicit_ignorance |
| B 秘密、人物视角与检索 / Agent 范围不允许 | passed |  |  |  | excluded_without_asserting_explicit_ignorance |
| B 秘密、人物视角与检索 / 没有匹配安全投影规则 | passed |  |  |  | excluded_without_asserting_explicit_ignorance |
| B 秘密、人物视角与检索 / 仅有信念保持 belief 类型，两者与范围允许才呈现事实条目 | passed |  |  |  | belief_only_not_fact; known_true + confirmed + scope => fact_fixture |
| B 秘密、人物视角与检索 / known_false 有明确来源，缺失保持 unknown | passed |  |  |  | explicit_negative_sources=1; absent_sources=0; missing=unknown |
| B 秘密、人物视角与检索 / 异常命中 rain_B 被过滤 | passed |  |  |  | authority_recheck_filtered; source_identifier_omitted |
| B 秘密、人物视角与检索 / 异常命中 future 被过滤 | passed |  |  |  | authority_recheck_filtered; source_identifier_omitted |
| B 秘密、人物视角与检索 / 异常命中 old_active 被过滤 | passed |  |  |  | authority_recheck_filtered; source_identifier_omitted |
| B 秘密、人物视角与检索 / 异常命中 inactive 被过滤 | passed |  |  |  | authority_recheck_filtered; source_identifier_omitted |
| B 秘密、人物视角与检索 / 排序前已授权过滤，允许 ID 夹带的 snippet/标题/嵌套 metadata 也被丢弃 | passed |  |  |  | {"maliciousFixtureHits":10,"rebuiltFromApprovedFields":true,"leaks":0} |
| B 秘密、人物视角与检索 / 真实校验服务可看更多，但写作反馈只呈现有限安全解释 | passed |  |  |  | privileged_validation_read=true; feedback_projection=true; raw_explanation_omitted |
| B 秘密、人物视角与检索 / 知识/信念值域不能混用 | passed | fixture_constraint | 23514 |  | knowledge_belief_separate_enum |
| C Bundle 来源、冻结与复用授权 / 实际载荷、数据库摘要、条目顺序与受限来源完全对应 | passed |  |  |  | {"orderedItems":7,"sourceReferences":7,"digestMatchesActualPayload":true,"restrictedMetadataExcluded":true} |
| C Bundle 来源、冻结与复用授权 / 受限审计身份能追溯来源，写作身份不能读取审计 | passed |  |  |  | {"restrictedAuditRows":50,"traceableSourceRows":14,"writerDenied":true,"crossProjectAuditorDenied":true} |
| C Bundle 来源、冻结与复用授权 / context_bundle 冻结后 UPDATE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / context_bundle 冻结后 DELETE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / context_item 冻结后 UPDATE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / context_item 冻结后 DELETE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / context_source_reference 冻结后 UPDATE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / context_source_reference 冻结后 DELETE 拒绝 | passed | direct_database | P0001 |  | permission_or_immutability_rejected |
| C Bundle 来源、冻结与复用授权 / 冻结后追加条目也拒绝，物理输出计数不变 | passed | INSERT | P0001 | frozen_bundle_append | immutable_bundle_seal |
| C Bundle 来源、冻结与复用授权 / 客户端不能给已过滤条目盖章 | passed |  |  |  | compile_only_accepts_server_task_id |
| C Bundle 来源、冻结与复用授权 / writerB 猜测别人的 bundle_id 不能取用 | passed |  |  |  | bundle_owner_and_server_task_scope_checked |
| C Bundle 来源、冻结与复用授权 / peer 猜测别人的 bundle_id 不能取用 | passed |  |  |  | bundle_owner_and_server_task_scope_checked |
| C Bundle 来源、冻结与复用授权 / 重新编译创建新包，旧包内容保持不变 | passed |  |  |  | new_public_context_ref; old_bundle_immutable |
| C Bundle 来源、冻结与复用授权 / 撤销已成功后旧包取用和 Generation 复用拒绝 | passed |  |  |  | compile_grant_revoked; frozen_bundle_not_permanent_credential |
| C Bundle 来源、冻结与复用授权 / 真实授权到期后旧包不能取用 | passed |  |  |  | database_time_expiration_observed; old_bundle_denied |
| C Bundle 来源、冻结与复用授权 / 未到生效时间的 Grant 不能授权 | passed |  |  |  | future_grant_not_effective |
| C Bundle 来源、冻结与复用授权 / 未知 Scope 格式和非拒绝默认值不能授权 | passed |  |  |  | unknown_scope_or_allow_default_rejected |
| C Bundle 来源、冻结与复用授权 / 停用主体默认拒绝 | passed |  |  |  | inactive_principal_denied_despite_grants |
| C Bundle 来源、冻结与复用授权 / 策略升级拒绝旧包，客户端不能自选旧策略，新策略生成新包 | passed |  |  |  | v1_stored_immutable; current_v2_new_bundle; caller_policy_override_denied |
| C Bundle 来源、冻结与复用授权 / 未知策略不可判定时拒绝 | passed |  |  |  | unknown_policy_default_deny |
| C Bundle 来源、冻结与复用授权 / 预算不足不能裁掉必要安全约束后继续 | passed |  |  |  | mandatory_guard_preserved_or_entire_compile_denied |
| D 默认日志、错误与拒绝审计 / 各模型实际可见通道及嵌套字段完整扫描 | passed |  |  |  | {"channels":47,"markers":113,"leaks":0,"nestedScan":true} |
| D 默认日志、错误与拒绝审计 / 候选正文与错误请求含 canary，默认日志/Trace/导出仍只用白名单 | passed |  |  |  | {"logRecords":58,"traceRecords":58,"exportRows":58,"rawPayloadLogging":false,"leaks":0} |
| D 默认日志、错误与拒绝审计 / 含秘密和嵌套来源的内部异常不进入外部错误或日志 | passed |  |  |  | raw_internal_exception_discarded; fixed_external_error; no_sql_or_parameters |
| D 默认日志、错误与拒绝审计 / 拒绝审计在独立事务连接实际可读，且不记录秘密原文 | passed |  |  |  | {"deniedBefore":23,"deniedAfter":24,"durableDenial":true,"transaction":"controlled_result_then_commit"} |
| D 默认日志、错误与拒绝审计 / 直接数据库拒绝与工具入口拒绝分别留证 | passed |  |  |  | {"directPermissionErrors":30,"controlledToolDenials":33,"safeToolErrors":5} |
| D 默认日志、错误与拒绝审计 / 数据库默认错误日志也未记录参数、秘密行或受限来源标识 | passed |  |  |  | postgres_terse_errors; statement_and_parameter_logging_disabled; canary_scan_zero |
| E 撤销竞争、连接隔离与失败清理 / 撤销先持稳定锁并提交，已阻塞的旧包取用拒绝 | passed | concurrency |  |  | {"blocker":265,"waiter":266,"observer":267,"waiting":{"pid":266,"wait_event_type":"Lock","wait_event":"transactionid","blockers":[265],"observed_at":"2026-10-20 01:50:32.694023+00"},"first":"revocation_committed","second":"ACCESS_DENIED","stableGate":true} |
| E 撤销竞争、连接隔离与失败清理 / 取用先完成受保护判定，撤销等待，下一次取用拒绝 | passed | concurrency |  |  | {"blocker":270,"waiter":271,"observer":272,"waiting":{"pid":271,"wait_event_type":"Lock","wait_event":"transactionid","blockers":[270],"observed_at":"2026-10-20 01:50:32.761928+00"},"first":"one_read_authorized_before_revocation","second":"revocation_committed","subsequentRead":"ACCESS_DENIED"} |
| E 撤销竞争、连接隔离与失败清理 / 同一客户端入口交替主体和项目，不复用他人的载荷或身份 | passed |  |  |  | {"alternatingOperations":4,"projects":2,"noCache":true,"freshLoginConnectionPerOperation":true,"noPoolOrSetRole":true} |
| E 撤销竞争、连接隔离与失败清理 / context_source_reference 写入失败无半成品 | passed | INSERT |  |  | {"allPhysicalCountsBefore":{"bundles":15,"items":102,"refs":102,"candidates":3,"generations":3},"afterEqual":true,"noUsablePartialBundleOrCandidate":true} |
| E 撤销竞争、连接隔离与失败清理 / candidate_version 写入失败无半成品 | passed | INSERT |  |  | {"allPhysicalCountsBefore":{"bundles":16,"items":109,"refs":109,"candidates":3,"generations":4},"afterEqual":true,"noUsablePartialBundleOrCandidate":true} |
| E 撤销竞争、连接隔离与失败清理 / 真实 COMMIT 发现缺失来源，返回前的包不对外生效 | passed | COMMIT | P0001 | bundle_source_binding | {"functionReturned":true,"physicalCountsUnchanged":true,"before":{"bundles":16,"items":109,"refs":109,"candidates":3,"generations":4}} |
| E 撤销竞争、连接隔离与失败清理 / 同事务编译/Generation/Candidate 返回后外层回滚，全量物理计数不变 | passed |  |  |  | {"before":{"bundles":16,"items":109,"refs":109,"candidates":3,"generations":4},"afterEqual":true,"outerRollback":true} |
| E 撤销竞争、连接隔离与失败清理 / 全部辅助函数关闭 PUBLIC 执行权且受控所有者固定 search_path | passed |  |  |  | {"controlledFunctions":32,"publicExecute":0,"noHelperBypass":true,"disabledTriggers":0} |
| E 撤销竞争、连接隔离与失败清理 / 最终模型通道/默认日志/Trace/导出再次全量泄密扫描 | passed |  |  |  | {"sensitiveMarkers":113,"modelResponses":72,"defaultLogs":78,"leaks":0,"scope":"database_and_tool_boundary_not_natural_language_inference"} |

## 范围声明

- 本原型使用独立登录角色验证权限、安全投影、不可变 Bundle、撤销、审计及泄密扫描；不调用模型或外部检索。
- 不证明完整身份认证、生产安全认证、所有侧信道或自然语言零泄密；受限角色只在本轮实例创建。
