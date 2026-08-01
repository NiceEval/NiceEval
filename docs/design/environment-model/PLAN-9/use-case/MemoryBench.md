# MemoryBench:Experiment template owner 先准备

契约单源见 [Library · 没有 template 的 recipe](../library.md#没有-template-的-recipe)、[Architecture · Owner stack](../architecture.md#owner-stack)与 [Lifecycle · Experiment template 路径](../lifecycle.md#experiment-template-路径)。

MemoryBench 的 Experiment 提供 E2B template。
Experiment 的 mempal 条件属于复用窗口，Eval 的 checkout 与项目依赖属于每条 Attempt；Experiment 是 templateOwner。

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .setup(mempalSetup({ version: "0.9.0" }))
    .teardown(mempalTeardown),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: defineSandboxRecipe().beforeEach(async (sandbox) => {
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
  -> window scope: Experiment mempalSetup
  -> window scope: Eval setup（本题可为空）
  -> reset anchor（包含 mempal）
  -> attempt scope: Experiment beforeEach（本实验可为空）
  -> attempt scope: Eval checkout and install
  -> Agent diff workspace baseline
  -> AgentProvisioner
  -> state load
  -> Agent runtime setup
  -> attempt cleanup: Eval afterEach -> Experiment afterEach
  -> window cleanup: Eval teardown -> Experiment mempalTeardown
```

Experiment 同时拥有 template 与 setup。
template 预装 mempal 只让 `mempalSetup` command 中的版本检查提前返回，不删除这条 command。复用时 mempal setup/teardown 每窗口各一次，Eval checkout beforeEach 则按当前 Eval 每 Attempt 执行。

两方窗口 setup 完成后建立 reset anchor；当前 Attempt 的 checkout 完成后才建立 Agent diff baseline。因此 checkout 不计入 Agent 修改，但不同 Eval 的 checkout command 不需要进入 pool key。

若同一批中某条 Eval 自带 Compose recipe，该 Attempt 单独切换为 Eval templateOwner。
Experiment E2B template 变成未激活 fallback，ownerOrder 变成 `eval → experiment → agent`；两种 scope 都随之换序，dry plan 必须展示这项差异。
