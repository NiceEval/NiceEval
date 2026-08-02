# MemoryBench:Experiment 带 template

契约单源见 [Sandbox Layer · Eval 与 Experiment 使用同一个类型](../../layers.md#eval-与-experiment-使用同一个类型)、[内置 prepare 命令](../../prepare-commands.md)与[三方准备时序 · Experiment template 路径](../../lifecycle.md#experiment-template-路径)。

MemoryBench 的环境和 mempal 版本随 Experiment 变化,具体 Eval 只负责 checkout 固定仓库并准备题目。
因此 Experiment 是 template owner,Eval 保持 command-only:

```typescript
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox, installTool, shell } from "niceeval/sandbox";

export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .prepare(installTool({
      tool: "mempal",
      identity: { version: "0.9.0" },
      probe: shell("mempal --version | grep -q 0.9.0"),
      install: shell("curl -fsSL https://get.mempal.dev | sh"),
    }))
    .setup(async (sandbox) => {
      await restoreMempalForThisPhysicalSandbox(sandbox);
    })
    .teardown(async (sandbox) => {
      await archiveMempalFromThisPhysicalSandbox(sandbox);
    }),
  agent: codexAgent(),
});
```

```typescript
import { defineEval } from "niceeval";
import { checkout, sandboxLayer, shell } from "niceeval/sandbox";

export default defineEval({
  sandbox: sandboxLayer()
    .prepare(checkout({
      repo: "https://github.com/acme/memory-tasks",
      ref: "9e107d9d",
    }))
    .prepare(shell("yarn install --immutable")),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
    t.succeeded();
  },
});
```

解析后的顺序是:

```text
Experiment E2B template
  -> Sandbox lifecycle setup (一次)
  -> Experiment installTool(mempal)
  -> Eval checkout 与依赖安装
  -> agent.ensure
  -> Agent runtime
```

`installTool` 每条 Attempt 都用 probe 检查实际版本。
template 已预装正确版本时首测即命中;缺失时现场安装并复检;template 名本身不代替实际检查。

开启 Sandbox 复用后,Runner 每条 Attempt 仍先 reset,再重放 installTool、checkout 与 `agent.ensure`。
mempal 装在 workdir 外,reset 后 probe 命中;`checkout()` 的镜像让第二条 Attempt 起零网络,只付本地写入。
逐 Attempt 的命令仍只有 `prepare()` 一种频次；物理实例的记忆目录则明确由 lifecycle hook 管理。

Mempal 的 `$HOME` 目录属于实际 Sandbox，`setup()` 在实例 ready 后恢复一次，`teardown()` 在其退休、Provider finalizer 前封存一次。新的 run 也在同一条 `setup()` 边界恢复 checkpoint，它不假装成普通 command；需要同一条连续实例时声明 `sandboxReuse: true`，需要固定顺序再声明 `maxConcurrency: 1`。

同一 Experiment 误选一道自带 Compose template 的 Eval 时,该配对是两份 template:

```text
Eval Compose template + Experiment E2B template -> sandbox.template-conflict
```

Runner 在全矩阵 link 中列出冲突并保持零 Provider I/O。
作者可以收窄 Experiment selector,或把该组合改成唯一的融合 template;E2B template 不会静默覆盖 Eval template。
