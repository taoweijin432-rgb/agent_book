# 权限与秘密安全上下文集中验证

独立 Schema：`authorization_safe_context_fixture`；独立数据库：`authorization_safe_context`。本轮只使用两个项目的固定输入夹具、真实受限 PostgreSQL 登录和受控工具入口。不调用模型，不部署图/向量检索，不实现或复制 Canon Commit，不把夹具资源描述成正式提交成功的 Canon。

## 运行与实测结果

```sh
cd /Users/yuka/agent-book/prototypes/authorization-safe-context
pnpm install --frozen-lockfile --ignore-scripts
pnpm prototype
node verification/audit-scope-repair/verify-protected.mjs
```

沿用 PostgreSQL `18.6`、`node-pg-migrate@9.0.0`、`pg@8.23.0` 及已验证运行器的 TCP 就绪、有限超时、迁移/测试、结果新鲜度检查和 finally 清理。实测 Node `22.23.2`、pnpm `11.18.0`、Docker `29.4.0`，本轮迁移/测试/最终退出码均为 0。5 个顶层测试、119 个参数化子场景通过；TAP 合计 124，无跳过。其中原有 109 个场景保留，审计 Scope 修复新增 10 个回归。历史 109 场景报告保存在 `verification/audit-scope-repair/before/verification/runner-result.md`，不能把历史结果当成本轮新增边界的证明。

| 分组 | 实测子场景 | 重点 |
|---|---:|---|
| A 真实身份及写入边界 | 58 | 独立 LOGIN 正例、42501 权限拒绝、辅助函数/高权限入口关闭、伪造参数及会话切换、真实 Candidate 来源链 |
| B 秘密、视角与检索 | 15 | 知识/信念/披露独立、批准线索、明确否定与 unknown、先授权后排序、异常命中重建、安全校验反馈 |
| C Bundle 来源/冻结/复用 | 31 | 确切模型输入字节摘要、有序条目和来源、不可变/禁止追加、跨主体隔离、撤销/到期/未知 Scope/策略、必要安全预算；新增审计资源 Scope 回归 10 项 |
| D 日志、错误与审计 | 6 | canary/敏感字段扫描、白名单日志、内部异常边界、拒绝审计真正提交、数据库日志扫描 |
| E 并发与连接隔离 | 9 | 两种具体 PID 阻塞顺序、共享入口交替身份、故障/真实 COMMIT/外层回滚、ACL 与最终扫描 |

完整结果见 [runner-result.md](verification/runner-result.md)，实际身份、PID、扫描计数和回滚证据摘录见 [security-evidence.md](verification/security-evidence.md)。所有交付文件及根文件改动见 [file-manifest.txt](verification/file-manifest.txt)。

## 规范对应与简化

| 规范 | 本轮落实 |
|---|---|
| docs/04 §2、§6—7 | Design / Canon 输入资源分域；草稿不成为 Canon；秘密、Agent 范围、人物认知和读者披露分离；不把原始秘密直接注入 |
| docs/07 §1、§3—4、§6—8 | Task 固定读取边界；授权候选先筛选再模拟排序；回查真实来源；有限投影与预算拒绝；实际输入、顺序、版本、权限依据可追溯；隐藏来源只在受限元数据 |
| docs/12 上下文、认知/披露、授权及审计表 | 最小 Principal / Capability / Grant / Scope / 决定和审计；分表知识/信念；带版本及来源的披露；Bundle / Item / Source Reference 与 Workflow / Generation / Candidate 关系 |
| docs/13 INV-KNOWLEDGE-001—003、INV-DISCLOSURE-001、INV-CONTEXT-001、INV-AUTH-001—002、TX-CONTEXT-001 / TX-GENERATION-001 / TX-CANDIDATE-002 | 默认拒绝、动作与范围共同检查；写作只写候选；冻结原子性、源链检查、重用重新授权和稳定锁 |

未发现需要修改正式文档的实质冲突。这里不是正式生产 Schema：不复制完整 Evidence、Canon 提交、Execution Role 管理或全部上下文分层。知识/信念/披露是有明确版本、来源 FK 与水位的测试输入，不声称已实现状态重建。资源的 `domain=canon` 仅表示显式 Canon 访问夹具，无伪造 committed 账本。

每次编译产生新的公开 `context_ref`，因此实际模型输入和 hash 也不同；`(task_id,content_hash)` 唯一约束仍保留。完整编译请求幂等、语义去重与生产缓存策略不在本批实现范围。

## 信任边界与实际身份矩阵

