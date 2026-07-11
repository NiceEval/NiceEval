# Agents 与 Adapters

这一组文档讲 niceeval 如何"连到一个被测对象"。这是整个库最容易被想歪的地方,先把两个核心论点摆出来:

> 1. **niceeval 不定义任何 agent 协议。** 每一个被测对象——你自己的 agent、你的后端服务、Claude Code / Codex 这种 coding agent——**都是自己实现的 adapter**。experiment 引用 agent,而不是给一个 url。
> 2. **adapter 真正的难点不是"连上",而是把各 agent 五花八门的原始返回归一化成一套标准的事件流。** 归一化之后,整套断言都是免费的、与 agent 无关的。

两个词:

- **Agent** —— 抽象。niceeval 眼里"一个被测对象",由 experiment 引用。`t` 上暴露什么由构造证据决定(见[契约 · 能力从哪来](contract.md#能力从哪来构造证明不是问卷)),不是声明式的能力位。运行器只认 Agent 契约。
- **Adapter** —— 实现。某个 agent 的具体代码,**由用户编写**(niceeval 也内置几个常用 coding agent)。一个 Adapter 实现一个 Agent。

按 `kind` 分两种,但**契约完全一样**(都是 `send` 进、`Turn` 出):

- **remote agent**(`defineAgent`,`kind: "remote"`)—— 你在 `send` 里按你服务的协议发 HTTP。不建议把 `send` 写成进程内直调你的函数,理由见[接入你的 Agent · 为什么不直调](../../docs-site/zh/guides/connect-your-agent.mdx)。
- **sandbox agent**(`defineSandboxAgent`,`kind: "sandbox"`)—— 在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。

## 这组文档怎么分

| 文档 | 回答什么问题 |
|---|---|
| [Adapter 契约](contract.md) | **规范参考**:Agent / Turn / 事件流的精确形状;逐 `t` API 的适配义务——eval 调 `t.respond` / `t.newSession` / `t.notCalledTool`…时,adapter 必须返回什么、违约怎么暴露 |
| [Adapter 写法](authoring.md) | **怎么做出来**:递进式写法(收发消息 → 事件流 → 多轮会话 → HITL → tracing)、remote / sandbox 参考实现、采集层技巧、`shared` 工具袋 |
| [采集设计](collection.md) | **从哪采、字段从哪来**:三条外部路线对比、双轨四通道、claude-code / codex / bub / AI SDK 的采集矩阵、接新对象的决策树 |
| [Coding Agent Skills / Plugins DX](coding-agent-skills-plugins.md) | 沙箱型 coding agent 怎么安装 skill / plugin,并组织 A/B 实验 |
| [Capabilities by Construction](../capabilities-by-construction.md) | 能力从哪来的设计动机与源码落点:为什么没有 `capabilities` 声明式字段、`t` 上每个能力各自的构造证据是什么 |
| [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图) | OTel 接入怎么喂 `niceeval view` 的调用瀑布图——只画图,不产出事件、不参与任何断言 |
| [agent-eval 参考](reference/agent-eval.md) | Vercel agent-eval 怎么做同一件事的源码阅读记录——学习资料,不是 niceeval 的实现 |
| [OTel GenAI 等标准参考](reference/otel-genai.md) | "agent 行为怎么记"的行业标准调研:OTel GenAI semconv 对比 agent-eval 自定义方案,附 OpenInference / OpenLLMetry / OpenAI Agents SDK / AG-UI / Langfuse |
| [agent loop 接入面](reference/agent-loop-apis.md) | 四个主流 agent loop(OpenAI Agents SDK / Claude Agent SDK / LangGraph / pi)的原生 API / 会话 / HITL / 遥测面调研 |
| [OTel 埋点生态](reference/otel-instrumentation.md) | 应用侧现成埋点(AI SDK telemetry / OpenLLMetry / OpenInference / 官方 contrib)里到底有没有 eval 要的数据 |
| [eve 协议机制](reference/eve-protocol.md) | 第三条路线:自有运行时原生吐协议(`HandleMessageStreamEvent` 26 种事件、三级坐标、requestId 回答)——`StreamEvent` 演进的上限参照 |
| [Claude Code 自带 OTel 遥测](reference/claude-code-otel-telemetry.md) | Claude Code CLI 自己的 OTLP 导出(metrics/logs GA、traces beta)能不能让 claude-code adapter 提前拿到中间结果,而不是等 `--print` 进程退出才读整份 transcript |

## 为什么是 experiment 选 agent,不是 `--url`

eve 能用一个 url 当被测对象,是因为它**定义了一套自己的协议**、被测 agent 恰好会说——于是"连哪"退化成"哪个 url"。niceeval 没有这个前提:不存在一套通用协议让任意 agent 都会说。所以:

- **没有 `--url`、没有通用的 "http agent"。** 要连你的 HTTP 服务,你写一个 agent,它内部知道你服务的协议(URL、鉴权、消息格式都是它的私事)。
- **agent 写进 experiment。** "评本地 vs 评线上"靠 agent 自己读 env,或写成两个 experiment / 两个 agent 配置:

```sh
npx niceeval exp local weather   # 评本地
npx niceeval exp prod weather    # 评线上
```

## Agent × Sandbox 正交

```text
experiment.agent    选「连哪个被测对象」(自实现的 adapter)
experiment.sandbox  选「沙箱型 agent 在哪跑」(docker / vercel / 三方;没有 CLI 覆盖)
```

任意沙箱型 agent × 任意 sandbox provider 自由组合:`claude-code` 可跑 docker 也可跑 vercel;同一个 docker 沙箱可跑 `claude-code` 也可跑 `bub`。运行器按 experiment(或 config 兜底)的 `sandbox` 字段备好 `Sandbox` 交给 `ctx.sandbox`,二者只通过 `Sandbox` 接口交互。remote agent 忽略 sandbox。详见 [Sandbox](../sandbox.md)。

## 相关阅读

- [Observability](../observability.md) —— transcript → 标准事件流的归一化、o11y、用量。
- [Scoring](../scoring.md) / [Assertions](../assertions.md) —— 这套事件流之上的全部断言。
- [Vision](../vision.md) —— 为什么名字只能用于路由、为什么没有通用协议。
