# MemoryBench:Experiment template 加 Eval setup

契约单源见 [Library · Environment 与 setup](../library.md#environment-与-setup)与 [Lifecycle](../lifecycle.md)。

MemoryBench 的 Eval 没有 Environment source。
Experiment 选择预装实验工具的 E2B template，SandboxSpec setup 检查实际安装状态；EvalDef setup 再准备当前题目的仓库。

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({
    template: "mempal-codex-v3",
  }).setup(mempalSetup({ version: "0.9.0" })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  async setup(sandbox) {
    await sandbox.runShell("git clone <locked-repository> . && yarn install --immutable");
  },
  async test(t) {
    await t.send("完成仓库中的目标任务。");
    t.succeeded();
  },
});
```

该 Eval 没有 verifier files 时，不进入受管 verifier phase。
PLAN-7 不要求所有 Eval 为了统一形状声明空 `fixture` 或空 `verifier`。
