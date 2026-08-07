# Sandbox Agent

被测对象是在隔离环境中运行的 coding-agent CLI 时，使用 `defineSandboxAgent`。
Sandbox provider 由 experiment 选择；Adapter 不绑定 Docker、Vercel 或 E2B。

```ts
import { completeEvidenceCoverage, defineSandboxAgent, makeSendFailure } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export default defineSandboxAgent({
  name: "my-coding-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "my-coding-agent", version: "1.4.2" },
    probe: shell('test "$(my-agent --version)" = "1.4.2"'),
  },

  async setup(sandbox, ctx) {
    ctx.progress({ message: "configuring my-agent" });
    // 写鉴权、CLI 主配置、skills / plugins；每个 attempt 只执行一次。
    // 安装与版本探测不写在这里：归 ensure 声明与配对的 Agent 安装层（见下文生命周期）。
  },

  async send(input, ctx) {
    ctx.progress({ message: "running my-agent" });
    const result = await ctx.sandbox.runCommand("my-agent", ["--json", input.text]);
    const parsed = parseMyAgent(result.stdout);

    if (result.exitCode !== 0 || !parsed.terminal) {
      throw makeSendFailure({
        acceptance: parsed.acceptance ?? "unknown",
        message: parsed.error ?? `my-agent exited ${result.exitCode}`,
        events: parsed.events,
        usage: parsed.usage,
        process: { exitCode: result.exitCode },
      });
    }

    return {
      status: parsed.terminal.status,
      events: parsed.events,
      usage: parsed.usage,
    };
  },
});
```

## 生命周期

[Agent Ensure](../architecture/agent-ensure.md)（探测 精确身份、缺失时由配对安装层安装、复检）由 Runner 在 `agent.ensure` 相位按 Adapter 的 ensure 声明执行，排在两方作者 prepare command 之后。
`setup` 只做 Agent runtime 准备：写鉴权、Agent 配置和扩展；不安装 CLI，失败直接抛出并使 attempt errored。
`send` 只执行一轮任务，多轮时会重复调用。只有协议给出完整可信终态才返回 Turn。

CLI 非零、signal、transport 中断或无法解析终态时 reject `SendFailure`。`Turn.status: "failed"` 只保留给协议明确报告的可评分任务失败，不能由 `exitCode !== 0` 直接推导。
可选 cleanup 和 `teardown` 始终在 finally 阶段执行。

每个回调的 `ctx.progress(...)` 只更新当前 `agent.setup` / `agent.run` / `agent.teardown` 的短期 activity;需要永久保留的协议降级、transcript 缺失或 cleanup 问题用 `ctx.diagnostic(...)`。
不要从 CLI stdout 的每个 frame 转发 progress,也不要直接写宿主进程的 stdout/stderr。
完整语义见 [Adapter Library · 向运行反馈进度与诊断](../library.md#向运行反馈进度与诊断)。

环境级二进制、预热和跨 attempt 资源属于 Experiment layer 的 `prepare()` 或预制产物；eval 的任务 Fixture 属于 Eval layer 的 `prepare()` 或 `test(t)`。
三类准备不交换职责。

## Transcript 采集

按以下优先级选择行为数据：

1. CLI 官方结构化 stdout；
2. CLI 为 resume 保存的完整 transcript/tape；
3. 两者都没有时返回空事件，并说明负断言不可信。

采集代码负责定位文件、执行命令和取得原始字符串；parser 只接受 raw string，逐行容错并返回标准事件与 usage。
不要让 parser 读 Sandbox，也不要让 `send` 内联一百行方言状态机。

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

CLI 原生 resume ID 写入 `ctx.session.capture()`，下一轮用 `ctx.session.id` 拼接 resume 参数。
审批过程中尚未消费完的 cursor、parser 和 request ID 放进模块级 `createSessionSlot<T>()` 创建的 typed slot。
暂停前调用 `ctx.session.set(slot, value)`，回答轮调用 `ctx.session.take(slot)` 一次性取回；需要重复读取的状态用 `get(slot)`。

## Skills 与 Plugins

Coding-agent 扩展在构造期配置并由 setup 安装。
实际调用见 [配置 Coding Agent 扩展](coding-agent-extensions.md)，内部边界见 [Architecture · Coding Agent 扩展](../architecture/coding-agent-extensions.md)。
