# Runner —— 执行引擎

运行器是把"一批 eval"变成"一份结果"的调度引擎。它拥有对所有被测对象都一样的部分:发现、有界并发、首过即停、缓存、报告编排。被测对象的差异它一概不管 —— 它只对着 `Agent` 接口(统一动词 `send`)驱动。

这是 niceeval "跑得快"承诺的落点,见 [Vision](vision.md#跑得快)。

## 职责边界

运行器**做**:发现 eval、算指纹决定跳过、建 attempt 列表、有界并发调度、首过即停、把结果交给报告器、落盘工件、定退出码。

运行器**不做**:不知道怎么驱动 agent(那是 Agent/Adapter)、不知道怎么打分(那是 Scorer)、不知道结果存哪种格式细节(那是 Reporter)。它是协调者,不是执行者。

## 发现

`runner/discover.ts` 扫 `evals/`:

- 找所有 `*.eval.ts`,`import` 后看默认导出 —— 单个 eval 用文件 id;数组则扇出,id 加零填充索引(`sql/0000`)。没有另一种基于目录约定的隐式发现——沙箱型 eval 也必须有一个 `.eval.ts` 文件。
- 按相对路径排序,保证 id 稳定、输出可比。
- 应用过滤:`niceeval exp <组|配置>` 后的位置参数(id 前缀,如 `weather` 命中 `weather/*`)、`--tag`。
- `niceeval exp` 时另从 `experiments/` 扫实验文件(默认导出 `defineExperiment` 的 `.ts`),据路径推导实验 id;**目录段即"可对比组"** —— `niceeval exp <组>` 跑整个文件夹、同组互为对照(见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验))。实验的 `evals` 字段再筛要跑哪些 eval(见[矩阵展开](#矩阵展开与通过率))。

## 调度:有界并发

核心调度用 `Effect.forEach({ concurrency: "unbounded" })` + **两级信号量**实现:每个 attempt 立刻有自己的 fiber,但执行体要先过实验级闸(`ExperimentDef.maxConcurrency`,可选)、再占全局 permit(全局 `maxConcurrency`)才真正开跑。实验级闸只让该实验自己的 attempt 排队,同批其它实验照常并发——串行化有共享状态的实验(如跨 eval 累积记忆,`maxConcurrency: 1`)不再拖慢整批基线。报告回调走 **permit=1 的信号量串行化**,不阻塞执行 fiber。结果最后按**发现顺序**排序(而非完成顺序),让输出稳定可 diff。

全局并发上限来源:`--max-concurrency` → 配置 `maxConcurrency` → 默认。沙箱型受沙箱 provider 容量约束(本地 Docker 别开太高;云 provider 可大)。实验文件里的 `maxConcurrency` 不参与全局解析,只在该实验内部限流。

## 矩阵展开与通过率

一次 `exp` 运行把一批配置展成 attempt:通常来自**一组文件夹里的多个单一配置**(`compare/bub-gpt-5.4` + `compare/codex-gpt-5.4`,见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验));再 × `eval × runs`。比如 2 个实验配置 × `runs: 5` × 3 个 eval = 30 个 attempt。汇总按 `(agent, model, eval)` 分组,不再是单一判定,而是**通过率** + 平均耗时 / token / 成本:

```text
fixtures/button   claude-code   pass@5 = 4/5 (80%)   mean 34s · 58k tok · $0.44
fixtures/button   codex         pass@5 = 3/5 (60%)   mean 41s · 72k tok · $0.39
```

用于衡量 agent 的稳定性(一次过 ≠ 可靠),以及跨 agent 的**质量 × 成本**对比。不写实验时退化成单 agent × `runs`。

## 首过即停(earlyExit)

取通过率本可以跑满 N 次,但若只关心"能不能做到",先过一次即可停其余:

- 每个 eval 配一个 `AbortController`。
- 某 attempt 通过且 `earlyExit` 开 → `abort()` 同 eval 其余 attempt;被 abort 的不计入分母。
- 某 attempt `errored`(框架/环境层面的意外,不是断言没过)且 `earlyExit` 开 → 同样 `abort()` 其余 attempt。errored 通常会确定性重复,跑满 `runs` 只是重复烧同一个错误;只有 `failed` 才是 agent 行为的样本,值得跑满 `runs` 测通过率。
- 默认开;`--no-early-exit` 关(想要完整通过率分布时)。

## 预算护栏(budget)

实验可设 `budget`(整个 run 的估算成本上限 $),`--budget` 覆盖。运行器在派发每个 attempt 前检查已花成本(用量 × 价格表,见 [Observability](observability.md#用量与成本token--计费)),并给**在飞的 attempt 做预扣**:还没有任何完成样本时,同一 budget 域只放一个 attempt 在飞(先探出单次成本);有样本后按平均实测成本给每个在飞 attempt 预扣,预计总额到顶就等在飞的结算。已花到顶则**停止派发新 attempt**(在飞的跑完),整个 run 提前收尾并发 `run:budgetExceeded`。没有预扣的话,`maxConcurrency` 个 attempt 会在任何成本回写前全部起飞,实际花费能冲到 budget 的好几倍。借鉴 crabbox 的 spend cap,避免一次跑爆账单。

## 缓存:指纹去重

`runner/fingerprint.ts` 对每个 eval 算 `(eval 代码 + 相关配置)` 的哈希:

- 上次已 `passed` 且指纹未变 → 默认**跳过**,直接复用结果。
- 改了 fixture、改了配置、或 `--force` → 重跑。
- 失败的结果不缓存(总会重试失败项)。

让"改一个 case 重跑"只花那一个 case 的时间,而不是全量。

## 超时:双层保护

- **Adapter 内层超时** —— agent CLI 自己的超时。
- **运行器外层超时** —— `Promise.race` 一个 `AbortSignal.timeout`,即使 agent 卡死也能强行收尾,标记该 attempt / eval 为 `errored`(error: timeout)并触发 abort。

外层是兜底,保证一个卡死的 case 不会挂起整批。

## 环境预置不进运行器,但按顺序调它

niceeval **没有 run / experiment 级生命周期钩子**——`ExperimentDef` 仍是纯配置数据,不携带任何生命周期字段,运行器不会替用户在整个 run 前后跑任意 `setup` / `teardown`。但"跑 agent 前要不要准备环境"这件事确实需要一个家:沙箱创建后、git 基线之前,运行器会调用 `experiment.sandbox` 链上挂的环境钩子(`SandboxSpec.setup()` / `.teardown()`,见 [Sandbox · 沙箱生命周期钩子](sandbox.md#沙箱生命周期钩子setup--teardown));沙箱固定段("发现 → 调度 → 沙箱起停 / git 基线 / 采 diff → 评分 → 报告"这条主轴)之内,还分出这条 eval 的任务夹具(`EvalDef.setup` 或 `test(t)`)和 agent 自己的一次性预置([`SandboxAgent.setup`](adapters/contract.md#agent-契约))。运行器只固定这几个调用点的**顺序**,钩子内部做什么、要不要按实验变化,全部交给对应的作者决定,不写进运行器本身。整个 run 共享的外部服务(mock API、DB)仍然用外部编排(`docker compose` / CI 脚本)起停、经 env 传入——这类资源跨进程共享,不属于任何一次沙箱的生命周期。四类职责的完整分工表见 [环境预置放哪](sandbox.md#环境预置放哪)。

**下游分析**(二次评分、自定义指标)走 [reporter](observability.md#reporters),不另设运行钩子——这是从 agent-eval 的 `onRunComplete` 收敛过来的(见 [Experiments 砍字段](experiments.md#从-agent-eval-砍掉了什么以及为什么))。

## 运行器事件

运行器发一串事件,供 CLI dashboard、reporter、外部集成消费:

```text
run:start          { total, agent, model }
eval:start         { id, attempt }
eval:complete      { id, attempt, verdict, durationMs, usage, estimatedCostUSD }
run:earlyExit      { id }
run:budgetExceeded { spentUSD, budgetUSD }
run:saved          { outputDir }
run:summary        { passed, failed, skipped, errored, durationMs, usage, estimatedCostUSD }
```

`verdict` 是互斥的判定分类:`passed` / `failed` / `errored` / `skipped`,没有 `scored` 中间态。`run:summary.failed` 只统计断言/评分不通过,环境、超时、adapter 或 agent runtime 问题统计到 `errored`。

## 退出码

- 全 `passed` → `0`。
- 任一 `failed`(含 `--strict` 下 soft 未达标而改判的)→ 非零。
- 任一 `errored` → 非零。

供 CI 直接判红绿。

## 相关阅读

- [Architecture](architecture.md) —— 运行器在四段数据流里的位置与端到端时序。
- [Sandbox](sandbox.md) —— 预热与复用的 provider 支持,以及环境预置放哪。
- [Observability](observability.md) —— 运行器产出的工件与报告。
- [CLI](cli.md) —— 暴露这些调度行为的标志。
