# Projection Attempt 生命周期原型一键运行报告

- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。
- PostgreSQL 镜像：`postgres:18.6`
- 实际镜像 digest：`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`
- PostgreSQL Server 版本：`18.6 (Debian 18.6-1.pgdg13+2)`
- 实际运行时间（Asia/Shanghai）：2026/10/19 13:02:18
- pnpm：11.18.0
- Docker：Docker version 29.4.0, build 9d7ad9f
- 最终退出码：0
- Node.js：`v22.23.2`
- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`
- 迁移命令：`pnpm run migrate:up`
- 测试命令：`pnpm test`
- 数据库就绪路径：宿主机 TCP `127.0.0.1:32837` 上执行 `SELECT 1`
- 测试数据库：`projection_attempt_lifecycle`
- 测试 Schema：`projection_attempt_fixture`
- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）
- 迁移命令退出码：`0`
- 测试命令退出码：`0`
- 测试结果状态：有效（11 个顶层测试；11 通过；0 失败；90 个参数化子场景）
- 运行状态：**成功**
- 容器清理结果：已删除本轮容器 projection-attempt-fixture-12677-1792386126631；未执行全局 Docker 清理
- 临时结果清理：运行前：结果文件不存在，无需清理；运行后：已删除 .test-results.json
- 报告写入状态：成功
- 最终退出条件：全部满足

## 场景结果

| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |
|---|---|---|---|---|---|
| A：领取身份、策略时间与可执行 Task | passed | 详见实测子场景 |  |  |  |
| A：成功、截止拒绝、过期与执行失败 | passed | 详见实测子场景 |  |  |  |
| B：重试新身份、旧 Worker 隔离与原子回滚 | passed | 详见实测子场景 |  |  |  |
| B：普通 DML 的身份、时间、终态及历史保护 | passed | 详见实测子场景 |  |  |  |
| C：完成路径锁等待跨过截止，必须在锁后重新取时 | passed | 详见实测子场景 |  |  |  |
| C：截止前接纳、截止后 COMMIT 或 ROLLBACK | passed | 详见实测子场景 |  |  |  |
| D：同一 Task 的领取、清理、成功及重试竞争 | passed | 详见实测子场景 |  |  |  |
| D：不同 Task 操作首次异步提交，无死锁重试 | passed | 详见实测子场景 |  |  |  |
| E：来源绑定与 Task 状态保护 | passed | 详见实测子场景 |  |  |  |
| E：状态与审计同事务，审计不可伪造或删除 | passed | 详见实测子场景 |  |  |  |
| E：public 路径直连及数据库实际元数据 | passed | 详见实测子场景 |  |  |  |

## 参数化子场景统计

| 分组 | 子场景数 |
|---|---:|
| A：领取身份、策略时间与可执行 Task | 6 |
| A：成功、截止拒绝、过期与执行失败 | 4 |
| B：重试新身份、旧 Worker 隔离与原子回滚 | 6 |
| B：普通 DML 的身份、时间、终态及历史保护 | 25 |
| C：完成路径锁等待跨过截止，必须在锁后重新取时 | 2 |
| C：截止前接纳、截止后 COMMIT 或 ROLLBACK | 2 |
| D：同一 Task 的领取、清理、成功及重试竞争 | 7 |
| D：不同 Task 操作首次异步提交，无死锁重试 | 3 |
| E：来源绑定与 Task 状态保护 | 21 |
| E：状态与审计同事务，审计不可伪造或删除 | 9 |
| E：public 路径直连及数据库实际元数据 | 5 |
| 合计 | 90 |

## 实测子场景与失败阶段

| 分组 / 子场景 | 状态 | 阶段 | SQLSTATE | 约束 | 证据 |
|---|---|---|---|---|---|
| A：领取身份、策略时间与可执行 Task / 首次领取与未过期重复领取 | passed |  |  |  | created→in_progress，同一 attempt_id=6e8d5e98-671f-46aa-92cb-2d108db521af；时长来自策略 30000ms；单一 processing |
| A：领取身份、策略时间与可执行 Task / 不同 Task 可使用相同 worker_version | passed |  |  |  | 两个不同 Task 各自首次领取成功；worker_version 相同，执行身份不同 |
| A：领取身份、策略时间与可执行 Task / completed 不自动恢复 | passed | direct INSERT | 55000 | projection_task_not_executable | 入口返回 task_not_executable；普通 INSERT 同样拒绝；无 Attempt/审计残留 |
| A：领取身份、策略时间与可执行 Task / cancelled 不自动恢复 | passed | direct INSERT | 55000 | projection_task_not_executable | 入口返回 task_not_executable；普通 INSERT 同样拒绝；无 Attempt/审计残留 |
| A：领取身份、策略时间与可执行 Task / abandoned 不自动恢复 | passed | direct INSERT | 55000 | projection_task_not_executable | 入口返回 task_not_executable；普通 INSERT 同样拒绝；无 Attempt/审计残留 |
| A：领取身份、策略时间与可执行 Task / needs_rebuild 不自动恢复 | passed | direct INSERT | 55000 | projection_task_not_executable | 入口返回 task_not_executable；普通 INSERT 同样拒绝；无 Attempt/审计残留 |
| A：成功、截止拒绝、过期与执行失败 / 截止前成功、幂等回读与终态不改写 | passed |  |  |  | accepted_success→idempotent_success；截止后 2026-10-19 05:02:09.669761+00 仍 succeeded；ended_at=2026-10-19 05:02:09.326852+00 < expires_at=2026-10-19T05:02:09.66888+00:00 |
| A：成功、截止拒绝、过期与执行失败 / 截止前不能过期，截止后清理前不能成功 | passed |  |  |  | 数据库时间=2026-10-19 05:02:10.028025+00 >= expires_at=2026-10-19T05:02:10.019984+00:00；清理前成功入口返回 deadline_elapsed，无结果写入；expired ended_at=2026-10-19 05:02:10.085307+00 |
| A：成功、截止拒绝、过期与执行失败 / retryable_failure | passed |  |  |  | failure_recorded；原失败详情保留；重试返回 retried，不将旧 Attempt 改回 processing |
| A：成功、截止拒绝、过期与执行失败 / permanent_failure | passed |  |  |  | failure_recorded；原失败详情保留；重试返回 not_retryable，不将旧 Attempt 改回 processing |
| B：重试新身份、旧 Worker 隔离与原子回滚 / expired | passed |  |  |  | 新 attempt_id=856a98c1-0626-4cc1-903a-82f2e7c04a42, attempt_no=2, Task不变；旧ID回写仅返回 already_terminal，不影响新执行 |
| B：重试新身份、旧 Worker 隔离与原子回滚 / processing_overdue | passed |  |  |  | 新 attempt_id=155e7cde-17f7-4edb-8219-505a857bba11, attempt_no=2, Task不变；旧ID回写仅返回 already_terminal，不影响新执行 |
| B：重试新身份、旧 Worker 隔离与原子回滚 / retryable_failure | passed |  |  |  | 新 attempt_id=774349bd-bf49-49d2-a65f-cd2e06db7aaa, attempt_no=2, Task不变；旧ID回写仅返回 already_terminal，不影响新执行 |
| B：重试新身份、旧 Worker 隔离与原子回滚 / 未过期不能重试 | passed |  |  |  | in_progress，无新 Attempt/审计 |
| B：重试新身份、旧 Worker 隔离与原子回滚 / 过期与重试一起回滚/ROLLBACK | passed |  |  |  | 事务内已创建 0b90216c-12b4-4cd0-9c93-82cce14e47aa 并终结旧 Attempt；ROLLBACK 后独立连接仅见原 processing，expired/retried 审计均消失 |
| B：重试新身份、旧 Worker 隔离与原子回滚 / 过期与重试一起回滚/insert_failure | passed | retry INSERT CHECK | 23514 | ck_projection_attempt_worker | new row for relation "projection_attempt" violates check constraint "ck_projection_attempt_worker" |
| B：普通 DML 的身份、时间、终态及历史保护 / attempt_id 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / task_id 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / attempt_no 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / previous_attempt_id 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / worker_version 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / started_at 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / expires_at 不可改写 | passed | UPDATE | 23514 | projection_attempt_identity | Attempt identity, input binding, worker version and deadline are immutable |
| B：普通 DML 的身份、时间、终态及历史保护 / 直接 INSERT 伪造 succeeded | passed | INSERT | 23514 | projection_attempt_initial_state | New Attempts must start processing |
| B：普通 DML 的身份、时间、终态及历史保护 / 不能自己指定领取时间 | passed | INSERT | 23514 | projection_attempt_time_authority | Worker-supplied creation or acceptance times are forbidden |
| B：普通 DML 的身份、时间、终态及历史保护 / 第二个 processing 不能直接 INSERT | passed | INSERT | 55000 | projection_attempt_in_progress | An unexpired processing Attempt already exists |
| B：普通 DML 的身份、时间、终态及历史保护 / UPDATE 伪造 ended_at/succeeded | passed | UPDATE | 23514 | projection_attempt_time_authority | Only the locked database transition assigns ended_at |
| B：普通 DML 的身份、时间、终态及历史保护 / UPDATE 伪造 ended_at/retryable_failure | passed | UPDATE | 23514 | projection_attempt_time_authority | Only the locked database transition assigns ended_at |
| B：普通 DML 的身份、时间、终态及历史保护 / UPDATE 伪造 ended_at/expired | passed | UPDATE | 23514 | projection_attempt_time_authority | Only the locked database transition assigns ended_at |
| B：普通 DML 的身份、时间、终态及历史保护 / 成功结果必须完整/[null,"fixture://result/one"] | passed | success UPDATE CHECK | 23514 | ck_projection_attempt_lifecycle | new row for relation "projection_attempt" violates check constraint "ck_projection_attempt_lifecycle" |
| B：普通 DML 的身份、时间、终态及历史保护 / 成功结果必须完整/["sha256:fixture-result",null] | passed | success UPDATE CHECK | 23514 | ck_projection_attempt_lifecycle | new row for relation "projection_attempt" violates check constraint "ck_projection_attempt_lifecycle" |
| B：普通 DML 的身份、时间、终态及历史保护 / 成功结果必须完整/[" ","fixture://result/one"] | passed | success UPDATE CHECK | 23514 | ck_projection_attempt_lifecycle | new row for relation "projection_attempt" violates check constraint "ck_projection_attempt_lifecycle" |
| B：普通 DML 的身份、时间、终态及历史保护 / 成功结果必须完整/["sha256:fixture-result"," "] | passed | success UPDATE CHECK | 23514 | ck_projection_attempt_lifecycle | new row for relation "projection_attempt" violates check constraint "ck_projection_attempt_lifecycle" |
| B：普通 DML 的身份、时间、终态及历史保护 / 历史 DELETE | passed | DELETE | 23514 | projection_attempt_immutable | Attempt execution history is append-only |
| B：普通 DML 的身份、时间、终态及历史保护 / 历史 TRUNCATE | passed | TRUNCATE | 23514 | projection_attempt_immutable | Attempt execution history is append-only |
| B：普通 DML 的身份、时间、终态及历史保护 / 终态不可改写/succeeded | passed |  |  |  | 终态 succeeded 的状态、结果、时间覆盖均拒绝；失败入口返回 already_terminal，独立连接历史完全相同 |
| B：普通 DML 的身份、时间、终态及历史保护 / 终态不可改写/expired | passed |  |  |  | 终态 expired 的状态、结果、时间覆盖均拒绝；失败入口返回 already_terminal，独立连接历史完全相同 |
| B：普通 DML 的身份、时间、终态及历史保护 / 终态不可改写/retryable_failure | passed |  |  |  | 终态 retryable_failure 的状态、结果、时间覆盖均拒绝；失败入口返回 already_terminal，独立连接历史完全相同 |
| B：普通 DML 的身份、时间、终态及历史保护 / 终态不可改写/permanent_failure | passed |  |  |  | 终态 permanent_failure 的状态、结果、时间覆盖均拒绝；失败入口返回 already_terminal，独立连接历史完全相同 |
| B：普通 DML 的身份、时间、终态及历史保护 / 无变化 UPDATE 允许且不新增终态审计 | passed |  |  |  | 终态原值 UPDATE 真实提交成功，审计数量/时间/结果均不变 |
| B：普通 DML 的身份、时间、终态及历史保护 / 普通 DML 合法转换也使用数据库时间及原子审计 | passed |  |  |  | 普通 INSERT 不能传入时间；合法 UPDATE 由数据库写 ended_at，并与 succeeded 审计同事务提交 |
| C：完成路径锁等待跨过截止，必须在锁后重新取时 / projection_task | passed | success operation after lock wait |  |  | 发起=2026-10-19 05:02:11.838625+00 < 截止=2026-10-19T05:02:13.230045+00:00；阻塞={"pid":258,"state":"active","query_start":"2026-10-19 05:02:11.838838+00","xact_start":"2026-10-19 05:02:11.837502+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[257],"observed_at":"2026-10-19 05:02:11.839461+00"}；数据库时间=2026-10-19 05:02:13.233866+00 >= 截止后先释放 holder PID=257，worker PID=258 才继续，返回 deadline_elapsed 并 COMMIT；无结果/成功审计 |
| C：完成路径锁等待跨过截止，必须在锁后重新取时 / projection_attempt | passed | success operation after lock wait |  |  | 发起=2026-10-19 05:02:13.292255+00 < 截止=2026-10-19T05:02:14.682493+00:00；阻塞={"pid":264,"state":"active","query_start":"2026-10-19 05:02:13.292458+00","xact_start":"2026-10-19 05:02:13.290977+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[265],"observed_at":"2026-10-19 05:02:13.309954+00"}；数据库时间=2026-10-19 05:02:14.692987+00 >= 截止后先释放 holder PID=265，worker PID=264 才继续，返回 deadline_elapsed 并 COMMIT；无结果/成功审计 |
| C：截止前接纳、截止后 COMMIT 或 ROLLBACK / COMMIT | passed | COMMIT |  |  | 接受 ended_at=2026-10-19T05:02:14.784221+00:00 < expires_at=2026-10-19T05:02:15.221088+00:00；未提交时独立观察仍为 processing、无结果和成功审计；数据库跨截止时间=2026-10-19 05:02:15.227342+00，COMMIT 后数据库时间=2026-10-19 05:02:15.231641+00；持久化状态=succeeded |
| C：截止前接纳、截止后 COMMIT 或 ROLLBACK / ROLLBACK | passed | ROLLBACK |  |  | 接受 ended_at=2026-10-19T05:02:15.307783+00:00 < expires_at=2026-10-19T05:02:15.743713+00:00；未提交时独立观察仍为 processing、无结果和成功审计；数据库跨截止时间=2026-10-19 05:02:15.747177+00，ROLLBACK 后数据库时间=2026-10-19 05:02:15.748731+00；持久化状态=processing |
| D：同一 Task 的领取、清理、成功及重试竞争 / 两个领取者 | passed | claim / COMMIT |  |  | A PID=281, B PID=280; 阻塞={"pid":280,"state":"active","query_start":"2026-10-19 05:02:15.80443+00","xact_start":"2026-10-19 05:02:15.799692+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[281],"observed_at":"2026-10-19 05:02:15.805558+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=created/in_progress |
| D：同一 Task 的领取、清理、成功及重试竞争 / 两个过期清理者 | passed | expire / COMMIT |  |  | A PID=287, B PID=288; 阻塞={"pid":288,"state":"active","query_start":"2026-10-19 05:02:15.959054+00","xact_start":"2026-10-19 05:02:15.953439+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[287],"observed_at":"2026-10-19 05:02:15.977575+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=expired/already_terminal |
| D：同一 Task 的领取、清理、成功及重试竞争 / 成功与过期/success 先取得锁 | passed | success vs expire / COMMIT |  |  | A PID=293, B PID=292; 阻塞={"pid":292,"state":"active","query_start":"2026-10-19 05:02:16.033656+00","xact_start":"2026-10-19 05:02:16.030212+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[293],"observed_at":"2026-10-19 05:02:16.034558+00"}；数据库跨截止=2026-10-19 05:02:16.629534+00；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=accepted_success/already_terminal |
| D：同一 Task 的领取、清理、成功及重试竞争 / 成功与过期/expire 先取得锁 | passed | success vs expire / COMMIT |  |  | A PID=300, B PID=301; 阻塞={"pid":301,"state":"active","query_start":"2026-10-19 05:02:16.807962+00","xact_start":"2026-10-19 05:02:16.802088+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[300],"observed_at":"2026-10-19 05:02:16.810069+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=expired/already_terminal |
| D：同一 Task 的领取、清理、成功及重试竞争 / 两个重试者 | passed | retry / COMMIT |  |  | A PID=307, B PID=306; 阻塞={"pid":306,"state":"active","query_start":"2026-10-19 05:02:16.881379+00","xact_start":"2026-10-19 05:02:16.878528+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[307],"observed_at":"2026-10-19 05:02:16.882539+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=retried/superseded；仅一个新 ID 和 attempt_no=2，processing 总数=1 |
| D：同一 Task 的领取、清理、成功及重试竞争 / 旧 Worker 完成与过期重试/old_worker 先取得锁 | passed | old completion vs retry / COMMIT |  |  | A PID=314, B PID=315; 阻塞={"pid":315,"state":"active","query_start":"2026-10-19 05:02:17.026062+00","xact_start":"2026-10-19 05:02:17.022364+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[314],"observed_at":"2026-10-19 05:02:17.02702+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=deadline_elapsed/retried；新执行 ID=c9ff82dd-76d1-43aa-b197-bfe64116d176；旧 ID 无法写新结果 |
| D：同一 Task 的领取、清理、成功及重试竞争 / 旧 Worker 完成与过期重试/retry 先取得锁 | passed | old completion vs retry / COMMIT |  |  | A PID=321, B PID=322; 阻塞={"pid":322,"state":"active","query_start":"2026-10-19 05:02:17.193195+00","xact_start":"2026-10-19 05:02:17.18759+00","wait_event_type":"Lock","wait_event":"transactionid","blockers":[321],"observed_at":"2026-10-19 05:02:17.194404+00"}；；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=retried/already_terminal；新执行 ID=a2e40998-68c0-44a2-bb28-d953b2c2b952；旧 ID 无法写新结果 |
| D：不同 Task 操作首次异步提交，无死锁重试 / claim | passed | first asynchronous COMMIT |  |  | PID=327,328; 返回=created,created；观察=[{"pid":327,"blockers":[]},{"pid":328,"blockers":[]}]；首次异步 COMMIT 均成功，无重试，独立连接回读各 Task 的历史与审计 |
| D：不同 Task 操作首次异步提交，无死锁重试 / success | passed | first asynchronous COMMIT |  |  | PID=336,335; 返回=accepted_success,accepted_success；观察=[{"pid":335,"blockers":[]},{"pid":336,"blockers":[]}]；首次异步 COMMIT 均成功，无重试，独立连接回读各 Task 的历史与审计 |
| D：不同 Task 操作首次异步提交，无死锁重试 / retry | passed | first asynchronous COMMIT |  |  | PID=347,348; 返回=retried,retried；观察=[{"pid":347,"blockers":[]},{"pid":348,"blockers":[]}]；首次异步 COMMIT 均成功，无重试，独立连接回读各 Task 的历史与审计 |
| E：来源绑定与 Task 状态保护 / projection_task.task_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.project_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.outbox_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.origin_type | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.target | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.scope_hash | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_task.strategy_version | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.canon_commit_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.project_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.scope_hash | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.source_canon_watermark | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.strategy_version | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_outbox.target | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / projection_policy.timeout_ms | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / canon_commit.project_id | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / canon_commit.canon_watermark | passed | UPDATE | 23514 | projection_input_immutable | Source, target, scope, policy and project bindings are immutable |
| E：来源绑定与 Task 状态保护 / 新 Task 映射错误/project_id | passed | Task INSERT | 23514 | projection_source_mapping | Task must preserve Outbox project, target, scope and strategy |
| E：来源绑定与 Task 状态保护 / 新 Task 映射错误/target | passed | Task INSERT | 23514 | projection_source_mapping | Task must preserve Outbox project, target, scope and strategy |
| E：来源绑定与 Task 状态保护 / 新 Task 映射错误/scope_hash | passed | Task INSERT | 23514 | projection_source_mapping | Task must preserve Outbox project, target, scope and strategy |
| E：来源绑定与 Task 状态保护 / 新 Task 映射错误/strategy_version | passed | Task INSERT | 23514 | projection_source_mapping | Task must preserve Outbox project, target, scope and strategy |
| E：来源绑定与 Task 状态保护 / 原值输入 UPDATE 合法，取消 Task 不自动恢复 | passed | Task UPDATE | 23514 | projection_task_terminal | Non-pending Tasks cannot automatically resume |
| E：状态与审计同事务，审计不可伪造或删除 / expired 回滚 | passed |  |  |  | expired 和对应审计在事务内存在，ROLLBACK 后独立连接仅见 processing/claimed |
| E：状态与审计同事务，审计不可伪造或删除 / retryable_failure 回滚 | passed |  |  |  | retryable_failure 和对应审计在事务内存在，ROLLBACK 后独立连接仅见 processing/claimed |
| E：状态与审计同事务，审计不可伪造或删除 / permanent_failure 回滚 | passed |  |  |  | permanent_failure 和对应审计在事务内存在，ROLLBACK 后独立连接仅见 processing/claimed |
| E：状态与审计同事务，审计不可伪造或删除 / 首次领取回滚不留下执行或 claimed 审计 | passed |  |  |  | Attempt 与 claimed 审计全部回滚 |
| E：状态与审计同事务，审计不可伪造或删除 / 审计 UPDATE | passed | UPDATE | 23514 | projection_attempt_audit_immutable | Execution audit is append-only |
| E：状态与审计同事务，审计不可伪造或删除 / 审计 DELETE | passed | DELETE | 23514 | projection_attempt_audit_immutable | Execution audit is append-only |
| E：状态与审计同事务，审计不可伪造或删除 / 审计 TRUNCATE | passed | TRUNCATE | 23514 | projection_attempt_audit_immutable | Execution audit is append-only |
| E：状态与审计同事务，审计不可伪造或删除 / 审计 INSERT 不得伪造成功历史 | passed | audit INSERT | 23514 | projection_attempt_audit_mapping | Audit must describe the actual locked transition |
| E：状态与审计同事务，审计不可伪造或删除 / 审计无变化 UPDATE 不改变历史 | passed |  |  |  | 原值审计 UPDATE 合法，未生成新审计 |
| E：public 路径直连及数据库实际元数据 / public 合法提交、截止拒绝和终态保护 | passed | public direct UPDATE | 55000 | projection_attempt_deadline | 所有连接为全新 pg.Client，search_path=public、全限定业务对象；合法提交和 23514/projection_attempt_terminal 终态保护均验证；Success acceptance deadline elapsed |
| E：public 路径直连及数据库实际元数据 / 函数路径及 invoker 权限 | passed |  |  |  | 实际 pg_proc=[{"proname":"accept_success","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"attempt_response","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"audit_attempt_transition","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"claim_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"expire_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"guard_attempt_audit","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"guard_attempt_insert","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"guard_attempt_update","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"lock_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"protect_projection_inputs","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"record_failure","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"reject_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"retry_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false},{"proname":"transition_attempt","proconfig":["search_path=pg_catalog, projection_attempt_fixture, pg_temp"],"prosecdef":false}] |
| E：public 路径直连及数据库实际元数据 / Attempt 编号唯一与单一 processing 部分唯一索引 | passed |  |  |  | [{"conname":"uq_projection_attempt_number","definition":"UNIQUE (task_id, attempt_no)"}]；{"indisunique":true,"definition":"CREATE UNIQUE INDEX uq_projection_attempt_processing ON projection_attempt_fixture.projection_attempt USING btree (task_id) WHERE (status = 'processing'::text)"} |
| E：public 路径直连及数据库实际元数据 / 关键触发器实际挂载与严格比较符号 | passed |  |  |  | 实际触发器=[{"relname":"projection_attempt_audit","tgname":"attempt_audit_guard","tgtype":31},{"relname":"projection_attempt_audit","tgname":"attempt_audit_no_truncate","tgtype":34},{"relname":"projection_attempt","tgname":"attempt_insert_guard","tgtype":7},{"relname":"projection_attempt","tgname":"attempt_no_truncate","tgtype":34},{"relname":"projection_attempt","tgname":"attempt_transition_audit","tgtype":21},{"relname":"projection_attempt","tgname":"attempt_update_guard","tgtype":27},{"relname":"canon_commit","tgname":"canon_commit_inputs","tgtype":31},{"relname":"canon_commit","tgname":"canon_commit_no_truncate","tgtype":34},{"relname":"projection_outbox","tgname":"projection_outbox_inputs","tgtype":31},{"relname":"projection_outbox","tgname":"projection_outbox_no_truncate","tgtype":34},{"relname":"projection_policy","tgname":"projection_policy_inputs","tgtype":31},{"relname":"projection_policy","tgname":"projection_policy_no_truncate","tgtype":34},{"relname":"projection_task","tgname":"projection_task_inputs","tgtype":31},{"relname":"projection_task","tgname":"projection_task_no_truncate","tgtype":34}]；拒绝成功 >= 截止，拒绝过期 < 截止；锁后 clock_timestamp，成功接纳为严格 <，过期为 >= |
| E：public 路径直连及数据库实际元数据 / 业务 FK 仅限独立 Schema，无 Checkpoint/Rebuild/外部投影对象 | passed |  |  |  | 本 Schema 表=canon_commit,pgmigrations,project,projection_attempt,projection_attempt_audit,projection_outbox,projection_policy,projection_task；11 个 FK 全部在本 Schema，无外部来源借用 |

## 范围声明

- 本原型验证普通 Outbox Task 的 Attempt 领取、截止接纳、过期、失败及重试竞争。
- 不代表正式生产 Schema；不实现 Checkpoint、水位推进、staging→active 发布、真实 Worker、外部投影数据库、完整 Outbox 消费、完整 Canon Commit 或生产部署。
