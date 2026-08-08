# MemoryBench：Experiment root 与 Eval extension

契约单源见 [Library · Eval 与 Experiment 使用同一个类型](../library.md#eval-与-experiment-使用同一个类型)、[Architecture · Agent 安装进入同一时间线](../architecture.md#agent-安装进入同一时间线)与 [Lifecycle · Experiment root 路径](../lifecycle.md#experiment-root-路径)。

MemoryBench 的 Sandbox 与 mempal 版本随 Experiment 变化，具体 Eval 只负责 checkout 固定仓库并准备题目。
因此 Experiment 提供 E2B root，Eval 提供 extension command。

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .prepare(mempalEnsure({ version: "0.9.0" })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: sandboxLayer().prepare(async (sandbox) => {
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

归一后的顺序是：

```text
Experiment E2B root
  -> Experiment mempalEnsure
  -> Eval checkout and dependencies
  -> AgentProvisioner
  -> State load
  -> Agent runtime
```

`mempalEnsure` 每条 Attempt 都检查实际版本。
template 中已经预装正确版本时快速返回；缺失时现场安装并复检；不兼容时在 Experiment layer phase 明确失败。
预装 template 名本身不代替实际检查。

开启 Sandbox 复用后，Runner 每条 Attempt 仍先 reset，再重新执行 mempal ensure、checkout 与 AgentProvisioner。
如果 mempal 安装在 reset 保留的位置，检查会命中；如果 reset 删除它，当前 Attempt 重新安装。
作者不需要判断 mempal 属于 `setup` 还是 `beforeEach`。

外部 memory state 不进入 Layer：AgentProvisioner 收敛后执行 State load，Agent teardown 后执行 State save。
需要跨 Attempt 保留活状态时由 State Feature 与 `sandboxReuse` 声明复用周期边界，不让普通 command 假装拥有一次性复用周期语义。

若同一 Experiment 误选了一道自带 Compose root 的 Eval，该 pair 是两个 root：

```text
Eval Compose root + Experiment E2B root -> sandbox.root-conflict
```

Runner 在全矩阵 pure link 中列出冲突并保持零 Provider I/O。
作者可以缩小 Experiment selector，或把该组合改成唯一的融合 root；E2B root 不会静默取代 Eval root。
