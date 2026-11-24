# 第七段 A 收尾

2026-11-05 实际执行 `pnpm test`，退出 0；真实运行标识与 UTC 时间见 run-result.md。PostgreSQL 18.6 固定 digest、Node v22.23.2；依赖和锁文件未变。

| 真实本轮回归 | 顶层 | 子场景 | 独立专项/控制 |
|---|---:|---:|---:|
| 第一批底座 | 5 | 45 | 7 控制测试 |
| 设计任务 | 6 | 34 | 9 有效期专项 |
| 安全上下文 | 6 | 29 | — |
| Workflow/Candidate | 6 | 29 | — |
| 有限校验 | 6 | 26 | — |
| 人工审批 | 6 | 35 | — |
| 测试生成 | 6 | 32 | 11 授权时间专项 |
| 本轮 Assertion/Evidence | 6 | 52 | — |

全部通过，跳过 0。数量按层级分别统计，不相加表示系统覆盖率。旧阶段副本位于 legacy/，原历史报告保持原字节。development-result.md 是先前 current-only 开发执行（46 子场景）记录，未执行旧回归，不能替代最终完整结果；最终新增结果为 52 子场景。

空库顺序执行 001→008（8 项），重复迁移 0；已有真实 007 作品/Task/Bundle/Candidate/Validation/Approval/Design Evidence 数据升级 008（1 项），重复迁移 0。测试 DDL 故障使 008 非零退出，账本保持 7，已完成前向 DDL/约束替换整体回滚，原数据精确保留；移除故障设施后升级成功。升级前后旧表每行精确相同，旧审阅字节及批准可用性不变；真实 author 升级后登记断言成功，追加断言不扩展旧批准覆盖。

权限正例来自真实 author/writer 新连接，初始化管理员不替代业务正例。管理员仅建立测试范围/最小读取授权、观察持久化及实施数据库约束反例/临时故障设施。默认会话 search_path 下 author CLI/数据库 API 成功，writer、validator、executor、commit、projection 无新表/helper 权限。审计只返回完整范围核验后的元数据，不含正文、片段或断言内容。

真实反例阶段/SQLSTATE/约束标识、独立连接无半成品检查及具体阻塞 PID 见 run-result.md：中途子事务失败只持久化拒绝审计；外层回滚与延后 COMMIT 失败无 Assertion、Evidence、支撑、关联、请求或成功审计残留。唯一身份先行提交/回滚由唯一索引裁决；真实 author 同断言竞争及不同断言首次提交均成功，无死锁重试。共同 gate 等待跨截止后以数据库墙钟拒绝，不采用事务开始时间。

默认日志、错误、CLI 拒绝输出、auditor、数据库日志、验收报告扫描随机设计秘密/正文标记和运行凭据，发现 0。授权 author 的受保护正文引用读取作为正例保留，不把合法响应误判为泄密。精确中文/emoji/组合字符/CRLF/LF 引用、独立 SHA-256、错误码点边界、跨 Novel/Workflow/Candidate、类型/对象 ID 分别错绑及六字段去重均有真实测试。Context 审计额外检查来源域，跨表 UUID 碰撞不能把 Candidate Evidence 误当 Design。

只清理本轮创建的实例、匿名卷、临时凭据和结果。旧回归及本轮运行器均报告清理成功；未运行 Docker 全局清理。最终文件保护/语法/链接/交付核验见 protection-result.json、final-checks.json、file-manifest.md 和 package-check.json。未进行 Git 暂存、提交、推送、reset 或 clean；工作区仍为初始未跟踪布局，原用户归档未修改。

本轮无已知功能阻断。未执行语义真实性、事实确认、三类结构化提案、Canon/Tool Evidence、集合冻结及其校验/审批绑定、自动抽取、真实模型、生产部署、压力/质量/灾备与全侧信道验证。只完成第二批第七段 A；整个第二批保持未完成，到此停止。
