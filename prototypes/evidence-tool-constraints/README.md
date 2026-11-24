# Tool Evidence 来源约束原型

## 1. 定位与边界

本目录是 `docs/12`—`docs/14` 中 Tool Evidence 来源规则的独立数据库约束夹具，Schema 固定为 `evidence_tool_constraint_fixture`。它不是正式生产 Schema，不调用真实工具，也不实现工具能力授权、执行状态机、外部引用内容验证、其他 Evidence 来源域或完整 Canon Commit。

夹具只接受：

| 字段 | 固定映射 |
|---|---|
| `source_domain` | `tool` |
| `source_object_type` | `tool_call` |
| `source_object_id` | 实际 `tool_call_id` |
| `source_version_id` | Tool Call 的 `generation_run_id` |
| 来源支撑表 | `evidence_tool_source` |
| 支撑必填字段 | `evidence_reference_id`、`tool_call_id`、`source_ref` |

`tool_call_id`、响应引用和 `source_ref` 都不作为 `source_version_id`。`source_ref` 使用无真实内容的稳定夹具引用，不参与六字段去重身份。

## 2. 最小执行归属链

执行归属按下列方向校验：

```text
Project
  └─ Scene Task Version
       ├─ Workflow Run
       └─ Context Bundle ──绑定同一 Workflow Run
            └─ Generation Run ──引用 Workflow Run + Context Bundle
                 └─ Tool Call
                      └─ Evidence Tool Source
                           └─ Evidence Reference
```

数据库提交前确认：Tool Call 属于父 Evidence `source_version_id` 指定的 Generation Run；Generation Run 引用指定 Workflow Run 和 Context Bundle；Bundle 绑定同一 Workflow Run；Workflow 与 Bundle 指向同一 Scene Task Version；Evidence、Tool Call、Generation、Workflow、Bundle 和两个 Task Version 查询路径的项目范围一致。

工具证据只是执行来源记录。它不会因为存在而成为 Canon Fact，也不自动证明工具响应真实、正确或具有写入授权。

## 3. 夹具字段与正式文档的对应关系

| 夹具对象 | 本批字段 | 对应与差异 |
|---|---|---|
| `project` | `project_id` | 用于模拟 Novel/项目范围；不是正式表定义 |
| `scene_task_version` | `scene_task_version_id`、`project_id` | 对应正式 Scene Task Version 身份与 Novel 范围；省略任务正文、设计版本、水位和状态 |
| `workflow_run` | `workflow_run_id`、`scene_task_version_id`、`project_id` | 对应正式 Workflow Run 的任务版本绑定；`project_id` 是归属校验夹具字段 |
| `context_bundle` | `context_bundle_id`、`scene_task_version_id`、`workflow_run_id`、`project_id` | 对应正式 Bundle 的任务/Workflow 绑定；省略内容 hash、策略和状态；`project_id` 是夹具字段 |
| `generation_run` | `generation_run_id`、`workflow_run_id`、`context_bundle_id`、`project_id` | 对应正式 Generation Run 输入绑定；省略 Prompt、Model、请求键和状态；`project_id` 是夹具字段 |
| `tool_call` | `tool_call_id`、`generation_run_id`、`tool_name`、`request_ref`、`response_ref`、`project_id` | 对应正式 Tool Call；不实现状态机；`project_id` 是夹具字段 |
| `evidence_reference` | 完整六字段身份及 `project_id` | `project_id` 用于本批跨表范围校验 |
| `evidence_tool_source` | `evidence_reference_id`、`tool_call_id`、`source_ref` | 与 `docs/12` 的 Tool 来源支撑一致 |
| `evidence_consumer_reference` | 消费方 ID、Evidence ID、消费类型 | 仅证明消费方共享 Evidence，不属于去重身份 |

## 4. 数据库强制位置

| 规则 | 数据库位置 | 失败阶段 |
|---|---|---|
| 六字段完整身份唯一 | `uq_evidence_reference_full_identity` | 冲突父行 `INSERT`；并发时等待后裁决 |
| 旧四字段查询 | `idx_evidence_reference_legacy_lookup` | 非唯一索引，不拒绝不同 Tool Call |
| 支撑一对一 | `evidence_tool_source` 主键兼父 FK | 重复支撑 `INSERT` |
| Tool Call 存在 | `fk_evidence_tool_call` | 支撑 `INSERT` |
| 三个支撑必填字段与非空 `source_ref` | `NOT NULL`、`ck_evidence_tool_source_ref_nonempty` | 支撑 `INSERT` |
| 父域与类型 | `ck_evidence_reference_tool_domain`、`ck_evidence_reference_tool_type` | 父行 `INSERT` |
| 恰一支撑、父子身份、Generation/Workflow/Bundle/Task Version/项目链 | 默认延后约束触发器，标识 `evidence_tool_complete` | 真实 `COMMIT` |
| Evidence 与来源支撑追加不可变 | `evidence_tool_immutable` | 修改或删除语句 |
| 来源身份、项目、输入绑定及既有结果保护 | `evidence_tool_complete` BEFORE 触发器及 FK | 实际字段变化或删除语句 |

完整去重身份固定为：

```text
(source_domain, source_version_id, source_object_type,
 source_object_id, locator, evidence_kind)
```

唯一约束直接裁决并发重复，不使用应用层“先查询再插入”。`source_ref` 和消费方不进入该身份。

五个 PL/pgSQL 函数固定函数级 `search_path`：

```text
pg_catalog, evidence_tool_constraint_fixture, pg_temp
```

函数不使用 `SECURITY DEFINER`。新建直连测试会把会话 `search_path` 设置为 `public`，并用全限定对象名验证合法提交、缺失支撑和不可变保护。

来源保护只拒绝实际身份、项目和输入绑定变化；原值 UPDATE 合法。Tool Call 的非空既有 `response_ref` 不允许覆盖，但从 `NULL` 首次写入响应引用仍可由数据库接受；本原型不把这一点扩展为工具状态机。创建校验不额外请求排他 Generation 锁，并发结果只证明 README 和报告列出的竞争路径。

## 5. 运行

前置环境：Docker、Node.js `>=22.23.2`、pnpm。固定依赖为 `node-pg-migrate@9.0.0`、`pg@8.23.0`，固定镜像为 `postgres:18.6`。

```bash
pnpm install --frozen-lockfile
pnpm prototype
```

一键运行器只操作本原型资源：清理旧 `.test-results.json`，启动绑定 `127.0.0.1` 随机端口的一次性容器，通过宿主机 TCP 在统一期限内执行真实 `SELECT 1`，从空库迁移，以显式 `READ COMMITTED` 运行测试，写入 `verification/runner-result.md`，最后删除本轮容器和临时结果。只有迁移、测试、全部场景、报告写入和资源清理都成功才返回 `0`。

## 6. 未覆盖范围

- 真实工具调用、能力授权、网络访问及工具结果真实性判断；
- 外部 `source_ref` 的格式、内容解析、可访问性或保留介质；
- Tool Call/Generation Run 完整状态机和重试协议；
- Candidate、Canon、Author Design 与 Tool 的四域联合约束；
- 完整 Canon Commit、正式生产 Schema、备份恢复和部署设计。

`verification/runner-result.md` 记录最后一次真实一键运行结果。`verification/protected-sha256-before.txt`、`protected-sha256-after.txt` 和 `hash-validation.txt` 用于证明正式文档、四个既有原型及根级受保护文件未被修改。
