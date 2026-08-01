# Terminal-Bench:Eval template owner 先准备

契约单源见 [Library · Eval template](../library.md#eval-template)、[Architecture · Owner stack](../architecture.md#owner-stack)与 [Lifecycle · Eval template 路径](../lifecycle.md#eval-template-路径)。

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
它不选择 Provider；Compose service、网络、volume、ready 与 workspace service 在启动前进入完整 Case。

## Experiment recipe

```typescript
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";

export default defineExperiment({
  agent: codexAgent(),
  sandbox: dockerSandbox().setup(ensureGitForLedger),
  evals: ["terminal-bench/"],
});
```

Docker fallback 因 Eval 已有 template 而不激活。
Docker Provider 内建 Compose planner；Experiment 不注册 materializer，也不需要检查选中 Eval 的 template kind。

解析后的 stack 是：

```text
Eval Compose template
  -> Eval recipe setup（本题可为空）
  -> Experiment ensureGitForLedger
  -> AgentProvisioner and Agent setup
```

## Profile 完整 Case

某题断网且无法现场加入 Experiment 条件时，Provider recipe 提供完整预制 Case：

```typescript
dockerSandbox({
  templates: {
    "terminal-bench/play-zork-easy": {
      image: "acme/play-zork-with-tools@sha256:...",
    },
  },
}).setup(ensureGitForLedger);
```

表项替换 Compose template 的物理实现，Eval 仍是 templateOwner。
因此 ownerOrder 不变，`ensureGitForLedger` 仍在 Eval recipe setup 后检查实际状态。

## Runner 证据

dry plan 与运行记录都展示 Eval templateOwner、Docker Provider、CaseKey 与 `eval → experiment → agent`。
transfer manifest 和 Agent 可见 closure 在判定封口前比对，发现测试泄漏时拒绝 verdict。
