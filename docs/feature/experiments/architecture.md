# Experiments —— 架构

experiment 是**可签入的运行配置**：一个文件钉一个单一配置，运行时展开成 attempt 矩阵，落盘成快照。本页定义这条链路上的实体、配置解析、调度接口与结果投影；使用侧 API 见 [README](README.md) 与 [Library](library.md)。

## 实体与生命周期

```text
ExperimentDef(运行配置 + 实验级 setup 钩子,experiments/ 下一文件一个)
  → resolved config(调度前一次求值:合并 CLI flag / env / config 兜底,evals 过滤器与 sandbox environments 查表求值)
  → attempt 矩阵(selectedEvalIds × runs,每 attempt 一个执行 fiber)
  → 快照(.niceeval/<experiment>/<timestamp>-<suffix>/,含 ExperimentRunInfo 投影)
```

- **id 从路径推导**（`experiments/agents/bub/gpt-5.4.ts` → `agents/bub/gpt-5.4`），路径只表达身份与 CLI 前缀选择，禁止手写 id。
- **`ExperimentDef` 携带实验级生命周期钩子对 `setup` / `teardown`**——整场一次、宿主机侧(语义见下文 [实验级生命周期](#实验级生命周期setup-与-teardown))。其余生命周期各归各位:沙箱内环境预置挂 `sandbox` 字段的 `SandboxSpec` 钩子链,任务 Fixture 属于 eval,连 agent 属于 `SandboxAgent.setup`,跨实验共享服务用外部编排(分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪))。
- 同一次 `niceeval exp` Invocation 可以同时跑多个实验（文件夹展开），但每个实验各自开快照目录，没有跨实验成员关系或聚合落盘。Invocation 是瞬时编排边界，不分配持久化 id。

## Resolved config：一次求值，处处同源

配置优先级是 CLI flag → 环境变量 → experiment 字段 → `niceeval.config.ts` 兜底 → 默认值。解析发生在调度任何 attempt 之前、一次完成，运行中不再重读；此后所有消费方——调度器、fingerprint、快照投影、报告——引用同一份 resolved 值：

- `evals` 过滤器在解析时遍历发现后的 `EvalDescriptor` 全集（数据集已扇出），产出 `selectedEvalIds`；函数必须同步返回 boolean。落盘的是求值结果与过滤器指纹，不是函数本身。
- `sandbox` 是本实验唯一的固定 `SandboxSpec`。spec 携带 `environments` 表时，解析期按每条选中 eval 的 `environment` 查表得出该 eval 的有效产物参数：选中 eval 声明的 profile 缺表项属于启动期配置错误，一次穷举列出全部缺项，不创建任何沙箱。逐 eval 的解析结果进入该 eval 的 fingerprint、provider 并发推荐值与 `ExperimentRunInfo.sandboxByEval`；remote Agent 不创建 sandbox，不参与查表。
- eval 级 fingerprint 由 eval 源码 + 影响该 eval 的 resolved 配置构成，是 [carry](#carry自动携带) 的判断依据。
- 落盘投影 `ExperimentRunInfo` 的穷尽形状单点定义在 [Results · snapshot.json](../results/architecture.md#snapshotjson)；`model` / `agent` 只在快照顶层存在。

## 调度接口

experiment 影响调度的字段就四个，语义单点在 [Runner](../../runner.md)：

- `maxConcurrency` —— 实验私有信号量，先过它再占全局并发位；名额与 attempt 同生命周期（沙箱创建到销毁全程持有，turn 退避等内部等待不释放），串行化共享状态实验或给撞限额的实验单独降速。
- `earlyExit` —— 只由 `passed` 触发的首过即停；`errored` 不中止其余样本，确定性错误走 run 级 fail-fast（见 [Runner · 首过即停](../../runner.md#首过即停earlyexit)）。
- `budget` —— 按已完成 attempt 实测花费停止派发的安全网。
- `timeoutMs` —— 单 attempt 外层超时。

## 实验级生命周期：setup 与 teardown

`setup(ctx)` / `teardown(ctx)` 在**宿主机**上、对每个实验**整场恰好至多一次**执行,与 attempt 生命周期(沙箱内 / 每 attempt 一次)分属两个节奏;成对形态与触发规则和其余三层一致(见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它)):

- **触发时机是懒的**:本实验第一个通过派发许可(首过即停 / fail-fast / budget 检查)的 attempt 触发它,后续 attempt 等同一个 memoized 结果。全部结果被 carry 携入、一个 attempt 都不派发时,`setup` 不执行——没有 attempt 要跑就没有资源要起。
- **不占并发位,也不折损优先级**:等待 `setup` 的 attempt 不持有、不预留全局并发位,不会让一个慢启动的隧道饿死同批其它实验;它们在反馈计数里保持 `queued`。setup 完成后按[瓶颈优先](../../runner.md#派发顺序瓶颈优先追求最小总墙钟时间)的优先级参与下一次空位分配,不因回来得晚排到队尾。
- **起止可见性由 runner 发布**:setup / teardown 的开始与结束是运行级反馈事件(Human dashboard 的运行级 active 行、`--json` 的起止事件),不依赖钩子自己调 `progress`——渲染契约见 [CLI · 实验级钩子的显示](cli.md#实验级钩子的显示)。
- **ctx**:`experimentId`、`selectedEvalIds`、`signal`(用户中断时 abort),以及作用域反馈 `progress` / `diagnostic` / `fact`(绑定到当前钩子对应的 `experiment.setup` / `experiment.teardown`,见 [Library · 生命周期代码怎样向这次运行反馈](library.md#生命周期代码怎样向这次运行反馈))。experiment 级钩子上报的 fact 落进 `SnapshotMeta.facts`(快照封口补写),记录整场实验的环境观测;语义与形状见 [Results · facts](../results/architecture.md#facts运行事实)。
- **失败语义**:`setup` 抛错 → 本实验**所有** attempt 记 `errored`(`error.code = "experiment-setup-failed"`,`error.phase = "experiment.setup"`),逐条落 `result.json`、进报告——环境起不来是每条 eval 都没跑成的事实,不是一条一次性日志;同批其它实验不受任何影响。同一 eval 连续复现同一错误码走既有 run 级 fail-fast 收敛,不会刷出无限重复行。
- **teardown 的触发**:本实验最后一个 attempt 收尾后执行,当且仅当 `setup` 的时点走到过——`setup` 抛错不豁免(半初始化的现场同样要扫尾,teardown 对可能未赋值的闭包变量做防御),一个 attempt 都没派发则跳过;运行被中断、attempt 全部失败时同样执行(finalizer 语义),强清退出路径(二次中断 / 看门狗 / 崩溃退出)由宿主机侧注册表兜底排空——与正常路径互斥、恰好执行一次(机制见 [CLI 内部架构 · 中断:三级响应](../../cli.md#中断三级响应));无法拦截的强杀(`SIGKILL` / 断电)不在进程内兜底范围,由[强杀后的收尾兜底](#强杀后的收尾兜底收尾登记与启动自愈)在磁盘上接手。
- **teardown 的失败语义**:抛错记一条快照级 diagnostic(`experiment-teardown-failed`, `phase: "experiment.teardown"`),随该 Experiment 的 `completedAt` 封口落入 `snapshot.json`,不改变任何已产出的 verdict——与 `sandbox.teardown` 的失败语义一致;执行有界(30s 清理超时,到点同样记 `experiment-teardown-failed`),不能无限拖住退出。
- **产出的运行时值经模块闭包流动**:`setup` 拿到的 URL / 凭据写进实验文件的模块级变量,`teardown` 与同文件里 agent / sandbox 钩子(后两者每 attempt 执行,晚于 `setup`)从闭包读取。runner 不做值的中介,也不把这些值写进快照——它们是运行时基础设施坐标,不是实验条件(实验条件进 `flags`)。
- **不进 fingerprint**:钩子函数体与 `SandboxSpec` 钩子一样不参与 eval fingerprint;改了 `setup` / `teardown` 逻辑要强制重跑用 `--force`。
- **两个钩子都不产出 attempt 阶段计时**:`experiment.setup` / `experiment.teardown` 不属于任何单个 attempt,`phases[]` 里永远不出现;这两个词表成员只用于错误 / 诊断归因(见 [Results · result.json](../results/architecture.md#resultjson))与运行级反馈行的标注。

## 强杀后的收尾兜底:收尾登记与启动自愈

进程内的兜底注册表覆盖正常、中断与崩溃退出,覆盖不到 `SIGKILL` / 宿主断电——此时实验级 `setup` 起过的外部资源(隧道、共享服务、license 席位)没有任何代码来得及释放,而且强杀往往来自会重复触发的外部看门狗(CI 时限、宿主超时),泄漏会随重跑累积。这条路径的兜底建立在磁盘上:

- **收尾登记与触发时点同步落盘。** 实验的触发时点(第一个通过派发许可的 attempt)在跑 `setup` 之前,先把收尾登记原子写入 `.niceeval/teardowns/<entry>.json`(与留存注册表同一套逐条目文件纪律):`{ experimentId, selectedEvalIds, pid, host, startedAt }`。条目键包含实验身份与 pid，因此同一实验的并发 run 各自保留一份义务。teardown settle 后——不论由哪条路径触发、成功还是超时——删除**自己的**登记。不变量:磁盘上存在登记,当且仅当某次 run 的实验级收尾义务尚未完成。
- **启动自愈。** `niceeval exp` 启动时扫描登记目录。`host` 等于当前宿主机名且 `pid` 不存活的登记是**遗留义务**:只要该实验被本次选中且仍声明 `teardown`,就在调度 attempt 前逐条补执行一次(运行级反馈行标注 recovery),再照常走本次的生命周期——即使全部结果被 carry、零 attempt 会派发，也会补上强杀遗留的收尾。不在这类可自愈选择中的遗留登记打一行提醒并给出 `--teardown` 补收尾命令；这包括选中了但定义已删除 `teardown` 的实验。`pid` 仍存活或 `host` 不匹配的登记可能属于并发 run,不触碰。
- **补执行是新进程语义。** 原进程的模块闭包已随强杀丢失,补执行时 teardown 读到的闭包变量是未赋值状态——这正是 teardown 既有防御契约(`tunnel?.stop()`)覆盖的形态;需要跨进程收尾的资源应由 teardown 从环境或自身的持久化(容器名、pid 文件、幂等的外部 down 脚本)找回,不依赖 `setup` 的内存产物。`ctx.selectedEvalIds` 从登记恢复,`ctx.signal` 绑定当前进程的中断。
- **删登记是互斥点,义务至多补执行一次。** 补执行(启动自愈或 `--teardown`)先原子删除登记,删除成功者获得执行权;登记已被别的进程删除则跳过——同一份遗留义务不会被两个进程双跑。补执行失败按既有失败语义记 `experiment-teardown-failed` diagnostic,不自动重试;手动 `--teardown` 是重试入口。
- **手动补收尾:`--teardown`。** `niceeval exp <experiment 路径> --teardown` 不派发 attempt、不跑 `setup`。它先逐条原子删除选中实验的遗留登记；删除成功者才执行相应 teardown，登记已被启动自愈或另一条 `--teardown` 路径删除则跳过，因而同一义务不会双跑。没有任何登记时仍照常执行一次，供「我知道有东西泄漏了」的场景使用；若扫描时已有登记但本进程未抢到删除权，不另行执行。teardown 抛错记 diagnostic 并退出 1，失败后不回写登记，重试入口仍是 `--teardown`。与 eval 前缀位置参数组合报用法错误——这个 flag 选择的是「只收尾」这种跑法,不参与 eval 选择。

## Carry：自动携带

上一轮 fingerprint 匹配、判定为终态（passed / failed）的结果默认不重跑，**携带合入**本次快照（带 `artifactBase` 指回原 artifact），让最新快照保持完整；`--force` 关闭携带全部重跑；`errored` / `skipped` 判定不可信，永不携带。携带以 attempt 为粒度、来源不要求快照收尾，因此被中断或强杀的 Invocation **重跑同一条命令就是续跑**——只补缺失的 attempt。粒度与来源的完整规则见 [Runner · 缓存](../../runner.md#缓存指纹去重)，携带条目的落盘与读取语义见 [Results · 两类条目](../results/architecture.md#resultjson)。

## Invocation Completion 与退出

当次 Invocation 的结论与逐 attempt 判定分开表达：`complete` / `incomplete` / `interrupted`（budget 耗尽、fail-fast 或中断造成的未派发计入 `unstarted`，让结论落在 `incomplete`，不伪装成全绿）；退出码按 `(experiment, eval)` 折叠判红。这是当场编排事实，不写入 Results；需要审计时由 `Json(path)` reporter 写 `InvocationSummary`。终端两种输出形态怎么呈现见 [CLI 预期反馈](cli.md)，完成状态的机器形状见 [Runner · 完成状态](../../runner.md#完成状态)。

## 设计参照：从 agent-eval 砍掉了什么（以及为什么）

agent-eval 的 `ExperimentConfig` 字段一半是它自己业务的耦合或可下放的。niceeval 的 `defineExperiment` 只留**纯运行矩阵**：

| agent-eval 字段 | niceeval | 处置 | 理由 |
|---|---|---|---|
| `agent` | `agent` | 保留,但一文件一个 agent | 沿用 agent；报告直接比较当前 Scope 中的 experiments |
| `model` / `runs` / `earlyExit` / `evals` / `timeout` / `sandbox` | 同(`timeout`→`timeoutMs`) | 保留 | 运行矩阵的本体 |
| `setup` | `setup` | **重造** | 保留字段名,语义收窄成「实验级整场一次、宿主机侧」:管每实验一份的共享服务(隧道、mock server、license),与 `teardown` 成对(见上文 [实验级生命周期](#实验级生命周期setup-与-teardown))。沙箱内按实验变化的环境挂 `sandbox` 字段的 `SandboxSpec.setup()` / `.teardown()`,任务 Fixture 写 `EvalDef.setup` / `test()`,连 agent 写 `SandboxAgent.setup`(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `validation` | — | **删** | 「怎么算对」是 eval 自己的事(`test()` 里手工跑校验命令),不该由 experiment 决定 |
| `scripts` | — | **删** | 同上,属于 eval / fixture 的评分,不是运行配置 |
| `brands` | — | **删** | Vercel 品牌追踪专用,通用 evals 不需要 |
| `editPrompt` | — | **删** | 改写 prompt 太 niche,需要时在 agent/eval 里做 |
| `onRunComplete` | — | **删** | 下游**分析**交给 [reporter](../../observability.md#reporters);实验级**资源回收**由 `teardown` 承担(见上文 [实验级生命周期](#实验级生命周期setup-与-teardown)),不需要独立的完成回调 |
| `modelPolicy` | — | **删** | 折进「`model` 省略 = 原生默认」 |
| `copyFiles` | — | **删** | 和 diff 冗余:agent 新建的文件在 agent diff 里就是完整内容,`t.sandbox.diff.get(path)` 直接可读,不必再单独拷一份 |
| `webResearch` / `agentOptions` | `flags` | **合并** | 一个通用参数袋取代散落的开关,经 `ctx.flags` / `t.flags` 透传 |
| — | `budget` | **加** | 实验级成本上限,接 [用量与成本](../../observability.md#用量与成本token-计费) |

一句话：**experiment 只管"跑什么、跑几次、花多少"，不碰"怎么算对"。** 评分细节全在 eval。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— model/flags 怎么透传、怎样选择 eval、路径怎样形成 id。
- [CLI 预期反馈](cli.md) —— 人读文本与 `--json` 两种输出形态的契约。
- [Runner](../../runner.md) —— 调度、carry、完成状态的执行语义。
