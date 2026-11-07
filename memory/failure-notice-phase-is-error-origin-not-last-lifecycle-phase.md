# failure 通知的 phase 必须取 error 原点,不能取最后 lifecycle phase

**现象**:一个 gate 断言已经判为 `failed` 的 attempt,永久通知却显示
`· collecting trace`;一个在 `eval.run` 抛错的 `errored` attempt,如果后续仍完成 diff/scoring,
通知会把错误 phase 写成 `scoring.evaluate`。两者都来自 `run.ts` 把 teardown 之前最后一次
`onPhase` 回调当作失败位置。

**根因**:`LifecyclePhase` 描述 attempt 当前走到哪里,不描述哪个阶段决定 verdict。`failed` 是
断言 outcome,在 lifecycle 结束后成立,本来就没有「失败 phase」;`errored` 的真实原点已经在
捕获异常时绑定进 `result.error.phase`。最后 phase 还会受正常的 diff、scoring、trace collect
影响,即使排除 teardown 也仍不是故障原点。

**修法**:`reportFailure()` 对 `failed` 不发 phase;对 `errored` 直接使用
`result.error.phase`。`run.ts` 不再为了失败通知追踪 lastPhase。此前
`attempt-phase-tracking-teardown-always-last` 的「排除 teardown 后取 lastPhase」只消除了最末一层
污染,没有解决「最后状态不是原因」这个建模错误,由本条裁决替代。

**适用场景**:展示状态机故障归因时,优先使用错误产生时绑定的结构化 origin;不要从事后状态或
最后事件反推。结果型失败（断言不满足、业务拒绝）如果没有结构化执行错误,就不要伪造 lifecycle
phase。
