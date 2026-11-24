# Time Interval 来源绑定约束原型

## 目的

本原型实现并验证 `docs/15-database-implementation-plan.md` 第一批范围：Time Interval 来源绑定及其最小依赖夹具。

它不是正式生产 Schema，不实现 Evidence、Projection Attempt、完整 Canon Commit、Agent 或应用界面。数据库对象集中在独立 PostgreSQL Schema `time_interval_constraint_fixture`，用于验证真实数据库的外键、类型目标组合、延后约束触发器、提交/回滚和并发行为。

## 固定参数

- PostgreSQL 镜像标签：`postgres:18.6`
- 实际镜像 digest：由运行脚本读取并写入 `verification/runner-result.md`
- Node.js：要求 `>=22.23.2`
- 迁移工具：`node-pg-migrate@9.0.0`
- PostgreSQL 客户端：`pg@8.23.0`
- 测试：Node.js 内置 `node:test`
- 测试事务隔离级别：`READ COMMITTED`
- 端口：仅绑定 `127.0.0.1` 的随机端口
- 凭据：运行时随机生成，不进入日志、仓库或结果报告

## 前置条件

- Node.js `22.23.2` 或兼容版本
- pnpm `11.x`
- Docker Engine 可用
- 本地允许启动和删除一次性 PostgreSQL 容器

本目录已包含固定依赖和 `pnpm-lock.yaml`。若依赖未安装，先在本目录执行 `pnpm install --frozen-lockfile`。

## 一键执行

```bash
pnpm prototype
```

该命令依次执行：

1. 检查固定镜像并记录 digest；
2. 启动一次性 PostgreSQL `18.6` 容器；
3. 通过宿主机映射的 `127.0.0.1:<随机端口>` 执行真实 `SELECT 1`，在统一的 30 秒总期限内限制连接、查询、重试等待和探测连接关闭；该短超时只用于就绪探测，不应用于建库、迁移或业务测试；
4. 创建本轮空数据库；
5. 从空库执行迁移；
6. 运行全部 Node 测试；
7. 删除本轮容器；
8. 生成 `verification/runner-result.md`。

脚本在测试开始前删除本原型自己的旧 `.test-results.json`，并在报告生成前再次清理该临时文件；文件不存在视为无需清理，其他错误会写入报告。脚本只删除它自己创建的容器，不执行全局 Docker 清理。

一键流程只有在迁移成功、测试命令成功、有效结果中的全部场景均为 `passed`、本轮容器和临时结果文件均已确认清理、且运行报告成功写入时才返回退出码 `0`。测试失败、未取得有效结果和“测试通过但资源清理失败”会分别记录，后续清理成功不会覆盖先前失败。

## 夹具与正式 Schema 的差异

夹具保留 Time Interval 约束验证所需的项目、Author Design Revision、Workflow Run、Candidate Version、Canon Commit、来源对象及容器归属字段，但不包含正式业务系统的全部字段、权限、审计、Evidence、Projection、Canon Commit 18 步或生产索引布局。夹具表和函数只服务于本轮约束原型，不能直接作为生产迁移使用。

迁移创建：

- `time_interval`
- `time_interval_source`
- 八种来源类型的最小来源表
- 类型专属外键、CHECK 和非延后唯一约束
- 覆盖区间、绑定及来源对象写入的 `DEFERRABLE INITIALLY DEFERRED` 约束触发器

`time_interval` 不保存 `source_binding_id`；`time_interval_source.time_interval_id` 为必填外键并具有非延后唯一约束。

## 未覆盖能力

- Evidence 完整来源身份和跨表唯一性
- Projection Attempt 成功接受、过期和 Checkpoint 推进
- 完整 Canon Commit 原子事务
- 正式生产 Schema、备份、灾备、部署和连接池

## 结果

- `result-report.md` 是手工整理的审计报告，保留父子锁复现、修复边界和受保护文档哈希核验；`pnpm prototype` 不会覆盖它。
- `verification/runner-result.md` 是最近一次 `pnpm prototype` 一键运行生成的报告，动态记录实际 Node.js 版本、TCP 就绪路径、迁移/测试退出码和临时资源清理结果。
- `verification/verify-runner.mjs` 直接调用运行器导出的实际状态判定、清理和就绪探测逻辑，验证清理失败、结果包含 `failed` 及查询挂起等故障路径；结果写入 `verification/runner-fault-verification.md`，不计入数据库业务测试数量。
- 若本次测试未启动、异常退出、未生成新结果或结果无法解析，一键报告只显示“未取得有效测试结果”，不会展示先前运行的场景记录。