可信边界包括一次性实例的初始化管理员、内部迁移/编译代码、受控投影模板、宿主中的凭据注册表及受限服务身份。不可信输入包括写作请求 JSON、Candidate 正文、工具/检索命中内容、snippet、标题和嵌套 metadata。

角色名为本轮随机前缀 `asc_<12位十六进制>` 加下列后缀；最终实际登录名逐项保存在运行报告。每次运行前缀不同，角色只存在于本轮容器。

| 身份/后缀 | 真实连接 | 允许入口 | 范围 |
|---|---|---|---|
| 初始化管理员 postgres | 管理登录 | 初始化角色/夹具、约束负例、受限核验 | 可信测试宿主；结果不计作授权正例 |
| owner | **NOLOGIN** | SECURITY DEFINER 所有者，拥有本 Schema | 非超级用户，无 BYPASSRLS / CREATEDB / CREATEROLE；不授给写作角色 |
| author | 独立 LOGIN | read_design、manage_grant | 项目 A；允许读取经自身 Scope 核对的原始设计资源及撤销授权 |
| writera | 独立 LOGIN | compile_context、read_context、generate_context、write_candidate、validation_feedback | 项目 A / 场景 A / hero A，最大水位 10；有限资源类别与命题集合 |
| writerb | 独立 LOGIN | 同写作入口 | 项目 B / 场景 B / hero B，最大水位 10 |
| peer | 独立 LOGIN | 同写作入口 | 项目 A，同场景视角但独立任务/主体；不能读取 writera 的包 |
| validator | 独立 LOGIN | inspect_validation | 项目 A / 最大水位 10；Scope 明确包含更多资源与命题，返回仅供内部服务 |
| auditor | 独立 LOGIN | read_audit | 项目 A / 最大水位 100 的受限审计元数据；不返回秘密正文 |
| expiring / disabled | 各自独立 LOGIN | 同写作入口但仍须实时授权 | 到期/未来 Grant 和停用主体负例 |

所有八个 LOGIN 都实测为非超级用户、非表所有者、无 BYPASSRLS / CREATEDB / CREATEROLE、无角色成员关系。正例使用这些角色的新 TCP 连接；没有用管理员连接上传 actor_id 或管理员 SET ROLE 冒充。

写作侧仅得到宿主预先绑定的 `{ call(operation,input) }` 对象，拿不到管理员、所有者、作者或校验服务凭据，也拿不到宿主的 `bindIdentity` 或凭据注册表。绑定身份由可信宿主提供，不能从请求参数选择。这只验证数据库/工具边界，不实现登录界面、会话认证、进程隔离或阻止拥有宿主代码/操作系统权限的人读取测试内存。

## 数据库权限与工具入口

本批明确选择 `SECURITY DEFINER`，不使用 RLS。函数由受控 NOLOGIN 所有者持有，固定 `search_path=pg_catalog, authorization_safe_context_fixture, pg_temp`，不把内部 `current_user` 当调用者：主体只按 `session_user` 与 `actor_principal.db_login` 映射。

撤销 PUBLIC 对 Schema、全部表/序列/函数的默认权限和公共 Schema 的 CREATE 权限；对所有者的未来函数也撤销 PUBLIC 默认 EXECUTE。登录角色只获 Schema USAGE、数据库 CONNECT 和必要 API 函数 EXECUTE。作者、校验、审计角色也没有任意底表权限。最终测试枚举每个函数的所有者、固定路径、PUBLIC ACL 和写作 EXECUTE 白名单，检查无辅助函数旁路和被禁用触发器。

`authorize` 同时核对当前主体状态、固定动作 Capability、Grant 生效/到期/撤销、Scope 的项目/场景/视角/最大水位/格式/默认拒绝；写作还必须是 Task 的服务端指定主体。资源读取另外核对类别、命题范围、Design Revision、水位、有效状态和来源版本。未知策略、未知 Scope 格式、不确定条件一律不放行。

API 只接受精确字段和字符串值。例如编译仅接受 `{task_id}`；不能传入 actor、项目、Scope、视角、水位、旧策略、已过滤条目或任意上下文。真实存在的其他项目任务、其他人物视角、超水位任务同样拒绝。

Generation 入口核对真实 Workflow 与 Bundle 的 Task 一致；Candidate 入口再核对当前主体、Workflow、Task、Bundle、Generation 的全部归属。这里的 Generation 只保存受控上下文取用引用，审计明确标记 `reference_only_no_model_call`，没有伪造外部模型调用或生成结果。

## 四种概念与有限安全投影

