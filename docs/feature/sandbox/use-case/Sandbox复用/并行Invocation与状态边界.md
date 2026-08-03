# 并行 Invocation 下区分 Sandbox 复用与共享状态

契约单源在 [Sandbox 复用](../../reuse.md#并行-invocation)、[Runner 调度](../../../../runner.md#调度有界并发)与 [Experiments 并发 Invocation](../../../experiments/architecture.md#并发-invocation用例锁与共享状态租约)。

## 先判断共享的是什么

`sandboxReuse: true` 只表示一条 Invocation 里的多条 Attempt 可以借用同一 Sandbox。
另开一个终端会得到新的 Invocation、Run 和 Sandbox 复用池；NiceEval 不把 Sandbox handle 或运行中的物理实例交给另一个进程。

| 真实边界 | 声明 | 两个并行 Invocation 的结果 |
|---|---|---|
| Attempt 彼此独立，只想每个进程保留一个 Sandbox | `sandboxReuse: true`, `maxConcurrency: 1` | 各自一个 Sandbox，两边可同时跑不同 Eval |
| 两个 Sandbox 都恢复、修改并回存同一 checkpoint | 再加 `sharedState: { key }` | 只有一个完整状态窗口运行，另一边在创建 Sandbox 前等待 |
| 共享服务自己支持并发，没有整体 restore/save | 不声明 `sharedState` | 用服务自己的事务与配额；两边压力相加 |
| 两个 Experiment id 读写同一 cohort | 声明相同 `sharedState.key` | 跨 Experiment 串行整段状态生命周期 |

## 独立 Sandbox 应当真正并行

一批 Eval 只在各自 Sandbox 里写临时文件，没有宿主机 checkpoint 或远程共享数据库。配置：

```ts
export default defineExperiment({
  sandbox: e2bSandbox({ template: "memorybench" }),
  sandboxReuse: true,
  maxConcurrency: 1,
});
```

终端 A 与 B 同时运行该 Experiment 时，用例锁使它们认领不同 Eval，每边各维护一个 Sandbox。
两边合计可同时执行两条 Attempt；一边声明 1、另一边因配置漂移声明 3 时，它们也各用自己的宽度，不取在场最小值。

## 共享 checkpoint 要锁住完整窗口

Mempal 的 `$HOME` 由 Sandbox lifecycle `setup()` 从宿主机 checkpoint 恢复，并在 `teardown()` 回存。这个 Experiment 声明：

```ts
export default defineExperiment({
  sandbox: e2bSandbox({ template: "memorybench" })
    .setup(restoreMempal)
    .teardown(saveMempal),
  sandboxReuse: true,
  maxConcurrency: 1,
  sharedState: { key: "mempal/codex/cohort-a" },
});
```

`maxConcurrency: 1` 只让本 Invocation 维护一条串行 Attempt 队列。
`sharedState.key` 才保证不会出现「Sandbox A 恢复旧 checkpoint → Sandbox B 也恢复旧 checkpoint → 两边先后覆盖回存」。

预期时序是：

```text
Invocation A: state lease → Experiment setup → Sandbox A setup → Attempt…
Invocation B: waiting for shared state; no setup, no Sandbox, no Eval lock
Invocation A: Sandbox A teardown/save → Provider finalizer → Experiment teardown → release
Invocation B: replan carry → acquire if work remains → create Sandbox B
```

## 结果沿用与选择重叠

- 两边选中同一批 Eval 时，等待方在租约释放后重做整个 Experiment 的携带规划。指纹相同时全部携入，不创建第二个 Sandbox。
- 两边选择不同 Eval 子集时，后者在前者完整 save 后恢复新 checkpoint，然后执行自己的子集。
- `--rerun all` 不跳过共享状态租约。它关掉的是携带，不是状态互斥。
- 全部结果在初始规划就可携带时，不取租约、不运行 Experiment Hook，也不创建 Sandbox。

## 顺序、强杀与失败边界

- `sharedState` 只保证两条状态轨迹不交错，不合并两个 Invocation 的 Eval 发现顺序。后一题必须读前一题的实验仍用单一 Invocation、固定选择集与 `--rerun all`。
- 持有者被强杀后，等待方可在心跳过期后接管互斥，但 NiceEval 不能证明外部状态没有半次写入。作者必须原子提交 checkpoint；做不到时换新 key 与干净 cohort 从头重建。
- Sandbox 在 Attempt 中途消失时，当前 Attempt 记 `errored`，不静默重跑。Sandbox lifecycle `teardown()` 必须早于 Provider finalizer；若 checkpoint save 只因 Sandbox 已停止而失败，这是实现违反收尾顺序，不是并行运行的正常结果。
- 租约只在共享同一 `.niceeval` 记录根的进程间生效。不同机器、不同工作副本或不共享文件系统时，外部数据库或 checkpoint 要自己提供分布式互斥。
- 改变 `sharedState.key` 表示换了状态轨迹，因此进入 `configHash` 并作废旧结果。两个配置指向同一底层状态却误写不同 key，属于作者契约违约。

## 读反馈

等用例锁表示「别人正在跑同一 Eval」；等共享状态租约表示「别人占用了这份 checkpoint 的完整生命周期」。
后者的运行级反馈必须显示 state key、持有方和等待时间，不应显示为 Experiment concurrency slot，也不应暗示两边共用 Sandbox。