测试和结果报告在本地生成；本仓库不写入业务凭据或真实数据。

## 本轮并发归属保护

本轮在 PostgreSQL `18.6` 中复核了 Candidate Version 的父子行锁时机。数据库实验确认：`UPDATE candidate_version` 的目标 Candidate Version 行锁可能已经由执行器取得，然后才进入 `BEFORE ROW` 触发器；因此 `BEFORE ROW` 触发器不能保证“先锁 Workflow Run、再锁 Candidate Version”。旧的 `candidate_version_lock_before_write` 触发器已移除，不再把该执行顺序作为正确性前提。

### 当前机制

- Revision、Workflow Run、Candidate Version、Canon Commit 的项目归属和 Canon `committed` 状态属于容器身份/治理属性。相关身份变化由数据库 `BEFORE UPDATE` 触发器立即拒绝，使用 `SQLSTATE 23514` 和约束标识 `time_interval_source_complete`。
- Canon Commit 从 `committed` 回退到其他状态立即拒绝；`preparing → committed` 仍未被本原型禁止，但完整 Canon 提交协议不在本原型范围内。
- 对项目归属、Workflow Run 引用和 Canon 状态均未变化的无变化 UPDATE，不触发新的延后关系扫描；它不会改变任何事实或归属关系。
- 容器属性的延后校验仍使用 `FOR NO KEY UPDATE`；来源对象和 Time Interval 仍使用 `FOR UPDATE`。外键自动取得的父行 `KEY SHARE` 不再被校验阶段升级为 `FOR UPDATE`。

### 锁时机和等待位置

| 路径 | 原始 DML/FK 锁 | 触发器/校验阶段 | 可能等待位置 |
|---|---|---|---|
| Temporal 来源 INSERT | 来源对象对 Revision 的 FK `KEY SHARE` | Revision `FOR NO KEY UPDATE`；来源对象和区间 `FOR UPDATE` | Revision 正在被合法读取保护时等待 |
| Candidate 来源 INSERT | 来源对象对 Candidate Version 的 FK `KEY SHARE` | Workflow Run→Candidate Version 均为 `FOR NO KEY UPDATE`；来源对象和区间 `FOR UPDATE` | Workflow Run 或 Candidate Version 被保护时等待 |
| Canon 来源 INSERT | 来源对象对 Canon Commit 的 FK `KEY SHARE` | Canon Commit `FOR NO KEY UPDATE`；来源对象和区间 `FOR UPDATE` | Canon Commit 被保护时等待 |
| Candidate Version 相关身份 UPDATE | 执行器可能先取得 Candidate Version 目标行锁 | `BEFORE UPDATE` 立即拒绝实际身份/归属变化；无变化 UPDATE 跳过新的延后扫描 | 不再依赖 BEFORE ROW 先锁 Workflow Run |
| Workflow Run/Revision/Canon Commit 相关身份 UPDATE | 执行器取得目标容器行锁 | `BEFORE UPDATE` 立即拒绝实际身份/归属变化；无变化 UPDATE 跳过新的延后扫描 | 不形成“父行→子行”和“子行→父行”的校验锁循环 |

本原型不声称任意业务事务都不会死锁；当前结论只覆盖上述 Time Interval 来源完整性路径。来源对象、容器引用和区间关系在等待结束后仍按当前事务可见状态重新读取。`SET CONSTRAINTS ALL IMMEDIATE` 仅保留为既有确定性交错测试，默认合法创建路径使用真实 `COMMIT`。

测试“容器非法更新被即时拒绝后来源可合法创建”是顺序行为验证：先确认非法容器更新在语句阶段被拒绝，再创建并提交合法来源；它不再被描述为“容器先持锁”的并发测试。真正的并发覆盖仍由“来源绑定先持锁，容器后尝试”、合法共享容器创建和父子无变化更新场景承担。
