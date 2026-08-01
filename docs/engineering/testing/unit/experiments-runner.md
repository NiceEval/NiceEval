# Experiments 与 Runner 怎么测

契约来源：

- [Experiments](../../../feature/experiments/README.md)
- [Experiments Architecture](../../../feature/experiments/architecture.md)
- [Experiments Library](../../../feature/experiments/library.md)
- [Experiments CLI](../../../feature/experiments/cli.md)
- [Runner](../../../runner.md)
- [执行错误类型](../../../feature/error-classification/README.md)
- [错误与警告反馈](../../../error-feedback.md)

Runner 测试关心 Attempt 的集合、开始条件、结束条件、事件与资源释放。
它不锁定内部循环、Promise 数量或 Effect combinator。

本篇使用 fake Agent、Sandbox、Reporter 与时钟测试调度逻辑。
真实进程与真实 Attempt 由 [E2E 功能域 · CLI](../e2e/cli.md) 验收。
Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## 观察面与边界

调度契约的正确观察面是**可观察的调度事实**：哪些 attempt 启动了、任意时刻多少在飞、事件流里出现了什么、资源最终是否释放。
不是内部信号量的调用次数，也不是 Promise 图的形状。

| 契约域                | 观察面                                                                            |
| --------------------- | --------------------------------------------------------------------------------- |
| runs 展开与过滤       | 计划中的 attempt 集合（`--dry` 语义层）                                           |
| 并发上限              | barrier 控制下的在飞计数峰值                                                      |
| early exit / budget   | 启动过的 attempt 列表 + `invocation:earlyExit` / `invocation:budgetExceeded` 事件 |
| 缓存与指纹            | 复用 vs 重跑的 attempt 集合                                                       |
| 退出码折叠            | `InvocationCompletion` 与退出码                                                   |
| 资源生命周期          | fake Sandbox 的 created/stopped 集合、reporter queue 收尾                         |
| 实验级 setup/teardown | 生命周期 Hook 调用计数、收尾登记文件、运行级事件                                  |

## Fixture 规范

Runner fixture 用声明式场景描述 attempt，而不是为每个测试重新拼完整 `EvalDefinition`、Agent、Sandbox 和 Reporter：

```ts
const scenario = runnerFixture({
  attempts: 3,
  maxConcurrency: 2,
  attempts: [
    { evalId: "a", result: "failed", release: "a0" },
    { evalId: "a", result: "passed", waitFor: "a0" },
    { evalId: "b", result: "passed" },
  ],
});
```

`runnerFixture` 提供受控 barrier、记录型 Reporter、fake Agent/Sandbox 和结果读取方法。
它不自行决定 early exit、budget 或调度顺序；这些必须由生产 Runner 决定。
fixture 里的 `costUSD` 是输入证据（该 attempt 完成后结算的实测成本），不复制 Runner 的任何计费逻辑。
所有权与稳定性规则见 [Harness](harness.md)。

时序纪律：并发与调度用 barrier 观察"在飞"状态，不用 `setTimeout` 猜测调度是否已经发生；重试和 backoff 用 `TestClock.adjust` 推进，不做真实等待。
Effect 程序用 `it.effect` 让测试运行时持有 Scope；保存状态的 Layer 要求每例隔离时用独立 `it.layer(...)`。

```ts
it.effect("全局同时在飞的 attempt 不超过 maxConcurrency", () =>
  Effect.gen(function* () {
    const fx = yield* makeRunnerFixture({ maxConcurrency: 2, evals: 5 });
    const fiber = yield* Effect.forkChild(fx.run);

    yield* fx.started.awaitCount(2);
    assert.strictEqual(fx.inFlight.current, 2);

    yield* fx.releaseOne;
    yield* fx.started.awaitCount(3);
    assert.isAtMost(fx.inFlight.maximum, 2);

    yield* fx.releaseAll;
    yield* fiber.await;
  }),
);
```

## 覆盖规范

- **runs 展开与选择**：attempt 总数公式与 runs 的默认值；位置参数前缀 × 实验 `evals` 字段两层交集；谓词的白名单投影、只求值一次、非法返回值的完整报错；experiment 选择器三条规则与零命中反馈。
  template 配对 link 的同源消费(check / --dry / 正常运行同一 linker),以及 conflict / missing 的全矩阵前置报错。
  选择类契约的每条规则都要有"命中"与"不误配"两面。
- **`EvalDescriptor.scoring` 投影与混型保真**：`evalDescriptorOf` 对 `defineEval` 产物投影 `scoring: "pass"`，对 `defineScoreEval` 产物投影 `"points"`。
  未经两个定义函数处理的未包装对象缺少 scoring 时，discovery 明确拒绝；不能用默认 `"pass"` 猜它原本想调用哪个 factory。
  同一 Experiment 选择混合题型时，两类 Eval 全部进入调度、记录与携带，不能在启动期拒绝或静默删掉一类。报告按 scoring 分列通过率与总分，绝不把两种无共同单位的数相加。
