# Experiments 与 Runner 怎么测

契约来源：[Experiments](../../../feature/experiments/README.md)、[Experiments Architecture](../../../feature/experiments/architecture.md)、[Experiments Library](../../../feature/experiments/library.md)、[Experiments CLI](../../../feature/experiments/cli.md)、[Runner](../../../runner.md)、[执行错误类型](../../../feature/error-classification/README.md)、[错误与警告反馈](../../../error-feedback.md)。Runner 测试关心 attempt 的集合、开始条件、结束条件、事件与资源释放，不锁定内部循环、Promise 数量或 Effect combinator。本篇的缝：fake Agent / Sandbox / Reporter 与时钟，测其上的调度逻辑；缝的真实侧（真实进程与真实 attempt）由 [E2E 功能域 · CLI](../e2e/cli.md) 验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## 观察面与边界

调度契约的正确观察面是**可观察的调度事实**：哪些 attempt 启动了、任意时刻多少在飞、事件流里出现了什么、资源最终是否释放。不是内部信号量的调用次数，也不是 Promise 图的形状。

| 契约域 | 观察面 |
|---|---|
| runs 展开与过滤 | 计划中的 attempt 集合（`--dry` 语义层） |
| 并发上限 | barrier 控制下的在飞计数峰值 |
| early exit / budget | 启动过的 attempt 列表 + `run:earlyExit` / `run:budgetExceeded` 事件 |
| 缓存与指纹 | 复用 vs 重跑的 attempt 集合 |
| 退出码折叠 | `RunCompletion` 与退出码 |
| 资源生命周期 | fake Sandbox 的 created/stopped 集合、reporter queue 收尾 |
| 实验级 setup/teardown | 钩子调用计数、收尾登记文件、运行级事件 |

## Fixture 规范

Runner fixture 用声明式场景描述 attempt，而不是为每个测试重新拼完整 `EvalDef`、Agent、Sandbox 和 Reporter：

```ts
const scenario = runnerFixture({
  runs: 3,
  maxConcurrency: 2,
  attempts: [
    { evalId: "a", result: "failed", release: "a0" },
    { evalId: "a", result: "passed", waitFor: "a0" },
    { evalId: "b", result: "passed" },
  ],
})
```

`runnerFixture` 提供受控 barrier、记录型 Reporter、fake Agent/Sandbox 和结果读取方法。它不自行决定 early exit、budget 或调度顺序；这些必须由生产 Runner 决定。fixture 里的 `costUSD` 是输入证据（该 attempt 完成后结算的实测成本），不复制 Runner 的任何计费逻辑。所有权与稳定性规则见 [Harness](harness.md)。

时序纪律：并发与调度用 barrier 观察"在飞"状态，不用 `setTimeout` 猜测调度是否已经发生；重试和 backoff 用 `TestClock.adjust` 推进，不做真实等待。Effect 程序用 `it.effect` 让测试运行时持有 Scope；保存状态的 Layer 要求每例隔离时用独立 `it.layer(...)`。

```ts
it.effect("全局同时在飞的 attempt 不超过 maxConcurrency", () =>
  Effect.gen(function* () {
    const fx = yield* makeRunnerFixture({ maxConcurrency: 2, evals: 5 })
    const fiber = yield* Effect.forkChild(fx.run)

    yield* fx.started.awaitCount(2)
    assert.strictEqual(fx.inFlight.current, 2)

    yield* fx.releaseOne
    yield* fx.started.awaitCount(3)
    assert.isAtMost(fx.inFlight.maximum, 2)

    yield* fx.releaseAll
    yield* fiber.await
  }),
)
```

## 覆盖规范

