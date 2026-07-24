# Experiments 与 Runner 怎么测

契约来源：[Experiments](../../../feature/experiments/README.md)、[Experiments Architecture](../../../feature/experiments/architecture.md)、[Experiments Library](../../../feature/experiments/library.md)、[Experiments CLI](../../../feature/experiments/cli.md)、[Runner](../../../runner.md)、[执行错误类型](../../../feature/error-classification/README.md)、[错误与警告反馈](../../../error-feedback.md)。Runner 测试关心 attempt 的集合、开始条件、结束条件、事件与资源释放，不锁定内部循环、Promise 数量或 Effect combinator。本篇的缝：fake Agent / Sandbox / Reporter 与时钟，测其上的调度逻辑；缝的真实侧（真实进程与真实 attempt）由 [E2E 功能域 · CLI](../e2e/cli.md) 验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## 观察面与边界

调度契约的正确观察面是**可观察的调度事实**：哪些 attempt 启动了、任意时刻多少在飞、事件流里出现了什么、资源最终是否释放。不是内部信号量的调用次数，也不是 Promise 图的形状。

| 契约域 | 观察面 |
|---|---|
| runs 展开与过滤 | 计划中的 attempt 集合（`--dry` 语义层） |
| 并发上限 | barrier 控制下的在飞计数峰值 |
| early exit / budget | 启动过的 attempt 列表 + `invocation:earlyExit` / `invocation:budgetExceeded` 事件 |
| 缓存与指纹 | 复用 vs 重跑的 attempt 集合 |
| 退出码折叠 | `InvocationCompletion` 与退出码 |
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
- **计分制 attempt 落盘**：`runAttemptEffect` 对 `scoring: "points"` 的 eval 把 `.points(n)` 挣分正确写进 `EvalResult.assertions[].points`、把 `t.score(label, n)` 正确写进 `EvalResult.scoreEntries`（不只是 collector 单元层的孤立证明，这里证明 runner 真的把 collector 的产物接上了落盘字段）；前置 `.gate()` 中止时 `verdict` 为 `failed` 而非 `errored`（断言已记录，不是执行异常）、中止前已经产生的 `scoreEntries` 照实保留、中止后的 `test()` 代码不再执行（后续 `.points()` / `t.score()` 调用不出现在结果里）；没有中止、只是丢分的 attempt（含全部得分点挂掉）`verdict` 为 `passed`——计分制的 `failed` 只有中止一个来源。
- **调度项优先级**：CLI flag → experiment → config → 内置默认的覆盖链逐层可区分；agent/model/flags 只属 experiment，CLI 覆盖报用法错误；labels 的值域校验与快照投影。
- **并发**：全局与实验级上限、全局上限的三层解析与 provider 推荐值、exclusive provider 强制串行、退避的槽位持有期差（退避睡眠释放全局位、实验级闸全程持有：`maxConcurrency: 1` 下一个 attempt 进入退避窗口时，同实验下一个 attempt 不启动，退避结束跑完后才放行；退避用 `TestClock` 推进）、实验级闸覆盖沙箱收尾（前一 attempt 的 `sandbox.teardown` 钩子未完成时，后一 attempt 的沙箱创建 / `sandbox.setup` 不开始——fake sandbox 钩子内 barrier 观察）、瓶颈优先分配、等待 setup 不占位、被中止者不泄漏槽位。每条都以在飞峰值或分配顺序为断言面。
- **反馈协调器的事件队列纪律**：`FeedbackCoordinator` 对每一类 durable 事件都按 clear→append→redraw 的原子顺序转发给当前活跃 renderer（不止某一种事件；renderer 方法即便是异步的也不交错）；同一去重 key 的诊断在 `RunFeedbackState.diagnostics` 里合并计数，但仍逐次转发给 renderer——是否折叠展示是 renderer 自己的决定，不是 coordinator 的职责；renderer 在某次 durable 事件上抛错不会中断队列，后续事件仍按完整顺序处理；`activity()` 不写入 `diagnostics`/`failures`；tick 定时器按注入 clock 周期触发、`elapsedMs` 相对 `start()` 计算，`stopDynamic()` 之后立即失效；`finish()` 的收尾顺序恒为停 tick → 清 dashboard → summary → saved → close，之后拒绝任何新输出；`start()` 只能调用一次，`stopDynamic()`/`diagnostic()` 在 `start()` 之前调用抛错；`sink.ts` 的 `reportXxx()` 系列只在 coordinator 活跃期间（`start()` 之后、`finish()` 之前）转发给它，之外退回 bootstrap 出口。观察面是「renderer 的哪个方法按什么顺序、被调用几次」，不是它具体写出的字节。
- **human renderer 的面板接线到 `panel.ts`（`runner/feedback/human.ts`）**：面板几何本身由 [Reports 的「面板几何」类别](reports.md#覆盖规范)覆盖，这里只证明 `renderDurableLines`/live dashboard 真的把内容交给 `renderPanel` 而不是各自拼框字符——`panelCapabilityOf(io)` 按 `io.stderr.isTTY` 与 `io.env.NO_COLOR` 正确算出 `mode`；`plan`/`summary`/`saved` 三类事件在 `mode: "boxed"` 时产生可识别的框线字符（`╭`/`├`/`╰`）且面板顺序与分隔（FAILED/PASSED → FAILURES → KEPT SANDBOXES，各自独立成框、之间空行分隔；NEXT 面板内嵌 RESULTS 横隔）符合声明；同一状态在 `mode: "plain"` 或非 TTY 下不产生任何框字符，内容仍完整。不断言具体字节内容或列宽算术——那是 panel.ts 自己的几何测试与 [E2E · CLI](../e2e/cli.md)「反馈输出格式」的职责。
- **live 面板的宽度与 ACTIVE 列分配（`runner/feedback/human.ts`）**：宽终端等价类必须显式存在（fake io `columns: 200` 一类,历史 bug 恰在窄终端测不出——`// bug: memory/live-dashboard-active-row-width-clamp-mismatch.md`）。覆盖:live 面板行宽跟随终端全宽(不被 100 列上限截断,行内容与外框同一宽度值,phase/detail 文本出现在渲染帧里且不被框吃掉);scrollback 永久面板(plan/summary/failures)仍封顶 100;身份列按实际出现过的最长值定宽——短 id 不垫空格、列宽只放宽不回缩(两帧之间同列宽度单调)、各自的封顶比例生效、超宽截尾补 `…`;detail 拿到身份列与 elapsed 之外的全部剩余宽度,任何一帧都非零可见。断言面是渲染帧的行数组与列位置,不是内部算式。
- **执行错误 message 的一层摘要投影（`agents/shared.ts` 的 diagnose 组装 + `runner/feedback/failure.ts` 的失败事实投影）**：diagnose 组合消息的首行恒为一层可行动摘要（exit code · transcript 状态 · 最后一条 error 事件的首行），output tail 从第二行起按原始换行保留——被测 CLI 输出里的 traceback 框线不得混进首行（docs/feature/experiments/cli.md「运行反馈」：执行错误即时输出一层摘要）；失败事实的 reason 对多行 error message 只取首行、剥控制字节并按摘要上限截断收口，后续行（tail）不进 scrollback。区分力：单行 message 原样保留与多行 message 折首行两面都要有；tail 缺失（stdout/stderr 全空）时消息只有首行、不带空尾巴。
- **实验级生命周期**：setup 整场至多一次（memoized、无派发不执行）、setup 抛错的结构化 errored 与实验隔离、teardown 恰好一次的全部触发路径（完成/中断/setup 抛错）与有界清理超时、强清兜底注册表的原子性、收尾登记的落盘与启动自愈、`--teardown` 的独立入口语义；钩子起止事件归约进 `experimentHooks` 状态——`started` 建行、`done`/`failed` 摘行、`experiment:progress` 只覆盖对应行的 `detail`（没有对应行时静默忽略）、新的 `plan` 清空残留行。两种输出形态各自把这份状态渲染成什么字节，由 [E2E · CLI](../e2e/cli.md)「反馈输出格式」在真实进程输出上验收，不在这里断言。
- **judge 预检的运行级行**：`precheck` 起止事件归约进 `RunFeedbackState.activePrecheck`——`started` 建行、`done` 清行，两者都不触碰 `total = reused + running + queued + completed` 计数不变量（预检发生在派发之前、attempt 全程保持 `queued`）；live 面板把这行排在实验钩子行与 attempt 行之前（发生在最前的解释项）；TTY 的 `appendDurable` 对 `precheck` 不写 scrollback，非 TTY / `--json` 起止各产出一个永久事件。渲染成什么字节由 [E2E · CLI](../e2e/cli.md)「反馈输出格式」验收，这里只断言 reducer 状态与事件序。
- **Invocation 公共回调面**：`Reporter.onInvocationStart` 只接收 `(evals, shape?)` 两个参数——类型层用编译 fixture 证明，三参数或裹带 `agent` 的旧签名不能编译；tsx 直接运行一次最小 Invocation 时 `onInvocationStart` 与 `onInvocationComplete` 各真实触发恰好一次，`onEvalComplete` 按 attempt 数触发；`InvocationSummary` / `InvocationShape` 序列化后不出现顶层 `agent` / `model` 字段（结构断言，不是类型断言）；跨配置（多 agent 或多实验）场景下 `results` 内逐条 `EvalResult.agent` 仍分别正确，顶层摘要不塌缩成一个值。
- **Experiment 收尾协议**：`experiment:complete` 事件在该 Experiment `teardown`（若声明）完成之后、`invocation:summary` 之前恰好触发一次，携带的 `experimentId` / `completedAt` / `carriedResults` / `diagnostics` 与该 Experiment 实际的收尾结果一致；多 Experiment 的一次 Invocation 里各自的 `experiment:complete` 独立触发、顺序与各自完成时点一致，不等到全部 Experiment 收尾才批量触发；实验域诊断（teardown 失败、budget 不可执行等）经 `ExperimentDiagnosticInput` 累积进正确的 experimentId 桶，不同 Experiment 的诊断不串桶，相同 `dedupeKey` 只在同一个 Experiment 内折叠计数。
- **`ctx.fact()` 的作用域归属**：sandbox hook / agent setup·send·teardown 经 `ctx.fact()` 上报的落进对应 attempt 的 `EvalResult.facts`（不落进任何其它 attempt）；experiment setup/teardown（含收尾自愈路径 `recoverStaleTeardownRegistration`）经 `ctx.fact()` 上报的累积进该 Experiment 的 `experiment:complete` 事件 `facts` 字段，按 experimentId 分桶、不同 Experiment 不串桶；两级互不混淆，runner 按当前回调所处生命周期自动归属，调用方不能指定层级。同一作用域内同 key 后写覆盖先写（跨 setup/send/teardown 三个不同回调仍是同一 attempt 作用域）。key 不匹配 `[a-z0-9._-]{1,64}` 或 value 非标量（对象/数组/`null`/`undefined`）时抛错，错误信息带上具体 key/value 与修正提示；合法调用不受影响。
- **用例锁与并发 Invocation**：取锁时机——派发时刻逐用例非阻塞取锁、排队用例不持锁（以「锁目录条目数不超过在跑用例数」为断言面）、全携带用例不取锁、等锁用例不触发实验级 setup、`--dry` 只读锁目录不取锁（计划行 `locked` 标注）；等待语义——撞新鲜锁的用例挂起、并发位转派给下一条未被锁的用例（以在飞峰值与启动集合为断言面），挂起用例不占全局并发位，计入独立的 `elsewhere` 计数且与 `queued` 互斥、五项计数恒等式成立；多开分工——两条 runEvals 指向同一 `niceevalRoot`、选择重叠时各自认领不同用例并行推进（两边真实派发的用例集不相交、并集覆盖选择集、总在飞峰值可达两边全局上限之和）；实验闸租约——声明 `maxConcurrency` 的实验名额域跨 runEvals 共享（同一 `niceevalRoot` 两条并行 runEvals 且 `maxConcurrency: 1` 时该实验总在飞峰值恒为 1；租约条目的心跳/过期/rename 接管复用用例锁纪律；两边 resolved N 不一致时生效名额为最小值）；释放后续接——锁释放重查携带，指纹匹配携入且计数 `elsewhere` 迁 `reused`、不匹配转 `queued` 自跑、`runs` 部分携入部分补跑，三面都要有区分力场景；心跳与接管——续租与等待轮询按注入 clock 推进、过期判据（心跳落后超过阈值）、接管 rename 的互斥（两个竞争者恰一个获得执行权、输者转入等待）、接管产生去重的 `lock-taken-over` warning；释放路径——正常收尾、中断、实验 setup 抛错各路径锁文件都被删除，遗留过期锁被下一次运行接管（不需要手工清理）；执行模式组合——`--force` 等待后全部自跑、`--reuse-sandbox` 等待后不消费携带；`lock_wait` 起止事件与 `elsewhere` 计数归约进反馈状态，字节渲染归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」。锁文件走隔离 `niceevalRoot` 下的真实文件系统（每例独立临时根，不许写进真实仓库的 `.niceeval/`），时间推进用 `TestClock`，不做真实等待。逐条目原子文件原语（命名、tmp→fsync→rename→fsync 目录写、损坏跳过的全目录扫描、rename 墓碑认领互斥）抽在 `src/shared/entry-file-store.ts`（用例锁、收尾登记、留存清单三个消费方共用），由 `src/shared/entry-file-store.test.ts` 独立覆盖：写入/读取往返、全目录扫描跳过损坏条目与点文件、缺失目录不抛错、认领在两个并发调用者之间互斥（恰一个拿到 `true`）。
- **early exit**：只有 `passed` 触发、只作用于同一 eval、省略计入 `earlyExitUnstarted`、事件只在实际省略时发出；确定性错误的 run 级 fail-fast 与瞬态 errored 的区分。只断言最终通过数发现不了白跑了本应取消的 attempt——启动集合必须显式断言。
- **逐 eval 结论行的纯派生（`runner/feedback/eval-conclusions.ts` 的 `evalConclusionRows`）**：纯跑满给出 `attempts`/`passed`/`rate`，代表 attempt 取序号最大的一条；首过即停触发（该 eval 确有省略）给出 `attempts`/`planned`/`unstarted`/`reason=early_exit`，代表 attempt 取命中通过的那一条；并发下已经在飞、passed 触发省略之前就跑完的 attempt 照常计入 `attempts`，不是幽灵 `unstarted`；fail-fast 未派发复用同一个 `attempt:early-exit` 事件类型，函数按 `diagnostics` 里配套的 `fail-fast:` 记录扣除对应份额，扣完为零则按跑满渲染，不得把 fail-fast 或 budget 未派发误标 `reason=early_exit`；按 `results` 中每个 `(experiment, eval)` 首次出现的顺序返回。reducer 侧只断言 `RunFeedbackState.earlyExitByEval` 按 `(experiment, eval)` 累计原始计数（不剔除 fail-fast，剔除是 `evalConclusionRows` 的职责）。字面渲染（人读结论行与 `--json` 的 `eval` 事件）归 [E2E · CLI](../e2e/cli.md)「反馈输出格式」在真实进程输出上验收。
- **budget**：只按已完成实测花费判断（在飞不影响派发是契约不是 bug）、到顶停发在飞跑完、按 experiment 域隔离、未派发导致 incomplete 与退出码 1、成本缺失 warning 的去重与触发前提。
- **超时、缓存与指纹**：外层超时兜底为 errored 且不放弃同 eval 剩余轮次；**超时证据保全**——超时 attempt 的 events/usage 保留截至中断的已收值(fixture 要让中断前确有事件,证明不是空壳重建)、收尾段补折叠 workspace.diff、`error.phase` 是中断时已打开的阶段;`passed` 与 `failed` 都是可复用终态而 `errored`/`skipped` 总是重跑；指纹变化只重跑受影响 eval；**`timeoutMs` 不进指纹哈希、以携带判据参与**——提高上限旧终态全部携带、调低上限使 `durationMs` 超线的旧终态重跑(fixture 两个方向都要有区分力场景)；携带以 attempt 为粒度、未收尾快照是合法来源；执行模式 flag 的携带豁免——`--keep-sandbox` 下留存档内的历史终态不携带、照常派发（failed 档豁免 `failed`、all 档连 `passed` 一起豁免），档外照常携带；`--force`/`--dry` 语义；计数恒等式 `total = reused + running + queued + completed`。
- **汇总与退出码**：verdict 四值互斥、failed 只统计断言不过；退出码按 `(experiment, eval)` 最终判定折叠、完整退出码矩阵（0/1/130、strict、required reporter）；分组通过率的分母口径。
- **启动期错误格式**：coordinator 激活前的错误恒为 `error:` + `fix:` 两行、两种输出形态同形；库错误类的下一步原样透传。
- **用户 `.ts` 装载与宿主模块形态**（`bin/niceeval.js` + 包 `exports` 表）：CLI 装载用户 `.ts` 不受宿主 `package.json` 的 `type` 影响（契约见 [docs/cli.md「装载用户 .ts」](../../../cli.md)）。单元层以数据面守护两条不变量：exports 每个带 `import` 条件的出口同时带 `require` 条件、且两者指向真实存在的文件；bin 入口同时注册 tsx 的 ESM 与 CJS 两个 hook——两者缺一，CJS 宿主（`npm init -y` 默认）下 `init` 刚生成的 config 就装载不了（`// bug: memory/tsx-dynamic-import-require-cycle.md`）。真实 CJS 宿主的进程级验收归 [E2E · CLI](../e2e/cli.md)，init 的 ESM 建议提示行同归该处，单元层不起 CLI 进程。
- **形态解析与 `--json` 流不变量**：`resolveOutputForm` 只有两个结果——`--json` 即机器面，否则人读文本；**不读任何 CI 环境变量**（fixture 要在设置了 `CI=true` 的环境下证明结果只由 flag 与 TTY 决定），TTY 只决定人读文本的版式；`--json` 的事件流不变量——单一 stdout 有序流(stderr 只留启动期错误)、每行一个合法 JSON 对象且首行 `start` 事件携带 `format`/`schemaVersion`、字段名复用 Results 词表、失败不做 suppression 逐事件给出（人读文本才有展开上限 10）、空闲 30 秒 `progress` 心跳且永久事件重置计时、`result` 事件的 `junit` 字段只在传了 `--junit` 时出现、`--dry --json` 是单 JSON 文档不是流。字节级渲染归 [E2E · CLI](../e2e/cli.md)，这里以 reducer/renderer 的事件序列与状态为断言面。
- **生命周期与资源**：成功、失败、中断三条路径下 sandbox 全部 stop、reporter queue 收尾；预热池边界；生命周期阶段闭集与主链耗时封口；diagnostic 去重与不改判定；逐轮进度行的提取规则；分类账导出的常数往返。资源泄漏通常出现在失败和中断——三条路径缺一不可。
- **沙箱内 OTLP 采集器的启动韧性**：远程沙箱（`otlpHost === null`）的 tracing 出口要在沙箱里起进程、等它写回端口，这条路径外面没有任何重试兜底（命令执行不进 IO 重试、provision 重试只覆盖 create、runner 也没有 attempt 级重试），所以韧性由它自己证明——首轮没等到端口要重试；重试换一套带随机后缀的脚本 / spans / 端口路径并先杀掉上一轮进程（上一轮迟到的采集器不得写进新一轮的端口或 spans 文件，也不得留成孤儿）；重试用尽才抛错，错误带上等待预算、轮次与采集器自己的日志；首轮就成功时不重试也不误杀。fixture 分两层：脚本化 fake Sandbox 按脚本形态回放 stdout，观察面是「起了几轮、每轮路径是否互不相同、失败前有没有杀掉上一轮」而不是脚本字节；另一层把 `runShell` 真的交给 `/bin/sh` 跑、`writeFiles` 真的落盘，证明生成的启动脚本在真实 shell 下语法与退出边都成立（采集器真的监听、POST 得到 200），以及采集器一起来就死时立刻放弃本轮——断言实测耗时远小于一轮等待预算，光看脚本字节证不了这条。相关台账：[insandbox-otlp-port-wait-3s-no-retry](../../../../memory/insandbox-otlp-port-wait-3s-no-retry.md)。

## 不这样测

- 不用 `sleep(100)` 等待调度"应该已经发生"。
- 不断言内部 `Effect.forEach`、Semaphore 或 AbortController 被调用几次。
- 不让 fake scheduler 预先算出生产 Runner 应该启动哪些 attempt；fixture 只控制输入和完成时机。
- 不在 fixture 里复制 budget 的判断公式；`costUSD` 是完成后结算的输入证据，停发与否由生产 Runner 决定。
- 不把全流程汇总 snapshot 当作唯一 Runner 测试；它难以定位 early exit、budget 或资源泄漏。
