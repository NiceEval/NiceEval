# Experiments 与 Runner 的测试用例

本页是调度契约的场景登记表。fixture 形状见 [测试架构](README.md)；契约正文以 [Runner](../../../runner.md) 与 Experiments 各页为准。

## runs 展开与矩阵

契约来源：[Runner](../../../runner.md)、[Experiments CLI](../../../feature/experiments/cli.md)、[Experiments Library](../../../feature/experiments/library.md)。

| 契约 | 场景 |
|---|---|
| attempt 总数 = 选中实验配置数 × 选中 eval 数 × runs（runs 默认 1）；不写实验不能运行 | 正例：2 配置 × 3 eval × 5 runs = 30；边界：runs 省略 = 1；反例：无 experiment 报错 |
| eval 文件默认导出数组时扇出，id 加零填充索引；单导出用文件 id | 正例：数组扇出 id 格式；边界：单元素数组仍带索引 |
| 位置参数按 eval id **裸字符串前缀**过滤，实验 `evals` 字段（`"*"` / 数组 / 谓词）再筛，两层是交集；与 show/view 同口径，不要求 `/` 段边界 | 正例：`memory/terminal-swe-bench` 命中两个 `memory/terminal-swe-bench-astropy-*` sibling；反例：不命中为空；正例：谓词过滤；边界：evals 默认 `"*"` |
| `EvalDef.environment` 是 provider-neutral profile；sandbox spec 的 `environments` 表在调度前对每条选中 eval 查表，解析结果同源驱动创建、逐 eval fingerprint、provider 推荐并发与结果投影；remote Agent 不查表 | 正例：两个 profile 查到不同 E2B template，快照落 sandboxByEval；反例：选中 eval 的 profile 缺表项在创建 sandbox 前穷举报错；边界：remote Agent 零查表；边界：未声明 environment 的 eval 用基础产物且不进 sandboxByEval |
| 实验 id 从路径推导（`experiments/compare/x.ts` → `compare/x`）；选择器按序应用精确 id、目录前缀、目录段精确匹配下的文件名前缀三条规则，零命中报 `No experiment matched` 并列出可用目录 | 正例：`exp <组>` 选目录段下全部实验；正例：`exp <组/配置>` 精确 id 选一个，即使它是同目录内其它文件名的前缀；正例：`exp <组/前缀>` 命中同目录内共享文件名前缀的多个配置（如 `--agents-md` / `--mempal` 变体）；反例：目录段不精确匹配时不跨目录误配（如 `dev` 不命中 `dev-e2b`）；反例：零命中报错且列出全部已发现目录 |
| `exp show` / `exp view` 在没有同名 experiment 时仍按“不存在的实验”失败，但追加正确顶层命令提示；若真有同名 experiment 则正常选择，不抢占合法 id | 反例：无 `show` / `view` experiment 时分别提示 `niceeval show` / `niceeval view`；边界：存在同名 experiment 时不提示 |
| 调度项覆盖优先级 CLI flag → experiment → config → 内置默认；agent/model/flags 只属于 experiment，CLI 不可覆盖 | 正例：`--runs` 覆盖实验 runs；正例：实验 timeoutMs 覆盖 config；反例：`exp --model` 报用法错误 |
| 结果按发现顺序（相对路径排序）排列，与完成顺序无关 | 反例：后发现的先完成，输出顺序仍稳定 |
| `model` / `reasoningEffort` / `flags` 由实验经 ctx 透传到 agent send 与 eval test；省略 model 时不传值 | 正例：透传值一致；边界：省略时 ctx.model 为 undefined |
| `ExperimentDef.labels` 值域 string \| number（解析时校验），原样投影进快照 `ExperimentRunInfo.labels`；不透传 ctx / t，不参与可比性配置 | 正例：声明 labels 的实验落盘投影一致且 ctx.flags 不含 labels；反例：布尔 / 对象值在 defineExperiment 解析时报错；边界：仅 labels 不同的两快照仍互相可比（current() 拼接不跳过） |

