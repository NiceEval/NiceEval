# Experiments —— 架构

experiment 是**可签入的运行配置**：一个文件钉一个单一配置，运行时展开成 attempt 矩阵，落盘成快照。本页定义这条链路上的实体、配置解析、调度接口与结果投影；使用侧 API 见 [README](README.md) 与 [Library](library.md)。

## 实体与生命周期

```text
ExperimentDef(纯配置数据,experiments/ 下一文件一个)
  → resolved config(调度前一次求值:合并 CLI flag / env / config 兜底,evals 过滤器求值)
  → attempt 矩阵(selectedEvalIds × runs,每 attempt 一个执行 fiber)
  → 快照(.niceeval/<experiment>/<timestamp>-<suffix>/,含 ExperimentRunInfo 投影)
```

- **id 从路径推导**（`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`），路径即身份，禁止手写 id；目录段表达「可比组」。
- **`ExperimentDef` 不携带生命周期钩子**——环境预置挂在 `sandbox` 字段的 `SandboxSpec` 钩子链上，任务夹具属于 eval，连 agent 属于 `SandboxAgent.setup`，run 级共享服务用外部编排（分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪)）。
- 同一次 `niceeval exp` 调用可以同时跑多个实验（文件夹展开），但每个实验各自开快照目录，没有跨实验聚合落盘。

## Resolved config：一次求值，处处同源

配置优先级是 CLI flag → 环境变量 → experiment 字段 → `niceeval.config.ts` 兜底 → 默认值。解析发生在调度任何 attempt 之前、一次完成，运行中不再重读；此后所有消费方——调度器、fingerprint、快照投影、报告——引用同一份 resolved 值：

- `evals` 过滤器（含函数形式）在解析时对发现的 eval 全集求值，产出 `selectedEvalIds`；落盘的是求值结果与过滤器指纹，不是过滤器本身。
- eval 级 fingerprint 由 eval 源码 + 影响该 eval 的 resolved 配置构成，是 [carry](#carry自动携带) 的判断依据。
- 落盘投影 `ExperimentRunInfo` 的穷尽形状单点定义在 [Results · snapshot.json](../results/architecture.md#snapshotjson)；`model` / `agent` 只在快照顶层存在。

## 调度接口

experiment 影响调度的字段就四个，语义单点在 [Runner](../../runner.md)：

- `maxConcurrency` —— 实验私有信号量，先过它再占全局并发位；串行化共享状态实验或给撞限额的实验单独降速。
- `earlyExit` —— 只由 `passed` 触发的首过即停；`errored` 不中止其余样本，确定性错误走 run 级 fail-fast（见 [Runner · 首过即停](../../runner.md#首过即停earlyexit)）。
- `budget` —— 按已完成 attempt 实测花费停止派发的安全网。
- `timeoutMs` —— 单 attempt 外层超时。

## Carry：自动携带

上一轮 fingerprint 匹配、判定为终态（passed / failed）的结果默认不重跑，**携带合入**本次快照（带 `artifactBase` 指回原 artifact），让最新快照保持完整；`--force` 关闭携带全部重跑；`errored` / `skipped` 判定不可信，永不携带。缓存规则见 [Runner · 缓存](../../runner.md#缓存指纹去重)，携带条目的落盘与读取语义见 [Results · 两类条目](../results/architecture.md#resultjson)。

## Completion 与退出

一次运行的结论与逐 attempt 判定分开表达：`complete` / `incomplete` / `interrupted`（budget 耗尽、fail-fast 或中断造成的未派发计入 `unstarted`，让结论落在 `incomplete`，不伪装成全绿）；退出码按 `(experiment, eval)` 折叠判红。终端各 profile 怎么呈现见 [CLI 预期反馈](cli.md)，完成状态的机器形状见 [Runner · 完成状态](../../runner.md#完成状态)。

## 设计参照：从 agent-eval 砍掉了什么（以及为什么）

agent-eval 的 `ExperimentConfig` 字段一半是它自己业务的耦合或可下放的。niceeval 的 `defineExperiment` 只留**纯运行矩阵**：

| agent-eval 字段 | niceeval | 处置 | 理由 |
|---|---|---|---|
| `agent` | `agent` | 保留,但一文件一个 agent | 沿用 agent;文件夹表达"可比组"(见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验)) |
| `model` / `runs` / `earlyExit` / `evals` / `timeout` / `sandbox` | 同(`timeout`→`timeoutMs`) | 保留 | 运行矩阵的本体 |
| `setup` | — | **删** | 环境预置不进 experiment 本身:按实验变化的环境挂在 `sandbox` 字段的 `SandboxSpec.setup()` / `.teardown()`,任务夹具写 `EvalDef.setup` / `test()`,连 agent 写 `SandboxAgent.setup`,整个 run 共享服务用外部编排(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `validation` | — | **删** | 「怎么算对」是 eval 自己的事(`test()` 里手工跑校验命令),不该由 experiment 决定 |
| `scripts` | — | **删** | 同上,属于 eval / fixture 的评分,不是运行配置 |
| `brands` | — | **删** | Vercel 品牌追踪专用,通用 evals 不需要 |
| `editPrompt` | — | **删** | 改写 prompt 太 niche,需要时在 agent/eval 里做 |
| `onRunComplete` | — | **删** | 下游**分析**交给 [reporter](../../observability.md#reporters);**资源起停**不由 experiment 钩子管,靠外部编排 / `SandboxAgent.setup` / `SandboxSpec.setup()` / `.teardown()` / `test()`(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `modelPolicy` | — | **删** | 折进「`model` 省略 = 原生默认」 |
| `copyFiles` | — | **删** | 和 diff 冗余:agent 新建的文件在 agent diff 里就是完整内容,`t.sandbox.diff.get(path)` 直接可读,不必再单独拷一份 |
| `webResearch` / `agentOptions` | `flags` | **合并** | 一个通用参数袋取代散落的开关,经 `ctx.flags` / `t.flags` 透传 |
| — | `budget` | **加** | 实验级成本上限,接 [用量与成本](../../observability.md#用量与成本token--计费) |

一句话：**experiment 只管"跑什么、跑几次、花多少"，不碰"怎么算对"。** 评分细节全在 eval。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— model/flags 怎么透传、实验怎么按文件夹组织。
- [CLI 预期反馈](cli.md) —— 三种 profile 的输出契约。
- [Runner](../../runner.md) —— 调度、carry、完成状态的执行语义。
