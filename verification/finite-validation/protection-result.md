# 第二批第四段保护与收口核验

- [本轮开始前基线](workspace-before.json)含 334 个文件，保留原基线，不覆盖旧基线。获准修改 7 个，另外 **327 个原文件 SHA-256 完全相同**，原文件删除 0；新增 13 个均在本轮授权范围。[完整清单](file-manifest.md)。
- 001—004 原迁移、docs/00—15 的 16 个文件、十三个原型的 247 个文件、全部历史 verification 的 32 个文件、全部旧测试断言、依赖/锁文件、配置及 .gitignore、用户既有归档保持原字节。
- 排除 .git、node_modules、.pnpm-store、.cache、__pycache__、.DS_Store、临时结果与符号链接；没有遍历依赖制造保护清单，没有新增 Schema、身份或账本。
- 正式 src/db/scripts/test 的 36 个 .mjs 语法检查全部成功。本轮 README、DOC-16 和验收 Markdown 的 205 个本地文件/锚点链接全部有效，缺失 0。
- 最终真实 `pnpm test` 退出 0；002 原 5/45、7 控制、6/34、9 个运行器独立有效期专项，003 原 6/29、004 原 6/29、本轮 005 新 6/26 分开统计，均无失败或跳过。不汇总成系统覆盖率，不把历史/原型记录充作新执行。
- 最终完整运行使用 13 个一次性实例，各嵌套运行器均确认自身容器、匿名卷及临时凭据/正文请求/结果清理成功；没有全局 Docker 清理。前期定位实例和试运行也各自完成清理。
- 试运行曾因 005 返回列 position 的引用语法失败，未进入新测试；修正后独立空库迁移成功。另一次旧有效期阶段未得到有效结果，未改旧断言；最终完整原样重跑通过。所有试运行不计作本轮最终通过结果。
- 005 空库、已有 004 数据/写作撤销历史升级、失败整体回滚与重复迁移均通过；独立连接确认旧数据逐行不变。细节见[本轮运行](run-result.md)及[覆盖契约](coverage.md)。
- 实际阻塞 PID、数据库期限、选择/撤销双向竞争、真实 COMMIT/外层回滚、94 个受控函数和权限证据、实际 CLI/PostgreSQL 日志与秘密/正文/凭据扫描见运行记录。故障设施、禁用约束/触发器、高权运行成员关系均为 0。
- 未连接或迁移未知业务/生产数据库；没有模型、人工审批、自然语言语义校验、Canon/Outbox/投影、自动修复或强制豁免。hard unknown 仍阻断，不宣称生产就绪。
- Git 仍是既有未跟踪工作区；无暂存、提交、推送、reset、clean 或第二仓库初始化。没有本段已知功能阻断，整个第二批未完成。

## 原迁移 SHA-256（与本轮前相同）

| 文件 | SHA-256 |
|---|---|
| [001_foundation.mjs](../../db/migrations/001_foundation.mjs) | `0435d0870e7ca9acd6ee031ddafad85810083181badbfc8b27e1fafa4d4fc0c1` |
| [002_design_task.mjs](../../db/migrations/002_design_task.mjs) | `a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8` |
| [003_safe_context.mjs](../../db/migrations/003_safe_context.mjs) | `590a87bb35c0be9263e44e939ed041c074d5d2a585e8ebd122c59e41ad665618` |
| [004_manual_workflow.mjs](../../db/migrations/004_manual_workflow.mjs) | `5429bafb3a5b148291981efd1107037190bb3f9419d81624fffa085c2c1d13d4` |
