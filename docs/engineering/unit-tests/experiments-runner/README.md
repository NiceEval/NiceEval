# Experiments 与 Runner 的测试架构

契约来源：[Experiments](../../../feature/experiments/README.md)、[Experiments Architecture](../../../feature/experiments/architecture.md)、[Experiments Library](../../../feature/experiments/library.md)、[Experiments CLI](../../../feature/experiments/cli.md) 和 [Runner](../../../runner.md)。Runner 测试关心 attempt 的集合、开始条件、结束条件、事件与资源释放，不锁定内部循环、Promise 数量或 Effect combinator。用例登记在 [cases.md](cases.md)。

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

`runnerFixture` 提供受控 barrier、记录型 Reporter、fake Agent/Sandbox 和结果读取方法。它不自行决定 early exit、budget 或调度顺序；这些必须由生产 Runner 决定。fixture 里的 `costUSD` 是输入证据（该 attempt 完成后结算的实测成本），不复制 Runner 的任何计费逻辑。所有权与稳定性规则见 [Harness](../harness.md)。

## Effect、时钟和资源

- Effect 程序用 `it.effect`，让测试运行时持有 Scope。
- 重试和 backoff 用 `TestClock.adjust` 推进，不做真实等待。
- 共享只读 Layer 可以用 `layer(...)`；保存计数器或资源状态的 Layer 若要求每例隔离，使用独立 `it.layer(...)`。
- 成功、执行失败和中断三条路径都断言 Sandbox、OTLP channel 和 reporter queue 正确收尾。
