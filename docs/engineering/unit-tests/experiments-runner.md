# Experiments 与 Runner 的单元测试

契约来源：[Experiments](../../feature/experiments/README.md)、[Architecture](../../feature/experiments/architecture.md) 和 [Runner](../../runner.md)。Runner 测试关心 attempt 的集合、开始条件、结束条件、事件与资源释放，不锁定内部循环、Promise 数量或 Effect combinator。

## 场景 fixture

Runner fixture 用声明式场景描述 attempt，而不是为每个测试重新拼完整 `EvalDef`、Agent、Sandbox 和 Reporter：

```ts
interface AttemptScript {
  readonly evalId: string
  readonly costUSD?: number
  readonly result: "passed" | "failed" | "errored"
  readonly waitFor?: string
  readonly release?: string
}

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

`runnerFixture` 应提供受控 barrier、记录型 Reporter、fake Agent/Sandbox 和结果读取方法。它不自行决定 early exit、budget 或调度顺序；这些必须由生产 Runner 决定。

## 示例：并发上限测在飞数量

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

这个测试用 barrier 观察“在飞”状态，不用 `setTimeout` 猜测调度是否已经发生。

## 示例：early exit 只影响同一 eval 的剩余 attempts

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

不要只断言最终有两个 passed；那无法发现 Runner 白跑了本应取消的 attempt。

## 示例：budget 同时计算已花与在飞预留

构造多个成本相同、会停在 barrier 上的 attempt，使“只看已完成成本”和“已花 + 在飞预估”得到不同调度结果：

```ts
it("budget 到达护栏后不再启动新 attempt", async () => {
  const fx = runnerFixture({
    budget: 1,
    estimatedCostPerAttempt: 0.4,
    maxConcurrency: 4,
    evals: ["a", "b", "c", "d"],
  })

  const running = fx.run()
  await fx.waitForStableQueue()

  expect(fx.startedCount).toBe(2)
  expect(fx.reservedCost).toBeCloseTo(0.8)

  fx.releaseAll({ actualCostUSD: 0.4 })
  await running
  expect(fx.eventsOfType("run:budgetExceeded")).toHaveLength(1)
})
```

Fixture 中的 `estimatedCostPerAttempt` 是输入证据，不应复制 Runner 的预留公式。

## Effect、时钟和资源

- Effect 程序用 `it.effect`，让测试运行时持有 Scope。
- 重试和 backoff 用 `TestClock.adjust` 推进，不做真实等待。
- 共享只读 Layer 可以用 `layer(...)`；保存计数器或资源状态的 Layer 若要求每例隔离，使用独立 `it.layer(...)`。
- 成功、执行失败和中断三条路径都断言 Sandbox、OTLP channel 和 reporter queue 正确收尾。

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

- 不用 `sleep(100)` 等待调度“应该已经发生”。
- 不断言内部 `Effect.forEach`、Semaphore 或 AbortController 被调用几次。
- 不让 fake scheduler 预先算出生产 Runner 应该启动哪些 attempt；fixture 只控制输入和完成时机。
- 不把全流程汇总 snapshot 当作唯一 Runner 测试；它难以定位 early exit、budget 或资源泄漏。