## 并发

契约来源：[Runner](../../../runner.md)、[Experiments](../../../feature/experiments/README.md)。

| 契约 | 场景 |
|---|---|
| 全局在飞 attempt 任意时刻 ≤ 全局 maxConcurrency，释放一个才启动下一个 | 正例：barrier 观察 inFlight 峰值；边界：attempt 数 < 上限 |
| 实验级 `maxConcurrency` 只让该实验自己排队，同批其它实验仍按全局并发跑 | 正例：实验 A 上限 1 时实验 B 仍并发 |
| 全局上限解析：`--max-concurrency` → 配置 `maxConcurrency` → 所有实际 resolved sandbox provider 推荐值的最小值（docker 10 / e2b 20 / vercel 1 / 自定义 recommendedConcurrency，省略则 5）；实验级不参与全局解析 | 正例：三层各自生效；边界：两个实验分别用 vercel 与 e2b 时默认 1；反例：实验级不抬高全局上限 |
| 报告回调经 permit=1 信号量串行化，且不阻塞执行 fiber | 正例：慢 reporter 下 inFlight 仍达上限；正例：并发完成时 onEvent 无重入 |

示例——并发上限用 barrier 观察"在飞"状态，不用 `setTimeout` 猜测调度是否已经发生：

```ts
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("全局同时在飞的 attempt 不超过 maxConcurrency", () =>
  Effect.gen(function* () {
    const fx = yield* makeRunnerFixture({ maxConcurrency: 2, evals: 5 })
    const fiber = yield* Effect.forkChild(fx.run)

    yield* fx.started.awaitCount(2)
    assert.strictEqual(fx.inFlight.current, 2)
    assert.strictEqual(fx.started.count, 2)

    yield* fx.releaseOne
    yield* fx.started.awaitCount(3)
    assert.isAtMost(fx.inFlight.maximum, 2)

    yield* fx.releaseAll
    yield* fiber.await
  }),
)
```

## 实验级生命周期（`ExperimentDef.setup` / `.teardown`）

