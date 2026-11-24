# Agent Book：正式底座、作者设计版本与场景任务

第一批实现 [DOC-16 第 4.1 节](docs/16-prototype-consolidation-and-implementation-plan.md#41-第一批工程与身份基础建立第一个正式可运行底座)：一个 Node.js 原生 ESM 模块化单体入口，一套正式 `agent_book` Schema、一份 `agent_book_meta.schema_migrations` 迁移账本，以及受限数据库登录、作品范围授权、撤销和最小审计。十三个 `prototypes/` 仍为只读历史工程证据，没有导入正式运行路径。

当前已完成第一批底座与 [第二批第一段](docs/16-prototype-consolidation-and-implementation-plan.md#42-第二批设计安全-bundle候选校验人工审批)：真实 author 可创建 Volume/Chapter/Scene 和稳定 Entity，创建设计草案、编辑、冻结并生效，再创建场景任务及追加版本、查询历史。只实现人物设计和有限作者规则格式；不实现 Bundle、Workflow、Generation、Candidate、Validation、Approval、Canon、Evidence 全域整合、投影或模型调用，不代表生产就绪。

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

`pnpm test` 显式调用 `--isolated` 验收：忽略用户的普通数据库配置，创建三个名称/口令/角色前缀均独立的临时 PostgreSQL 实例；校验镜像 digest，经有总期限的宿主 TCP `SELECT 1` 就绪检查后，分别验证空库 001→002、已有第一批作品/授权/撤销数据的升级，以及历史创建证据不足的安全失败。覆盖重复迁移、实际迁移失败阻断、真实受限身份、设计/任务版本竞争、真实 COMMIT 回滚、撤销竞争和安全输出。最后只删除本轮匹配标签的容器、匿名卷、临时配置/凭据/结果目录。没有全局 Docker 清理，也不自动连接或迁移现有数据库。

实际数量以 [第二批第一段正式验收](verification/design-task/run-result.md) 为准；[第一批历史验收](verification/foundation/run-result.md) 保持只读，顶层、参数化子场景与配置/运行器控制测试分别统计；它与旧原型报告独立。结果缺失、过期、无效、包含失败，或迁移/测试/报告/清理失败时，最终退出非零。`pnpm test:unit` 只跑配置/运行器控制测试，不连接数据库。验收不调用模型，不跑生产负载、连接池或灾备演练。

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
| writer | identity、read Novel | 有当前有效的指定 Novel `novel.read` 才能读取；不能创建、授权、读受限审计或直写表 |
| auditor | identity、read audit | 当前有效的指定 Novel `audit.read`；不能读底表或其他作品/越界资源事件 |
| validator / commit-service / projection-worker | 只有 identity | 尚无校验、提交、投影或其他业务入口 |

运行登录是真正的新 TCP 连接：非所有者、无超级用户/BYPASSRLS/CREATEDB/CREATEROLE、无任何角色成员关系。没有连接池。Actor 仅从 `session_user → actor_principal.db_login` 映射；请求 actor、角色或 GUC 不参与授权。采用 SECURITY DEFINER，固定 `pg_catalog,agent_book,pg_temp`（安装标记函数使用固定 meta 路径），受控 owner 持有，撤销 PUBLIC EXECUTE 和未来函数默认 PUBLIC 权限；登录只有必要 Schema USAGE 和 API EXECUTE，无业务底表读写。只读安装 UUID 函数不返回凭据/授权信息。未使用 RLS，不声称抵抗可信管理员/迁移者改 DDL。

## Scope、稳定锁与审计

`data_scope` 仅支持 `scope_kind=novel`，Novel FK 非空，格式为 `foundation-scope-v1`，默认 deny。缺少 Grant 表示无权，未传场景等维度不表示允许所有资源：此 Scope 只与已实现的能力组合使用；novel.read 仅元数据，新增设计/任务能力另行授权。授权 Scope 请求中的 Scene、人物视角、秘密、Canon 水位等维度仍一律拒绝；任务中经过真实关系校验的人物与场景是业务输入，不能提高权限；Schema 不用任意 JSON 保存授权条件。

新作品尚不存在，不能建立 Novel FK Scope。因此作者启动权限使用单独的 `novel_creation_authorization` 及其追加撤销记录，能力严格固定为 `novel.create`，只允许插入新身份；它不是全作品通配 Scope。初始化登记，身份/有效期不可改，运行接口不能自助发放/恢复；作者可用无主体参数的 `creation:revoke` 仅撤销自己的有效创建启动授权，既有作品权限仍由各 Novel Grant 决定。现有作品必须另有真实 Novel Scope Grant，创建入口不能指定他人、角色、权限内容或借新作品取得其他作品权限。

首批使用预先存在的单行 `authorization_gate`。已实现 API、授权 INSERT 和撤销 INSERT 都先锁它，锁后用一次数据库 `clock_timestamp()` 判断授权状态/有效期；随后才操作作品、Grant 和审计。此保守全局锁符合本地单用户底座范围，串行化不同 Novel 的已实现命令，尚未做吞吐优化。它不依赖不存在的撤销行，也不使用“BEFORE UPDATE 一定先锁父行”的假设。未来与 Novel/Workflow/Canon 锁的整合仍属 DOC-16 D06。

撤销先提交：等待的判定看到撤销而拒绝。许可操作先完成受保护判定：可以完成本次事务，撤销等待后生效，下一次拒绝。期限在取得锁后判断，等待跨过到期点不能放行。只承诺当前命令的锁序，不宣称未来全系统无死锁。

业务拒绝以固定 `{ok:false,error:ACCESS_DENIED}` 提交审计后返回；SQL 权限错误和技术异常使用安全错误标识，相关事务回滚，不冒充已持久化拒绝审计。默认日志只含 `event/operation/outcome/request_id`；CLI 错误和迁移诊断不附密码、连接串、请求、SQL 或参数。

审计首先检查记录的 Novel，再正向核对实际引用资源的 Novel。仅支持 none、真实 Novel 和真实作品 Grant；未知类型不能入库，也不作为默认可见。越界整条事件过滤，允许资源标识和无资源普通事件保留；原始受限记录不删不改。不会用 Grant 当前是否有效来抹去许可范围内的历史撤销审计。作者/审计/写作权限独立。

保护核验见 [保护结果](verification/foundation/protection-result.md)，文件清单见 [交付清单](verification/foundation/file-manifest.md)。本轮不修改 `docs/00`—`15`、十三个原型或历史归档，不执行 Git 暂存/提交/推送/reset/clean。第二批第一段已完成，安全 Bundle、候选及后续流程仍未开始；生产认证、密钥保管、生产部署、完整恢复及规模性能仍需后续评审与验收。

## 第二批第一段：设计与场景任务

### 追加迁移与已有作品升级

`001_foundation.mjs` 保持原字节，正式账本顺序追加 `002_design_task.mjs`。空库执行两组迁移；第一批数据库使用原 migrator 的 `pnpm db:migrate` 升级，再启动新版本 CLI。迁移成功前不要使用新客户端的作品创建协议；迁移路径、所有者、安装 UUID 与第一批相同，无第二个业务 Schema。

升级持有稳定授权锁，只根据唯一的 `novel.create/allow` 审计、相符 Novel 资源及实际 author Actor/Role 确认创建者；按真实 Novel Scope 补七项能力。创建者还必须同时有当前有效的原 `novel.read` 和 `grant.revoke`，新增授权到期时间不晚于这两项当前有效授权的最早到期时间。任一已撤销/到期/主体停用，则记录 `withheld_revoked_or_expired`，不补齐、不恢复。作者撤销新作品**创建启动权**不抹掉已有作品权限，沿用第一批契约。其他 author 和元数据 reader 不提升权限。

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
