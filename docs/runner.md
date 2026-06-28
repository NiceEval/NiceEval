# Runner —— 执行引擎

运行器是把"一批 eval"变成"一份结果"的调度引擎。它拥有对所有被测对象都一样的部分:发现、有界并发、重试、早停、缓存、报告编排。被测对象的差异它一概不管 —— 它只对着 `Agent` 接口(统一动词 `send`)驱动。

这是 fastevals "跑得快"承诺的落点,见 [Vision](vision.md#跑得快)。

## 职责边界

运行器**做**:发现 eval、算指纹决定跳过、建 attempt 列表、有界并发调度、重试可疑失败、早停、把结果交给报告器、落盘工件、定退出码。

运行器**不做**:不知道怎么驱动 agent(那是 Agent/Adapter)、不知道怎么打分(那是 Scorer)、不知道结果存哪种格式细节(那是 Reporter)。它是协调者,不是执行者。

## 发现

`runner/discover.ts` 扫 `evals/`:

- 找所有 `*.eval.ts`,`import` 后看默认导出 —— 单个 eval 用文件 id;数组则扇出,id 加零填充索引(`sql/0000`)。
- 找所有含 `PROMPT.md` 的目录(fixture),据相对路径推导 id。
- 按相对路径排序,保证 id 稳定、输出可比。
- 应用过滤:位置参数(id 前缀,如 `weather` 命中 `weather/*`)、`--tag`。
- `fastevals exp` 时另从 `experiments/` 扫实验文件(默认导出 `defineExperiment` 的 `.ts`),据路径推导实验 id;**目录段即"可对比组"** —— `fastevals exp <组>` 跑整个文件夹、同组互为对照(见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验))。实验的 `evals` 字段再筛要跑哪些 eval(见[矩阵展开](#矩阵展开与通过率))。

## 调度:有界并发

核心循环维持至多 `maxConcurrency` 个 attempt 在飞,池满则等任一完成再补位(`Promise.race`)。报告回调走**独立的串行队列**,不阻塞执行池:

```typescript
const pending = [...attempts];
const inFlight = new Set<Promise<void>>();
let reportQueue = Promise.resolve();

while (pending.length || inFlight.size) {
  while (pending.length && inFlight.size < maxConcurrency) {
    const attempt = pending.shift()!;
    const p = runOne(attempt).then((result) => {
      results.push(result);
      // 报告在串行队列上,不占执行槽
      reportQueue = reportQueue.then(() => emitEvalComplete(result));
    });
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  }
  if (inFlight.size) await Promise.race(inFlight);
}
await reportQueue;
```

结果最后按**发现顺序**排序(而非完成顺序),让输出稳定可 diff。

并发上限来源:`--max-concurrency` → 配置 `maxConcurrency` → 默认。沙箱型受沙箱后端容量约束(本地 Docker 别开太高;云后端可大)。

## 矩阵展开与通过率

一次 `exp` 运行把一批配置展成 attempt:既可来自**一组文件夹里的多个单一配置**(`compare/bub-gpt-5.4` + `compare/codex-gpt-5.4`,见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验)),也可来自**单文件内的 `agent × model` 数组**笛卡尔展开;两者再 × `eval × runs`。比如 `agent: [claude-code, codex]` × `runs: 5` × 3 个 eval = 30 个 attempt。汇总按 `(agent, model, eval)` 分组,不再是单一判决,而是**通过率** + 平均耗时 / token / 成本:

```text
fixtures/button   claude-code   pass@5 = 4/5 (80%)   mean 34s · 58k tok · $0.44
fixtures/button   codex         pass@5 = 3/5 (60%)   mean 41s · 72k tok · $0.39
```

用于衡量 agent 的稳定性(一次过 ≠ 可靠),以及跨 agent 的**质量 × 成本**对比。不写实验时退化成单 agent × `runs`。

## 早停(earlyExit)

取通过率本可以跑满 N 次,但若只关心"能不能做到",先过一次即可停其余:

- 每个 eval 配一个 `AbortController`。
- 某 attempt 通过且 `earlyExit` 开 → `abort()` 同 eval 其余 attempt;被 abort 的不计入分母。
- 默认开;`--no-early-exit` 关(想要完整通过率分布时)。

## 预算护栏(budget)

实验可设 `budget`(整轮估算成本上限 $),`--budget` 覆盖。运行器在派发每个 attempt 前累加已花成本(用量 × 价格表,见 [Observability](observability.md#用量与成本token--计费)):一旦超过 budget,**停止派发新 attempt**(在飞的跑完),整轮提前收尾并发 `run:budgetExceeded`。借鉴 crabbox 的 spend cap,避免一次跑爆账单。

## 重试:压平基础设施抖动

基础设施会抖(沙箱起不来、网络瞬断、限流)。运行器对**可疑的快速失败**自动重试:

- 判据:失败 + 耗时 < 5s + 错误不是"超时"。这种"秒挂"几乎一定是 infra 而非模型。
- 指数退避 + 抖动,最多 5 次。
- 真正的模型失败(跑了很久才挂、或测试不过)**不重试** —— 那是有效信号。

这条规则把"基础设施噪声"和"模型能力信号"分开,避免重试掩盖真实失败。

## 缓存:指纹去重

`runner/fingerprint.ts` 对每个 eval 算 `(fixture 内容 + 相关配置)` 的哈希:

- 上次已 `passed` 且指纹未变 → 默认**跳过**,直接复用结果。
- 改了 fixture、改了配置、或 `--force` → 重跑。
- 失败的结果不缓存(总会重试失败项)。

让"改一个 case 重跑"只花那一个 case 的时间,而不是全量。

## 超时:双层保护

- **Adapter 内层超时** —— agent CLI 自己的超时。
- **运行器外层超时** —— `Promise.race` 一个 `AbortSignal.timeout`,即使 agent 卡死也能强行收尾,标记该 eval `failed`(error: timeout)并触发 abort。

外层是兜底,保证一个卡死的 case 不会挂起整批。

## 生命周期钩子

环境的起停由一组分层钩子负责,运行器按作用域把它们插进调度的固定位置(完整模型见 [Lifecycle](lifecycle.md)):

所有钩子收在一个 `hooks` 对象里,动词统一为 `setup` / `teardown`,作用域是结构 key:

- **`hooks.run.setup` / `hooks.run.teardown`**(run 作用域) —— 整轮一次,在第一个 attempt 之前 / 最后一个 attempt 之后跑;用来起停共享环境(mock API、共享 DB、预热池)。
- **`hooks.sandbox.setup` / `hooks.sandbox.teardown`**(sandbox 作用域,每个 attempt) —— 每次运行前预置沙箱(写 `.env`、起服务、装额外依赖)、跑完清理;能读 `ctx.flags` 按 feature flag 分支,`setup` 可返回 cleanup 闭包。

执行顺序:config 钩子先于 experiment 钩子叠加,teardown 反序;**`teardown` / cleanup 一律在 `finally` 里跑**,失败也跑。错误隔离按作用域分级:`hooks.run.setup` 抛错**中止整轮**,`hooks.sandbox.setup` 抛错**隔离成该 eval 失败**(不影响别人),`teardown` 抛错只记 diagnostic、不改判决。

**下游分析**(二次评分、自定义指标、品牌提及统计)走 [reporter](observability.md#reporters),不另设运行钩子 —— 这是从 agent-eval 的 `onRunComplete` 收敛过来的(见 [Experiments 砍字段](experiments.md#从-agent-eval-砍掉了什么以及为什么))。生命周期钩子管**资源起停**、reporter 管**结果消费**,两者正交,见 [资源 vs 分析](lifecycle.md#不和-reporter-冲突--资源-vs-分析)。

## 生命周期事件

运行器发一串事件,供 CLI dashboard、reporter、外部集成消费:

```text
run:start          { total, agent, model }
run:setup          { }                          # hooks.run.setup 开始(见 Lifecycle)
run:setupComplete  { durationMs }
eval:start         { id, attempt }
eval:complete      { id, attempt, verdict, durationMs, usage, costUSD }
run:earlyExit      { id }
run:budgetExceeded { spentUSD, budgetUSD }
run:teardown       { }                          # hooks.run.teardown 开始
run:saved          { outputDir }
run:summary        { passed, failed, scored, skipped, errored, durationMs, usage, estimatedCostUSD }
```

起停失败另发 `run:setupFailed` / `attempt:teardownFailed` / `run:teardownFailed`,完整事件表见 [Lifecycle:生命周期事件](lifecycle.md#生命周期事件)。

## 退出码

- 全 `passed` / `scored`(非 strict)→ `0`。
- 任一 `failed` → 非零。
- `--strict` 下任一 `scored` → 也非零。

供 CI 直接判红绿。

## 相关阅读

- [Architecture](architecture.md) —— 运行器在四段数据流里的位置与端到端时序。
- [Lifecycle](lifecycle.md) —— 生命周期钩子的作用域、执行顺序与错误语义。
- [Sandbox](sandbox.md) —— 预热与复用的后端支持。
- [Observability](observability.md) —— 运行器产出的工件与报告。
- [CLI](cli.md) —— 暴露这些调度行为的标志。
