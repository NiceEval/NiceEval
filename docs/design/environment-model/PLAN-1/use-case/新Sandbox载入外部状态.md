# 新 Sandbox 载入外部状态

返回 [PLAN-1 用例手册](README.md)。场景定义见根 [CASES · C6](../../CASES.md#c6新-sandbox-载入外部状态)。

## 解决什么问题

mempal 二进制与模型属于可检查的安装状态,但记忆数据库是实验运行状态。
每条 Attempt 都要取得全新 Sandbox,同时又要从外部存储载入上一条 Attempt 回存的记忆。

这里不启用 `sandboxReuse`。
跨 Attempt 复用的是外部存储中的显式状态,不是 `$HOME`、`/tmp`、后台进程或全局安装等整个 Sandbox 活状态。

## Provision 与状态 Hook 分开

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE })
    .setup(async (sandbox, ctx) => {
      await loadMemoryState(sandbox, ctx.experimentId);
    })
    .teardown(async (sandbox, ctx) => {
      await saveMemoryState(sandbox, ctx.experimentId);
    }),
  provisions: [mempal],
  maxConcurrency: 1,
});
```

每条 Attempt 创建并等待一个新的 Running Environment。
Runner 先 Ensure mempal Provision 和 Agent CLI,随后 Sandbox setup 从外部存储载入状态。
Attempt 完成后,teardown 在销毁该 Running Environment 前回存状态。

`maxConcurrency: 1` 让载入、Agent 执行和回存组成同一 Experiment 的临界区。
没有这条限制时,两个全新 Sandbox 可能同时读到相同旧版本,随后互相覆写回存结果。

## 与 Sandbox 复用的区别

新 Sandbox 不继承上一条 Attempt 的进程、临时文件、home 或全局安装。
Provision 和 Agent Ensure 因此在每条 Attempt 都重新检查,只有预装命中或 Provider 的隔离实例克隆可以缩短准备时间。

如果实验要观察同一份活状态在 Sandbox 内连续累积,使用[复用 Sandbox 中的状态](复用沙箱中的状态.md)。
两条路径的状态边界、失败恢复和运行数据不同,不能用安装成本在它们之间做隐式切换。