- **runs 展开与选择**：attempt 总数公式与 runs 缺省；位置参数前缀 × 实验 `evals` 字段两层交集；谓词的白名单投影、只求值一次、非法返回值的完整报错；experiment 选择器三条规则与零命中反馈；environment profile 查表的同源消费与缺表项前置报错。选择类契约的每条规则都要有"命中"与"不误配"两面。
- **`EvalDescriptor.scoring` 投影与实验同型校验**：`evalDescriptorOf` 对 `defineEval` 产物投影 `scoring: "pass"`、`defineScoreEval` 产物投影 `"points"`，未经这两个定义函数处理的裸对象（`scoring` 缺失）兜底按 `"pass"` 投影，三种情形在同一批候选 eval 里都要各有一条区分力场景；`splitByScoring` 对全通过制、全计分制、混合三种候选集合的分桶结果——只有混合桶两侧都非空。混型启动校验的报错文案（`cli.experiment.mixedScoring`）要能证明关键信息齐全：两侧的 eval id 各自列出、各自计数，以及收窄建议（tags / id 前缀 / `scoring` 字段，或拆成两个实验文件）——直接对 `t("cli.experiment.mixedScoring", …)` 断言，不需要起一个真实 CLI 进程。
- **计分制 attempt 落盘**：`runAttemptEffect` 对 `scoring: "points"` 的 eval 把 `.points(n)` 挣分正确写进 `EvalResult.assertions[].points`、把 `t.score(label, n)` 正确写进 `EvalResult.scoreEntries`（不只是 collector 单元层的孤立证明，这里证明 runner 真的把 collector 的产物接上了落盘字段）；`t.require` 中止时 `verdict` 为 `failed` 而非 `errored`（断言已记录，不是执行异常）、中止前已经产生的 `scoreEntries` 照实保留、中止后的 `test()` 代码不再执行（后续 `.points()` / `t.score()` 调用不出现在结果里）。
- **调度项优先级**：CLI flag → experiment → config → 内置默认的覆盖链逐层可区分；agent/model/flags 只属 experiment，CLI 覆盖报用法错误；labels 的值域校验与快照投影。
- **并发**：全局与实验级上限、全局上限的三层解析与 provider 推荐值、exclusive provider 强制串行、退避期间释放槽位、瓶颈优先分配、等待 setup 不占位、被中止者不泄漏槽位。每条都以在飞峰值或分配顺序为断言面。
- **反馈协调器的事件队列纪律**：`FeedbackCoordinator` 对每一类 durable 事件都按 clear→append→redraw 的原子顺序转发给当前活跃 renderer（不止某一种事件；renderer 方法即便是异步的也不交错）；同一去重 key 的诊断在 `RunFeedbackState.diagnostics` 里合并计数，但仍逐次转发给 renderer——是否折叠展示是 renderer 自己的决定，不是 coordinator 的职责；renderer 在某次 durable 事件上抛错不会中断队列，后续事件仍按完整顺序处理；`activity()` 不写入 `diagnostics`/`failures`；tick 定时器按注入 clock 周期触发、`elapsedMs` 相对 `start()` 计算，`stopDynamic()` 之后立即失效；`finish()` 的收尾顺序恒为停 tick → 清 dashboard → summary → saved → close，之后拒绝任何新输出；`start()` 只能调用一次，`stopDynamic()`/`diagnostic()` 在 `start()` 之前调用抛错；`sink.ts` 的 `reportXxx()` 系列只在 coordinator 活跃期间（`start()` 之后、`finish()` 之前）转发给它，之外退回 bootstrap 出口。观察面是「renderer 的哪个方法按什么顺序、被调用几次」，不是它具体写出的字节。
- **实验级生命周期**：setup 整场至多一次（memoized、无派发不执行）、setup 抛错的结构化 errored 与实验隔离、teardown 恰好一次的全部触发路径（完成/中断/setup 抛错）与有界清理超时、强清兜底注册表的原子性、收尾登记的落盘与启动自愈、`--teardown` 的独立入口语义；钩子起止事件归约进 `experimentHooks` 状态——`started` 建行、`done`/`failed` 摘行、`experiment:progress` 只覆盖对应行的 `detail`（没有对应行时静默忽略）、新的 `plan` 清空残留行。三种 output profile 各自把这份状态渲染成什么字节，由 [E2E · CLI](../e2e/cli.md)「反馈输出格式」在真实进程输出上验收，不在这里断言。
- **early exit**：只有 `passed` 触发、只作用于同一 eval、省略计入 `earlyExitUnstarted`、事件只在实际省略时发出；确定性错误的 run 级 fail-fast 与瞬态 errored 的区分。只断言最终通过数发现不了白跑了本应取消的 attempt——启动集合必须显式断言。
- **budget**：只按已完成实测花费判断（在飞不影响派发是契约不是 bug）、到顶停发在飞跑完、按 experiment 域隔离、未派发导致 incomplete 与退出码 1、成本缺失 warning 的去重与触发前提。
- **超时、缓存与指纹**：外层超时兜底为 errored 且不放弃同 eval 剩余轮次；`passed` 与 `failed` 都是可复用终态而 `errored`/`skipped` 总是重跑；指纹变化只重跑受影响 eval；携带以 attempt 为粒度、未收尾快照是合法来源；执行模式 flag 的携带豁免——`--keep-sandbox` 下留存档内的历史终态不携带、照常派发（failed 档豁免 `failed`、all 档连 `passed` 一起豁免），档外照常携带；`--force`/`--dry` 语义；计数恒等式 `total = reused + running + queued + completed`。
- **汇总与退出码**：verdict 四值互斥、failed 只统计断言不过；退出码按 `(experiment, eval)` 最终判定折叠、完整退出码矩阵（0/1/130、strict、required reporter）；分组通过率的分母口径。
- **启动期错误格式**：coordinator 激活前的错误恒为 `error:` + `fix:` 两行、三种 output profile 同形；库错误类的下一步原样透传。
- **生命周期与资源**：成功、失败、中断三条路径下 sandbox 全部 stop、reporter queue 收尾；预热池边界；生命周期阶段闭集与主链耗时封口；diagnostic 去重与不改判定；逐轮进度行的提取规则；分类账导出的常数往返。资源泄漏通常出现在失败和中断——三条路径缺一不可。

## 不这样测

- 不用 `sleep(100)` 等待调度"应该已经发生"。
- 不断言内部 `Effect.forEach`、Semaphore 或 AbortController 被调用几次。
- 不让 fake scheduler 预先算出生产 Runner 应该启动哪些 attempt；fixture 只控制输入和完成时机。
- 不在 fixture 里复制 budget 的判断公式；`costUSD` 是完成后结算的输入证据，停发与否由生产 Runner 决定。
- 不把全流程汇总 snapshot 当作唯一 Runner 测试；它难以定位 early exit、budget 或资源泄漏。