- **计分制 attempt 落盘**：`runAttemptEffect` 对 `scoring: "points"` 的 eval 把 `.points(n)` 挣分正确写进 `EvalResult.assertions[].points`、把 `t.score(label, n)` 正确写进 `EvalResult.scoreEntries`（不只是 collector 单元层的孤立证明，这里证明 runner 真的把 collector 的产物接上了落盘字段）；前置 `.gate()` 中止时 `verdict` 为 `failed` 而非 `errored`（断言已记录，不是执行异常）、中止前已经产生的 `scoreEntries` 照实保留、中止后的 `test()` 代码不再执行（后续 `.points()` / `t.score()` 调用不出现在结果里）；没有中止、只是丢分的 attempt（含全部得分点挂掉）`verdict` 为 `passed`——计分制的 `failed` 只有中止一个来源。
- **调度项优先级**：CLI flag → experiment → config → 内置默认的覆盖链逐层可区分；agent/model/flags 只属 experiment，CLI 覆盖报用法错误；labels 的值域校验与 Run 投影。
  **这条链里没有环境变量层**（[边界](../../../architecture.md#配置从代码来凭据从环境来)）。
  这一条按**白名单守护**证明而不是逐个变量写负面 fixture：扫 `src/` 下所有非测试源码实际读取的环境变量名，断言它们全部落在「凭据 + 终端环境」白名单内。
  加一条配置类环境变量回来就会红，不需要预先知道它叫什么名字；白名单本身是那份边界表的机器可读副本，改动它等于改契约。
- **含 eval 层的字段解析链（`timeoutMs`）**：`--timeout` → experiment → eval → config → 无上限，五档逐层可区分。
  区分力最强的一格必测：**config 有值、experiment 没写、eval 写了自己的值时取 eval 的值**——`??` 链少写一层回落时这一格恰好是唯一会红的，其余四格照常通过。
  断言面取 attempt 实际生效的 deadline 与超时消息里的来源标注（`from eval` / `from config`…），不是解析函数的中间返回值；同一份解析结果同时喂给 carry 的资格判据（`executionMs` ≤ 当前上限），两处不分叉。
- **`judge` 的解析链（单条 `{ model }` → experiment → eval → config）**：四档逐层、逐字段可区分。

  没有 CLI judge override。两份只改变 Experiment judge model 的 A/B 必须得到不同配置身份。

  rubric、severity 与 threshold 仍取同一 Eval 定义。

  区分力最强的一格必测——**config 写了 `judge`、eval 也写了自己的 `judge` 时取 eval 的值**。
  再加一格证明它**逐字段合并而不是整体覆盖**：eval 只声明 `model` 时 `baseUrl` 仍从 config 来。
  这条链没有 CLI flag，多出一层就是回归。
  断言面取 judge 断言实际请求到的 model 与端点。
  `judge` 的 `model` / `baseUrl` 进 configHash、`apiKeyEnv` 不进，归下面的指纹输入类别。
- **界面语言的取值链**：`config.locale` → 系统 locale（`LC_ALL` → `LC_MESSAGES` → `LANG`）→ `zh-CN`。
  断言面是 `detectLocale(env)` 的返回值：`config.locale` 在场时压过任何系统变量；未声明或无法归一（`C` / `POSIX` / 空串）时逐级回落而不是报错；niceeval 自己的旧变量（`NICEEVAL_LANG` / `NICEEVAL_LOCALE`）在场也不参与。
- **并发**：全局与实验级上限、全局上限的三层解析与 Provider 推荐值、exclusive Provider 强制串行。
  退避睡眠释放全局槽位，实验级闸全程持有。
  `maxConcurrency: 1` 时，前一 Attempt 进入退避窗口，下一 Attempt 不得启动。
  前一 Attempt 的 `sandbox.cleanup` 未完成时，下一 Attempt 也不得创建沙箱或进入 `sandbox.prepare`。
  用 `TestClock` 与 barrier 观察在飞峰值或分配顺序。
  完整的用户侧搭配见[并发怎么配](../../../feature/experiments/use-case/并发/)。
- **发现顺序与串行下的执行顺序**：
  - 发现结果按项目根相对路径字典序排列。
    数字前缀补零与不补零各一格（`10-` 排在 `2-` 前），再加跨目录与 `.eval.ts` / `.eval.tsx` 同名两格。
  - 数组与 keyed record 的文件内展开顺序；位置参数与 `--tag` 过滤后，剩下条目的相对次序不变。
  - `maxConcurrency: 1` 下 attempt 的实际**开始**顺序等于 `(attempt 序号, eval 发现顺序)`。
     `attempts > 1` 时按轮次交错：全部 eval 的第 0 次先于任何一条 eval 的第 1 次。
  - 这一格用 barrier 记录真实开始序列来断言，不读排序函数的返回值。
  - 并发 > 1 时不断言开始顺序（没有这条契约），只断言结果数组仍按发现顺序。
    两面合起来才证明排序只承诺到输出层。
- **反馈协调器的事件队列纪律**：`FeedbackCoordinator` 对每一类 durable 事件都按 clear→append→redraw 的原子顺序转发给当前活跃 renderer（不止某一种事件；renderer 方法即便是异步的也不交错）；同一去重 key 的诊断在 `RunFeedbackState.diagnostics` 里合并计数，但仍逐次转发给 renderer——是否折叠展示是 renderer 自己的决定，不是 coordinator 的职责；renderer 在某次 durable 事件上抛错不会中断队列，后续事件仍按完整顺序处理；`activity()` 不写入 `diagnostics`/`failures`；tick 定时器按注入 clock 周期触发、`elapsedMs` 相对 `start()` 计算，`stopDynamic()` 之后立即失效；`finish()` 的收尾顺序恒为停 tick → 清 dashboard → summary → saved → close，之后拒绝任何新输出；`start()` 只能调用一次，`stopDynamic()`/`diagnostic()` 在 `start()` 之前调用抛错；`sink.ts` 的 `reportXxx()` 系列只在 coordinator 活跃期间（`start()` 之后、`finish()` 之前）转发给它，之外退回 bootstrap 出口。
  观察面是「renderer 的哪个方法按什么顺序、被调用几次」，不是它具体写出的字节。
- **attempt 级诊断的对外词法与阶段标注（`runner/attempt.ts` 的 `recordDiagnostic` + `runner/feedback/human.ts` 的诊断行）**：经 `ScopedFeedback.diagnostic` 报上来的一条诊断进反馈流时，`code` 恒是作者给的干净字面量——作者省略 `dedupeKey` 时折叠 key 里编进的 attempt 身份不得泄漏成 `code`（`// bug: memory/diagnostic-key-doubles-as-json-warning-code.md`）；`phase` 恒是运行器此刻所处的 `LifecyclePhase`，压过作者 `data` 里的同名字段（作者不能冒充阶段，与 `ScopedFeedback` 不收 phase 参数同一条纪律），`data` 其余字段原样保留。
  人读诊断行的标题是「阶段标签 · `code`」，阶段标签复用失败行同一个投影；没有 phase 的运行级诊断（止损闸、锁接管、budget）标题只有 `code`，不留空的分隔符。
  区分力要覆盖有/无 `dedupeKey`、有/无作者 `data`、`data` 里带一个冒充 `phase` 三面。
  `--json` 侧同一份 `code`/`phase` 的透出归「形态解析与 `--json` 流不变量」类别，字节渲染归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」。
- **human renderer 的面板接线到 `panel.ts`（`runner/feedback/human.ts`）**：面板几何本身由 [Reports 的「面板几何」类别](reports.md#覆盖规范)覆盖，这里只证明 `renderDurableLines`/live dashboard 真的把内容交给 `renderPanel` 而不是各自拼框字符——`panelCapabilityOf(io)` 按 `io.stderr.isTTY` 与 `io.env.NO_COLOR` 正确算出 `mode`；`plan`/`summary`/`saved` 三类事件在 `mode: "boxed"` 时产生可识别的框线字符（`╭`/`├`/`╰`）且面板顺序与分隔（FAILED/PASSED → FAILURES → KEPT SANDBOXES，各自独立成框、之间空行分隔；NEXT 面板内嵌 RESULTS 横隔）符合声明；同一状态在 `mode: "plain"` 或非 TTY 下不产生任何框字符，内容仍完整。
  不断言具体字节内容或列宽算术——那是 panel.ts 自己的几何测试与 [E2E · CLI](../e2e/cli.md)「反馈输出格式」的职责。
- **live 面板的宽度与 ACTIVE 列分配（`runner/feedback/human.ts`）**：
  - 必须包含宽终端场景，例如 fake IO 的 `columns: 200`。
    历史缺陷只在宽终端出现： `// bug: memory/live-dashboard-active-row-width-clamp-mismatch.md`。
  - live 面板跟随终端全宽，不受 100 列上限约束。
    内容与外框使用同一宽度。
  - scrollback 的 plan、summary 与 failures 面板仍封顶 100 列。
  - 身份列按实际出现过的最长值定宽。
    列宽只放宽，不回缩；超宽内容截尾并补 `…`。
  - detail 使用身份列与 elapsed 之外的剩余宽度，每一帧都必须可见。

断言渲染帧的行数组与列位置，不断言内部计算公式。

- **执行错误 message 的一层摘要投影（`agents/shared.ts` 的 diagnose 组装 + `runner/feedback/failure.ts` 的失败事实投影）**：diagnose 组合消息的首行恒为一层可行动摘要（exit code · transcript 状态 · 最后一条 error 事件的首行），output tail 从第二行起按原始换行保留——被测 CLI 输出里的 traceback 框线不得混进首行（docs/feature/experiments/cli.md「运行反馈」：执行错误即时输出一层摘要）；失败事实的 reason 对多行 error message 只取首行、剥控制字节并按摘要上限截断收口，后续行（tail）不进 scrollback。
  区分力：单行 message 原样保留与多行 message 折首行两面都要有；tail 缺失（stdout/stderr 全空）时消息只有首行、不带空尾巴。
- **实验级生命周期**：setup 整场至多一次；无派发时不执行。
  覆盖 setup 抛错的结构化 `errored` 与实验隔离，以及 teardown 在完成、中断、setup 抛错时都恰好一次。
  还要覆盖有界清理超时、强清登记、启动自愈与 `--teardown`。
  生命周期 Hook 起止事件归约进 `experimentHooks`：`started` 建行，`done` / `failed` 摘行，`experiment:progress` 只更新对应行。
  新的 `plan` 清空残留行。
  用例见[环境预置与收尾怎么放](../../../feature/experiments/use-case/生命周期/)。
  字节渲染归 [E2E · CLI](../e2e/cli.md)。
- **scoring 阶段的 judge 推进 detail（`runner/attempt.ts` 接线）**：进入 `scoring.evaluate` 后，collector 的每次 judge 进度回调把 active 行 detail 更新为 `judge k/n · <检查方式>`。
  契约见 [CLI · Attempt 阶段](../../../feature/experiments/cli.md#attempt-阶段)。
  无 judge 断言的 attempt 在 scoring 阶段不产生任何 detail 文本——不存在与阶段词重复的静态占位文案。
  断言面是 feedback 事件流里的 progress 文本，不断言渲染字节。
- **Judge 预检的运行级行**：`precheck` 起止事件归约进 `RunFeedbackState.activePrecheck`。
  `started` 建行，`done` / `failed` 清行。
  预检发生在派发前，因此 Attempt 始终保持 `queued`，不改变计数恒等式。
  live 面板把它排在实验生命周期 Hook 与 Attempt 行之前。
  这里断言 reducer 状态与事件序；字节渲染归 [E2E · CLI](../e2e/cli.md)。
- **Judge 预检失败的降级**（契约见 [Judge · 派发前预检](../../../feature/judge/library.md#派发前预检)）：预检失败时，含 judge 断言的 eval 的全部计划 attempt 不派发、逐条落成 `errored`，并照常落盘。
  错误形状是 `code: "judge-precheck-failed"` 加 `phase: "judge.precheck"`。
  不含 judge 断言的 eval 照常派发并产出 verdict；同一批里两类 eval 都要有，才有区分力。
  还要覆盖两个不预检的场景：未配置 judge，以及含 judge 的 eval 全部命中携带。
- **探测预算逐次独立**：每次探测各自拥有完整的 20 秒超时预算。
  区分力场景：第一次探测超时耗尽后，第二次探测仍以完整预算发出——不是拿着已 abort 的 signal 立即失败。
  用 fake fetch 断言两次调用的 signal 各自独立、第二次调用真实发生。
- **PLAN 的实验并发附注**：任一选中实验声明 `maxConcurrency` 时，`start` 事件带 `experimentConcurrency`（仅收声明了的实验）；没有任何实验声明时整个字段省略。
  human PLAN 行的附注文本（`concurrency 19 (from flag) · mempal ≤1`）断言到格式化输出，字节渲染归 [E2E · CLI](../e2e/cli.md)。
- **PLAN 的全局并发来源标注**：human PLAN 行的 `concurrency` 值带取胜层。
   `from flag` / `from config` / `from <provider> default` 三层来源各一条区分力场景，断言到格式化输出。
  来源不进 `--json` 的 `start` 事件（契约见 [CLI · 运行中的 live 面板](../../../feature/experiments/cli.md#运行中的-live-面板)）。
- **已了结 attempt 按 verdict 分项**：reducer 不保留笼统的完成数，每一条了结的 attempt 落进 `passed` / `failed` / `errored` / `skipped` 之一（契约见 [CLI · 运行中的 live 面板](../../../feature/experiments/cli.md#运行中的-live-面板)）。
  断言面：`attempt:complete` 按事件携带的 `verdict` 落项，四值都要有区分力场景（同一批事件里换 verdict，落项跟着变，不是恒落同一项）；`attempt:early-exit` 与 `budget-exhausted` 落 `skipped` 而非 `passed`／`failed`——未跑出 verdict 的了结不冒充结论；携入结果的 verdict 留在 `reused`、不摊进四项（`plan` 事件带 `reusedFailures` 时四项仍全为零）；`lock-wait` 等到锁时把 `carried` 迁 `reused`、`dispatched` 迁 `queued`，两者都不直接落结局项。
  恒等式 `total = reused + running + elsewhere + queued + passed + failed + errored + skipped` 在每一个事件之后逐步断言，不只在末尾断言一次。
  字面渲染（首行九项的顺序、零值不省略、窄终端下按 `skipped` → `errored` → `passed` 丢弃零值项）归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」。
- **Invocation 公共回调面**：`Reporter.onInvocationStart` 只接收 `(evals, shape?)` 两个参数——类型层用编译 fixture 证明，三参数或裹带 `agent` 的旧签名不能编译；tsx 直接运行一次最小 Invocation 时 `onInvocationStart` 与 `onInvocationComplete` 各真实触发恰好一次，`onEvalComplete` 按 attempt 数触发；`InvocationSummary` / `InvocationShape` 序列化后不出现顶层 `agent` / `model` 字段（结构断言，不是类型断言）；跨配置（多 agent 或多实验）场景下 `results` 内逐条 `EvalResult.agent` 仍分别正确，顶层摘要不塌缩成一个值。
- **Experiment 收尾协议**：`experiment:complete` 事件在该 Experiment `teardown`（若声明）完成之后、`invocation:summary` 之前恰好触发一次，携带的 `experimentId` / `completedAt` / `carriedResults` / `diagnostics` 与该 Experiment 实际的收尾结果一致；多 Experiment 的一次 Invocation 里各自的 `experiment:complete` 独立触发、顺序与各自完成时点一致，不等到全部 Experiment 收尾才批量触发；实验域诊断（teardown 失败、budget 不可执行等）经 `ExperimentDiagnosticInput` 累积进正确的 experimentId 桶，不同 Experiment 的诊断不串桶，相同 `dedupeKey` 只在同一个 Experiment 内折叠计数。
- **`ctx.fact()` 的作用域归属**：sandbox hook / agent setup·send·teardown 经 `ctx.fact()` 上报的落进对应 attempt 的 `EvalResult.facts`（不落进任何其它 attempt）；experiment setup/teardown（含收尾自愈路径 `recoverStaleTeardownRegistration`）经 `ctx.fact()` 上报的累积进该 Experiment 的 `experiment:complete` 事件 `facts` 字段，按 experimentId 分桶、不同 Experiment 不串桶；两级互不混淆，runner 按当前回调所处生命周期自动归属，调用方不能指定层级。
  同一作用域内同 key 后写覆盖先写（跨 setup/send/teardown 三个不同回调仍是同一 attempt 作用域）。
  key 不匹配 `[a-z0-9._-]{1,64}` 或 value 非标量（对象/数组/`null`/`undefined`）时抛错，错误信息带上具体 key/value 与修正提示；合法调用不受影响。
- **用例锁与并发 Invocation**：取锁时机——派发时刻逐用例非阻塞取锁、排队用例不持锁（以「锁目录条目数不超过在跑用例数」为断言面）、全携带用例不取锁、等锁用例不触发实验级 setup、`--dry` 只读锁目录不取锁（计划行 `locked` 标注）；等待语义——撞新鲜锁的用例挂起、并发位转派给下一条未被锁的用例（以在飞峰值与启动集合为断言面），挂起用例不占全局并发位，计入独立的 `elsewhere` 计数且与 `queued` 互斥、计数恒等式成立；多开分工——两条 runEvals 指向同一 `niceevalRoot`、选择重叠时各自认领不同用例并行推进（两边真实派发的用例集不相交、并集覆盖选择集、总在飞峰值可达两边全局上限之和）；实验闸租约——声明 `maxConcurrency` 的实验名额域跨 runEvals 共享（同一 `niceevalRoot` 两条并行 runEvals 且 `maxConcurrency: 1` 时该实验总在飞峰值恒为 1；租约条目的心跳/过期/rename 接管复用用例锁纪律；两边解析出的 N 不一致时生效名额为最小值；撞满名额报一条按实验折叠的 `gate-lease-waiting` warning，同时给出**生效名额**与**本次运行声明的 N**——两者不等即 min-N 被别的运行夹低，这是「声明了 3 却只跑 1 条」的唯一解释）；取锁后重查携带——取到锁即重做携带规划，**无条件**、不附加「等过锁 / 接管过」之类前置判据（干净取锁：对方跑完并释放锁后，本进程第二波取到空锁的用例不得重跑对方已落盘的 attempt；派发路径上按用例数各读一次收窄读取面、不走全树扫描）；重查结论与派发前的携带规划共用同一份资格判据，两处不分叉；重查后的计数迁移——指纹匹配携入且计数 `elsewhere` 迁 `reused`、不匹配转 `queued` 自跑、`attempts` 部分携入部分补跑，三面都要有区分力场景；心跳与接管——续租与等待轮询按注入 clock 推进、过期判据（心跳落后超过阈值）、接管 rename 的互斥（两个竞争者恰一个获得执行权、输者转入等待）、接管产生去重的 `lock-taken-over` warning；释放路径——正常收尾、中断、实验 setup 抛错各路径锁文件都被删除，遗留过期锁被下一次运行接管（不需要手工清理）；执行模式组合——`--rerun all` 等待后全部自跑、`sandboxReuse: true` 的 Experiment 等待后不消费携带； `lock_wait` 起止事件与 `elsewhere` 计数归约进反馈状态，字节渲染归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」。
  锁文件走隔离 `niceevalRoot` 下的真实文件系统（每例独立临时根，不许写进真实仓库的 `.niceeval/`），时间推进用 `TestClock`，不做真实等待。
  逐条目原子文件原语（命名、tmp→fsync→rename→fsync 目录写、损坏跳过的全目录扫描、rename 墓碑认领互斥）抽在 `src/shared/entry-file-store.ts`（用例锁、收尾登记、留存清单三个消费方共用），由 `src/shared/entry-file-store.test.ts` 独立覆盖：写入/读取往返、全目录扫描跳过损坏条目与点文件、缺失目录不抛错、认领在两个并发调用者之间互斥（恰一个拿到 `true`）。
- **early exit**：只有 `passed` 触发、只作用于同一 eval、省略计入 `earlyExitUnstarted`、事件只在实际省略时发出；确定性错误的 run 级 fail-fast 与瞬态 errored 的区分。
  只断言最终通过数发现不了白跑了本应取消的 attempt——启动集合必须显式断言。
- **逐 eval 结论行的纯派生（`runner/feedback/eval-conclusions.ts` 的 `evalConclusionRows`）**：纯跑满给出 `attempts`/`passed`/`rate`，代表 attempt 取序号最大的一条；首过即停触发（该 eval 确有省略）给出 `attempts`/`planned`/`unstarted`/`reason=early_exit`，代表 attempt 取命中通过的那一条；并发下已经在飞、passed 触发省略之前就跑完的 attempt 照常计入 `attempts`，不是幽灵 `unstarted`；fail-fast 未派发复用同一个 `attempt:early-exit` 事件类型，函数按 `diagnostics` 里配套的 `fail-fast:` 记录扣除对应份额，扣完为零则按跑满渲染，不得把 fail-fast 或 budget 未派发误标 `reason=early_exit`；按 `results` 中每个 `(experiment, eval)` 首次出现的顺序返回。
  reducer 侧只断言 `RunFeedbackState.earlyExitByEval` 按 `(experiment, eval)` 累计原始计数（不剔除 fail-fast，剔除是 `evalConclusionRows` 的职责）。
  字面渲染（人读结论行与 `--json` 的 `eval` 事件）归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」在真实进程输出上验收。
- **budget**：只按已完成实测花费判断（在飞不影响派发是契约不是 bug）、到顶停发在飞跑完、按 experiment 域隔离、未派发导致 incomplete 与退出码 1、成本缺失 warning 的去重与触发前提。
- **超时、缓存与指纹**：外层超时回退为 errored 且不放弃同 eval 剩余轮次；**超时证据保全**——超时 attempt 的 events/usage 保留截至中断的已收值(fixture 要让中断前确有事件,证明不是空壳重建)、收尾段补折叠 workspace.diff、`error.phase` 是中断时已打开的阶段;`passed` 与 `failed` 都是可复用终态而 `errored`/`skipped` 总是重跑；指纹变化只重跑受影响 eval；**`timeoutMs` 不进指纹哈希、以携带判据参与**——提高上限旧终态全部携带、调低上限使 `executionMs` 超线的旧终态重跑(fixture 两个方向都要有区分力场景)；**资格判据量的是 `executionMs` 不是 `durationMs`**——一条排队远长于执行的历史终态在「排队+执行 > 新上限、执行 < 新上限」这一格必须携带,这一格是拿含排队的量去比时唯一会红的;`executionMs` 缺失的历史条目回落到 `durationMs`(方向是多跑,不误采信)；**指纹输入的进 / 不进两侧都要有区分力场景**——`flags` 整袋进(任一键任一值不同即重跑,无逐键豁免)、`model` / `reasoningEffort` / agent 名 / sandbox 解析参数 / `strict` / `judge` 的 `model` 与 `baseUrl` 进,而 `attempts` / `labels` / 调度字段 / 生命周期 Hook 函数体 / `judge.apiKeyEnv` 改动不作废携带；**`--accept <selector>` 的授权面**(逐条类别见下面几条独立条目)；**携带条目合入新 Run 时按本次规划重打 `fingerprint`**,`facts`/`locator`/`artifactBase`/判定原样携带(fixture 断言携带条目的 facts 仍是产出它那一轮的值)；携带以 attempt 为粒度、未收尾 Run 是合法来源；**出身门**——落盘带 `sandbox.reused` 的历史终态在任何模式下都不携带、照常派发,与本次是不是复用运行无关；执行模式 flag 的携带豁免——`--keep-sandbox` 下留存档内的历史终态不携带、照常派发（failed 档豁免 `failed`、all 档连 `passed` 一起豁免），档外照常携带；**`--rerun` 三档各自的携带口径**——不带(`passed`+`failed` 都携带)、单独使用与 `failed` 档(只携带 `passed`，历史 `failed` 全部重新派发)、`all` 档(一律不携带)，三档在同一份含 `passed`/`failed`/`errored` 的历史 fixture 上产出三种不同的派发集合；`--dry` 语义；计数恒等式 `total = reused + running + elsewhere + queued + passed + failed + errored + skipped`。
- **`--accept` 的授权判据**：四支 selector(`config:` / `source:` / `data:` / `opaque:no-manifest`)各自命中本类差异时携带。
  同一条 eval 另有一条未授权差异时仍重跑,两个方向都要有区分力场景。
  selector 按路径命中:同一路径带两个不同旧值的两批历史条目,一条 selector 全部携带,各自的 `carriedAccepting` 记自己的旧值新值。
  与 `--rerun failed` 同用不冲突:被授权的 `failed` 条目仍被口径门拦下重跑,`passed` 照常携带。
  selector 在本次计划里算不出对应差异是空转,按启动期用法错误报出并列出本次可授权的原因,不静默通过;与 `--rerun all` 同用同样是用法错误。
- **`--accept` 的重锚与留痕**：被授权携入的条目按本次口径重打指纹,留痕两处都要断言——条目的 `carriedAccepting` 逐条记 selector 与旧值新值摘要,本次 Run 另记一条 `accept` diagnostic。
  下一次不带这个 flag 的运行照常命中,这一格证明它是重锚而不是一次豁免。
- **`--accept` 打不开的门**：终态、资格、出身、模式四道门各要一条。
  缺失序号与 `errored` / `skipped`、`executionMs` 超过当前上限、带 `sandbox.reused` 的历史条目、落在留存档内的条目,授权都不放行。
- **manifest 的算出与相减**：每次 Run 按 eval 算一份指纹输入清单,配置面、源码面、数据面与指纹同一份输入。
  新旧相减给出带名字的差异:`config:` 字段的旧值新值、`source:` / `data:` 的内容哈希变化与文件增删。
  历史条目缺清单时算不出的只有源码面与数据面,如实合并成一条 `opaque:no-manifest`,不按「没差异」放过;配置面从 `run.json` 重建,照常给具名差异。
  这一格要两个方向:源码面没变时单独授权那条具名配置差异即可携带(反事实指纹相等就是证明),源码面也变时要连 `opaque:no-manifest` 一起授权才携带。
- **`--dry` 的逐条作废原因**：要派发的行各标一个原因,词表是六道门加缺历史门的 `new` / `incompatible`,全部携带的行标 `carried`。
  九个原因各要一条能把它与相邻原因区分开的 fixture,`stale` 行另要断言按差异聚合出的分组与可复制的 accept 命令。
  同一 selector 对应多个不同旧值时按「selector × 旧值→新值」各成一组,`accept:` 命令行是同一条。
- **`incompatible` 与 `new` 的区分**:同一次计划里一条 eval 的历史落在版本不同的快照里、另一条从没跑过,两行的原因词不同。
  把不兼容历史一并算作「没有任何历史」的实现只在这一格会红。
  判定链的另一半在读取面:不兼容的快照只按目录名认坐标(它的文件按格式规则不解析)。
  断言面是 `loadCarryInputs` 的 `incompatibleHistory` 收进了那些坐标,而 `results` 一条都没多。
- **不带值 `--accept` 的 TTY 交互选择语义**：逐条问下来,只有明确选「复用」的那些 selector 进带值执行路径。
  选「重跑」与读入中断都不授权,后者是把中断当空答案、按默认放行的实现唯一会红的那一格。
  可 accept 的分组逐条都要被问到,提问文本点到每条 selector,人才知道自己在为哪条差异做决定。
- **等价命令的拼装**：先打印的那条命令只含已授权的 selector,一个都没选时它就是原命令本身。
- **非 TTY 下不带值的 `--accept`**：按启动期用法错误报出,错误信息除了「要带 selector」还要列出本次计划里真实可授权的原因清单(与 selector 空转报错同一份枚举),两个语言各断言一次。
- **尾随 eval 前缀逐个必须命中**：每个尾随前缀在选中实验的发现集里匹配 0 条时,按启动期用法错误报出,不静默丢弃。
  「一个前缀命中、另一个零命中」是唯一会红的那一格——按整体命中数判空的实现会放过它。
- **超时归属**：超时把 attempt 转成 `errored` 时,`error.timeout` 三样都要断言——触发层、生效的上限值、值来自哪一层。
  attempt deadline 与命令显式 `timeout` 两条触发路径各要一条;来源层取自 `timeoutMs` 的解析链,fixture 要让两层的值不同才有区分力。
- **eval 源码闭包的构成与确定性**：闭包含三样东西——eval 文件字节、项目根内导入图的递归展开、 `loadYaml` / `loadJson` / `loadText` 读入的数据文件内容。
  进 / 不进两侧各要区分力场景：改被引用 helper 的一行使**引用它的那些 eval** 重跑而未引用的照常携带；改测试集一行只作废对应那条 eval；`node_modules` 下的包与动态 `import()` 改动不作废。
  判据文件经 `loadText` 读入时改一字节即重跑，同一文件换 `fs` 直读不触发。
- **数据 loader 的调用面**：同一份数据文件用项目根相对字符串与 `URL` 两种入参读入，登记与指纹等价——两种写法算出同一个哈希，这一格在只支持 string 的实现下会红。
  发现期之外调用 `loadText` / `loadYaml` / `loadJson` 立即报错，错误文案含问题与下一步，不得静默跳过登记。
- **普通本地上传的 transfer manifest**：改树内一个文件的一字节、增加文件、删除文件，三种改动都使使用上一份 manifest 的 Attempt 重跑；改权限位与修改时间不作废；`ignore` 命中的生成物变化不作废。
  首次真实执行记录 source tree、内容摘要、目标与 send 区间；源码闭包不变时重算历史 manifest，源码变化时不信任旧依赖集合并重跑。
  失败面覆盖 source 不存在、source 落到项目根外、符号链接逃逸与目录展开为空；每一条都在上传调用点报含下一步的错误。
- **普通上传的相对 source**：项目根相对字符串与 Eval 模块相对 `URL` 展开同一棵树时，transfer manifest 相同。
  同一模块导出两条 Eval 时，manifest 归当前 Attempt，不形成模块级共享表。
- **未读取文件不进入身份**：同目录 solution、生成器或参考答案若未被 Eval 读取，内容变化不作废该 Eval。
  是否进入 image 由 Environment closure 与 `.dockerignore` 证明，不靠 `privateFiles` 登记。
- **eval 源码闭包的确定性**：同一份源码在两种不同的目录遍历顺序下算出同一个哈希。
  它靠两件事成立——按项目根相对路径排序、循环导入按解析后绝对路径去重。
  任缺一条哈希都会随环境漂移，症状是缓存永不命中而不是结果出错，只有这一格会红。
- **汇总与退出码**：verdict 四值互斥、failed 只统计断言不过；退出码按 `(experiment, eval)` 最终判定折叠、完整退出码矩阵（0/1/130、strict、required reporter）；分组通过率的分母口径。
- **启动期错误格式**：coordinator 激活前的错误恒为 `error:` + `fix:` 两行、两种输出形态同形；库错误类的下一步原样透传。
- **用户 `.ts` 装载与宿主模块形态**（`bin/niceeval.js` + 包 `exports` 表）：CLI 装载用户 `.ts` 不受宿主 `package.json` 的 `type` 影响（契约见 [docs/cli.md「装载用户 .ts」](../../../cli.md)）。
  单元层以数据面守护两条不变量：exports 每个带 `import` 条件的出口同时带 `require` 条件、且两者指向真实存在的文件；bin 入口同时注册 tsx 的 ESM 与 CJS 两个 hook——两者缺一，CJS 宿主（`npm init -y` 默认）下 `init` 刚生成的 config 就装载不了（`// bug: memory/tsx-dynamic-import-require-cycle.md`）。
  真实 CJS 宿主的进程级验收归 [E2E · CLI](../e2e/cli.md)，init 的 ESM 建议提示行同归该处，单元层不起 CLI 进程。
- **形态解析与 `--json` 流不变量**：`resolveOutputForm` 只有两个结果——`--json` 即机器面，否则人读文本；**不读任何 CI 环境变量**（fixture 要在设置了 `CI=true` 的环境下证明结果只由 flag 与 TTY 决定），TTY 只决定人读文本的版式；`--json` 的事件流不变量——单一 stdout 有序流(stderr 只留启动期错误)、每行一个合法 JSON 对象且首行 `start` 事件携带 `format`/`schemaVersion`、字段名复用 Results 词表、失败不做 suppression 逐事件给出（人读文本才有展开上限 10）、空闲 30 秒 `progress` 心跳且永久事件重置计时、`result` 事件的 `junit` 字段只在传了 `--junit` 时出现、`--dry --json` 是单 JSON 文档不是流。
  字节级渲染归 [E2E · CLI](../e2e/cli.md)，这里以 reducer/renderer 的事件序列与状态为断言面。
- **生命周期与资源**：成功、失败、中断三条路径下 sandbox 全部 stop、reporter queue 收尾；预热池边界；生命周期阶段闭集与主链耗时封口；diagnostic 去重与不改判定；逐轮进度行的提取规则；分类账导出的常数往返。
  资源泄漏通常出现在失败和中断——三条路径缺一不可。
- **止损闸（空间轴消费）**：触发——终局失败携带 `scope: "eval"` 只停本 eval 剩余 attempt、`"experiment"` 停全实验且同批其它实验不连坐；组合——可重试失败被重试吸收不落闸、耗尽后的终局失败才读 scope；幂等与不可逆——并发重复声明按 dedupeKey 折叠成一条 `dispatch-halted` 诊断、落闸后在飞 attempt 成功不重开派发；闸只停派发不抢占——在飞 attempt 照常跑完落账、等待集中同闸 attempt 经 interruption 中止；记账——未派发计 `unstarted`、完成状态 `incomplete`、退出码由观察到失败的 `errored` attempt 判红；teardown 边界——实验级 teardown 抛声明降级普通诊断、per-attempt teardown 抛声明照常落闸且不改 verdict；诊断双通路——反馈流通知与 `run.json` 的 `dispatch-halted`（`data.scope` / `data.evalId`）同源互不派生。
- **派发前资源获取失败的归一化**：`sandboxReuse` 的实例创建、Case 就绪与寿命确认都在复用池内完成。
  任一步失败只让这条 attempt 落 `errored`，phase 为 `sandbox.create`、message 保留原始正文。
  同批其它实验照常跑完，整次运行照常收尾出汇总。
  Hook 里抛的 `ExperimentFatalError` 走与 attempt 内抛出同一条空间轴回执链，照常落实验闸。
  区分力在「失败不冒充中断」：这类失败不得产生 `interrupted` 诊断。
  `// bug: memory/experiment-fatal-presented-as-user-interrupt.md`
- **沙箱内 OTLP 采集器的启动韧性**：
  - 远程沙箱在沙箱内启动采集器，并等待端口写回。
    这条路径没有外层重试，因此启动逻辑自己重试。
  - 每轮使用不同的脚本、span 和端口路径。
    开始下一轮前先终止上一轮进程，防止迟到写入和孤儿进程。
  - 重试耗尽才抛错。
    错误包含等待预算、轮次和采集器日志。
    首轮成功时不重试。
  - 第一层 Fixture 用脚本化 fake Sandbox，观察启动轮数、路径隔离和旧进程终止。
  - 第二层把 `runShell` 交给真实 `/bin/sh`，并让 `writeText` / `writeBytes` 真实落盘。
    它证明脚本语法、端口监听和 POST 200，也证明采集器立即退出时不会耗完整轮等待预算。

相关台账：
[insandbox-otlp-port-wait-3s-no-retry](../../../../memory/insandbox-otlp-port-wait-3s-no-retry.md)。

- **共享 Run activity 不占 attempt 位**（[Run 级共享准备](../../../feature/experiments/architecture.md#run-级共享准备构建协调的预算)）：

  - BuildKey 构建与 `agent.artifact.prepare` 在独立构建并发下推进时，attempt 在飞计数与 `maxConcurrency` 槽位不变。
  - live 面板把共享准备显示为运行级 active 行，不占 attempt active 位。
  - 共享构建 duration 只在 `RunMeta.timings` 出现一次，任一 attempt 的 `executionMs` 不含该段。
  - fixture 要有非零共享构建 + 至少一个依赖 attempt，证明两者可区分。
  - 依赖某个 BuildKey 的 attempt 等到该 key 登记 locator 才派发；同批不依赖它的 attempt 在构建仍在进行时就已开跑。
- **build failure 的 Run origin**：

  - 确定性构建失败时，依赖该 BuildKey 的 fresh attempt 全部 `errored`。
  - 每条 `error.origin` 为 `scope: "run"`，且 `timingNodeId` 指向同一个 `sandbox.build` activity。
  - 不伪造 `sandbox.create` 或其它 attempt 锚点。
  - 不依赖该 key 的 attempt 照常派发；carried attempt 不因查看历史结果触发构建。
- **全 skipped 启动错误**：

  - 平台、能力或 locator 不可用在只读 physical planning 聚合报错,整个 Run 零资源失败,不落 `skipped`。
  - 此时零 Sandbox 创建，不静默跑完再汇总。
  - 集合里仍有可派发 eval 时，仅缺能力的那些 skipped、其余照常。
  - 「全 skipped 才升级」与「部分 skipped 继续」两面都要有区分力。
- **live feedback 的未知 activity 通用投影**：

  - Run / attempt 的 feedback 与 `--json` 对未登记 activity key 使用 producer 的 `label` 通用投影。
  - 不需要 switch 穷尽；未知 key 不改变计数恒等式、verdict 折叠或 attempt active 位。
  - 锚点本地化标签只覆盖 `LifecyclePhase` 闭集。
  - fixture 塞一个官方未列 key，断言仍可见且不进锚点标签表。

## 不这样测

- 不用 `sleep(100)` 等待调度"应该已经发生"。
- 不断言内部 `Effect.forEach`、Semaphore 或 AbortController 被调用几次。
- 不让 fake scheduler 预先算出生产 Runner 应该启动哪些 attempt；fixture 只控制输入和完成时机。
- 不在 fixture 里复制 budget 的判断公式；`costUSD` 是完成后结算的输入证据，停发与否由生产 Runner 决定。
- 不把全流程汇总 snapshot 当作唯一 Runner 测试；它难以定位 early exit、budget 或资源泄漏。
