# Experiments —— 架构

experiment 是**可签入的运行配置**：一个文件钉一个单一配置，运行时展开成 attempt 矩阵，落盘成快照。本页定义这条链路上的实体、配置解析、调度接口与结果投影；使用侧 API 见 [README](README.md) 与 [Library](library.md)。

## 实体与生命周期

```text
ExperimentDef(运行配置 + 实验级 setup 钩子,experiments/ 下一文件一个)
  → resolved config(调度前一次求值:合并 CLI flag / env / config 兜底,evals 过滤器与 sandbox environments 查表求值)
  → attempt 矩阵(selectedEvalIds × runs,每 attempt 一个执行 fiber)
  → 快照(.niceeval/<experiment>/<timestamp>-<suffix>/,含 ExperimentRunInfo 投影)
```

- **id 从路径推导**（`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`），路径即身份，禁止手写 id；目录段表达「可比组」。
- **`ExperimentDef` 携带唯一的实验级生命周期字段 `setup`**——整场一次、宿主机侧,返回的 cleanup 就是 teardown(语义见下文 [实验级生命周期](#实验级生命周期setup-与它返回的-teardown))。其余生命周期各归各位:沙箱内环境预置挂 `sandbox` 字段的 `SandboxSpec` 钩子链,任务夹具属于 eval,连 agent 属于 `SandboxAgent.setup`,跨实验共享服务用外部编排(分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪))。
- 同一次 `niceeval exp` 调用可以同时跑多个实验（文件夹展开），但每个实验各自开快照目录，没有跨实验聚合落盘。

## Resolved config：一次求值，处处同源

配置优先级是 CLI flag → 环境变量 → experiment 字段 → `niceeval.config.ts` 兜底 → 默认值。解析发生在调度任何 attempt 之前、一次完成，运行中不再重读；此后所有消费方——调度器、fingerprint、快照投影、报告——引用同一份 resolved 值：

- `evals` 过滤器（含函数形式）在解析时对发现的 eval 全集求值，产出 `selectedEvalIds`；落盘的是求值结果与过滤器指纹，不是过滤器本身。
- `sandbox` 是本实验唯一的固定 `SandboxSpec`。spec 携带 `environments` 表时，解析期按每条选中 eval 的 `environment` 查表得出该 eval 的有效产物参数：选中 eval 声明的 profile 缺表项属于启动期配置错误，一次穷举列出全部缺项，不创建任何沙箱。逐 eval 的解析结果进入该 eval 的 fingerprint、provider 并发推荐值与 `ExperimentRunInfo.sandboxByEval`；remote Agent 不创建 sandbox，不参与查表。
- eval 级 fingerprint 由 eval 源码 + 影响该 eval 的 resolved 配置构成，是 [carry](#carry自动携带) 的判断依据。
- 落盘投影 `ExperimentRunInfo` 的穷尽形状单点定义在 [Results · snapshot.json](../results/architecture.md#snapshotjson)；`model` / `agent` 只在快照顶层存在。

## 调度接口

experiment 影响调度的字段就四个，语义单点在 [Runner](../../runner.md)：

- `maxConcurrency` —— 实验私有信号量，先过它再占全局并发位；串行化共享状态实验或给撞限额的实验单独降速。
- `earlyExit` —— 只由 `passed` 触发的首过即停；`errored` 不中止其余样本，确定性错误走 run 级 fail-fast（见 [Runner · 首过即停](../../runner.md#首过即停earlyexit)）。
- `budget` —— 按已完成 attempt 实测花费停止派发的安全网。
- `timeoutMs` —— 单 attempt 外层超时。

## 实验级生命周期：setup 与它返回的 teardown

`setup(ctx)` 在**宿主机**上、对每个实验**整场恰好至多一次**执行,与 attempt 生命周期(沙箱内 / 每 attempt 一次)分属两个节奏:

- **触发时机是懒的**:本实验第一个通过派发许可(首过即停 / fail-fast / budget 检查)的 attempt 触发它,后续 attempt 等同一个 memoized 结果。全部结果被 carry 携入、一个 attempt 都不派发时,`setup` 不执行——没有 attempt 要跑就没有资源要起。
- **不占并发位**:等待 `setup` 的 attempt 不持有全局并发 permit,不会让一个慢启动的隧道饿死同批其它实验;它们在反馈计数里保持 `queued`。
- **起止可见性由 runner 发布**:setup / teardown 的开始与结束是运行级反馈事件(Human dashboard 的运行级 active 行、agent/ci 的起止行),不依赖钩子自己调 `progress`——渲染契约见 [CLI · 实验级钩子的显示](cli.md#实验级钩子的显示)。
- **ctx**:`experimentId`、`selectedEvalIds`、`signal`(用户中断时 abort),以及作用域反馈 `progress` / `diagnostic`(绑定到 `experiment.setup`,见 [Library · 生命周期代码怎样向这次运行反馈](library.md#生命周期代码怎样向这次运行反馈))。
- **失败语义**:`setup` 抛错 → 本实验**所有** attempt 记 `errored`(`error.code = "experiment-setup-failed"`,`error.phase = "experiment.setup"`),逐条落 `result.json`、进报告——环境起不来是每条 eval 都没跑成的事实,不是一条一次性日志;同批其它实验不受任何影响。同一 eval 连续复现同一错误码走既有 run 级 fail-fast 收敛,不会刷出无限重复行。
- **teardown = setup 返回的 cleanup**:本实验最后一个 attempt 收尾后执行;运行被中断、attempt 全部失败时同样执行(finalizer 语义),强清退出路径(二次中断 / 看门狗 / 崩溃退出)由宿主机侧注册表兜底排空——与正常路径互斥、恰好执行一次(机制见 [CLI 内部架构 · 中断:三级响应](../../cli.md#中断三级响应))。cleanup 抛错记一条运行级 diagnostic(`experiment-teardown-failed`),不改变任何已产出的 verdict——与 `sandbox.teardown` 的失败语义一致;执行有界(30s 清理超时,到点同样记 `experiment-teardown-failed`),不能无限拖住退出。
- **产出的运行时值经模块闭包流动**:`setup` 拿到的 URL / 凭据写进实验文件的模块级变量,同文件里 agent / sandbox 钩子(它们每 attempt 执行,晚于 `setup`)从闭包读取。runner 不做值的中介,也不把这些值写进快照——它们是运行时基础设施坐标,不是实验条件(实验条件进 `flags`)。
- **不进 fingerprint**:钩子函数体与 `SandboxSpec` 钩子一样不参与 eval fingerprint;改了 `setup` 逻辑要强制重跑用 `--force`。
- **两个钩子都不产出 attempt 阶段计时**:`experiment.setup` / `experiment.teardown` 不属于任何单个 attempt,`phases[]` 里永远不出现;这两个词表成员只用于错误 / 诊断归因(见 [Results · result.json](../results/architecture.md#resultjson))与运行级反馈行的标注。

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
| `setup` | `setup` | **重造** | 保留字段名,语义收窄成「实验级整场一次、宿主机侧」:管每实验一份的共享服务(隧道、mock server、license),返回 cleanup 作 teardown(见上文 [实验级生命周期](#实验级生命周期setup-与它返回的-teardown))。沙箱内按实验变化的环境挂 `sandbox` 字段的 `SandboxSpec.setup()` / `.teardown()`,任务夹具写 `EvalDef.setup` / `test()`,连 agent 写 `SandboxAgent.setup`(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `validation` | — | **删** | 「怎么算对」是 eval 自己的事(`test()` 里手工跑校验命令),不该由 experiment 决定 |
| `scripts` | — | **删** | 同上,属于 eval / fixture 的评分,不是运行配置 |
| `brands` | — | **删** | Vercel 品牌追踪专用,通用 evals 不需要 |
| `editPrompt` | — | **删** | 改写 prompt 太 niche,需要时在 agent/eval 里做 |
| `onRunComplete` | — | **删** | 下游**分析**交给 [reporter](../../observability.md#reporters);实验级**资源回收**由 `setup` 返回的 cleanup 承担(见上文 [实验级生命周期](#实验级生命周期setup-与它返回的-teardown)),不需要独立的完成回调 |
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
