# 第七段 A 契约

- 仅 `candidate` 域，断言类型 `narrated_claim_v1`；登记来源 `human-curation-v1`。人工、测试生成及其人工编辑的真实 Candidate 均可作为来源；不创建 Generation/Model Call 占位记录。
- 精确定位 `{"format":"utf8-byte-range-v1","start":0,"end":3}`：0 起点 UTF-8 字节半开区间 `[start,end)`，非空，不超过真实保存正文；起止均须为字符边界。逐字节核对 quote，不 trim、不转换换行、不做 Unicode 规范化。组合字符可以在两个完整码点之间分界，本协议不宣称以字素簇计数。
- 服务端重新计算 Candidate 的 SHA-256 并核对 exact-utf8-v1 的正文/hash/字节数。断言内容上限 16384 UTF-8 字节，正文仍沿用 262144 字节输入保护边界。
- 摘要协议 `assertion-jsonb-v1`：UTF-8 编码 `assertion-jsonb-v1:<kind>\n` 加 PostgreSQL jsonb::text 的固定字段对象；kind 为 content 或 request。content 字段集合以 `_na_payload` 为准，涵盖 Novel/Workflow/Candidate、实际正文 hash、类型、内容、extractor、定位和 quote；不包含新 UUID 或登记时间。请求包含 operation、Novel 和原 request，键顺序由 jsonb 固定。不是跨数据库实现的通用 canonical JSON 协议。
- 相同 Candidate、断言内容摘要、extractor 复用不可变断言；新内容/定位产生新记录。请求键按主体/Novel/操作/Candidate 隔离，同键异请求拒绝，重放仍检查当前权限与输入。
- 共同 Evidence 保留完整六字段身份 `(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind)`。Design 三类继续使用 whole:v1/author_intent；Candidate 仅 candidate_version/candidate_text_v1 和 narrative_assertion/narrative_assertion_v1，版本均为真实 Candidate ID，locator 为 `utf8-byte-range-v1:<start>:<end>`。消费方不进入身份。
- 所有 Evidence 在 Design/Candidate 两支撑表合计恰一。父/支撑类型、对象、版本、Novel、Workflow、Assertion→Candidate 来源关系全部校验。Assertion 必须有 Candidate 来源和两类 Evidence 关联；缺少时真实 COMMIT 失败。008 在同一迁移事务内替换旧的强制 Design FK/CHECK，验证已有行，保留 Design 类型专属 FK 与原六字段唯一键。
- 登记权限：真实 session_user 映射的 author，当前 design.read/design.freeze/task.read/task.create 四项均有效；不补发能力。历史读取：当前 design.read/task.read。auditor：Novel audit.read，只看完整资源范围过滤后的执行元数据。writer/validator/executor/commit/projection 无新入口或底表权限。
- 锁顺序：authorization gate → Novel → Task → Workflow；取得锁后用数据库 clock_timestamp() 重新核对实际 writer 两层授权及 Bundle/Design/Task/策略/发布当前性。来源 FK 和唯一索引不额外排他锁 Candidate；单独的完整性并发试验使用真实数据库唯一键裁决，不依赖 BEFORE ROW 的取锁顺序。
- 权限拒绝在读取载荷前；无效字段/定位在受控写子事务中拒绝并回滚其部分写入；类型专属 CHECK/FK 在语句时拒绝；缺支撑/关联、父子来源完整性在真实 COMMIT 拒绝；技术提交失败整体回滚。业务拒绝审计通过受控返回结果提交；不把回滚审计当作持久化。
- API：`assertion:register`、`candidate-evidence:register`、`assertion:history`、`assertion:audit`；见根 README 的精确参数。历史记录、来源、关联、请求和审计拒绝 UPDATE/DELETE/TRUNCATE；普通运行身份无底表权限、无 helper 执行权。
- 本轮不扩展旧 Validation/Approval 覆盖，不修改旧审阅/摘要协议；旧批准未审阅这些新断言。定位正确只证明原文引用与归属，不证明命题语义真实，不代表 Canon 权威。后续结构化产物必须另做集合冻结及校验/审批绑定。

008 同时收紧旧 Context Evidence 审计的域判断：即使 Candidate ID 与 Design Revision ID 合法相等，也要求 author_design 和真实 Design 支撑，不因父表扩域将 Candidate ID 当成设计来源。保留原任务/资源范围检查，不改写历史审计。