契约来源：[Experiments Architecture · 实验级生命周期](../../../feature/experiments/architecture.md#实验级生命周期setup-与-teardown)、[Experiments Library](../../../feature/experiments/library.md#实验级共享服务setup-与-teardown)。

| 契约 | 场景 |
|---|---|
| `setup` 每实验整场至多一次：第一个通过派发许可的 attempt 触发,并发 attempt 等同一个 memoized 结果 | 正例：runs×evals 多 attempt 并发时 setup 只执行 1 次；正例：两个实验各自的 setup 各执行 1 次 |
| 全部结果被 carry 携入、无 attempt 派发时 `setup` 不执行 | 边界：priorResults 全命中时 setup 调用数为 0 |
| `setup` 抛错 → 本实验所有 attempt 记 `errored`(code `experiment-setup-failed`、phase `experiment.setup`),同批其它实验不受影响 | 反例：实验 A setup 抛错,A 的 attempt 全 errored 且 error 字段结构化;正例:实验 B 结果正常 |
| `teardown`:本实验全部 attempt 收尾后执行恰好一次,setup 时点走到过才触发;中断(signal abort)也执行;setup 抛错不豁免 | 正例:全部完成后 teardown 已执行;正例:中途 abort 后仍执行;正例:setup 抛错后仍执行;边界:未声明 teardown 时无收尾动作;边界:无 attempt 派发(setup 未触发)时不执行 |
| teardown 抛错只产生运行级 diagnostic(`experiment-teardown-failed`),不改变任何已产出的 verdict | 反例:teardown 抛错后 results 的 verdict 不变,diagnostic 事件可见 |
| teardown 执行有界:超过 30s 清理超时按 `experiment-teardown-failed` 诊断收束,run 照常返回 | 反例:挂起的可调用体在小超时下抛超时错(机制在 cleanup-timeout 单测);超时错→诊断与上一行 teardown 抛错同一路径(出处:memory/force-exit-skips-experiment-teardown.md) |
| 强清兜底注册表:teardown 执行体是 memoized 一次性 promise,drain 启动全部未启动、等待全部未 settle(含在飞);条目 settle 后自行注销,正常路径与 drain 并发到达同一 teardown 只执行一次且都等到 settle | 正例:登记两条后 drain 全部执行且再次 drain 为 0;正例:drain 与正常路径并发调用同一入口,执行计数为 1 且两者都在 settle 后返回;反例:正常收尾(settle 已注销)后 drain 无动作(出处:memory/force-exit-skips-experiment-teardown.md) |
| 正常完整跑完后注册表为空:teardown 由运行路径消费,不留待兜底的条目 | 边界:runEvals 返回后 pendingExperimentTeardownCount() 为 0 |
| `setup` 的 ctx:experimentId / selectedEvalIds / signal / progress / diagnostic 齐备,diagnostic 进运行级永久事件流 | 正例:ctx 字段值与实验一致;正例:diagnostic 以 experiment.setup 归因出现在事件流 |
| 钩子函数体不进 fingerprint:只改 setup / teardown 逻辑不使携带失效 | 边界:改 setup 后 fingerprint 不变 |
| 钩子起止由 runner 发布为运行级反馈事件(`status=started|done|failed`,done/failed 带 duration);reducer 据此维护 `experimentHooks` 状态(started 添加、done/failed 移除、plan 重置),等待 setup 的 attempt 计数保持 `queued` | 正例:setup 成功发 started+done;反例:setup 抛错发 failed 而非 done;正例:reducer 状态随事件增删;边界:plan 事件清空残留 |
| Human TTY 在 ACTIVE 区为在飞钩子渲染运行级行(排在 attempt 行前),实验级 `ctx.progress` 只更新该行 detail;成功钩子不写 scrollback 永久行 | 正例:钩子在跑的帧含 `experiment setup · <experimentId>` 行;正例:progress 后 detail 更新;反例:done 后 TTY scrollback 无新增行 |
| agent / ci / 非 TTY human 起止各追加一行(`NICEEVAL experiment_setup …` / `niceeval: experiment_setup …` / human 文案),实验级 progress 不逐条输出 | 正例:agent/ci 各两行含 experiment 与 status 字段;正例:非 TTY human started/done 文案行;反例:progress 在 agent/ci 零输出 |
| 运行级瞬时通知(`reportActivity`):human 追加一行(TTY 先撤 dashboard 再重建),agent/ci 不输出 | 正例:TTY human scrollback 出现通知行且 dashboard 重建;反例:agent/ci 零输出 |

## early exit

契约来源：[Runner](../../../runner.md)、[Experiments](../../../feature/experiments/README.md)。

| 契约 | 场景 |
|---|---|
| earlyExit 开且某 attempt 通过 → 同 eval 其余 attempt 被 abort，被 abort 的不计入通过率分母 | 正例：首过后剩余未启动；边界：已在飞的被 abort 后不计分母 |
| 只有 `passed` 触发首过即停；`failed` 与 `errored` 都不触发，剩余轮次照常启动（errored 是瞬态基建错误，下个 attempt 可能自愈） | 反例：failed 后剩余照常启动；反例：errored 后剩余照常启动 |
| 确定性错误走独立的 run 级 fail-fast：预检命中或同一错误 code 在同一 eval 连续复现时停止派发受同一配置影响的后续 attempt，如实报 errored | 正例：同 code 连续复现后停发；反例：不同 code 的偶发 errored 不触发 |
| early exit 只作用于同一 eval，其它 eval 继续调度 | 正例：eval a 首过后 eval b 仍跑满 |
| earlyExit 默认开；`--no-early-exit` / `earlyExit: false` 跑满 runs | 正例：默认省略次数；反例：关闭后 attempts = runs |
| 省略的次数计入 `earlyExitUnstarted` 而非 `unstarted`，不导致 status 变 `incomplete` | 正例：首过省 2 次仍 complete |
| `run:earlyExit { evalId, experimentId }` 只在实际省略了至少一个轮次时发出 | 正例：事件字段；反例：no-early-exit 下无此事件；边界：最后一轮才通过省略数为零，不发事件 |

示例——只断言最终有两个 passed 无法发现 Runner 白跑了本应取消的 attempt：

```ts
import { expect, it } from "vitest"

it("某个 eval 首次通过后不启动它的剩余轮次，但其它 eval 继续", async () => {
  const fx = runnerFixture({
    runs: 3,
    maxConcurrency: 1,
    earlyExit: true,
    scripts: {
      a: ["failed", "passed", "passed"],
      b: ["failed", "failed", "passed"],
    },
  })

  await fx.run()

  expect(fx.startedAttempts("a")).toEqual([0, 1])
  expect(fx.startedAttempts("b")).toEqual([0, 1, 2])
  // b 最后一轮才通过，省略数为零，不发事件——同一场景顺带锁住零省略边界。
  expect(fx.eventsOfType("run:earlyExit")).toEqual([
    { type: "run:earlyExit", evalId: "a", experimentId: fx.experimentId },
  ])
})
```

## budget

契约来源：[Runner](../../../runner.md)、[Experiments CLI](../../../feature/experiments/cli.md)。budget 只按**已完成 attempt 的实测花费**判断，不做预测性节流——在飞未结算成本不影响派发，因此已花 + 在飞可能短暂超出 budget，这是契约行为不是 bug。

| 契约 | 场景 |
|---|---|
| 只按已完成实测花费判断；在飞未结算成本不影响派发 | 正例：在飞成本高但未结算时仍按 maxConcurrency 派发；反例：不得按预估成本提前扣留 |
| 已完成花费到顶后停止派发；已在飞的照常跑完，不中途打断 | 正例：到顶后 startedCount 冻结；正例：在飞 attempt 仍产出 verdict |
| budget 域按 experimentId（无实验时按 agent 名）隔离 | 正例：实验 A 耗尽后实验 B 照常 |
| 未派发的计入 `RunCompletion.unstarted`，status 变 `incomplete`，零 failed/errored 时退出码也是 1 | 反例：全 passed + budget 耗尽不得退出码 0 |
| 只有已发起 agent turn、却连续拿不到成本数据的 attempt 才对该域发一条去重 warning；首个 turn 前失败没有成本事实，不发 budget warning | 正例：N 个真实 turn 无成本只 1 条 warning；反例：`sandbox.create` 404 只保留结构化根因（[bug 台账](../../../../memory/budget-warning-requires-agent-turn.md)） |
| 耗尽时发出 `run:budgetExceeded { budget, spent }`；`--budget` 覆盖实验 `budget` | 正例：事件载荷；正例：CLI 覆盖后按新值停发 |

示例——让第三个 attempt 的结算把已花推到顶，证明"到顶停发、在飞跑完"：

```ts
it("已完成花费到顶后不再派发新 attempt，在飞的照常完成", async () => {
  const fx = runnerFixture({
    budget: 1,
    maxConcurrency: 2,
    attempts: [
      { evalId: "a", costUSD: 0.6, release: "a0" },
      { evalId: "b", costUSD: 0.5, waitFor: "a0", release: "b0" },
      { evalId: "c", costUSD: 0.4, waitFor: "b0" },
      { evalId: "d", costUSD: 0.4 },
    ],
  })

  const running = fx.run()
  fx.releaseAll()
  await running

  // a、b 结算后已花 1.1 ≥ 1,c 若已在飞则跑完,d 不再派发。
  expect(fx.completedCount).toBeGreaterThanOrEqual(2)
  expect(fx.started("d")).toBe(false)
  expect(fx.eventsOfType("run:budgetExceeded")).toEqual([
    { type: "run:budgetExceeded", budget: 1, spent: expect.closeTo(1.1) },
  ])
  expect(fx.completion.unstarted).toBeGreaterThan(0)
})
```

## 超时、缓存与指纹

契约来源：[Runner](../../../runner.md)、[Experiments CLI](../../../feature/experiments/cli.md)。

| 契约 | 场景 |
|---|---|
| 外层超时兜底：agent 卡死时 attempt 强行收尾，verdict=`errored`（timeout）；同 eval 剩余轮次照常调度，不因一次超时放弃重试 | 正例：卡死被标 errored；反例：超时不计入 failed；正例：超时后同 eval 剩余轮次仍启动 |
| 一个卡死 attempt 不挂起整批 | 正例：1 卡死 + N 正常时 run 收尾且 N 个有结果 |
| 上次 `passed` 或 `failed` 且指纹未变 → 跳过并复用（两者都是可复用终态） | 正例：passed 复用；正例：failed 也复用（易漏）；反例：指纹变了不复用 |
| `errored` 和 `skipped` 不缓存，总是重跑 | 反例：上次 errored 不得被复用 |
| 指纹变化只重跑受影响 eval | 正例：改一个 eval 只重跑它；边界：改共享配置全部重跑 |
| `--force` 忽略全部可复用结果；`--dry` 只打印计划，无任何落盘 | 正例：force 下缓存命中仍执行；反例：dry 后无落盘 |
| 任意时刻 `total = reused + running + queued + completed` | 边界：含 reused 时每个事件快照恒等式成立 |

## 汇总判定与退出码

契约来源：[Runner](../../../runner.md)、[Experiments CLI](../../../feature/experiments/cli.md)。

| 契约 | 场景 |
|---|---|
| `verdict` 四值互斥；`run:summary.failed` 只统计断言/评分不过，超时、沙箱、adapter 问题计入 `errored` | 反例：超时进 failed 是 bug；正例：断言失败进 failed |
| 退出码按 `(experiment, eval)` 最终判定折叠，不按 attempt | 正例：`[failed, passed]` 序列退出码 0；反例：最终 failed 才是 1 |
| 退出码矩阵：0 = complete 且无 failed/errored；1 = 有 failed/errored 或 incomplete 或 required reporter 写失败；130 = interrupted | 每个分支各一例；边界：`--strict` 下 soft 未达标改判 failed |
| required reporter 写失败 → 非 complete、退出码 1、明细进 `reporterErrors`；非 required 失败不判红但记录 | 正例：required 失败判红；反例：可选 reporter 失败仍 0 |
| 汇总按 `(agent, model, eval)` 分组给通过率与均值；被 abort 的不进分母 | 正例：4/5 = 80%；边界：early exit 后分母为实跑数 |
| `RunSummary.model` 取首个 `AgentRun` 声明的 model，随 `--json` 输出面对外可读 | 正例：experiment 声明 `model: "x"` 时 `--json` 的顶层 `model` 字段等于 `"x"`；边界：未声明 model 时该字段省略 |

## CLI 启动期错误格式

契约来源：[错误与警告反馈](../../../error-feedback.md)。

| 契约 | 场景 |
|---|---|
| coordinator 激活前的错误（未知 flag、`exp --model` 用法拒绝、config 不可加载）恒为两行：`error:` 现象行 + 缩进 `fix:` 下一步行；fix 含可执行命令或定位动作，纯 ASCII，三种 output profile 与 bootstrap 出口同形 | 正例：未知 flag 的 fix 指向 `niceeval --help`；正例：`exp --model` 的 fix 指出 model 定义在 experiment 文件；边界：`--output agent` 下同为 ASCII 两行 |
| 库错误类（`MalformedLocatorError` / `LocatorNotFoundError` 等）的 message 自带下一步，CLI 捕获后 `fix:` 行原样取自错误对象，不在 CLI 层另写文案 | 正例：`show @不合法串` 的 fix 与错误对象 message 的下一步一致；反例：合法但不存在的 locator 给出「不在当前结果里」的不同下一步 |

## 生命周期与资源

契约来源：[Runner](../../../runner.md)、[Experiments Library](../../../feature/experiments/library.md)、[Experiments CLI](../../../feature/experiments/cli.md)。

| 契约 | 场景 |
|---|---|
| `eval:complete` 携带的 EvalResult 在事件触发前已写好最终 locator；`snapshotStartedAt` 在展开任何 attempt 前确定且与落盘一致 | 正例：事件内 locator 与落盘一致 |
| 成功、失败、中断三条路径下所有已创建 sandbox 被 stop（stoppedIds == createdIds）；中断时 status=interrupted | 正例：interrupt 中途释放全部；边界：创建中被中断 |
| 预热池按 `min(池大小, 计划 attempt 数)` 预创建；池空回落即时创建；run 结束销毁未领用沙箱 | 边界：池 > attempt 数不多建；反例：run 结束不留孤儿沙箱 |
| 跨 case 复用默认关闭；开启后收尾重置而非销毁，`stop` 只在最后一次使用后发生，每个 attempt 仍完整走 setup 链与分类账锚点 | 正例：N attempt 复用只 1 次 stop；正例：每 attempt 都调 setup；反例：默认不复用 |
| 生命周期阶段按固定顺序发出且取自 LifecyclePhase 闭集；无对应钩子的步骤直接跳过；phase 只由 runner 发出 | 正例：无 setup 钩子时 phases 无 sandbox.setup；反例：hook 调 progress 不切 phase |
| 主链 phase 在 Scope release 前封口，`sandbox.stop` / `sandbox.suspend` 只计入收尾；主链 phase 合计不超过 `durationMs` | 正例：延迟 stop 的 fake 中 stop 有独立耗时且主链不增长；反例：最后一个主链 phase 不能包含 stop |
| `diagnostic` 同 attempt 内相同 `dedupeKey` 折叠并累计 count；`error` 级与 teardown 阶段的 diagnostic 都不改变 verdict | 正例：并发同 key 只留一条；反例：error 级后 verdict 仍 passed |
| 每轮 `t.send()` 自动产出一条进度行（[Experiments Library · 生命周期代码怎样向这次运行反馈](../../../feature/experiments/library.md#生命周期代码怎样向这次运行反馈)的 `progress` 表达形态）：开始时带输入预览，结束时带状态/工具数/token/耗时；仅 `failed` 时追加从事件流提取的失败原因，`completed` 不提取；原因文本压成单行并截断到 120 字符 | 正例：failed 轮末尾带最后一条 error 事件的 message；反例：completed 轮混入 error 事件不提取原因；反例：failed 轮没有 error 事件时不追加空后缀；边界：长原因压单行、截断到 120 字符并以省略号收尾 |
| 分类账以一条命令导出全部窗口并经文件通道下载，provider 往返不随文件数与窗口数增长，只依赖 git + POSIX shell；Python venv 默认不进账；窗口证据越界明确 errored | 正例：多窗口 500 文件仍是一条导出命令加一次下载；正例：`venv/` / `.testing-venv/` 排除；反例：超过路径/字节上限不返回空 diff |

示例——中断路径的资源释放：

```ts
it.effect("中断后释放所有已创建的 Sandbox", () =>
  Effect.gen(function* () {
    const fx = yield* makeRunnerFixture({ evals: 3, maxConcurrency: 3 })
    const fiber = yield* Effect.forkChild(fx.run)
    yield* fx.sandboxes.awaitCreated(3)

    yield* fiber.interrupt

    assert.deepStrictEqual(fx.sandboxes.stoppedIds, fx.sandboxes.createdIds)
  }),
)
```

## 不这样测

- 不用 `sleep(100)` 等待调度"应该已经发生"。
- 不断言内部 `Effect.forEach`、Semaphore 或 AbortController 被调用几次。
- 不让 fake scheduler 预先算出生产 Runner 应该启动哪些 attempt；fixture 只控制输入和完成时机。
- 不在 fixture 里复制 budget 的判断公式；`costUSD` 是完成后结算的输入证据，停发与否由生产 Runner 决定。
- 不把全流程汇总 snapshot 当作唯一 Runner 测试；它难以定位 early exit、budget 或资源泄漏。
