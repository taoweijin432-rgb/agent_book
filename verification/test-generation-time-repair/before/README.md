# Agent Book：正式工程与有限人工写作审阅路径

第一批实现 [DOC-16 第 4.1 节](docs/16-prototype-consolidation-and-implementation-plan.md#41-第一批工程与身份基础建立第一个正式可运行底座)：一个 Node.js 原生 ESM 模块化单体入口，一套正式 `agent_book` Schema、一份 `agent_book_meta.schema_migrations` 迁移账本，以及受限数据库登录、作品范围授权、撤销和最小审计。十三个 `prototypes/` 仍为只读历史工程证据，没有导入正式运行路径。

当前已完成第一批底座、第二批第二段安全上下文，以及 [第二批第一段](docs/16-prototype-consolidation-and-implementation-plan.md#42-第二批设计安全-bundle候选校验人工审批)：真实 author 可创建 Volume/Chapter/Scene 和稳定 Entity，创建设计草案、编辑、冻结并生效，再创建场景任务及追加版本、查询历史。只实现人物设计和有限作者规则格式；现已追加人工 Workflow、不可变 Candidate、有限确定性 Validation、显式人工审批及受控 provider=test 单次生成。第二批第六段完成，整个第二批未完成；不实现真实模型、Canon、Evidence 全域整合或投影消费，不代表生产就绪。

## 运行前提与一次性验收

本地验收使用 Node.js `>=22.23.2`、pnpm `11.18.0`、Docker 和已验证镜像：

```text
postgres:18.6
postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae
```

依赖精确固定为 `pg@8.23.0`、`node-pg-migrate@9.0.0`；锁文件保留权限原型已验证的完整传递依赖版本，仅调整根 importer。没有 ORM、Web 框架、队列或其他数据库。这是本地首批决定，不是生产部署或长期补丁批准。

```sh
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` 显式调用 `--isolated` 验收：忽略用户的普通数据库配置，创建十七个名称/口令/角色前缀均独立的临时 PostgreSQL 实例；校验镜像 digest，经有总期限的宿主 TCP `SELECT 1` 就绪检查后，先在明确的 002 迁移边界回归旧断言及九项有效期专项，在 003 边界回归安全上下文、004 边界回归人工候选，在 005 边界回归有限校验、006 边界回归人工审批，再验证空库 001→007、已有 006 数据升级和测试生成路径。旧回归仍包含第一批数据升级及创建证据不足失败。覆盖重复迁移、实际迁移失败阻断、真实受限身份、设计/任务版本竞争、真实 COMMIT 回滚、撤销竞争和安全输出。最后只删除本轮匹配标签的容器、匿名卷、临时配置/凭据/结果目录。没有全局 Docker 清理，也不自动连接或迁移现有数据库。

实际数量以 [当前测试生成验收](verification/test-generation/run-result.md) 为准；[人工审批验收](verification/manual-approval/run-result.md) 保持历史原字节；[有限校验验收](verification/finite-validation/run-result.md) 保持历史原字节；[人工候选验收](verification/workflow-candidate/run-result.md) 保持历史原字节；[安全上下文验收](verification/safe-context/run-result.md) 保持历史原字节；[第二批第一段验收](verification/design-task/run-result.md) 保持历史原字节；[第一批历史验收](verification/foundation/run-result.md) 保持只读，顶层、参数化子场景与配置/运行器控制测试分别统计；它与旧原型报告独立。结果缺失、过期、无效、包含失败，或迁移/测试/报告/清理失败时，最终退出非零。`pnpm test:unit` 只跑配置/运行器控制测试，不连接数据库。验收不调用模型，不跑生产负载、连接池或灾备演练。

## 在明确指定的本地空库运行

普通命令没有默认连接、默认密码或管理员回退。每个身份只持有自己的连接配置，使用 [config.example.json](config.example.json) 的精确字段，复制为忽略入库的 `config.author.local.json` 等。当前仅允许 loopback 地址、`agent_book_` 前缀的显式数据库名和安装 UUID；生产/远程模式未开放。测试 `mode=test` 还必须显式设置 `AB_TEST_MODE=1`，普通本地配置使用 `mode=local`。

初始化是单独的管理员动作：先由操作者明确创建一个专用空数据库（不要使用 `postgres`、模板库或既有业务库），为此次安装生成 `crypto.randomUUID()` 的 `instanceId`，填写管理员连接配置和 [provision.example.json](provision.example.json)。模板中的 Actor UUID、登录名和占位密码必须换成此次安装值；密码使用 `crypto.randomBytes(24).toString('hex')`，各身份分别生成，配置文件限制为本人读取，不提交 Git。运行配置不接受整套身份或 provisioning 数据。

```sh
AB_CONFIG=config.admin.local.json AB_PROVISION=provision.local.json pnpm db:initialize --confirm-empty-target
AB_CONFIG=config.migrator.local.json pnpm db:migrate
AB_CONFIG=config.admin.local.json pnpm db:bootstrap
```

初始化先检查空库和角色不存在；不会覆盖已有角色/对象，不创建数据库，也不支持自动清理。它创建安装标记、六类运行登录及独立 owner/migrator；后续迁移和运行连接均核对安装 UUID。迁移命令仅接受登记的迁移登录，固定从 `db/migrations/` 向前迁移；无参数覆盖迁移路径或自动 down。再次执行无待迁移项返回 `migrations_applied=0`。`down` 明确拒绝破坏性回退，业务语义修订及未来迁移使用受评审的向前变更。

`db:bootstrap` 仅供可信初始化管理员登记已封存 registry 中的 Actor 和作者启动授权；没有从请求选择任意角色的运行授权入口。作者创建作品后，管理员可在初始化阶段显式登记已注册 writer 或 auditor 对该作品的单一读取权限：

```sh
AB_CONFIG=config.admin.local.json pnpm db:bootstrap --initialize-reader ACTOR_UUID NOVEL_UUID
```

此命令只允许 superuser 初始化连接、已存在作品及已登记 writer/auditor；分别固定授予 `novel.read` / `audit.read`，不接受角色、能力集合、范围表达式或其他主体类型。重复/重叠有效期拒绝；它不是作者/Agent 的自助授权接口。测试中管理员仅做这些初始化、故障注入和独立核验；授权成功正例都使用真实运行 LOGIN。

## 已实现命令

```sh
AB_CONFIG=config.author.local.json pnpm config:check
AB_CONFIG=config.author.local.json pnpm book identity
AB_CONFIG=config.author.local.json pnpm book novel:create my-novel "作品名"
AB_CONFIG=config.author.local.json pnpm book novel:read NOVEL_UUID
AB_CONFIG=config.writer.local.json pnpm book novel:read NOVEL_UUID
AB_CONFIG=config.auditor.local.json pnpm book audit:read NOVEL_UUID
AB_CONFIG=config.author.local.json pnpm book grant:revoke GRANT_UUID
AB_CONFIG=config.author.local.json pnpm book creation:revoke
```

创建/读取仅返回许可作品的最小字段；`canon_watermark=0, canon_status=not_implemented` 表示尚未发生提交的逻辑边界，没有 Canon 表、假 committed 记录或成功序号。创建函数返回发生于事务内，CLI/服务必须真实 COMMIT 成功后才交付结果；中途错误、延后 COMMIT 错误或外层回滚均无作品/Scope/初始授权/成功审计残留。

## 身份与权限边界

业务 UUID 由应用 `crypto.randomUUID()` 生成，包括迁移中固定目录项的 UUID；能力/角色代码和数据库登录名保留自然标识。作品根仅为 Novel，没有重复 Project 体系。Chapter/Scene 明确保留 Novel 列并使用与父对象的复合 FK；Volume/Entity 对真实 Novel 有 FK。治理身份、归属和授权/审计历史不能经普通 DML 改绑，状态编辑、归档和 Entity 合并拆分尚未开放。

| 身份 | 数据库事实／已授入口 | 当前边界 |
|---|---|---|
| 初始化管理员 | 显式空库初始化、主体/启动授权登记、最小 reader 初始化 | 可信宿主，凭据不能交给运行身份；不计作授权正例 |
| migrator | 独立 LOGIN；无超级用户/CREATEDB/CREATEROLE/BYPASSRLS；仅对 owner 有 `SET` 成员关系，`INHERIT=false, ADMIN=false` | 可迁移/修改正式结构，属于可信部署边界；运行时不使用 |
| owner | NOLOGIN、非超级用户，无 BYPASSRLS/CREATEDB/CREATEROLE | 持有表、迁移账本及受控函数；运行登录不属于它 |
| author | identity、create/read Novel、revoke Grant、revoke own creation，以及下列结构/设计/任务命令 | 有有效启动授权才可创建；新作品固定只给自己 `novel.read`、`grant.revoke` 及下表七项本轮作者能力；只能管理自己有权限的作品 |
| writer | identity、read Novel、显式授权的 context:compile/read 及人工 Workflow/Candidate | novel.read 仅元数据；上下文另需 Task 级固定授权；人工写作还需独立 manual_workflow_v1 授权，不能读原始设计/任务、发布或受限追踪，无底表权限 |
| auditor | identity、read audit、context:trace/audit、workflow:audit、validation:audit、approval:audit | 当前有效的指定 Novel `audit.read`；可追溯许可 Novel 的历史包与受限来源身份；不能读底表或其他作品/越界资源事件，不自动获得原始设计或候选正文读取权 |
| validator / commit-service / projection-worker | 只有 identity | 本段不启用这些登录的业务权限；校验由有权 author 实际执行 |

运行登录是真正的新 TCP 连接：非所有者、无超级用户/BYPASSRLS/CREATEDB/CREATEROLE、无任何角色成员关系。没有连接池。Actor 仅从 `session_user → actor_principal.db_login` 映射；请求 actor、角色或 GUC 不参与授权。采用 SECURITY DEFINER，固定 `pg_catalog,agent_book,pg_temp`（安装标记函数使用固定 meta 路径），受控 owner 持有，撤销 PUBLIC EXECUTE 和未来函数默认 PUBLIC 权限；登录只有必要 Schema USAGE 和 API EXECUTE，无业务底表读写。只读安装 UUID 函数不返回凭据/授权信息。未使用 RLS，不声称抵抗可信管理员/迁移者改 DDL。

## Scope、稳定锁与审计

`data_scope` 仅支持 `scope_kind=novel`，Novel FK 非空，格式为 `foundation-scope-v1`，默认 deny。缺少 Grant 表示无权，未传场景等维度不表示允许所有资源：此 Scope 只与已实现的能力组合使用；novel.read 仅元数据，新增设计/任务能力另行授权。授权 Scope 请求中的 Scene、人物视角、秘密、Canon 水位等维度仍一律拒绝；任务中经过真实关系校验的人物与场景是业务输入，不能提高权限；Schema 不用任意 JSON 保存授权条件。

新作品尚不存在，不能建立 Novel FK Scope。因此作者启动权限使用单独的 `novel_creation_authorization` 及其追加撤销记录，能力严格固定为 `novel.create`，只允许插入新身份；它不是全作品通配 Scope。初始化登记，身份/有效期不可改，运行接口不能自助发放/恢复；作者可用无主体参数的 `creation:revoke` 仅撤销自己的有效创建启动授权，既有作品权限仍由各 Novel Grant 决定。现有作品必须另有真实 Novel Scope Grant，创建入口不能指定他人、角色、权限内容或借新作品取得其他作品权限。

首批使用预先存在的单行 `authorization_gate`。已实现 API、授权 INSERT 和撤销 INSERT 都先锁它，锁后用一次数据库 `clock_timestamp()` 判断授权状态/有效期；随后才操作作品、Grant 和审计。此保守全局锁符合本地单用户底座范围，串行化不同 Novel 的已实现命令，尚未做吞吐优化。它不依赖不存在的撤销行，也不使用“BEFORE UPDATE 一定先锁父行”的假设。未来与 Novel/Workflow/Canon 锁的整合仍属 DOC-16 D06。

撤销先提交：等待的判定看到撤销而拒绝。许可操作先完成受保护判定：可以完成本次事务，撤销等待后生效，下一次拒绝。期限在取得锁后判断，等待跨过到期点不能放行。只承诺当前命令的锁序，不宣称未来全系统无死锁。

业务拒绝以固定 `{ok:false,error:ACCESS_DENIED}` 提交审计后返回；SQL 权限错误和技术异常使用安全错误标识，相关事务回滚，不冒充已持久化拒绝审计。默认日志只含 `event/operation/outcome/request_id`；CLI 错误和迁移诊断不附密码、连接串、请求、SQL 或参数。

审计首先检查记录的 Novel，再正向核对实际引用资源的 Novel。仅支持 none、真实 Novel 和真实作品 Grant；未知类型不能入库，也不作为默认可见。越界整条事件过滤，允许资源标识和无资源普通事件保留；原始受限记录不删不改。不会用 Grant 当前是否有效来抹去许可范围内的历史撤销审计。作者/审计/写作权限独立。

本轮保护核验见 [保护结果](verification/test-generation/protection-result.md)，实际变更及配置见 [交付清单](verification/test-generation/file-manifest.md)。本轮不修改 `docs/00`—`15`、十三个原型或历史归档，不执行 Git 暂存/提交/推送/reset/clean。第二批第六段已完成，整个第二批未完成，真实模型、结构化提案及 Canon 等后续流程未开始；生产认证、密钥保管、生产部署、完整恢复及规模性能仍需后续评审与验收。

## 第二批第一段：设计与场景任务

### 追加迁移与已有作品升级

`001_foundation.mjs` 保持原字节，正式账本顺序追加 `002_design_task.mjs`。空库执行两组迁移；第一批数据库使用原 migrator 的 `pnpm db:migrate` 升级，再启动新版本 CLI。迁移成功前不要使用新客户端的作品创建协议；迁移路径、所有者、安装 UUID 与第一批相同，无第二个业务 Schema。

升级持有稳定授权锁，只根据唯一的 `novel.create/allow` 审计、相符 Novel 资源及实际 author Actor/Role 确认创建者；按真实 Novel Scope 补七项能力。创建者还必须同时有有效的原 `novel.read` 和 `grant.revoke`：在稳定授权锁内以单个数据库判定时间取得两项实际支撑 Grant 及其共同截止，不再在写入时重新筛选来源。任一支撑有限期，七项新增授权均使用同一较早截止；只有两项支撑都明确 `expires_at=NULL` 才允许无限期。缺少支撑或聚合无结果不表示无限期。任一已撤销/到期/主体停用，则记录 `withheld_revoked_or_expired`，不补齐、不恢复。作者撤销新作品**创建启动权**不抹掉已有作品权限，沿用第一批契约。其他 author 和元数据 reader 不提升权限。

写入前数据库时间若已到共同截止，002 以安全技术错误失败，**整笔迁移回滚**（七项能力、升级记录与 002 账本均不持久化）；重试时重新判定已到期来源，记录 withheld 且不补权。合法写入采用同一个写入判定时间和固定截止，一条语句插入完整七项并核对数量，之后才记录 seeded。写入后、COMMIT 前才到期不会延长截止；seeded 只是历史处理结果，提交后的真实权限检查仍拒绝。

创建记录缺失或多于一条，或主体不是登记 author，迁移以 `AUTHOR_CREATION_PROVENANCE_REQUIRED` 停止，原数据与账本保留；对外迁移错误仍只给安全标识。应由可信运维检查具体历史作品并评审前向修复，不提供猜测归属或通用自助补权入口。升级后新作品在原受控创建事务中给真实创建者固定九项 Novel 能力（旧两项加新七项），不能传其他主体、角色或 Scope。

| 能力 | 已实现命令 | 运行身份与额外条件 |
|---|---|---|
| `structure.manage` | `volume:create`、`chapter:create`、`scene:create`、`entity:create`、`structure:read` | 仅 author，指定 Novel 有效 Grant |
| `design.read` | `design:history` | 仅 author；不由 `novel.read` 推导 |
| `design.edit` | `design:draft`、`design:edit` | 同时具有 `design.read` |
| `design.freeze` | `design:freeze` | 同时具有 `design.read`，显式预期编辑号与当前 Revision |
| `task.read` | `task:history` | 仅 author，独立于设计读取 |
| `task.create` | `task:create` | 同时具有 `task.read`，绑定当前生效设计 |
| `task.append` | `task:append` | 同时具有 `task.read`，显式预期前驱 |

writer 仍只读授权作品元数据；validator、commit-service、projection-worker 仍仅身份自检；auditor 仅其 Novel Scope 内最小审计。没有给它们新表或设计入口权限。新增审计仅引用已支持的 Novel 资源，不返回设计正文、摘要或细粒度设计引用。

### 命令与输入格式

所有新增命令形式统一为：

```sh
AB_CONFIG=config.author.local.json pnpm book OPERATION NOVEL_UUID request.local.json
```

`request.local.json` 是 JSON 对象，读取命令内容为 `{}`，写命令必须有稳定 `request_key`（1—100 字符）；失败后保留原键与原请求重试。请求不接受 actor/role/scope、客户端 hash 或额外字段。结构命令字段如下（均另带 `request_key`）：

| 命令 | 字段 |
|---|---|
| `volume:create` | `position` 正整数、`title` |
| `chapter:create` | `volume_id`、`position` 正整数、`title` |
| `scene:create` | `chapter_id`、`position` 正整数、`goal` |
| `entity:create` | `entity_type`（character/location/organization/item/concept）、`name`；仅稳定身份 |
| `design:draft` | `base_revision_id`：首次必须显式 null；后续传可读历史 Revision，复制其完整集合 |
| `design:edit` | `draft_id`、`expected_edit_version`、`content` 完整替换草案集合 |
| `design:freeze` | `draft_id`、`expected_edit_version`、`expected_current_revision_id`（首次显式 null） |
| `task:create` | 下列 Task 参数 |
| `task:append` | 同样 Task 参数，另有 `task_id`、`expected_version_id` |

设计 `content` 的精确格式：

```json
{
  "characters": [{
    "design_key": "hero", "entity_id": "CHARACTER_UUID", "name": "人物名",
    "description": {"summary": "作者设定", "motivation": "人物动机", "traits": ["谨慎"]}
  }],
  "constraints": [{
    "rule_key": "voice", "severity": "hard", "scope_kind": "scene",
    "scope_id": "SCENE_UUID", "rule_text": "作者意图中的语言约束"
  }]
}
```

最多各 16 个对象/约束，冻结至少一个人物；key 为小写字母开头、最长 64 的字母数字/下划线/连字符。人物 name 最长 300，summary/motivation 各 1—4000 字符，traits 最多 20 个、每个 1—200 字符；规则正文 1—4000。`scope_kind` 仅 novel/scene/character；novel 必须显式 `scope_id:null`，其他必须是本作品真实 Scene/character UUID。severity 仅 hard/soft，存储类型固定 `author_rule_v1`。硬/软在此只是作者声明，尚无规则执行、自然语言一致性结论或例外批准。

稳定设计身份由同 Novel 的 `design_key` 标识并固定对应 Entity；重命名可新版本，改绑 Entity 被拒绝。其他设计类型、秘密/伏笔工作流、设计身份合并拆分、归档/删除和例外授权未开放，不能用任意 JSON 扩展成这些操作。

Task 精确输入（追加时额外带任务及预期前驱）：

```json
{
  "request_key": "scene-1-task-1",
  "scene_id": "SCENE_UUID", "revision_id": "CURRENT_REVISION_UUID",
  "viewpoint_entity_id": "CHARACTER_UUID", "input_canon_watermark": 0,
  "goal": "场景目标", "constraint_ids": ["CONSTRAINT_UUID_FROM_THIS_REVISION"],
  "budget": {"max_input_tokens": 8000, "max_output_tokens": 2000},
  "reader_scope": {"format_version": "task-reader-v1", "mode": "no_disclosure_claim"},
  "compile": {"format_version": "scene-task-v1", "timeline": "linear", "dependencies": "committed_only"}
}
```

UUID 使用标准小写形式。人物须为真实 character，Scene/Revision/人物/约束必须同 Novel；约束必须来自该 Revision，场景/人物范围还须匹配本任务。读者参数仅表示任务设计输入，**不是 Canon 已确认的披露状态**。预算仅保存 1—1,000,000 的整数，不计算真实 token；任务目标 1—4000 字符，约束最多 16 条、不得重复。非零水位、全知视角、分支、非线性参数、草稿依赖、未知格式与额外字段明确拒绝，无假 Commit。读取历史仅对有当前权限的 author 开放。

### 草案、冻结内容与治理指针

`design_draft` 是可编辑工作记录；编辑号每次加一，旧号拒绝。冻结事务从完整草案生成正式 `author_design_revision`、人物 `design_object_version`、Entity Binding 和 `design_constraint`，正式记录从第一次插入起不可 UPDATE/DELETE/TRUNCATE。后续 INSERT 也必须在延后完整性检查中与冻结集合和摘要完全一致，不能向历史 Revision 夹入新成员。

生效历史单独追加 `design_activation`，当前仅 `design_head` 指向一个 Revision；这不是改写冻结内容的 status。旧版本的 effective/superseded 由指针与历史关系判断。重新设计必须明确指定历史 Revision 创建新草案；旧 Revision、对象、约束、历史任务绑定都保留。这是 DOC-12/13 的草案工作表加正式不可变版本的本轮承接方式，不把所有设计生命周期都实现成状态机。

`scene_task` 保持稳定 Scene/Novel 身份；每次变更创建不可变 `scene_task_version` 和规范化约束引用。复合 FK 保证 Novel、Scene、Revision、人物类型及实际约束版本；前驱检查与当前指针更新同事务。当前设计变化不改写旧任务；创建和追加版本都要求新绑定为当时当前设计。

### 摘要、幂等、事务与锁序

本轮协议 **`ab-jsonb-v1`**：UTF-8、SHA-256，不做 Unicode 归一化。精确字节前缀为 `ab-jsonb-v1:request\n`、`:frozen\n`、`:task\n`（`\n` 表示单个 LF），再拼 PostgreSQL 18 `jsonb::text` 表示；对象键按 JSONB 的 UTF-8 键字节长度、再字节值排序，采用其固定转义和逗号/冒号空格规则。所有载荷字段集合由上述精确格式和规范化列限定；人物集合按 design_key、约束按 rule_key、任务引用按 UUID 排序，traits 保留输入顺序。只支持此协议；未来变更须新协议及历史解析器，不能用新排序重解释旧 hash。

请求摘要覆盖 operation、Novel 和规范化完整 request，包含稳定请求键及显式前驱，**不含**每次生成的 UUID、审计 ID 或时间。冻结摘要只覆盖完整人物/约束集合（包括稳定 key、Entity/Scope 绑定）；任务摘要覆盖 Task 的完整参数，独立于请求与版本 ID。数据库实际计算，保存原 `canonical_text`、协议和 hash；延后检查从关系表重建集合再核对，历史可按原字节独立复算，不接受自报 hash。

新增写命令的幂等身份为 `(Novel,真实 Actor,operation,request_key)`。同键同规范化请求返回原结果；异请求拒绝；旧成功重放不改当前指针，且先检查当前动作及读取权限。冲突、参数和业务拒绝写安全审计并以受控结果提交；技术故障整笔回滚。外部服务只在真实 COMMIT 完成后交付成功。

当前统一锁序：预先存在的 `authorization_gate` → Novel → Design head（冻结）→ Draft，或 Novel → Task（追加）；任何新增业务路径都先授权，不能拿草案锁反等授权锁。初始化补权和撤销复用同一稳定 gate，锁后用数据库实时时间判断有效期。仍是保守全局串行化，不承诺未来 Canon/投影系统无死锁。未实现操作全部拒绝，不覆写历史或退化为其他阶段。

本轮报告、文件清单和保护结果集中在 [verification/design-task](verification/design-task/run-result.md)。生产安全、灾备、性能与小说质量不在本轮验收范围。


### 补授权有效期修复证据

此前通用升级验收未覆盖“资格通过后、写入前到期”，不能据此证明原实现的有效期继承。该路径现已在未修改的原始 002 中真实复现：七项能力被写成 NULL 截止，来源到期后 author 仍能读取设计。修复前 [002 副本](verification/design-task/expiry-repair/before/db/migrations/002_design_task.mjs)、[真实复现](verification/design-task/expiry-repair/before-reproduction.json) 及 [历史通过报告](verification/design-task/expiry-repair/before/verification/design-task/run-result.md) 保留，原保护基线未重建。

修复后 [专项证据](verification/design-task/expiry-repair/after-special.json) 包含 9 个运行器独立场景，逐项给出来源/七项能力截止、独立持久化状态、真实 author 结果，以及两种时间交错的阻塞 PID/数据库时间。它不混入原 5/45、6/34 或 7 控制测试数量；完整 `pnpm test` 同时执行这些回归与专项，结果见 [当前完整报告](verification/design-task/run-result.md)。本轮实际文件和保护核验见 [修复交付清单](verification/design-task/expiry-repair/file-manifest.md)；此前清单保留为当时的历史摘要。未连接或修改非验收数据库；未发现其已使用 002 的工作区证据，不能由此断言外部不存在部署。


## 第二批第二段：正式安全投影与冻结 Context Bundle

003 只追加正式结构和受控入口，不改 001、修复后的 002 或历史验收。普通 `pnpm db:migrate` 始终前向执行全部待迁移项；验收使用显式 test 配置及 `AB_TEST_MIGRATION_BOUNDARY=2` 运行旧断言，普通配置禁止这一测试边界。当前完整结果、旧边界回归、文件清单和保护核验位于 [verification/safe-context](verification/safe-context/run-result.md)。

### 信任与有限能力

可信边界仍是初始化管理员、迁移/NOLOGIN owner、内部编译代码和真实受限连接。Actor 来自 session_user，writer 不持有高权凭据。请求、原始设计/任务、标题、辅助 metadata、未来检索命中均不因字段名称成为安全上下文。

本段没有 Canon、人物知识证据或读者披露历史。所有输出都是作者明确批准的 **author_intent_only 指令**，不能冒充客观事实、known_true/known_false、人物“不知道”或已披露状态。不使用模型总结、字符串替换脱密、外部检索或权限原型 resource 夹具；不保证任意自然语言秘密自动识别或推断零泄密。

作者先创建不可变待发布提案，再单独发布。发布将批准主体、内容 hash、Task/Revision/Scene/POV/目标 writer 和真实 Evidence 固定；调整必须新提案、新发布，并显式指定被替代发布。撤销/替代追加记录，不能改原文、删除来源或重新激活旧版本。

### 授权与命令

形式沿用 `AB_CONFIG=... pnpm book OPERATION NOVEL_UUID request.local.json`。新增写操作均带稳定 `request_key`，未知字段拒绝。

| 命令 | 输入字段（除 request_key） | 权限 |
|---|---|---|
| `context-grant:create` | task_version_id、writer_actor_id、allow_revision/object/constraint（三个显式 boolean）、expires_at（显式 null 或时间） | author 同时有该 Novel 的 design.read、design.freeze、task.read、task.create |
| `projection:propose` | 见下例 | 同上；实际来源/引用全部同 Novel、Task、Revision/POV |
| `projection:publish` | proposal_id | 同上；当前 Task/Design/策略及发布前驱仍匹配 |
| `projection:revoke` | publication_id | 同上；追加撤销，不改原发布 |
| `context-policy:publish` | task_version_id、expected_release_id、policy_version=safe-context-v2 | 同上；只允许从 v1 升到已实现 v2，禁止任意策略代码及降级 |
| `context:compile` | task_version_id、max_bytes（128—65536） | 真实 writer、当前有效 Task 授权 |
| `context:read` | bundle_ref；无 request_key | 同一真实 writer、包原授权仍有效、输入仍为当前 |
| `context:trace` | bundle_ref；无 request_key | author 有 design.read+task.read，或 auditor 有该 Novel audit.read |
| `context:audit` | `{}`；无 request_key | 同上，仅受限核验信息 |

原 `grant:revoke GRANT_UUID` 同时支持本段的上下文授权；作者撤销它还须有 grant.revoke 及上述管理权限。ID 命名空间冲突在数据库拒绝。旧 Novel Grant 的撤销语义不变。

旧 `data_scope` 完全保留 foundation-scope-v1 语义。本段以独立的规范化 `context_task_scope` / `context_grant` 关系承接 **context-task-scope-v1**：Novel、真实 Task Version、Scene、Revision、人物及 writer Role/Actor 使用真实复合 FK；来源类型范围由非空布尔列表示，不使用任意 JSON，也不把 NULL 当作全部。固定 `compile_and_read_v1` 只含编译与读取两个能力，不允许传任意角色或能力。

novel.read 不推导任何新权限；003 不批量补作者/写作权限。作者只能为自己许可作品的真实 writer 发放固定上下文授权，不能给 validator 等角色。授权截止不晚于实际作者支撑权限的有限截止；缺少支撑不表示无限期。每份新 Scope/Grant 是独立授权；收窄旧权限须显式撤销旧 Grant，不能把另建 Scope 当作撤销。新编译在有效授权中按发放时间/ID确定选择；旧包须原 Grant 仍有效，即使后来另发新 Grant，也不能恢复已撤销包。

### 安全投影与正式来源

```json
{
  "request_key": "scene-1-goal-proposal",
  "task_version_id": "TASK_VERSION_UUID",
  "writer_actor_id": "WRITER_ACTOR_UUID",
  "kind": "goal",
  "source_object_type": "author_design_revision",
  "source_object_id": "REVISION_UUID",
  "safe_text": "围绕眼前行动推进场景，不确认尚未获准的身份。",
  "semantics": "author_intent_only",
  "format_version": "safe-projection-v1",
  "policy_version": "safe-context-v1",
  "replaces_publication_id": null
}
```

kind/source 必须对应：goal→author_design_revision（批准覆盖本 Task 原始目标/任务指导）；character→当前 POV 的 design_object_version（安全名称/描述/写作指导）；constraint→本 Revision 的 design_constraint（覆盖具体约束）。safe_text 1—12000 字符，其他设计来源及事实/知识语义明确拒绝。标题、解释、路径和任意 metadata 不在格式中，不能绕过批准注入。作者批准的是最终文字与适用范围，编译器不判断其自然语言与原设计的语义等价性。

正式 Evidence 父表保留 `(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind)` 六字段唯一身份；消费方不进身份。同一真实设计来源可由不同 Task/writer 的发布复用。当前仅 author_design、三类真实类型、whole:v1 locator、author_intent kind；父子身份/Novel/Revision/实际目标由复合 FK、类型 XOR 与延后父子完整性保证。其他域/类型拒绝，没有无 FK 占位来源。Evidence 和支撑从首次插入起不可变。

每个 Item 的受限链是冻结设计源→Evidence→作者发布→Item；Task Version 独立使用正式 FK，不伪装 Canon/Tool Evidence。作者/审计追踪还正向复核每条实际来源的归属和版本，不只检查 Bundle 所属 Task。

### 编译、载荷、冻结与预算

编译先锁授权 gate 并核对真实 writer、Grant、期限和 Scope，再读取必要来源的**身份字段**及已批准文字。必要集合是所有适用 hard 约束、Task 明确引用的约束、一个场景目标、当前 POV 设计对象；没有 POV 设计或任何必要安全投影缺失都整包拒绝，不裁掉硬约束。先约束、再目标、再人物，同层按来源 UUID 排序；不读取原始 goal/name/motivation/rule_text 排序后再删秘密。

模型可见的精确载荷只有固定 JSON：`format_version=safe-context-payload-v1`、`semantics=author_intent_only` 和有序 items 的 kind/text。没有来源 ID、原始路径/标题、隐藏内容摘要、过滤原因或调试 metadata。writer 工具响应另含随机公开 bundle_ref（与内部 Bundle ID 分开）、安全载荷 hash 和预算说明；受限来源身份、批准/授权依据只在 trace/audit 中。

`ctx-jsonb-v1` 使用 UTF-8/PostgreSQL 18 JSONB 的固定键顺序、转义、空格及已确定的数组顺序。Bundle hash 是**实际 payload_text 字节**的 SHA-256；请求和投影摘要使用独立域前缀，不接受客户端 hash。保存精确载荷、Item 顺序、发布与策略 Release、编译身份、原 Grant、Task/Design 和水位 0。数据库延后检查重建实际载荷并核对完整 Item/来源、顺序、版本、声明预算、字节数/hash 及编译记录；冻结后禁止 UPDATE/DELETE/TRUNCATE 和历史追加。

预算是 **utf8-byte-v1**，完整计入固定 JSON 外壳、文本、转义及顺序，超限整包拒绝。Task 声明的 input/output token 数仍原样保存并回传；real_token_budget_verified=false、model_call_admitted=false。字节和字符都不是 token，Bundle 不是模型调用准入；未来网关必须对真实渲染请求另做 tokenizer、窗口与费用检查。

所有写操作使用真实 COMMIT 成功后响应。相同 Actor/Novel/operation/request_key 同请求返回原结果，不重复创建；异请求拒绝。编译重放仍检查原 Grant、Task、Design、发布和策略当前性，不能用旧键取回已失权文字。版本变动或发布撤销/替代使旧包不再是 writer 当前输入；旧包本体保留，有当前 trace 权限的 author/auditor 可追溯历史，不把“只查当前来源”套到历史读取。

锁序为预先存在的 authorization_gate→Novel→Task（有对应任务的写路径）→发布/追加记录；旧设计/任务入口也先 gate/Novel。取锁后用数据库时间判期限。许可操作先受保护完成可完成该次，撤销先提交则等待者拒绝；不承诺收回已交付内容，不宣称未来全系统无死锁。

### 审计、默认输出与验证边界

旧审计保留，新 `context_access_audit` 使用实际 typed FK 资源，合并进原 audit:read。读取正向检查记录 Novel/Task、实际 Grant/发布/Bundle/Evidence/策略资源及来源版本；不匹配整条过滤，原记录不删除。当前 auditor 是 Novel 范围，可读取本 Novel 不同 Task 的合法事件；“错 Task 绑定事件”与“合法另一 Task 事件”明确区分。未知资源拒绝，合法历史不依赖当前投影状态。

固定日志白名单与安全错误沿用底座。作者原始内容读取、受限核验及默认日志分开；受控拒绝提交审计，直接 SQL 权限错误和技术回滚单独验证。随机秘密标记覆盖原始目标、名称/描述、规则和标题，以及被拒绝的嵌套 metadata；扫描完整 writer 响应、CLI 错误、日志和报告，只输出标签、计数和布尔。仅证明有限规则与正式来源的安全边界，不是生产认证或自然语言零泄密保证。

## 第二批第三段：人工 Workflow 与不可变 Candidate

004 前向扩展同一 Schema/账本，保留 001—003、旧测试断言及历史证据。`pnpm test` 先按明确的 002/003 迁移边界运行全部旧回归，再测试 004；旧版本不存在人工 API 时，新 CLI 返回 UNSUPPORTED_OPERATION，不把旧边界成功替代 004 兼容验证。显式测试配置才允许 `AB_TEST_MIGRATION_BOUNDARY=2/3`，普通迁移仍执行全部待迁移项。

### 命令和固定写作授权

形式为 `AB_CONFIG=config.身份.local.json pnpm book OP NOVEL_UUID request.local.json`；写命令带 request_key，读取不带。字段表是完整白名单，未知字段拒绝。

| 操作 | request 的精确字段（写操作另加 request_key） | 权限 |
|---|---|---|
| writing-grant:create | context_grant_id、expires_at（显式 null 或截止时间） | 该 Novel 的 design.read/freeze、task.read/create；原上下文 Grant 有效且 Task/Design 当前 |
| workflow:create | writing_grant_id、bundle_ref、execution_mode=manual_input_v1 | 真实 writer、对应固定写作授权及原上下文授权有效，Bundle 属于同 writer/Task/原 Grant 且当前可用 |
| candidate:input | workflow_ref、body | 同一 writer；本次和每次后续操作重新授权 |
| candidate:edit | workflow_ref、previous_candidate_ref、body | 前序真实存在且属于同一 Workflow |
| candidate:select | workflow_ref、candidate_ref、expected_selection_version | 目标同 Workflow；当前选择版本 CAS |
| workflow:read | workflow_ref | 同一 writer，所有输入仍有效；返回当前选择、候选和选择历史 |
| workflow:trace | workflow_ref | 该 Novel 当前 design.read+task.read；包含受保护正文及输入/授权关系，保留合法历史 |
| workflow:audit | 空对象 `{}` | 该 Novel audit.read；只有执行/选择元数据，不含候选正文 |

撤销仍用 `pnpm book grant:revoke GRANT_UUID`，author 须有该 Novel 的 grant.revoke 和安全上下文管理权限。新旧三类 Grant ID 双向防冲突，旧表后插入同 ID 也拒绝。原 Novel Grant 与上下文 Grant 的撤销接口继续有效。

manual_workflow_v1 固定授予本段创建、录入、编辑、选择和读取的集合，没有任意能力/角色/主体参数。它引用实际 context_grant/context_task_scope，继承明确的 Novel、Task Version、Scene、POV、来源范围及 writer；novel.read 和 compile_and_read_v1 均不能替代它，不补齐旧 writer 权限。

发放时在稳定授权锁内按明确数据库时间捕获四项作者支撑与原上下文授权。缺少任一支撑拒绝；截止取请求、原上下文及实际作者支撑的最早有限时间，只有全部明确无限期才允许 NULL。写入前已到期则整笔不发放，不能把空来源集合解释为无限期。原上下文授权撤销/到期会使下游写作授权不可用；另建授权不会替旧 Workflow 换绑授权。

### 固定人工输入、精确字节与选择

本段 execution_mode 仅 manual_input_v1。Workflow 的 Novel/Scene/Task/Design/POV/writer/Bundle/两层 Grant 和水位 0 建立后不可改绑；输入变化创建新 Workflow。强制 Bundle 仅为本人工模式的契约，不改变未来所有 Workflow 的规范基数。没有完整生成/校验/审批状态机，也没有假 Generation、Validation、Approval 或 Canon。

正文为 exact-utf8-v1：完整保存 UTF-8 字节，不 trim、不改换行、不做 Unicode 规范化。数据库对实际正文重新计算 SHA-256 和字节数；客户端 hash 不被信任。同正文可以有不同 Candidate UUID；编辑必须指定同 Workflow 前序，记录 human_edit 与真实编辑主体，原正文、绑定、摘要及前序始终不可变。human_input 表示独立人工录入，不伪装模型来源；本段不创建 Candidate Evidence 占位。空白正文、NUL/不配对代理项、除 TAB/LF/CR 外的 C0 及 DEL/C1 控制字符拒绝，最多 262144 UTF-8 字节。这只是入口保护，不是模型 token 或小说规模指标。

Workflow 初始选择版本为 0，追加 initialized 历史，尚无当前候选。录入和编辑都不自动选择。显式选择以 expected_selection_version 做 CAS，当前指针与追加历史同事务；A→B→A 产生不同 selection_id 和递增 selection_version。后续校验/审批应绑定这一选择版本，本段没有预建相关记录。数据库复合 FK、冻结触发器及延后完整性检查保护真实归属、前序、选择链和指针。

manual-request-v1 请求摘要固定 operation、Novel、完整 JSONB 请求；body 字符串的精确字节差异保留，服务新 UUID/时间不进入请求摘要。幂等域为 Actor/operation/Novel/Task（Workflow 创建）或原上下文 Grant（发放）或 Workflow（候选/选择）/key。同键同请求返回原结果，异请求拒绝；所有 writer 重放仍检查原授权和 Bundle 当前性。旧选择请求重放只返回原选择结果，不移动当前指针。

锁序为 authorization_gate→Novel→Task→Workflow→候选/选择追加。先授权再取得业务锁；期限在取得授权锁后用数据库实际时间判断。撤销先提交，等待者拒绝；受保护操作先完成，撤销等待并影响下一次。未依赖 BEFORE ROW 先于目标行锁的假设，也不承诺未来全系统无死锁。服务只在外层真实 COMMIT 完成后交付成功；中途、延后故障或外层回滚均不得留下半成品。

### 读取、审计和不支持项

writer 的可见结果仅候选正文、摘要、必要公开引用和选择版本；不返回设计、原始目标、Evidence 内部标识或投影来源链。原上下文授权、写作授权、Task/Design/策略/发布任一失效后，创建、编辑、选择、读取及重放固定返回 ACCESS_DENIED，无历史正文。author 按当前 design.read/task.read 可追溯历史；auditor 只读本 Novel 的执行/选择审计，不获得正文或作者 trace 权。

manual_workflow_audit 通过 typed FK 引用 Grant/Workflow/Candidate/Selection。读取分别正向核对记录 Novel/Task/Workflow 和实际资源的完整归属，跨 Novel、错 Task/Workflow 整条过滤，原受限记录不删。统一 audit:read 同时包含这类安全元数据；writer 不可读写审计。业务拒绝提交审计，直接 SQL 权限错误和技术回滚分别核验。

候选正文属于受保护业务内容，可能包含人工敏感文字；许可正文响应与固定白名单日志/安全错误分开，系统不对人工输入做自动脱密。没有模型、测试模型、Generation/Model Call、校验、审批、结构化提案、Narrative Assertion、Canon、Outbox、投影、跨 Workflow 草稿依赖或自动续写/修复。整个第二批仍未完成。

## 第二批第四段：有限确定性校验覆盖契约

本段先定义以下固定覆盖，再实现同版本代码。执行者是实际 author；实现版本 finite-validator-v1、规则集 finite-rules-v1、策略 finite-validation-v1。没有 validator 代理执行、模型推理、人工审批或 Canon 准入。

| 检查（版本 finite-check-v1） | 真实冻结输入 | 确定性判定 | 必需性／未覆盖范围 |
|---|---|---|---|
| selection_binding | Workflow、Candidate、selection_id/version | 目标同 Workflow 且与本次当前选择及预期版本匹配 | 必需；无选择／过时请求拒绝执行，不伪造校验 |
| body_protocol | Candidate 实际 body_text/hash/bytes/protocol | exact-utf8-v1，独立 UTF-8 SHA-256、字节数及字符检查 | 必需；不判断自然语言真实性 |
| input_bindings | Novel/Task/Design/Bundle/writer/水位 | 真实关系逐项一致，水位 0 | 必需；不冒充 Canon 快照 |
| writer_authorization | 实际 writer 的原写作及上下文 Grant、Bundle 当前性 | 真实 writer 主体/范围/有效期/撤销、当前 Task/Design/策略/发布 | 必需；author 不切换身份，不借 writer 凭据 |
| bundle_payload | 冻结 Bundle 实际 payload_text/hash/used_bytes | 独立 UTF-8 SHA-256 和字节计量相等 | 必需；不等于正文遵守安全指导 |
| review_bytes | 实际 Candidate 正文 | 本固定策略支持至多 65536 UTF-8 字节的单候选校验 | 必需；超过记录 failed。是本段明确的检查覆盖上限，不是 token／小说总规模限制；004 录入上限仍为 262144 字节 |
| 每项适用 Design Constraint（author-rule-unimplemented-v1） | 从真实 Revision/Scene/POV 适用范围及 Task 约束引用推导的完整集合 | author_rule_v1 自由文本不解析：hard=unknown/RULE_UNSUPPORTED；soft=unknown/RULE_NOT_CHECKED | hard 必需并阻断整体通过；soft 非必需且明确未检查。已发布安全投影不证明遵守原规则 |

必需项任一 failed→整体 failed；否则任一必需 unknown→整体 unknown；全部必需 passed 才整体 passed。非必需 soft unknown 保留但不冒充已检查。记录成功与检查通过分开：完整 failed/unknown 是成功保存的业务结果；技术异常返回 REQUEST_FAILED 并回滚。请求不得传 pass、分数、检查明细、snippet 或任意代码。没有人物一致性、秘密安全、文风及全部剧情逻辑保证；通过不等于审批或 Canon 提交。

### 校验命令、事务与冻结绑定

形式仍是 `AB_CONFIG=config.author.local.json pnpm book OP NOVEL_UUID request.local.json`。先显式发布有限策略，再发起校验。以下字段为完整白名单；写操作另加 request_key，不接受客户端结果、摘要、主体、规则代码或覆盖范围。

| 命令 | request 字段（除 request_key） | 权限与行为 |
|---|---|---|
| validation-policy:publish | expected_release_id（首次显式 null，之后为真实前驱） | design.read/freeze、task.read/create；只发布本段固定代码，每次生成新的 UUID/代次，允许同内容再发布 |
| validation:run | workflow_ref、expected_candidate_ref、expected_selection_version | 同上；锁内检查真实当前选择及实际 writer 原授权/输入，完整 failed/unknown 也提交保存 |
| validation:history | workflow_ref；无 request_key | 当前 design.read+task.read；完整 Run/明细与逐条 current_applicable、covered_checks_pass，不返回正文或规则文本副本 |
| validation:current | validation_ref；无 request_key | 同上；统一当前适用性门禁，过时固定 VALIDATION_STALE |
| validation:audit | 空对象 `{}`；无 request_key | 本 Novel audit.read，仅执行/发布元数据，无正文、原始规则或受限检查集合 |

writer 的 manual_workflow_v1 不扩权；auditor 不能执行或查询完整校验，validator/commit/projection 登录没有本段 API 权。executed_by 是 session_user 映射的真实 author，implementation_version 单独记录。`_val_writer_at` 检查 Workflow 的实际 writer/两层 Grant，不切换身份或借用 writer 凭据。

锁序为 authorization_gate→Novel→Task→Workflow→当前 Validation Policy Release。发布仅 gate→Novel→Release 追加，不反向请求 Task/Workflow。锁后用数据库实际时间判断期限，同一短事务执行与保存，真实 COMMIT 后交付；技术异常、外层回滚、延后失败无半成品。审计 allow 表示操作获准，不代表业务校验 passed。

Run 用真实 FK 固定 Novel、Workflow、Task、Candidate ID/实际 SHA-256、选择历史 ID/版本、Bundle ID/实际载荷 hash、Design、水位 0、Release、实现版本及真实执行主体/时间。完整检查描述集（含 required 标志）、集合摘要、顺序、结果摘要与结论同事务冻结。validation-jsonb-v1 使用 PostgreSQL 18 JSONB text 和 UTF-8，request/check-set/results 分域 SHA-256；请求不包含重试时新生成的 UUID/时间。

数据库延后约束从真实来源重建全部检查，核对归属、顺序、明细、required/outcome/code、hash、集合及汇总。缺项、额外明细或伪造整体 passed 拒绝。Run、明细、Release、请求和审计禁止 UPDATE/DELETE/TRUNCATE，历史不能补写检查。本段最多 112 项总检查，超限整笔明确拒绝，不能丢弃规则。

### 历史结论与当前适用性

统一 `_val_applicable` 与 validation:current 供未来审批复用。后续必须同时要求当前适用且 overall=passed；current_applicable=true 本身不证明通过。covered_checks_pass 仅表示声明覆盖内通过。005 边界的 approval_implemented=false 表示当时无审批；006 前向将响应标记为 true、automatic_approval=false，不改变旧 Run/明细或 _val_applicable 语义。审批还须通过下节独立门禁。

选择版本、Candidate 身份/hash、Task、Design、Bundle/hash、原写作/上下文授权、发布、上下文策略或校验 Release 变化后当前取用拒绝。A→B→A 不复活旧结果，相同正文的新 Candidate 也不能复用。编辑未选择时保留 004 当前指针，原结果只描述原候选，不覆盖新编辑。具当前 design.read/task.read 的 author 仍可查询合法历史。

同 Actor/Novel/operation/Workflow（发布按 Novel）/key 同请求返回原记录，不重执行；异请求 IDEMPOTENCY_CONFLICT。Run 重放重查 author 权限和原结果当前性，失权 ACCESS_DENIED、过时 VALIDATION_STALE。发布重放只返回原 Release，不恢复旧代次。同内容重新发布产生新 UUID/generation，版本字符串相同也不能恢复旧结果。

审计同时核对记录 Novel/Task/Workflow 和实际 Run 的 Candidate、选择、Bundle、Revision 归属；越界整条过滤，原引用保留，合法历史不套当前性过滤。audit:read 同时包含这类元数据。默认日志与固定代码不输出正文、规则或受限来源；没有 snippet/正文定位功能。本段不是自然语言、人物一致性、秘密安全或文风保证，仍无人工审批、模型、Generation、结构化提案、Canon、Outbox、投影、自动修复及强制豁免。


## 第二批第五段：人工审批与追加失效

仅 author 人工操作；校验执行者和审批者允许是同一授权作者，没有双人复核保证。审阅是受保护业务输出，包含正文、精确 Bundle 载荷及原始未检查软约束；不会进入默认日志、错误或 auditor 输出。第五段不接受自由文本审批理由、任意策略代码、force_override、pass、分数或自动审批参数。

### 命令、精确请求与权限

统一形式：`AB_CONFIG=config.author.local.json pnpm book OP NOVEL_UUID request.local.json`。写命令和审阅另带稳定 request_key；以下为完整字段白名单，不接受请求审批人或额外字段。

| 命令 | request 字段（除 request_key） | 当前有效权限与结果 |
|---|---|---|
| approval-policy:publish | expected_release_id（首次显式 null） | design.read、design.freeze、task.read、task.create；固定 manual-approval-v1，每次新 Release UUID/递增代次，重放不恢复旧发布 |
| approval:review | workflow_ref | design.read + task.read；重建当前选择的精确审阅包、协议及摘要。须有当前校验批次及审批 Release；failed/unknown 的完整 Run 也可审阅 |
| approval:approve | workflow_ref、review_ref、expected_decision_version、review_hash、confirmed_soft_constraint_ids | 四项管理权限；显式确认服务端审阅摘要和完整未检查软项 UUID 集合。只允许当前适用的 passed 校验 |
| approval:reject | 与 approve 相同 | 四项管理权限；允许针对完整 failed/unknown 结果拒绝，不产生可用批准 |
| approval:withdraw | workflow_ref、approval_ref、expected_decision_version | 四项管理权限；撤回本 Novel 当前批准，记录实际操作者，不要求原审批者本人 |
| approval:history | workflow_ref；无 request_key | design.read + task.read；历史审阅、决定、支撑授权、撤回/失效及逐条 currently_usable |
| approval:current | workflow_ref；无 request_key | 同上；统一当前可用性检查，失效固定 APPROVAL_UNAVAILABLE，无正文；成功仍标记 not_commit_permit=true |
| approval:audit | 空对象 `{}`；无 request_key | 本 Novel audit.read；仅审阅/决定/发布的执行元数据；统一 audit:read 同时包含这些事件 |

审批管理权限沿用真实 Novel Grant，不新增通用授权入口，也不从 novel.read、候选读取或 manual_workflow_v1 推导。writer、validator、commit-service、projection-worker 均无本段 API 权限；auditor 仅能调用审计操作。session_user 映射真实主体，不接受借用 writer 身份或请求 actor。author 查询历史仍要求当前 design.read/task.read。

### 审阅协议、冻结绑定和决定代次

approval-review-v1 从真实冻结关系重建 Candidate 精确正文/hash、Bundle 精确 payload_text/hash、选择身份/版本、完整 Validation Run/检查/覆盖、未检查软项及固定 finite_coverage_only_v1 适用范围、审批 Release。approval_review 只保存关系、协议和摘要，不建立第二套正文或载荷权威源。approval-jsonb-v1 使用 PostgreSQL 18 JSONB text 的 UTF-8 字节及 SHA-256，review/request/policy 域前缀分别区分；审阅摘要包括完整上述载荷及当时决定版本。软项确认规范化为无重复的有序 UUID 集合，必须与服务端完整集合一致。

批准冻结七类绑定：Candidate 身份/正文 hash、Bundle 身份/载荷 hash、Design Revision、逻辑 Canon 水位 0、Validation Run、审批策略版本/Release、真实审批主体/决定。另保留 Novel/Workflow/Task、选择历史/版本、校验 Release/代次、审阅摘要、软项确认和四项实际支撑 Grant ID/共同截止。正文或 Bundle 原文不复制进 Approval Record。软项仍是 unknown/未检查，确认只证明作者提交了明确确认，不证明实际阅读/理解或自然语言正确。

approval_validation_epoch 自 006 起按 Workflow 稳定递增；新 Validation Run 与当前批次指针同事务追加。升级前的 005 Run 保留历史与原 current_applicable 语义，但不按时间戳选举审批当前批次；已有 Workflow 须重新发起一次真实校验再审阅。005 的幂等重放不产生新批次。

批准、拒绝、撤回分别追加不可变决定及专属关联；独立 decision_version 从 0 递增，当前指针与历史同事务维护，expected_decision_version 做 CAS。旧批准不更新状态，撤回/失效显式关联。新拒绝或后续决定使旧批准不可用。A→B→A 使用新的选择身份；同正文不同 Candidate、后续校验或相同策略内容的新 Release 均不继承批准。未选中新编辑不移动选择，原批准仍只描述原选中候选。

### 当前可用性、失效及授权时点

统一内部 _ap_usable / 对外 approval:current 重查完整绑定、当前选择、最新校验批次/完整 passed 明细、Task/Design/Bundle/发布/两类策略 Release、实际 writer 的原两层 Grant、当前决定、撤回/失效及原作者支撑。此结果只是检查时点结果；未来 Canon 必须在自己的提交事务内重查，不能拿本次结果作提交许可证。

同一数据库判定时间捕获实际支撑四项管理能力的 Grant 及其最早有限截止；任一有限期就保留共同截止，只有四项实际支撑均无限期才允许 NULL。少项/已到期/撤销不能解释为无限期，写入前到期整笔拒绝。后续一直检查原 ID，换发新 Grant 不复活旧批准；需要新人工操作。批准后到期仍拒绝使用，不承诺收回之前已交付的审阅内容。

已实现的选择、Task/Design、发布撤销/替代、上下文/校验/审批策略发布、原授权撤销、新校验和后续决定，在同一事务追加首次失效记录。来源变更回滚时，失效也回滚。每个批准永久保留首条失效，重复检查幂等；不清除失效恢复旧批准。时间到期无后台即时事件，首次受保护检查立即拒绝并记录真实发现时间，而不是伪造为截止时刻；安全性不依赖后台扫描。具体 [失效矩阵与契约](verification/manual-approval/approval-contract.md)。

锁序为 authorization_gate→Novel→Task→Workflow→当前校验 Release→当前审批 Release→审批状态，随后追加决定/明细/历史/审计。发布只取 gate→Novel 并追加策略；原变更 API 已持 gate，006 的 AFTER 触发器在实际 DML 完成后补失效，不反向取得业务父锁，不假设 BEFORE ROW 会早于目标行锁。期限取锁后以数据库时间判定；当前全局 gate 串行化本地操作，不宣称未来全系统无死锁。

所有成功响应等外层真实 COMMIT；业务拒绝安全结果提交拒绝审计，技术异常回滚，完整 failed/unknown 校验可保存但不能批准。数据库 FK、冻结触发器及延后约束检查决定链、指针、实际授权与全部冻结绑定。普通登录不能读写底表、调用 helper 或改删/TRUNCATE 历史；未实现资源类型不默认可见。审计同时正向检查记录 Novel/Task/Workflow 与实际审阅/决定/策略资源，过滤整条越界事件，原引用保留，合法历史不套当前有效性过滤。

同 Actor/Novel/operation/Workflow（发布按 Novel）/key 同请求重放、异请求拒绝，重放重新授权并显示历史/当前性区别。过时批准重放返回不可用，不移动指针；旧拒绝/撤回重放只返回原记录，不重做决定。默认白名单日志与安全错误不输出正文、Bundle、原始规则、确认理由或凭据。

当前只完成有限人工审阅路径；hard unknown/failed/缺明细不能批准，无强制豁免或自动修复。没有模型、Generation、结构化提案、Canon、Outbox 或投影消费，也不保证小说人物、秘密、剧情或文风完整正确。整个第二批仍未完成。


## 第二批第六段：受控测试生成最小链路

本段 provider=test、adapter=fixed-test-v1、model=test-text-v1，只有工程内确定性单次调用，没有外部网络、真实模型、流式输出、工具调用或自动重试。一个 Generation 本段只计划一次 Model Call、最多接纳一个 Candidate；这是本段受限模式，不限定未来所有 Generation/Workflow 的基数。失败后的新尝试必须新请求键、新 Generation/Call 身份；同键重放不调用适配器。

### 测试作品与固定授权

数据库 `test_novel_registration` 由可信初始化管理员显式登记真实 Novel FK，之后不可改删。普通运行角色不能将 `test=true` 当授权或改变作品分类；未登记作品的数据库入口独立拒绝。所有新测试生成操作还要求 `mode=test` 和 `AB_TEST_MODE=1`，普通配置不开放适配器。

原 manual_workflow_v1、compile_and_read_v1、novel.read 均不导出生成权。真实 author 使用现有四项管理权限显式发放 test_generation_v1，绑定原 context_grant、真实 writer 和已有规范化 Task Scope。发放时在稳定 gate 内以同一数据库时间取得实际四项支撑，完整计数并捕获最早有限截止，再与原上下文 Grant、请求截止取较早值。少项/撤销/到期不能解释为无限期；只有全部实际来源无限期且请求 null 时才能无限期。通用 grant:revoke 支持该固定新类型；四类授权 ID 双向防歧义。

### 可信适配器服务初始化

writer 只有准备、受控查询及中断权限，不能提交任意响应。宿主内部适配器使用**单独受限 LOGIN**，沿用 actor_principal/actor_role/session_user 映射，固定角色 test-adapter-executor。它非所有者、无高权限属性/成员关系/底表权限，只获身份自检及封装的 start/finish API；不获得设计、上下文、候选、校验、审批等公共业务入口。已有 validator/commit/projection 登录没有新增业务权限。

这个服务凭据仅保存在可信工具宿主，不能交给 writer，也不是 writer 请求字段；本地文件隔离不等于生产密钥管理。初始化仅限显式测试配置和实际 superuser，绝不在运行操作中回退到管理员。例：

```sh
AB_TEST_MODE=1 AB_CONFIG=config.admin.test.local.json pnpm db:test-generation-initialize --register-novel NOVEL_UUID
AB_TEST_MODE=1 AB_CONFIG=config.admin.test.local.json pnpm db:test-generation-initialize --executor-file executor-provision.local.json
```

executor-provision.local.json 精确字段为 login、password；使用此次安装唯一登录名和随机 24 字节以上口令，文件权限 0600。服务运行配置沿用现有七字段，但 mode=test、实例/数据库/地址须与 writer 相同，登录必须不同。它不持有 owner 或管理员凭据，既有 provisioning registry 不被改绑。CLI 使用宿主设置的 `AB_TEST_EXECUTOR_CONFIG=config.executor.test.local.json`；不得把它作为 Agent 参数或提交 Git。

### 命令与完整输入白名单

统一为 `AB_TEST_MODE=1 AB_CONFIG=config.身份.test.local.json pnpm book OP NOVEL_UUID request.local.json`。下表写操作及准备须 request_key；读操作无 request_key。generation:execute 另需宿主的 AB_TEST_EXECUTOR_CONFIG。

| 命令 | request 字段（除 request_key） | 权限／行为 |
|---|---|---|
| generation-grant:create | context_grant_id、expires_at（显式 null 或有限截止） | author 四项管理权限；固定 test_generation_v1，不接受任意能力／writer 覆盖 |
| test-workflow:create | generation_grant_id、bundle_ref、execution_mode=test_generation_v1 | 实际 writer；同原 Grant/Task/Bundle，固定人工/生成输入关系不可改绑 |
| generation:execute | workflow_ref、expected_selection_version、adapter_id=fixed-test-v1、parameters={"protocol":"test-parameters-v1","max_output_bytes":4096} | writer；准备提交后单次事务外执行，再由内部服务记录与接纳；不接受 Prompt、消息、正文或成功结果 |
| generation:prepare | 与 execute 相同 | 仅准备并真实 COMMIT，用于明确分阶段操作；重放不自动补调用 |
| generation:read | run_ref | writer；当前原授权/输入有效时只得状态、公开执行/候选引用和测试标记，不得原始响应绕过拒绝 |
| generation:history | workflow_ref | 同上；该 Workflow 执行状态历史，无原始设计或受限授权依据 |
| generation:interrupt | run_ref | writer（原授权/输入仍有效）或当前四项管理权限 author + request_key；可关闭失权后的未决调用，不能覆盖已接纳终态，也不承诺适配器物理取消 |
| generation:trace | workflow_ref | author 当前 design.read/task.read；受保护请求/响应、实际开始、计量、终态历史；合法历史不按当前输入删除 |
| generation:audit | 空对象 `{}` | auditor 当前 Novel audit.read；仅实际范围内元数据，统一 audit:read 同时包含这些记录 |

有效测试生成 Grant 足以创建该模式的 Workflow，不依赖人工写作 Grant。该模式使用固定 Bundle；不改变未来其他 Workflow 的 Bundle 基数。后续编辑/选择/读取沿用现有命令并检查测试生成 Grant、原上下文 Grant 和 Bundle 当前性。

### 实际字节、分阶段事务与状态

固定 Prompt 外壳 test-prompt-v1，只读取已经获准的 Bundle.payload_text；不回读原始设计、Task goal、秘密或检索补充。test-request-v1 使用 PostgreSQL 18 JSONB text 的精确 UTF-8：protocol/provider/model/prompt_version/parameter_protocol/固定 parameters/instruction/bundle_payload。真实渲染文本、SHA-256、字节数在 model_call 冻结，实际调用消费同一文本。

fixed-test-v1 实际返回 test-response-utf8-v1：固定 provider/adapter 标记 + LF、request-sha256=请求摘要 + LF、固定测试片段 + LF。Node 适配器执行这个确定性算法；数据库对实际响应再计算摘要，并核验固定协议后才允许接纳。它不模拟供应商身份或真实推理。测试计量 test-bytes-v1 只记请求/响应字节、实测单调时钟耗时；真实 token 为 NULL、费用 NULL 且 not_applicable_test。两秒取消信号及数据库开始期限共同限制本次接纳；未知调用事实仍须显式中断处置。

| 阶段 | 事务与真实持久化 | 可观察状态 |
|---|---|---|
| 准备 | writer 授权、检查当前 Bundle/选择，冻结 Generation/实际请求/Call 计划/幂等记录，真实 COMMIT 后结束连接 | execution=prepared；call=dispatch_not_recorded；admission=pending |
| 开始及事务外调用 | 内部服务唯一领取并提交 start_id/实际服务主体/时间/期限；关闭连接后执行固定适配器，无 gate/Novel/Workflow 锁或长事务 | call=started_result_unknown；没有响应不等于从未调用 |
| 记录与接纳 | 新短事务保存真实观察结果，重查实际 writer 两层授权、Task/Design/Bundle/发布/上下文策略/精确 hash 和原选择版本；条件满足才同事务写 Candidate/真实来源、终态及审计 | accepted，或 input_rejected/adapter_failed/technical_failed |
| 中断或迟到 | 追加 interrupted；迟到实际响应可保留，但终态不可重写、不得再产生候选 | admission=rejected；事实与接纳分开 |

状态由不可变输入、开始、结果和终态关系构成，不用单一 status 表示校验、审批或 Canon。操作记录成功的 ok=true 与 admission_state=accepted 分开；完整失败事实可成功保存，但没有可用候选。writer 已失权时返回固定拒绝，不返回原始响应；author 可按当前读取权追溯真实发生的事实。

准备/接纳/中断遵循 gate→Novel→Task→Workflow→追加记录；领取/最终事务之间关闭连接。期限在取得 gate 后按数据库时间判定，冻结选择版本使 A→B→A 仍拒绝。中途故障、延后 COMMIT 失败或外层回滚无半成品；若接纳技术事务失败，宿主使用独立受控事务保存已经观察到的真实结果及 technical_failed，不将回滚审计说成持久化。若连独立记录也失败，返回 CALL_RECORDING_UNCONFIRMED，不声称已保存。

### 中断、来源和兼容边界

- 准备提交后未调用：同键只返回原 prepared 状态，不补调用；显式 interrupt 后以新键重试。
- 调用开始但缺响应、响应已产生却未保存或进程被杀：保留 started_result_unknown；不能把重新计算的确定性输出冒充当时已观察的响应。不自动调用，显式终止后新执行。
- 响应已知但最终事务失败：独立事务记录实际响应及技术失败；没有部分候选。结果接纳已提交但响应丢失：同键返回已有结果，不再调用或创建候选。
- 不承诺数据库外恰好一次。数据库内每执行至多接纳一次，已有终态和迟到结果不能重启执行。实际服务凭据与宿主代码仍是信任边界。

Candidate 继续使用现有 candidate_version、exact-utf8-v1 和独立正文 SHA-256。test_generated 通过真实 Generation/Model Call FK 关联成功观察结果；正文只保存一份，不建第二套 Evidence。人工编辑保留同 Workflow 前序和 test_root_generation_id，不伪造新的调用。既有 edited_by 对生成记录仅表示实际请求 writer 的归属，实际执行服务主体在开始/结果/审计单独保存，不冒充人工编辑。

生成和编辑都不自动选择或继承校验/审批。选择后沿用 005/006 的有限校验与显式人工审批，hard unknown/failed 不得批准；生成授权撤销也在同事务使相关批准失效。writer 输出、author 新审阅及审计明确 test_only/provider=test。新测试审阅为 approval-review-test-v1，按记录协议分派；approval-review-v1 的原重建字节和摘要保持，旧批准不因新增字段失效。

本段仅限登记测试作品及其测试来源链，不提供生产 Canon 准入。结构化提案/Assertion、相关 Evidence 全域整合、真实模型和剩余第二批能力仍未完成。实际状态与中断矩阵见 [本轮契约](verification/test-generation/generation-contract.md)，执行与未执行项见 [验收结果](verification/test-generation/run-result.md)。
