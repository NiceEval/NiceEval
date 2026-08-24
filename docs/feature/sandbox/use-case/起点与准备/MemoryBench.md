# MemoryBench:Experiment 带 template

契约单源见 [Sandbox Layer · Eval 与 Experiment 使用同一个类型](../../layers.md#eval-与-experiment-使用同一个类型)、[内置 before action](../../prepare-commands.md)与[三方准备时序 · Experiment template 路径](../../lifecycle.md#experiment-template-路径)。

MemoryBench 的 Sandbox 和 mempal 版本随 Experiment 变化,具体 Eval 只负责 checkout 固定仓库并准备题目。
因此 Experiment 是 template owner,Eval 保持 command-only:

```typescript
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { changeFrequency, e2bSandbox, shell } from "niceeval/sandbox";

export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .before(shell({
      id: "install-mempal",
      command: "mempal --version | grep -q '^0.9.0$' || (npm install -g mempal@0.9.0 && mempal --version | grep -q '^0.9.0$')",
      changeFrequency: changeFrequency.rare,
    }))
    .before(async (sandbox, context) => {
      const checkpoint = await restoreMempalForThisPhysicalSandbox(sandbox);
      context.onCleanup(() =>
        archiveMempalFromThisPhysicalSandbox(sandbox, checkpoint),
      );
    }),
  agent: codexAgent(),
  sandboxReuse: true,
  maxConcurrency: 1,
  sharedState: { key: "mempal/codex/cohort-a" },
});
```

```typescript
import { defineEval } from "niceeval";
import {
  changeFrequency,
  gitCheckout,
  sandboxLayer,
  shell,
} from "niceeval/sandbox";

export default defineEval({
  sandbox: sandboxLayer()
    .before(gitCheckout({
      id: "memory-tasks",
      repository: "https://github.com/acme/memory-tasks",
      ref: "9e107d9d4f6a6af8f1d53d4dc37b22d7d98c23af",
      to: ".",
      changeFrequency: changeFrequency.rare,
    }))
    .before(shell({
      id: "install-dependencies",
      command: "yarn install --immutable",
      changeFrequency: changeFrequency.normal,
    })),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
    t.succeeded();
  },
});
```

执行后的顺序是:

```text
Experiment E2B template
  -> physical before 恢复 checkpoint（一次）
  -> Experiment shell(install-mempal)
  -> Eval checkout 与依赖安装
  -> agent.ensure
  -> Agent runtime
```

`install-mempal` Action 每条 Attempt 都用 shell 内的探测检查实际版本。
template 已预装正确版本时首测即成功；缺失时现场安装并复检；template 名本身不代替实际检查。

开启 Sandbox 复用后，Runner 每条 Attempt 仍先 reset，再满足 install-mempal、checkout 与 `agent.ensure`。
mempal 装在 workdir 外，reset 后探测命中；`gitCheckout()` 的完成态 commit 与前缀身份让相同 checkout 直接 restore。Provider 只能提供 invocation-local 缓存时，同一次运行的后续 Attempt 也不再访问远端。
逐 Attempt 的 action 都在 attempt before 中满足。物理实例的记忆目录由 physical callback before 恢复，并在成功后立即用 `context.onCleanup()` 登记回存。

Mempal 的 `$HOME` 目录属于实际 Sandbox。新的 Run 也在同一条 physical before 恢复 checkpoint；回存按实际登记栈 LIFO，发生在 Provider finalizer 前。它不是可缓存 Action，也不会发布含外部状态的前缀。
`sandboxReuse` 保留本 Invocation 的连续实例，`maxConcurrency: 1` 固定本 Invocation 的顺序，`sharedState.key` 防止两个 Invocation 交错恢复和回存同一 checkpoint。

同一 Experiment 误选一道自带 Compose template 的 Eval 时,该配对是两份 template:

```text
Eval Compose template + Experiment E2B template -> sandbox.template-conflict
```

Runner 在全矩阵 link 中列出冲突并保持零 Provider I/O。
作者可以收窄 Experiment selector,或把该组合改成唯一的融合 template;E2B template 不会静默改写 Eval template。
