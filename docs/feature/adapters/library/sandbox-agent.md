# Sandbox Agent

被测对象是在隔离环境中运行的 coding-agent CLI 时，使用 `defineSandboxAgent`。Sandbox provider 由 experiment 选择；Adapter 不绑定 Docker、Vercel 或 E2B。

```ts
import { defineSandboxAgent, shared } from "niceeval/adapter";

export default defineSandboxAgent({
  name: "my-coding-agent",

  async setup(sandbox, ctx) {
    ctx.progress({ message: "checking my-agent installation" });
    await shared.ensureInstalled(sandbox, "my-agent", ["npm", "install", "-g", "my-agent"]);
    // 写鉴权、CLI 主配置、skills / plugins；每个 attempt 只执行一次。
  },

  async send(input, ctx) {
    ctx.progress({ message: "running my-agent" });
    const result = await ctx.sandbox.runCommand("my-agent", ["--json", input.text]);
    const parsed = parseMyAgent(result.stdout);

    return {
      status: result.exitCode === 0 ? "completed" : "failed",
      events: parsed.events,
      usage: parsed.usage,
    };
  },
});
```

## 生命周期

`setup` 安装 CLI、写 Agent 配置和扩展；失败直接抛出并使 attempt errored。`send` 只执行一轮任务，多轮时会重复调用。可选 cleanup 和 `teardown` 始终在 finally 阶段执行。

每个回调的 `ctx.progress(...)` 只更新当前 `agent.setup` / `agent.run` / `agent.teardown` 的短期 activity;需要永久保留的协议降级、transcript 缺失或 cleanup 问题用 `ctx.diagnostic(...)`。不要从 CLI stdout 的每个 frame 转发 progress,也不要直接写宿主进程的 stdout/stderr。完整语义见 [Adapter Library · 向运行反馈进度与诊断](../library.md#向运行反馈进度与诊断)。

环境级二进制、预热和跨 attempt 资源属于 `SandboxSpec.setup()`；eval 的任务 fixture 属于 eval setup 或 `test(t)`。三类 setup 不交换职责。

## Transcript 采集

按以下优先级选择行为数据：

1. CLI 官方结构化 stdout；
2. CLI 为 resume 保存的完整 transcript/tape；
3. 两者都没有时返回空事件，并说明负断言不可信。

采集代码负责定位文件、执行命令和取得原始字符串；parser 只接受 raw string，逐行容错并返回标准事件与 usage。不要让 parser 读 Sandbox，也不要让 `send` 内联一百行方言状态机。

### 字段检查

接入新 CLI 时必须回答：

- 工具 call ID 在哪里，是否支持并发？
- 工具失败、拒绝和取消怎样表达？
- session ID 从哪里取得，resume 参数是什么？
- usage、cache tokens、cost 和实际模型在哪里？
- 异常终止时 transcript 是否仍完整？
- transcript 与 stdout 同时存在时，怎样避免重复事件？

找不到 usage 就省略；找不到稳定 call ID 时只能明确限制并发配对能力，不能假装 FIFO 永远正确。

## 会话与 HITL

CLI 原生 resume ID 写入 `ctx.session.capture()`，下一轮用 `ctx.session.id` 拼接 resume 参数。审批过程中尚未消费完的 cursor、parser 和 request ID 用 `hold()` / `take()` 保存。

## Skills 与 Plugins

Coding-agent 扩展在构造期配置并由 setup 安装。实际调用见 [配置 Coding Agent 扩展](coding-agent-extensions.md)，内部边界见 [Architecture · Coding Agent 扩展](../architecture/coding-agent-extensions.md)。
