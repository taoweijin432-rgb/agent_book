# 第二批第二段保护与交付核验

- 修复前基线：[workspace-before.json](workspace-before.json)，原有 314 个文件；保留原基线，不替换任何历史清单。
- 原有文件删除 0；仅 7 个获准文件发生变化，其余 **307 个 SHA-256 完全一致**。变化及新增见[实际文件清单](file-manifest.md)。
- `docs/00`—`15`：16 个文件全部原字节；十三个原型：247 个文件全部原字节；历史 `verification/foundation/`、`verification/design-task/`：21 个文件全部原字节。
- `001_foundation.mjs`、修复后的 `002_design_task.mjs`、原有集成/控制/有效期测试均原字节；没有复制独立 Schema 或迁移账本。
- 无关业务模块、依赖锁文件、配置样例、根 `.gitignore` 均未修改。两个根归档及全部原型历史归档保留。
- 排除 `.git`、node_modules、.pnpm-store、.cache、__pycache__、.DS_Store、临时测试结果及符号链接；没有遍历依赖生成保护清单。
- 正式 src/db/scripts/test 的 26 个 `.mjs` 语法检查全部成功。
- 本轮 README、DOC-16 及 safe-context Markdown：185 个本地文件/锚点链接全部有效（含参考式链接），缺失 0。
- 本轮真实执行 `pnpm test` 退出 0。旧 002 边界回归与新增 003 集成分别记录，未把原型或历史报告作为正式工程新测试结果。
- 本轮共使用 9 个一次性 PostgreSQL 实例；各运行阶段确认自己的容器、匿名卷及临时凭据/结果目录清理成功。约束未禁用、故障设施残留 0。未做全局 Docker 清理。
- 无真实模型、外部检索、生产数据库、灾备及规模验收；字节预算不冒充 token 验证，不承诺自然语言推断零泄密。
- Git 状态仍为既有未跟踪工作区；未执行暂存、提交、推送、reset、clean。未新增第二仓库。

## 旧迁移 SHA-256（与修复前相同）

| 文件 | SHA-256 |
|---|---|
| [001_foundation.mjs](../../db/migrations/001_foundation.mjs) | `0435d0870e7ca9acd6ee031ddafad85810083181badbfc8b27e1fafa4d4fc0c1` |
| [002_design_task.mjs](../../db/migrations/002_design_task.mjs) | `a66f403147bbea81a87d6459805e422320cceb6b0c53559f730ae10913ca7ee8` |
