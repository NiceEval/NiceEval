---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Terminal-Bench:Eval 带 template

契约单源见 [Sandbox Layer · Template-bearing factory](../../layers.md#template-bearing-factory)、[顺序与依赖方向](../../layers.md#顺序与依赖方向)与[三方准备时序 · Eval template 路径](../../lifecycle.md#eval-template-路径)。

每道 Terminal-Bench Eval 的 task package 拥有 Compose 文件、workspace service、测试材料与题意。
因此 Eval 是 template owner,Experiment 保持 command-only:

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
  }),
  async test(t) {
    await t.send("完成任务并把答案写入指定文件。");

    await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests");
    const result = await t.sandbox.runShell("bash /tests/run-tests.sh", {
      user: "root",
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

省略的 `experiment.sandbox` 归一成空 command-only layer,不选择 Provider,也不产生隐式 template。
执行后的准备链是:

```text
Eval Compose template
  -> Eval prepare commands(本题为空)
  -> Experiment prepare commands(本实验为空)
  -> agent.ensure(probe 命中即过,未命中由 Agent 安装层补齐)
  -> Agent runtime
```

Compose template 求值成完整 Case:`client` 主 Sandbox、伴随 service、网络、volume、ready 与整组 finalizer 都归 Docker Compose Provider。
普通 layer command 不能把第二个 image 或 sidecar 叠到 Case 上。

同一 Experiment 还可以选中另一条使用 `e2bSandbox()` 的 Eval。
template 按配对求值,Experiment 不需要按 Provider 分叉。

实验需要证书时,Experiment 追加 command:

```typescript
export default defineExperiment({
  sandbox: sandboxLayer().prepare(installCompanyCertificate),
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

顺序固定为 Eval 命令、Experiment 证书、`agent.ensure`。
证书无法装进某道离线 Compose Case 时,作者用 selector 排除该配对,或让 Eval template 指向已融合证书的 Compose Case;Experiment 不能再提供第二份 template。

测试文件仍在 `send` 返回后通过普通 Sandbox API 上传。
Runner 从真实上传生成 transfer manifest,并检查 Agent 可见 closure;layer 不引入文件专用声明面。