四种数据分开存储：Design 秘密资源；Capability Grant / Scope；人物 `knowledge_evidence` / `belief_evidence`；`reader_disclosure_evidence`。认知与披露各自绑定版本、水位和真实来源资源，插入夹具时核对项目、命题、来源域与水位。知识与信念有独立值域。

缺记录为 unknown，不推成 known_false，也不宣称已证明人物明确“不知道”。人物仅持有信念时输出 `character_belief`，不会产生客观 Canon Fact。本批没有任何 Canon Fact 写入口。

有限规则代码放在内部编译函数，作者批准的具体可见文字放在受限、不可变 `safe_projection_rule` 表中，避免把故事内容写在所有人可能检视的函数定义里。规则版本为 `finite-projection-v1`，无通用模型摘要、字符串替换或自动脱密。没有匹配规则即排除。

| 输入条件 | 具体结果 |
|---|---|
| 人物 known_true，读者只获线索 | 仅批准的脚步线索，不透露人物身份或秘密真相 |
| 读者 confirmed，人物缺少知识证据 | 排除该事实，不把“缺记录”写成明确不知情 |
| 人物仅 believed_true / believed_false，读者已确认可呈现 | 有明确信念标签的有限条目，注明非客观事实 |
| known_false 有明确来源且读者允许 | 明确的否定知识条目 |
| 缺少否定知识来源 | unknown；不生成否定事实 |
| 人物知识、读者披露和 Agent Scope 均允许 | 批准的事实性夹具条目，并保留受限来源依据 |
| 人物/读者都允许，但 Agent Scope 不允许 | 排除 |
| 未批准投影规则、旧/失效/未来/跨项目来源 | 排除 |

必须保留的通用安全约束只要求受限视角和使用已提供信息，不在“禁止写出真相”的句子里附带真实身份。规则本身也结合知识/披露条件选择；可信模板仍需人工评审。本批证明这些确定规则的效果，不证明一般自然语言泄密识别。

## 检索、载荷与来源边界

固定检索夹具含合法 ID、跨项目、未来水位、旧版本、失效/缺失来源，以及夹带秘密正文、标题、路径和嵌套 metadata 的命中。正常候选先通过 `resource_allowed` 物化，再在授权 ID 范围内模拟评分排序。检索文本完全不作为模型内容来源；即使 ID 合法，也只从已批准规则重建可见字段。异常命中回查后仅记录受限过滤决定。

模型可见：公开 Bundle ID、实际 `model_input`、该输入的 hash，以及编译/策略/预算版本、允许水位、受限视角标记和有序 `{order,kind,text}`。模型不会收到原资源 ID、来源版本、秘密标识、原始内容摘要、标题/路径/metadata、Scope / Grant ID 或校验内部解释。

受限来源追踪：`context_source_reference` 保存资源/来源版本、原始内容摘要、知识/信念/披露证据 ID、权限依据、投影规则版本；Context Item 保存入选原因。审计读取入口独立授权，按自身项目、场景、视角、水位和资源范围返回治理元数据，能够追溯被重写来源但不返回秘密原文。`events` 的 Task 范围与 `restricted_resource_id` 实际资源范围分别判断；非空引用须正向确认资源存在、项目、场景、水位、类别和命题均在 Scope 内，否则过滤整条事件。NULL 资源引用的普通事件继续按 Task 范围返回。`source_refs` 使用同一内部资源判断；场景受限 Scope 允许项目级（scene 为 NULL）资源，资源本身不新增人物视角语义。此审计判断不要求 active、当前版本或当前 Design Revision，保留合法历史追溯。写作角色不能读这些表或审计入口。

Bundle `payload` 保存实际模型字段；`model_input` 是数据库 `payload::text` 的明确 UTF-8 序列化结果。`content_hash=SHA256(model_input字节)`，测试同时用 Node 按确切字符串重算并解析对照 payload。它不是秘密原文摘要，也不依赖客户端 JSON 排序或空格。格式约定为 PostgreSQL 18.6 JSONB 文本的 `safe-payload-v1`；正式跨语言整合需固定同一序列化规范。

## 冻结、预算及旧包取用

编译只以服务器 Task 为输入，固定 Design Revision、Canon 水位、人物视角、读者范围和预算。保存 Bundle、最终顺序的 Item、来源版本、权限依据、入选原因、投影/编译/安全/预算版本。每个条目有来源；跨表约束触发器在真实 COMMIT 核对条目、来源、有限投影、完整载荷、hash 与预算。

所有夹具历史及 Bundle / Item / 来源均拒绝 UPDATE、DELETE、TRUNCATE。创建事务 XID 由触发器覆盖；后续事务追加 Item/Reference 也拒绝。客户端无底表 INSERT 权限，不能“提交已过滤条目”直接盖章。

