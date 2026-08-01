# MemoryBench:Experiment template owner 先准备

契约单源见 [Library · 没有 template 的 recipe](../library.md#没有-template-的-recipe)、[Architecture · Owner stack](../architecture.md#owner-stack)与 [Lifecycle · Experiment template 路径](../lifecycle.md#experiment-template-路径)。

MemoryBench 的 Experiment 提供 E2B template。
Eval 只贡献 checkout 与项目依赖 setup，因此 Experiment 是 templateOwner。

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .setup(mempalSetup({ version: "0.9.0" })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: defineSandboxRecipe().setup(async (sandbox) => {
    await sandbox.runShell(
      "git clone <locked-repository> . && yarn install --immutable",
    );
  }),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
    t.succeeded();
  },
});
```

解析后的 stack 是：

```text
Experiment E2B template
  -> Experiment mempalSetup
  -> Eval checkout and install
  -> AgentProvisioner
  -> state load
  -> Agent runtime setup
```

Experiment 同时拥有 template 与 setup。
template 预装 mempal 只让 `mempalSetup` inspect 命中，不删除实际检查。

若同一批中某条 Eval 自带 Compose recipe，该 Attempt 单独切换为 Eval templateOwner。
Experiment E2B template 变成未激活 fallback，ownerOrder 变成 `eval → experiment → agent`；dry plan 必须展示这项差异。
