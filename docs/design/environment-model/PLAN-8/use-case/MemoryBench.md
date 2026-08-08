# MemoryBench:Experiment defaultEnvironment 与 Eval setup

契约单源见 [Library · defaultEnvironment](../library.md#defaultenvironment)、[Architecture · 起点 owner 不会吞掉 setup owner](../architecture.md#起点-owner-不会吞掉-setup-owner)与 [Lifecycle](../lifecycle.md)。

MemoryBench 的 Eval 没有 Environment。
Experiment 选择预装实验工具的 E2B defaultEnvironment，sandbox setup 检查实验条件；Eval setup 再准备当前题目的仓库。

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({
    defaultEnvironment: { template: "mempal-codex-v3" },
  }).setup(mempalSetup({ version: "0.9.0" })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  async setup(sandbox) {
    await sandbox.runShell(
      "git clone <locked-repository> . && yarn install --immutable",
    );
  },
  async test(t) {
    await t.send("完成仓库中的目标任务。");
    t.succeeded();
  },
});
```

这里由 Experiment 提供起点，但 Experiment sandbox setup 仍然执行。
“提供起点”与“拥有 setup 层”不是互斥身份。

Eval setup 只修改运行中的主 Sandbox。
它不会生成新的 E2B template，也不会把题目仓库解释成第二份 Environment。

若另一个 Eval 显式声明 Environment，普通 defaultEnvironment 立即让位。
只有 `environments[profile]` 的完整 Case 能替换该 Environment；Runner 不把两个起点合并。