预算为版本化字符预算，不是 token 优化器；若完整必要输入放不下，拒绝整次编译。不会裁掉安全约束后继续成功。预算失败可持久化拒绝审计，但没有可用的半成品 Bundle、Item 或来源。

每次取用、关联 Generation 或写 Candidate 都重新授权，并检查 Bundle 主体、当前 Scope、当前策略和原编译 Grant 仍然有效。旧包不会成为永久凭证；到期、撤销、其他主体、Scope 不匹配、旧策略均拒绝。重新授权也不会复活被撤销编译 Grant 形成的旧包，需要新编译。

## 撤销判定点与并发

使用预先存在的 `policy_gate` 与每个主体的 `authorization_gate`，不锁“尚不存在的撤销行”。取用先对策略 Gate 取得共享锁，再取得主体 Gate，随后读取数据库当前授权和时间。撤销也对同一主体 Gate 加锁，按固定主体 ID 顺序处理多个 Gate。Grant 撤销追加记录，历史不覆盖；重新发放时按撤销截止后的有效期检查避免重叠。

- 撤销先持 Gate 并提交：已阻塞的取用在恢复后看到撤销，返回拒绝。
- 取用先完成受保护判定：可完成这一次操作；撤销等待其事务结束，之后的取用拒绝。
- 不承诺收回之前已经交付的内容。

测试先取得两个真实事务 PID，再发起等待查询，由第三连接通过 `pg_stat_activity` / `pg_blocking_pids` 观察具体阻塞后释放事务。连接 5s、语句 8s、锁 6s、阻塞观察 4.5s 有限超时；固定 15ms 轮询只是观察，不用随机 sleep 或死锁重试。到期测试按数据库时钟观察明确的到期点。

工具宿主没有跨主体结果缓存或连接池。共享入口交替处理两个主体/项目，每次打开该主体真实 LOGIN 连接，提交/回滚后关闭；没有管理员 SET ROLE 或残留身份复用。测试同时验证另一主体不能读取该 Bundle。

## 错误、日志、审计与泄密扫描

每轮随机生成 canary，仅用于本轮测试内存和受限临时数据库；还检查秘密原文摘要、真实来源/版本与证据 ID、标题、路径、嵌套字段及校验服务解释。扫描实际写作工具响应、确切模型输入、默认日志、Trace、评测导出、测试证据与数据库日志，最终报告只写标签、计数和结果，绝不输出 canary 值。

默认日志从一开始只构造 `{event,operation,outcome,request_id}`；Trace 和评测导出使用更小白名单。Candidate 正文、请求参数、检索命中、授权来源和原异常都不进入这些对象。内部连接/SQL 错误统一对外为 `SAFE_REQUEST_FAILED`，业务授权拒绝为 `ACCESS_DENIED`，不附原 SQL、参数或原因细节。校验服务的原始解释仅存于受限结果，写作反馈由有限规则另行生成。

一次性 PostgreSQL 在启动前设定 `log_error_verbosity=terse`、`log_min_error_statement=panic`、`log_parameter_max_length_on_error=0`、`log_statement=none`，避免数据库错误日志打印行 DETAIL、SQL 或参数。测试确实读取本轮容器 stdout/stderr 全量扫描，末组在故障验收后再次扫描；不是先打印完整载荷再对导出做脱敏。

拒绝路径调用 `deny` 写审计并返回普通拒绝结果，由工具事务真实 COMMIT。因此独立连接可确认拒绝计数增加；不使用“写入审计后 RAISE 导致回滚”冒充持久化。直接数据库权限错误发生在函数外，另记录真实 42501 安全证据和工具日志，不声称此类错误已自动写入数据库审计。真正技术故障/外层回滚中的事务审计随事务回滚，也不虚称已持久化。

故障测试临时添加触发器并在 finally 删除，不关闭业务约束、不向 API 添加故障开关。覆盖来源写入失败、Candidate 写入失败、真实 COMMIT 缺来源、同事务编译/Generation/Candidate 返回后外层 ROLLBACK。独立连接直接 COUNT Bundle / Item / Source / Generation / Candidate，检查没有可用半成品；未提交状态对独立连接不可见。


## 本轮最小修复：审计资源 Scope

修复前在新的一次性 PostgreSQL 实例、原迁移和原夹具上真实复现：writerA 编译 A 后产生 1 条引用 B 资源的过滤审计；真实 auditor 读取 A 的任务时返回该标识。B 的水位、类别和命题条件均满足其余检查，原始审计保持不变。这不是静态推断。证据只保存布尔与计数，见 [reproduction-before.md](verification/audit-scope-repair/reproduction-before.md)。原代码快照与历史报告未覆盖。

