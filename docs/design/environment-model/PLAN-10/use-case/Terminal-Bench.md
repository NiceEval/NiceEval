# Terminal-Bench：Eval root 与 Experiment extension

契约单源见 [Library · Root 与 extension](../library.md#root-与-extension)、[Architecture · 固定 owner 顺序](../architecture.md#固定-owner-顺序)与 [Lifecycle · Eval root 路径](../lifecycle.md#eval-root-路径)。

每道 Terminal-Bench Eval 的 task package 拥有 Compose 文件、workspace service、测试材料与题意。
因此 Eval 提供 root layer，Experiment 默认是空 extension layer。

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import { dockerComposeSandbox } from "niceeval/sandbox";

export default defineEval({
  description: "play-zork-easy",
  sandbox: dockerComposeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
    executionUser: "image",
  }),
  async test(t) {
    await t.send("完成任务并把答案写入指定文件。");

    await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests");
    const result = await t.sandbox.runShell("bash /tests/run-tests.sh", {
      root: true,
    });
    t.check(result, commandSucceeded());
  },
});
```

```typescript
import { codexAgent } from "niceeval/adapter";
import { defineExperiment } from "niceeval";

export default defineExperiment({
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

省略的 `experiment.sandbox` 被规范化为空 extension，不选择 Provider，也不产生 implicit template。
归一后的准备链是：

```text
Eval Docker Compose root
  -> Eval prepare commands（本题可为空）
  -> Experiment prepare commands（本实验可为空）
  -> Codex AgentProvisioner inspect / install / reinspect
  -> Agent runtime
```

Compose root 规划成完整 Case：`client` 主 Sandbox、伴随 service、网络、volume、ready 与整组 finalizer 都留在 Docker Compose Provider。
普通 Layer command 不能把第二个 image 或 sidecar 叠到 Case 上。

同一 Experiment 还可以选中另一条使用 `e2bSandbox()` 的 Eval。
root 按 pair 归一，所以 Experiment 不需要按 Provider 分叉。

若实验需要证书，可以添加 extension command：

```typescript
export default defineExperiment({
  sandbox: sandboxLayer().prepare(ensureCompanyCertificate),
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

顺序强制为 Eval root command、Experiment certificate、AgentProvisioner。
如果证书无法装进某道离线 Compose Case，作者必须排除该 pair，或让 Eval root 指向已融合证书的 Compose Case；Experiment 不能再提供第二 root。

测试文件仍在 `send` 返回后通过普通 Sandbox API 上传。
Runner 从真实上传生成 transfer manifest，并检查 Agent 可见 closure；Layer 不引入文件专用声明面。
