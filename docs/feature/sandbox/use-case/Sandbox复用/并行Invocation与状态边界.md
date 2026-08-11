# 并行 Invocation 隔离 Record 与 Sandbox

## 先分清三个 owner

一条写 Invocation 独占一个 Record root 的 writer session；reader 仍可并发。`sandboxReuse: true` 只让这条 Invocation 内的 Attempt 复用 Sandbox。`sharedState.key` 只保护多个进程共同访问的外部 checkpoint 或服务。

| 目标 | 做法 | 结果 |
|---|---|---|
| 一条命令内复用 Sandbox | `sandboxReuse: true` | 当前 Invocation 的池内复用 |
| 两条命令并行运行 | 指定不同 `--record` root | 各自拥有 Run、Attempt、Sandbox 与 Sample |
| 两条命令访问同一 checkpoint | 不同 root，再声明相同 `sharedState.key` | 外部状态生命周期串行，Record 仍分离 |
| 两条命令写同一 root | 不支持 | 后打开者得到 `record-writer-busy`；`show/view` 仍可读已发布 Run |

## 独立 Sandbox 可以并行

```ts
export default defineExperiment({
  sandbox: e2bSandbox({ template: "memorybench" }),
  sandboxReuse: true,
  maxConcurrency: 1,
});
```

两个进程使用不同 Record root 时，各自建立一个 Sandbox 复用池。它们可以同时运行，但不能互相领取 Eval、carry 对方刚写的 Attempt 或合并分母。

## 共享 checkpoint 要保护完整周期

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

状态 owner 从 Experiment 与 Sandbox setup 之前持有到 checkpoint save、Sandbox finalizer 与 Experiment teardown 之后。等待方不创建 Sandbox；取得状态 owner 后，它继续自己的既有计划，不打开另一个 Record。

`sharedState` 不保存 checkpoint，也不提供事务回滚。强杀可能留下半次外部写入；作者仍要原子提交 checkpoint，或换新 key 与干净 cohort。

## 读取结果

两个 Record 各自产生 Sample 和 Report。产品不提供跨 Record 合并；需要统一比较范围时，在一个 root 中重新运行并选择其中已发布的 Run。

## 相关阅读

- [Sandbox 复用](../../reuse.md#并行-invocation)
- [Experiments 并发 Invocation](../../../experiments/architecture.md#并发-invocation)
- [并行 Invocation 使用不同 Record](../../../experiments/use-case/并发/并行Invocation协作.md)