本轮迁移只新增内部 `audit_resource_in_scope` 和替换 `api_read_audit` 的两个资源过滤条件。保留原入口授权及 Task 项目/场景/视角/水位判断；对实际资源另行正向确认，未知即拒绝。该辅助函数继承受控所有者、固定 search_path、PUBLIC EXECUTE 撤销，不向任何登录角色开放。未修改审计记录写入，未清空引用、删除或覆盖旧审计。

新增真实 `auditscoped` 登录：项目 A、场景 A、hero A、最大水位 10，类别只允许 public / narrative，命题集合排除 belief。原有八个登录和测试保持不变。新增普通范围夹具及合法编译输入验证 events 和 source_refs；没有关闭触发器或插入违反 Bundle 完整性的来源。

新增 10 个回归覆盖跨项目、同项目跨场景、超水位、类别、命题、允许资源/NULL 引用/项目级资源、旧版本来源、写作/其他项目/视角拒绝、辅助函数权限。所有返回结果对禁止的资源 ID、来源版本、Reference/Item 标识作嵌套检查，同时断言允许的标识确实存在，不能以删光全部标识冒充安全。

类别/命题的 source_refs 反例父 Task 在 Scope 内。合法 Bundle 的项目、场景和来源水位已受编译完整性约束，因此场景/水位的越界 source_refs 通过合法的另场景或高水位 Task 编译，其父 Task 也会被范围过滤；事件反例则由允许的 A Task 真实引用越界资源，隔离资源条件。没有为制造反例破坏来源约束。历史正例先合法冻结 v1，再追加 v2，证明已非当前业务版本的 v1 仍可审计追溯。

本轮独立保护基线为 434 个路径，包含根 `.gitignore`、运行器、工具网关、依赖/锁文件、正式文档、十二个旧原型及当前原始核验记录，前后重新枚举核对通过。只许可修改当前迁移、测试、相关 README、运行报告、安全证据和文件清单；新核验材料集中在 `verification/audit-scope-repair/`，没有改写旧 before 清单。使用本轮 [verify-protected.mjs](verification/audit-scope-repair/verify-protected.mjs)，不重新写入原批次的历史核验文件。

本轮完整报告见 [runner-result.md](verification/runner-result.md)，历史/复现/新增回归/完整运行的区分及 PID、审计保留证据见 [security-evidence.md](verification/security-evidence.md)。复现和完整运行的容器、临时结果均已清理；未修改运行器、网关、根 `.gitignore` 或依赖，没有新增独立原型。

## 原批次文件保护与清理（历史记录）

修改前重新枚举并记录 SHA-256，修改后重新枚举比较内容和路径集合，检查新增、遗漏、重复。实际前后均为 **418 个保护路径**，没有预设数量；覆盖 docs/00—15、全部十二个既有原型、根依赖和其他仓库文件，沿用既有方式跟随旧缓存符号链接。排除 `.git`、`node_modules`、本轮目录及其缓存别名。

根 `.gitignore` 仅精确追加 `prototypes/authorization-safe-context/.test-results.json\n`，新增 57 字节。历史结果见 [hash-validation.txt](verification/hash-validation.txt)、原批次前后 SHA-256 清单与 Git status。本轮改用独立的 [修复核验](verification/audit-scope-repair/hash-validation.txt)。没有暂存、提交、推送、reset 或 clean；未修改正式文档或旧原型。

运行器已删除本轮容器和临时 `.test-results.json`；随机前缀角色随实例一起销毁，未操作其他实例或执行全局 Docker 清理。未新增 Web 框架、模型 SDK 或数据库依赖。

## 正式整合必须保留的边界

必须保留真实连接主体映射、凭据宿主边界、函数 ACL/固定路径、动作与范围分别检查、先授权后检索、可信有限投影、模型载荷和受限来源分离、确切载荷摘要、不可变历史、每次复用重新授权、稳定撤销锁、拒绝审计真实提交以及日志字段白名单。

本轮不证明完整身份认证、生产级安全认证、多租户、计费、所有侧信道防护、模型从公开知识自行推断秘密的防护或自然语言零泄密。可信管理员/表所有者修改 Schema、停用约束或错误批准投影规则不在保护结论内。无真实模型、外部检索、完整知识/披露重建、完整 Canon 写入/审批及生产连接池；生产整合仍需鉴权提供者、密钥生命周期、策略评审、真实来源和预算兼容验证。

本轮完成后停止，不修改正式规范，不自动开展下一原型。
