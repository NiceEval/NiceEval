# Harbor 的原生层与对象关系

本页回答 Harbor 的产品层怎样分工，以及 Job、Trial、reward、viewer 与 Hub 怎样连接。
运行顺序见 [执行、失败与恢复](execution.md)，持久信封见 [存储与权威事实](storage.md)。

## 原生层总图

Harbor 的公共作者面是「Task 目录 + Job 配置 + Agent」。
它把 Agent 放进 `Environment` 执行 Task，由 verifier 产出 reward，再把 Trial 聚合成 Job。

```text
Task ─┐
      ├─ Dataset ─┐
Agent ────────────┼─ Job 展开与调度 ─→ Trial ─→ verifier reward
Environment ──────┘                         │
                                            ├─→ JobStats / Metric
                                            ├─→ 本地 viewer / analyze
                                            └─→ Harbor Hub 的行与 archive
```

| 层 | Harbor 原生对象或组件 | 负责什么 | 不负责什么 |
|---|---|---|---|
| 作者输入 | Task、Dataset、Agent、`Environment`、`JobConfig` | 声明题目、执行者、容器与运行矩阵 | 不代表已经发生的 Trial |
| 执行 | Job、`TrialQueue`、Trial | 展开、并发调度并完成一次次尝试 | 不把多个 Trial 合成一份 Trial 事实 |
| 判定 | verifier、`VerifierResult.rewards` | 运行 test 脚本并写出 reward | 不等同于 Agent 轨迹或后补分析 |
| 本地持久化 | Job 目录、Trial 目录、`config.json`、`lock.json`、`result.json` | 保存请求、锁定输入和运行事实 | 不预先保存所有 viewer 页面模型 |
| 派生计算 | `JobStats`、Metric、`pass_at_k`、`analysis.json` | 聚合 reward、持久化统计或后补摘要 | `analysis.json` 不是 verifier 判定 |
| 读取与呈现 | CLI 结果表、本地 viewer、比较网格 | 扫描 Job / Trial，筛选、下钻和比较 | 不是第二套本地存储模型 |
| 远程分享 | Harbor Hub 的 `job` / `trial` 行与 archive | 查询、比较、分享本地对象的远程副本 | 公开仓库未提供服务端 SQL 与 migration |

六个核心对象的官方定义见 [Core Concepts](https://harborframework.com/docs/core-concepts)。
具体字段与目录形状见 [存储与权威事实](storage.md)。

## Job 与 Trial 的关系

Harbor 没有名为 Run 的公共写入对象。
一次实验的用户身份是 Job，一次尝试的用户身份是 Trial。

Job 在内部把配置展开成一串 `TrialConfig`，再并行执行：

```text
n_attempts × tasks × agents → TrialConfig[]
```

Job 因此是 Trial 的集合，而不是包住一次 Agent 调用的别名。
`JobResult.trial_results` 在运行进程内聚合这些 Trial，但写入 Job `result.json` 时故意排除。
每个 Trial 自己的目录才保存该次尝试的事实。

Regrade 不走这张笛卡尔积。
它按源 Job 中已完成的 Trial 一对一派生新 Trial，并在新 `TrialLock` 中写入 `source_trial`。
它不会改写源 Job 或源 Trial。

Job 的展开入口见 [`Job._init_trial_configs`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/job.py) 与
[Core Concepts 的 Job 说明](https://harborframework.com/docs/core-concepts#job)。

## 事实、派生与呈现的边界

运行事实的公共信封是 Trial 目录中的 `config.json`、`lock.json`、`result.json`，以及 verifier 写出的 reward 文件。
Agent 轨迹、artifact 与日志也是 Trial 的运行材料，但并非每个 Agent 都提供 ATIF 轨迹。

Job 级 `result.json` 保存 `JobStats`，包括 Metric、`pass_at_k`、token 与费用等可重算合计。
viewer 的 `JobSummary`、`TaskSummary` 和比较网格则在读取时产生，不另存一份页面数据库。
`harbor analyze` 后补 `analysis.json`；viewer 可以展示它，但它不替代 reward。

Harbor 没有独立的 Analysis 产品对象。
Metric 写回 `JobResult`，后补 AI 摘要写回 Job / Trial 目录，比较网格留在读取侧。
这三种派生值分别有不同 owner，不能因为都出现在 viewer 中就视为同一层。

`JobConfig`、`JobResult` 与锁定输入的公开模型分别见：

- [`JobConfig`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/job/config.py)
- [`JobResult` / `JobStats`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/job/result.py)
- [`JobLock` / `TrialLock`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/job/lock.py)

## 本地与 Hub

Job / Trial 可以只留在本地 `jobs/`，也可以上传到 Harbor Hub。
本地 viewer 扫文件系统；Hub 通过 RPC 查询生成的公开行，并保存 allowlist archive。
两边展示的是同一套 Job / Trial 心智，不是两个不同的实验对象模型。

上传并非原子地复制整个目录。
Hub 先建立 in-progress Job 行，再逐个上传 Trial，最后上传 Job archive 并标记完成。
具体上传顺序见 [执行、失败与恢复](execution.md#hub-上传与完成)，表与 archive 形状见
[存储与权威事实](storage.md#hub-表与-archive)。

## 读取路线

按问题继续阅读：

- Job / Trial 怎样实际运行、失败、retry、resume 或 regrade：
  [执行、失败与恢复](execution.md)
- 哪些文件和 Hub 行保存权威事实，哪些值只是 projection 或 cache：
  [存储与权威事实](storage.md)
- 用户怎样重新打开、筛选、下钻、分组和比较：
  [读取、查询与比较](reading-and-comparison.md)
- 版本轨道、兼容读取与 migration 由谁负责：
  [Schema、兼容与 Migration](schema-and-migration.md)
