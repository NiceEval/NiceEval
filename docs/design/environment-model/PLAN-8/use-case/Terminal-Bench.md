# Terminal-Bench:Eval Environment 与 Docker 内建解析

契约单源见 [Library · Eval Environment](../library.md#eval-environment)、[Architecture · 唯一起点解析](../architecture.md#唯一起点解析)与 [Lifecycle](../lifecycle.md)。

## Eval

每道题在自己的目录声明 Compose Environment。
调用点只表达题目条件，不选择 Provider，也不注册转换器。

```typescript
import { defineEval } from "niceeval";
import { composeEnvironment } from "niceeval/environment";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  description: "play-zork-easy",
  environment: composeEnvironment({
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

Environment 启动前决定 Compose service、网络、volume、ready 与 workspace service。
send 后的测试上传只是 Eval 代码对运行中主 Sandbox 的操作，不会反向改变 Case 拓扑。

## Experiment

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

Experiment 只选择 Docker Provider，并声明启动后的 Experiment 条件。
它不导入 `dockerComposeMaterializer()`，也不需要知道选中的 Eval 使用 Compose 还是 Dockerfile Environment。

Docker Provider 若不支持 Compose，这个组合在计划期明确 skipped。
Provider 不能静默使用 defaultEnvironment 跑一个拓扑不同的近似环境。

## 无法现场准备的条件

某个 profile 断网且无法安装 Experiment 工具时，项目提供完整预制 Case：

```typescript
dockerSandbox({
  environments: {
    "terminal-bench/play-zork-easy": {
      image: "acme/play-zork-with-tools@sha256:...",
    },
  },
}).setup(ensureGitForLedger);
```

表项替换该 profile 的按需 Compose 规划，不与 Compose 产物运行时合并。
`ensureGitForLedger` 仍要检查实际状态；预制产物名不是命中证明。

## Runner 记录

记录包含 Compose Environment identity、实际 Case、BuildKey、CaseKey、setup activity 与 transfer manifest。
判定封口前，Runner 对比测试 source 与 Agent 可见 build / mount closure，发现泄漏时拒绝 verdict。
