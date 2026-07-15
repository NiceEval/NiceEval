# Experiments 与 Runner 的测试用例

本页是调度契约的场景登记表。fixture 形状见 [测试架构](README.md)；契约正文以 [Runner](../../../runner.md) 与 Experiments 各页为准。

## runs 展开与矩阵

契约来源：[Runner](../../../runner.md)、[Experiments CLI](../../../feature/experiments/cli.md)、[Experiments Library](../../../feature/experiments/library.md)。

| 契约 | 场景 |
|---|---|
| attempt 总数 = 选中实验配置数 × 选中 eval 数 × runs（runs 默认 1）；不写实验不能运行 | 正例：2 配置 × 3 eval × 5 runs = 30；边界：runs 省略 = 1；反例：无 experiment 报错 |
| eval 文件默认导出数组时扇出，id 加零填充索引；单导出用文件 id | 正例：数组扇出 id 格式；边界：单元素数组仍带索引 |
| 位置参数按 eval id 前缀过滤，实验 `evals` 字段（`"*"` / 数组 / 谓词）再筛，两层是交集 | 正例：前缀命中；反例：不命中为空；正例：谓词过滤；边界：evals 默认 `"*"` |
| 实验 id 从路径推导（`experiments/compare/x.ts` → `compare/x`）；`exp <组>` 选目录段下全部实验，`exp <组/配置>` 选一个 | 正例：组选中多实验；正例：精确选中；反例：不存在的组 |
| 调度项覆盖优先级 CLI flag → experiment → config → 内置默认；agent/model/flags 只属于 experiment，CLI 不可覆盖 | 正例：`--runs` 覆盖实验 runs；正例：实验 timeoutMs 覆盖 config；反例：`exp --model` 报用法错误 |
| 结果按发现顺序（相对路径排序）排列，与完成顺序无关 | 反例：后发现的先完成，输出顺序仍稳定 |
| `model` / `reasoningEffort` / `flags` 由实验经 ctx 透传到 agent send 与 eval test；省略 model 时不传值 | 正例：透传值一致；边界：省略时 ctx.model 为 undefined |

## 并发

契约来源：[Runner](../../../runner.md)、[Experiments](../../../feature/experiments/README.md)。

| 契约 | 场景 |
|---|---|
| 全局在飞 attempt 任意时刻 ≤ 全局 maxConcurrency，释放一个才启动下一个 | 正例：barrier 观察 inFlight 峰值；边界：attempt 数 < 上限 |
| 实验级 `maxConcurrency` 只让该实验自己排队，同批其它实验仍按全局并发跑 | 正例：实验 A 上限 1 时实验 B 仍并发 |
| 全局上限解析：`--max-concurrency` → 配置 `maxConcurrency` → provider 推荐值（docker 10 / e2b 20 / vercel 1 / 自定义 recommendedConcurrency，省略则 5）；实验级不参与全局解析 | 正例：三层各自生效；边界：vercel 默认 1；反例：实验级不抬高全局上限 |
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

## early exit

契约来源：[Runner](../../../runner.md)、[Experiments](../../../feature/experiments/README.md)。

| 契约 | 场景 |
|---|---|
| earlyExit 开且某 attempt 通过 → 同 eval 其余 attempt 被 abort，被 abort 的不计入通过率分母 | 正例：首过后剩余未启动；边界：已在飞的被 abort 后不计分母 |
| `errored` 同样触发同 eval abort；`failed` 不触发，跑满 runs | 正例：errored 停其余；反例：failed 后剩余照常启动 |
| early exit 只作用于同一 eval，其它 eval 继续调度 | 正例：eval a 首过后 eval b 仍跑满 |
| earlyExit 默认开；`--no-early-exit` / `earlyExit: false` 跑满 runs | 正例：默认省略次数；反例：关闭后 attempts = runs |
| 省略的次数计入 `earlyExitUnstarted` 而非 `unstarted`，不导致 status 变 `incomplete` | 正例：首过省 2 次仍 complete |
| 触发时发出 `run:earlyExit { evalId, experimentId }` | 正例：事件字段；反例：no-early-exit 下无此事件 |

示例——只断言最终有两个 passed 无法发现 Runner 白跑了本应取消的 attempt：

```ts
import { expect, it } from "vitest"

it("某个 eval 首次通过后不启动它的剩余轮次，但其它 eval 继续", async () => {
  const fx = runnerFixture({
    runs: 3,
    earlyExit: true,
    scripts: {
      a: ["failed", "passed", "passed"],
      b: ["failed", "failed", "passed"],
    },
  })

  await fx.run()

  expect(fx.startedAttempts("a")).toEqual([0, 1])
  expect(fx.startedAttempts("b")).toEqual([0, 1, 2])
  expect(fx.eventsOfType("run:earlyExit")).toEqual([
    { type: "run:earlyExit", evalId: "a", experimentId: fx.experimentId },
    { type: "run:earlyExit", evalId: "b", experimentId: fx.experimentId },
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
| 外层超时兜底：agent 卡死时 attempt 强行收尾，verdict=`errored`（timeout）并触发同 eval abort | 正例：卡死被标 errored；反例：超时不计入 failed |
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
| `diagnostic` 同 attempt 内相同 `dedupeKey` 折叠并累计 count；`error` 级与 cleanup 阶段的 diagnostic 都不改变 verdict | 正例：并发同 key 只留一条；反例：error 级后 verdict 仍 passed |
| 分类账整相一条命令导出全部窗口并经文件通道下载，provider 往返不随文件数与窗口数增长，只依赖 git + POSIX shell；Python venv 默认不进账；窗口证据越界明确 errored | 正例：多窗口 500 文件仍是一条导出命令加一次下载；正例：`venv/` / `.testing-venv/` 排除；反例：超过路径/字节上限不返回空 diff |

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
