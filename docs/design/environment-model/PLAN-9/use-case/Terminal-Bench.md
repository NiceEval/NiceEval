# Terminal-Bench:Eval template owner 先准备

契约单源见 [Library · Template-bearing recipe](../library.md#template-bearing-recipe)、[Architecture · Owner stack](../architecture.md#owner-stack)与 [Lifecycle · Eval template 路径](../lifecycle.md#eval-template-路径)。

## Eval recipe

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import { composeSandbox } from "niceeval/sandbox";

export default defineEval({
  description: "play-zork-easy",
  sandbox: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
    executionUser: "image",
  }),

  async test(t) {
    await t.send("完成任务并把答案写入指定文件。");

    await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests");
    await t.sandbox.uploadFile(
      "/tests/run-tests.sh",
      new URL("run-tests.sh", import.meta.url),
    );

    const result = await t.sandbox.runShell("bash /tests/run-tests.sh", {
      root: true,
    });
    t.check(result, commandSucceeded());
  },
});
```

`composeSandbox()` 同时声明 SandboxTemplate 与 Eval recipe。
它同时选择 Docker Compose Provider；Compose service、网络、volume、ready 与 workspace service 在启动前进入完整 Case。

## Experiment recipe

```typescript
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

Experiment 不选择 Provider，也不检查选中 Eval 的 template kind。多容器 Eval 可以用 `composeSandbox(...)`，单机 Eval 可以用 `e2bSandbox({ template })`；同一 Experiment 直接混跑，Provider 由每条 Eval 自己带出。

NiceEval ledger 所需的 Git 由 Runner 自己保证，Codex CLI 由官方 Adapter 安装，benchmark 不复制这两项基础设施责任。

解析后的 stack 是：

```text
Eval Compose template
  -> window scope: Eval setup（本题可为空）
  -> window scope: Experiment setup（本实验可为空）
  -> reset anchor
  -> attempt scope: Eval beforeEach（本题可为空）
  -> attempt scope: Experiment beforeEach（本实验可为空）
  -> AgentProvisioner and Agent setup
```

## 无法现场组合

某题断网且无法现场加入 Experiment command 时，Runner 不接受 Experiment 再提供第二份 base image。作者必须让该 Eval 自己改用一份已经融合条件的完整 template，或把它移出这个 Experiment：

```typescript
export default defineEval({
  sandbox: composeSandbox({
    file: new URL("docker-compose.with-tools.yaml", import.meta.url),
    workspaceService: "client",
    build: "prebuilt",
  }),
});
```

这份 Compose 可以引用已经预装工具的 digest image，同时保留原多容器拓扑；仍只有 Eval 一份 template，Eval 仍是 templateOwner。若它只对某个实验成立，应拆成明确的 Eval / Experiment selector；PLAN-9 不隐藏乘积关系。

## Runner 证据

dry plan 与运行记录逐 Eval 展示 template factory、由它选出的 Docker Compose 或 E2B Provider、CaseKey、Case/Attempt scope 与 `eval → experiment → agent`。
transfer manifest 和 Agent 可见 closure 在判定封口前比对，发现测试泄漏时拒绝 verdict。
