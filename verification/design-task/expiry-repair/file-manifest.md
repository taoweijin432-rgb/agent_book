# 补授权有效期修复实际交付清单

## 结论与执行证据

- 问题成立：[修复前真实复现](before-reproduction.json)。原始 002 成功，七项 NULL 截止，来源到期后真实 author 仍允许。
- [修复前完整通过报告](before/verification/design-task/run-result.md) 是历史结果，不覆盖本轮竞争反例；[原始 002](before/db/migrations/002_design_task.mjs) 按原字节保留。
- [修复后独立专项](after-special.json)：9/9，零跳过；[最终完整回归](../run-result.md)：第一批 5/45、控制 7、第二批 6/34 及 9 个运行器独立专项分别统计，退出 0。
- 观察到实际阻塞 PID、来源截止和数据库越期时间后释放事务；没有以 sleep 猜测阶段，没有修改正式迁移来注入测试屏障。观察连接持锁时显式刷新 PostgreSQL 统计快照。
- 中途故障以临时序列独立确认第 4 次插入尝试，前三项与升级记录/002 账本整体回滚；序列只是测试同步证据，不是业务账本，随后删除。
- 所有负例同时证明真实作者、唯一创建记录、正确 Novel/Role/Scope 等其他前提合法；最终完整回归负例明确断言 ACCESS_DENIED，不用技术异常冒充拒绝。
- 修复采用写前到期整笔失败回滚；写入后到期保留有限截止，seeded 不代表当前仍有权限。原基础授权及撤销记录始终未变。
- 开发期间同步/故障夹具的失败执行均非零并清理；它们没有被记为复现成功。这里分别保留的是最终成功的原始复现、独立专项及完整回归。
- 未执行：非验收数据库调查/修复、生产部署、历史数据修订、原型重跑、模型及后续业务阶段。未发现非验收部署证据，不承诺外部数据库从未执行 002；若已部署，须另行评审前向修复，不修改既有账本。

## 实际文件及 SHA-256

本清单包含本轮实际修改的 002、测试/运行器、README 和 DOC-16，不另打包；没有凭据、依赖目录或缓存。

| 状态 | 路径 | SHA-256 |
|---|---|---|
| 修改 | [README.md](../../../README.md) | 0a3fe5dd3e22b11a5788d006684b8e18d8b49eab12acc07f4559011e459df93d |
| 修改 | [db/migrations/002_design_task.mjs](../../../db/migrations/002_design_task.mjs) | a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8 |
| 修改 | [docs/16-prototype-consolidation-and-implementation-plan.md](../../../docs/16-prototype-consolidation-and-implementation-plan.md) | df890a6213939db9c87a7097c7705372efd0436c6f476b40cb53ee7d8b408063 |
| 修改 | [scripts/verify-design-task.mjs](../../../scripts/verify-design-task.mjs) | 75a8a30ad83a85021aaa3ac2dd4b234b0249c5272654b97890b13a550a77cb40 |
| 新增 | [test/design-upgrade-expiry.mjs](../../../test/design-upgrade-expiry.mjs) | b8ed78fc537c05c7f9f802f9e2f3bbf61970165df6477f58067b6968117d4413 |
| 新增 | [verification/design-task/expiry-repair/after-special.json](after-special.json) | 651d1c486497b0d942d005b38df5576cacd7d1e0f36d41c20da944eff438bee6 |
| 新增 | [verification/design-task/expiry-repair/before-reproduction.json](before-reproduction.json) | 1df3f860a4f7545f6f69866b165fa6e1fc8cea898336f9a60bb5e41664fe927a |
| 新增 | [verification/design-task/expiry-repair/before/README.md](before/README.md) | 2352b2ad5b67c4463ded44c210b9f2259e974c2a4e3d35c6d86ae21e903d2aac |
| 新增 | [verification/design-task/expiry-repair/before/db/migrations/002_design_task.mjs](before/db/migrations/002_design_task.mjs) | c0413da1200503567f5fa8f019070f66488b63815b80d37ef96ccf50b4f46402 |
| 新增 | [verification/design-task/expiry-repair/before/docs/16-prototype-consolidation-and-implementation-plan.md](before/docs/16-prototype-consolidation-and-implementation-plan.md) | 81bd07b36f4cfcb7e9d9fc34c79773ebab6d339dd4c2af5e8acf20cd62fc0657 |
| 新增 | [verification/design-task/expiry-repair/before/scripts/verify-design-task.mjs](before/scripts/verify-design-task.mjs) | 5a87efc40c338510af2a739babb70d54e85fa9a6c924009cc1f0255e404a83d8 |
| 新增 | [verification/design-task/expiry-repair/before/verification/design-task/file-manifest.md](before/verification/design-task/file-manifest.md) | 608b54e65bc679330f1f065e4b79a363e37cb08b021bec253d1dedc9ca6a9735 |
| 新增 | [verification/design-task/expiry-repair/before/verification/design-task/protected-before.json](before/verification/design-task/protected-before.json) | d9ceba4234bf14f2b2484a006b231ae9fb1ef8d4875e8af42f8030b571c40f3a |
| 新增 | [verification/design-task/expiry-repair/before/verification/design-task/protection-result.md](before/verification/design-task/protection-result.md) | 5fd11b500e450b4317fabe95718d2da211d073abe8965fb539dab0112bc07c16 |
| 新增 | [verification/design-task/expiry-repair/before/verification/design-task/run-result.md](before/verification/design-task/run-result.md) | 8762648f202e3d8c94390a4680ef422148bb075fa18f0b5ab531ffadedf84df4 |
| 新增 | [verification/design-task/expiry-repair/file-manifest.md](file-manifest.md) | 本清单不作循环自摘要 |
| 新增 | [verification/design-task/expiry-repair/protection-result.md](protection-result.md) | e283ff43109941b1d10bacfdff35ada6eea385a09327c295d9471210998c4d18 |
| 新增 | [verification/design-task/expiry-repair/workspace-before.json](workspace-before.json) | f49be96072351ccb27183961cd166926449bae6d8d025a1c4ca36125f13c896a |
| 修改 | [verification/design-task/run-result.md](../run-result.md) | 943dfb0908cdd526e6b338812fed002e8db1b2565f1e2041b71b544b51ad2591 |
