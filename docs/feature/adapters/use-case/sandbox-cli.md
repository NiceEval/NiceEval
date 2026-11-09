# 在 Sandbox 中运行 coding-agent CLI

## 用户目标

评估作者要在 Sandbox 实例中运行 Codex CLI，验证 Agent 可以完成一次任务，不在题目中维护 CLI 安装脚本。

## 起始状态

项目已配置 NiceEval 的发现目录，Docker 可用，宿主进程变量已设置 `CODEX_API_KEY`。
模型服务可用，实验允许 Agent 使用该服务。本页只展示配置与调用，未启动 Sandbox 或调用模型；输出均为预期输出。

## 完整路径

1. 在 Eval 目录保存 `greet.ts`，只描述任务与完成检查。 {#task}

   ```ts
   import { defineEval } from "niceeval";

   export default defineEval({
     description: "Agent 完成一次问候",
     async test(t) {
       const turn = await t.send("请简短问候用户。");
       turn.succeeded().label("完成问候");
     },
   });
   ```

   预期输出：Eval 定义完成；此时尚未启动 CLI，也没有发送模型请求。

2. 在 Experiment 目录保存 `coding.ts`，分别选择 Agent 与 Sandbox provider。 {#configure}

   ```ts
   import { defineExperiment } from "niceeval";
   import { codexAgent } from "niceeval/adapter";
   import { dockerSandbox } from "niceeval/sandbox";

   export default defineExperiment({
     adapter: codexAgent(),
     sandbox: dockerSandbox({
       source: { type: "image", image: "node:24-slim" },
     }),
     attempts: 1,
   });
   ```

   预期输出：Experiment 选择了在 Docker Sandbox 中运行的 Codex Adapter；不需要把安装命令放入 Eval。

3. 执行问候评估，观察 Agent 准备与任务结果。 {#run}

   ```sh
   niceeval exp coding greet
   ```

   预期输出：Human 进度显示 `checking Codex CLI <version>`，缺少锁定版本时继续显示安装进度，最后显示 `Codex CLI <version> ready`。
   `<version>` 表示 Adapter 锁定的版本。协议返回 completed Turn 时，完成检查匹配，Attempt 为 `passed`。

## 结果

Agent 接入与执行地点分别由 Adapter 和 Sandbox provider 选择。
CLI 准备失败属于执行错误；无法取得可信终态时也走执行错误路径，不由进程退出码推断任务通过或失败。

## 相关契约

- [Codex CLI](../library/sdk/codex-cli/README.md)：内置安装、鉴权与进度。
- [Sandbox Agent](../library/sandbox-agent.md)：准备、执行与失败边界。
- [Sandbox Library](../../sandbox/library/README.md)：Docker 起点。
- [Experiment 选择 Adapter](../../experiments/library/README.md#选择-adapter) 与 [CLI](../../experiments/cli/README.md#命令)：运行入口。
