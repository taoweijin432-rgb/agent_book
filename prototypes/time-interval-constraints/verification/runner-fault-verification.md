# Time Interval 运行器故障验证

- Node.js：`v22.23.2`
- 验证方式：子进程直接导入并调用 `scripts/run-prototype.mjs` 导出的实际清理、结果判定和 TCP 就绪检查逻辑；未复制一套平行实现。
- `pg@8.23.0` API 核实：就绪探测使用公开配置 `connectionTimeoutMillis`、`query_timeout`、`statement_timeout` 及公开方法 `Client.end()`；未访问 Client 内部属性。
- PostgreSQL 故障注入：未启动数据库；就绪挂起场景使用可控 Client 替身和 120ms 真实短期限，不使用虚拟时间。
- 表中的“实际退出状态”是每个隔离验证子进程的真实进程退出码。父验证脚本仅在四个子进程都按预期以非零退出时返回 0。

## 修复前核实

- 修复前运行器 SHA-256：`d343972d03dd7ee9a536231f91d57e2f461e4e12e986e15bfb92d2d3cb64b6aa`。
- 源码核实：最终退出条件只检查迁移、测试命令和结果文件是否可解析；容器/结果文件清理失败不参与退出码，且包含 `failed` 的非空 outcomes 仍被视为有效。
- 源码核实：就绪连接只有 `connectionTimeoutMillis`，`SELECT 1` 本身没有统一总期限或查询超时。

## 修复后故障验证

| 场景 | 预期退出状态 | 实际退出状态 | 资源与证据 |
|---|---:|---:|---|
| 容器清理失败，其他步骤成功 | 1 | 1 | 清理失败：本轮容器 simulated-runner-container 未确认删除（simulated docker rm failure） |
| 临时结果文件清理失败，其他步骤成功 | 1 | 1 | 运行后：清理失败（EACCES：simulated unlink permission denial） |
| 测试退出码为 0，但结果包含 failed | 1 | 1 | 保留 2 个场景及 1 passed / 1 failed 统计；失败详情未丢弃 |
| TCP 连接成功，但就绪查询持续挂起 | 1 | 1 | 1 个探测连接均调用一次 end()；97ms 内超时；验证使用 120ms 真实短期限，未使用虚拟时间 |

四项故障验证均通过；它们是运行器控制流验证，不计入 27 项数据库业务场景。
