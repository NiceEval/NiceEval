# Harbor：Job、Trial、reward 与 Hub

> 观察日期：2026-08-14
>
> 观察对象：Harbor Framework 公开仓库 `main` `ac398bbd`（2026-08-13），包版本 `0.21.0`；官方文档站滚动页
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

Harbor 是 Terminal-Bench 团队维护的 Agent 评测与优化框架。
用户用 `harbor run` 把 Agent 放进容器执行 Task，得到带 reward 的 Trial，再把 Trial 聚合成 Job。
同一套 Job / Trial 可以留在本地 `jobs/`，也可以上传到 [Harbor Hub](https://hub.harborframework.com)。

它不是同名的 [CNCF Harbor 镜像仓库](https://github.com/goharbor/harbor)，也不是外接 BI 后再画图的平台。

## 产品是什么

Harbor 的公共作者面是「Task 目录 + Job 配置 + Agent」。
用户写 Task、组成 Dataset、选择 Agent 与容器 `Environment`，再发起 Job。
Job 把配置展开成多个 Trial；每个 Trial 让一个 Agent 尝试一个 Task，并由 verifier 产出 reward。

```text
Task ─→ Dataset ─┐
Agent ───────────┼─→ Job ─→ Trial[] ─→ reward / artifact / trajectory
Environment ─────┘           │
                              ├─→ 本地 jobs/ 与 viewer
                              └─→ Harbor Hub
```

Harbor 没有名为 Run 的公共写入对象。
一次实验的用户身份是 Job，一次尝试的用户身份是 Trial；展开与 Regrade 的例外见
[Job 与 Trial 的关系](layers.md#job-与-trial-的关系)。

## 原生对象总图

[Core Concepts](https://harborframework.com/docs/core-concepts) 定义六个核心对象：

| 对象 | 产品定义 | 公开形状 |
|---|---|---|
| Task | 一条 instruction、一套容器 `Environment` 与一份 test 脚本 | 目录：`task.toml`、`instruction.md`、`environment/`、`tests/`，可选 `solution/` |
| Dataset | 一组 Task，通常对应一个 benchmark | 本地目录、registry 名，或 `org/name[@ref]` 包 |
| Agent | 完成 Task 的程序 | `BaseAgent` / `BaseInstalledAgent`；CLI 使用 `-a` |
| Environment | 容器运行时 | `BaseEnvironment`；默认 Docker，也可选 Daytona、Modal 等 |
| Trial | Agent 对一个 Task 的一次尝试；一次 rollout，产出 reward | `TrialConfig` 加一个 Trial 目录 |
| Job | 一组 Trial | `JobConfig`；可以包含多个 Dataset、Agent、Task 与 model |

## 用户怎样进入与返回结果

用户以 `harbor run` 发起 Job，再通过本地 `jobs/`、viewer、`harbor analyze` 或 Harbor Hub 返回结果。
`jobs/` 并非 opaque 根；官方文档直接展示 Job / Trial 的 JSON、Agent 输出、verifier 输出与 artifact。
命令形状分别见 [发起 Job](execution.md#发起-job)、[用户从哪里进入结果](reading-and-comparison.md#用户从哪里进入结果) 与
[Run Evals](https://harborframework.com/docs/run-jobs/run-evals)。

## 核心研究判断

| 问题 | Harbor 的选择 | 详细页面 |
|---|---|---|
| 一次实验与一次尝试是什么 | Job 是 Trial 的集合；Trial 保存一次 Task 尝试 | [原生层与对象关系](layers.md) |
| 运行怎样完成 | Job 展开并调度 Trial，verifier 产出 reward，`_finalize()` 收尾 Trial | [执行、失败与恢复](execution.md) |
| 哪个对象拥有事实 | Trial 的 `config` / `lock` / `result` 信封保存请求、锁定输入与运行事实 | [存储与权威事实](storage.md) |
| 怎样判断完成 | Trial 需要有效且含 `finished_at` 的 `result.json`；Job 查看自己的 `finished_at` | [执行、失败与恢复](execution.md#完成条件) |
| 哪些值是派生的 | Job 持久化 Metric 与合计，viewer 的摘要和比较网格在读取时计算 | [存储与权威事实](storage.md#权威事实派生值与-cache) |
| 怎样比较 | 本地 viewer 扫多个 Job；Hub 调 `get_comparison_data` | [读取、查询与比较](reading-and-comparison.md) |
| 怎样重评分 | Regrade 派生新的 Job / Trial，不改源 Trial | [执行、失败与恢复](execution.md#regrade) |
| 怎样演进旧数据 | reader 兼容旧 JSON；没有修改历史 Job / Trial 的用户 migrate | [Schema、兼容与 Migration](schema-and-migration.md) |

`JobResult.trial_results` 只在内存中聚合。
磁盘上的 Job `result.json` 故意不保存 Trial 列表，每个 Trial 由自己的目录保存事实。

## 页面导航

| 页面 | 独立回答的问题 |
|---|---|
| [原生层与对象关系](layers.md) | 作者输入、执行、判定、派生、读取与 Hub 分别是哪一层，Job / Trial 怎样关联 |
| [执行、失败与恢复](execution.md) | 一次 Job 的真实顺序、写入 owner、完成、原子性、retry、resume 与 regrade |
| [存储与权威事实](storage.md) | 本地目录、JSON 信封、Hub 表与 archive，以及权威事实、projection 和 cache 的边界 |
| [读取、查询与比较](reading-and-comparison.md) | viewer、终端、Hub、handoff、筛选、对齐、分组与比较怎样工作 |
| [Schema、兼容与 Migration](schema-and-migration.md) | 包、Task、lock、ATIF 与 Hub 的版本怎样演进，兼容读取是否改写历史 bytes |

## 与 NiceEval 的相似点

- 一次实验是集合，一次尝试是原子运行事实。Job 对应 Experiment / Run 集合，Trial 对应 Attempt。
- 判定与执行分离：reward 来自 verifier，Agent 轨迹另存。
- 源运行不可变：Regrade 派生新目录，不改源 bytes。
- 比较发生在读取侧，不要求先为图表修改持久格式。
- 完成态可以机器判断：Trial 有有效 `result.json`，Job / Hub Job 有 `finished_at`。
- 远程分享是可选副本，本地目录自己就能打开。

## 与 NiceEval 的差异

| Harbor | NiceEval 需要对齐的点 |
|---|---|
| `jobs/` 是用户可读目录，文档直接教人查看 JSON | Record root 对用户保持 opaque；入口是 `niceeval show` / `view` |
| 没有独立 Analysis 对象；Metric 写回 `JobResult` | Analysis 与 Report 应能重跑，不必改 Record |
| 缺 reward 当作 0 | 需要显式 missing、partial 与 unsupported |
| 使用 Task 名对齐 | 需要对齐身份，而不是显示名 |
| `harbor task migrate` 只处理题目格式 | `niceeval migrate` 只处理 Record，并且必须显式授权 |
| Hub schema 未公开，由平台升级 | 用户持有 portable Record；升级必须可计划、可拒绝 |
| `analysis.json` 是后补 LLM 摘要 | 不能把它当成 verifier 的权威判定 |
| Trial 失败仍可能写出 `result.json` | 完成与 errored 必须能够同时存在，不能把 partial 目录当成权威 |

## 可吸收约束

1. **稳定信封，少升版。** Harbor 用 `config` / `lock` / `result` 分开请求、锁定输入与运行事实。
   NiceEval 应继续分开 Core 与 Attachment，不能因为新增一列就提升 Record major。
2. **完成标识落在权威对象上。** Harbor 用 Trial `result.json` 决定 resume 是否删除目录。
   NiceEval 也需要单一、可机器检查的完成判断，不能扫描半成品目录猜测。
3. **派生统计可以缓存，比较必须能重算。** Harbor 持久化 mean / `pass_at_k`，但在读取侧生成比较网格。
   NiceEval 可以缓存昂贵合计，Sample、coverage 与图表仍须能从 Record 重做。
4. **重评分必须 fork。** Regrade 的 `source_trial` 包含 action、源 UUID 与源 Task digest。
   新判定不应改写原 Attempt。
5. **缺值不能默默变成 0。** Harbor 的零填充让分母看似完整；NiceEval 必须显示缺测。
6. **远程副本不是第二套真相。** Hub 行是本地 Trial 的投影。
   NiceEval 若提供分享，应以 portable Record 为权威，远程索引不能单独修改语义。
7. **不要为查看器发明用户 migration。** Harbor 没有升级旧 `jobs/` 的命令。
   NiceEval 只有在 current reader 无法按现行契约读取原 bytes 时，才进入 `niceeval migrate`。

以上是研究推论。
它们进入 Feature、Roadmap 或 Design 并完成裁决后，才成为 NiceEval 契约。

## 观察边界

官方文档站是滚动文档，无法固定到单一 HTML 修订号。
本研究使用 2026-08-14 当日公开文档，以及官方仓库 `main` 的
`ac398bbda7c4c1073461797d3b95c2455cc671b5`，提交日期为 2026-08-13T05:14:59Z。

| 面 | 观察到的版本边界 |
|---|---|
| 文档站 | [harborframework.com/docs](https://harborframework.com/docs) 滚动页；正文来自仓库 `docs/content/docs/` |
| Python 包 | [`pyproject.toml`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/pyproject.toml) 写明 `version = "0.21.0"` |
| 源码 | [harbor-framework/harbor](https://github.com/harbor-framework/harbor) `main` 的上述提交 |
| Harbor Hub | 托管站 [hub.harborframework.com](https://hub.harborframework.com)；服务端 SQL、migration 与存储桶内部布局未进公开仓库 |

产品没有公开某项能力时，这组页面只写「本次检查的一手公开面未提供」，不推断内部实现。

## 一手材料入口

- [Motivation](https://harborframework.com/docs)
- [Getting Started](https://harborframework.com/docs/getting-started)
- [Core Concepts](https://harborframework.com/docs/core-concepts)
- [官方 GitHub 仓库](https://github.com/harbor-framework/harbor)
- [Harbor Hub](https://hub.harborframework.com)

执行、artifact、读取、Hub、ATIF 与 migration 的一手文档链接分别放在对应主题页，紧邻其支持的事实。
