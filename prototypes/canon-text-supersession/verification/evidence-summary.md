# 最终验收证据摘录

本文件从 runner-result.md 的最终实测记录提取；完整正文、关系、输出、物理计数和错误原文保留在原报告。

## 结果

- 实际命令：`pnpm prototype`；迁移、测试和最终退出码均为 0。
- 五组共 130 个实际子场景通过；含五个顶层测试，TAP 总数 135；无跳过。
- 客户端 `search_path=public`；函数固定 Schema search_path；READ COMMITTED。

## 精确阻塞观察

| 场景 | 持锁 PID | 等待 PID | 观察 PID | 观测等待 | 释放 | 第二请求 |
|---|---:|---:|---:|---|---|---|
| 相同 key 修订等待 A COMMIT | 971 | 972 | 973 | Lock/transactionid，blockers=[971] | COMMIT | replayed |
| 相同 key 修订等待 A ROLLBACK | 984 | 985 | 986 | Lock/transactionid，blockers=[984] | ROLLBACK | created_in_transaction |
| 两个 key 同时替代同一旧版本，仅一个成功且记录实际失效条件 | 999 | 1000 | 1001 | Lock/transactionid，blockers=[999] | COMMIT | stale_canon_watermark |

先读取两事务 PID，再发起等待查询；观察到真实阻塞后释放 A。没有随机延时或死锁重试。

## 故障发生位置

| 故障 | SQLSTATE / 约束 | 新正文 | 正文 Item | 目标支撑 | 关系 | Outbox |
|---|---|---:|---:|---:|---:|---:|
| supersession_relation 写入失败，所有输出及维护回滚后同 key 重试 | P0001 / fixture_relation_failure | 1 | 1 | 1 | 0 | 0 |
| projection_outbox 写入失败，所有输出及维护回滚后同 key 重试 | P0001 / fixture_second_outbox_failure | 1 | 1 | 1 | 1 | 1 |

两例故障前与独立连接实际读取的故障后 17 张输出表 COUNT 完全相同；当前正文、水位、审计和失效记录也一致。随后 finally 删除测试故障设施，同 key 成功重试。

## 真实 COMMIT 拒绝

| 场景 | 阶段 | SQLSTATE | 约束 | 修复后同 key |
|---|---|---|---|---|
| 真实 COMMIT missing 关系失败，修复后同 key 重试 | COMMIT | P0001 | supersession_missing | created_in_transaction |
| 真实 COMMIT wrong 关系失败，修复后同 key 重试 | COMMIT | P0001 | supersession_binding | created_in_transaction |

另外，函数返回后独立连接仍只读取旧状态；外层 ROLLBACK 后没有新输出，同 key 重试得到新 Commit。

## 回放与锁序边界

- v3 后重放 v2 返回 v2 原 Commit、正文、Item、关系、完整输出和 Outbox ID；当前仍为 v3。
- 双 key 竞争实际拒绝条件为 stale_canon_watermark；刷新输入 Canon、新 Validation / Approval 后仍指向 v1 的独立场景为 revision_old_not_current。
- 跨项目目标 / replacement 在外键可能取得另一项目行锁之前由 relation_target_project_mismatch 拒绝；同项目关系完整性在真实 COMMIT 检查。

## 资源与保护

- 容器清理结果：已删除本轮容器 canon-text-supersession-fixture-41223-1792403868403；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 最后一组实际核查故障函数无残留，不存在 Publication、Impact、Projection Task/Attempt 执行表。
- 重新枚举和 SHA-256 核验见 hash-validation.txt；实际文件清单见 file-manifest.txt。
- 本报告仅证明纯正文修订，不证明发布变更、结构化撤销和下游治理。
