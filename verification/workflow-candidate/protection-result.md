# 第二批第三段：保护与收口核验

- 原始基线：[workspace-before.json](workspace-before.json)，本轮开始前 323 个文件；未重建或覆盖任何旧基线。
- 修改前后逐文件 SHA-256：获准修改 7 个，另外 **316 个原文件内容完全一致**；原文件删除 0。新增 11 个，全部在授权范围内，详见[文件清单](file-manifest.md)。
- docs/00—15 的 16 个文件、十三个原型的 247 个文件、全部历史 verification 的 26 个文件保持原字节。原 001—003、全部旧测试断言、依赖锁文件、配置、根 .gitignore 与用户既有归档保持原字节。
- 不遍历 .git、node_modules、.pnpm-store、.cache、__pycache__；忽略 .DS_Store、临时测试结果及符号链接。没有复制另一套 Schema、身份体系、Evidence 父表或迁移账本。
- 正式 src/db/scripts/test 的 31 个 .mjs 语法检查全部成功。本轮 README、DOC-16、验收 Markdown 的 194 个本地文件/锚点链接全部有效，缺失 0。
- 最终真实命令 `pnpm test` 退出 0：002 边界原 5/45、7 控制、6/34、9 个独立有效期专项；003 边界 6/29；004 新增 6/29。分别统计，不相加声称系统覆盖率，未将历史或原型结果当成本轮新执行。
- 004 空库迁移、已有 003 数据升级、重复迁移、失败整体回滚均通过；旧授权及两类撤销历史逐行保持。具体 PID、数据库截止时间、真实 COMMIT 回滚及权限证据见[运行记录](run-result.md)。
- 最终完整运行使用 11 个一次性 PostgreSQL 实例，嵌套运行器分别按本次标签核验清理容器/匿名卷及临时配置、正文请求、凭据、结果。没有全局 Docker 清理或连接生产/未知业务数据库。
- 测试数据库无禁用触发器、未验证约束、故障设施残留；正常运行登录无高权属性、成员关系、底表权限或内部 helper 执行权。实际 PostgreSQL 日志、CLI 日志/错误、完整嵌套响应和报告泄密扫描为 0（正文标记仅允许出现在获准正文响应）。
- Git 状态保持既有未跟踪工作区；没有暂存、提交、推送、reset、clean 或第二仓库初始化。
- 本段未发现尚未解决的实现阻断；整个第二批未完成。模型、Generation、校验、审批、Canon/Outbox/投影和跨 Workflow 草稿依赖未执行或实现，不声称生产就绪或自动脱密。

## 只读迁移摘要（与本轮开始前相同）

| 文件 | SHA-256 |
|---|---|
| [001_foundation.mjs](../../db/migrations/001_foundation.mjs) | `0435d0870e7ca9acd6ee031ddafad85810083181badbfc8b27e1fafa4d4fc0c1` |
| [002_design_task.mjs](../../db/migrations/002_design_task.mjs) | `a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8` |
| [003_safe_context.mjs](../../db/migrations/003_safe_context.mjs) | `590a87bb35c0be9263e44e939ed041c074d5d2a585e8ebd122c59e41ad665618` |
