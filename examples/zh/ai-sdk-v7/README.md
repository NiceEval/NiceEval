# AI SDK v7 × 内建适配器示例(全能力档)

这个例子演示 **niceeval 官方内建的 AI SDK 适配器**:应用只写「怎么召模型」,协议侧的一切
(会话、事件流、HITL 握手、失败兜底)由 `aiSdkAgent` 工厂承担,并证明当 adapter 把能力档
做满时,整套断言 surface 用起来是什么体验。

和隔壁 [`examples/zh/ai-sdk`](../ai-sdk/) 是互补关系:

| 示例 | 演示什么 | adapter 来源 |
|---|---|---|
| `ai-sdk`(v6) | **自己写 adapter**:HTTP web agent、`defineAgent` + `fromAiSdk`、双可观测(Langfuse + niceeval) | 自写(`adapter/adapter.ts`) |
| `ai-sdk-v7`(本目录) | **用官方内建适配器**:`aiSdkAgent` 一行接线、AI SDK v7 tool approval → HITL、全 tier 断言 | niceeval 内建(`niceeval/adapter` 的 `aiSdkAgent`) |

## 接线方式

被测助手是一个 AI SDK v7 工具循环(查天气 / 算数 / 搜索 / 发邮件),进程内直调、不用起服务:

```ts
// experiments/compare-models/deepseek-v4-pro.ts
import { aiSdkAgent } from "niceeval/adapter";
import { assistant } from "../../agent/assistant.ts";

export default defineExperiment({
  agent: aiSdkAgent(assistant),   // 官方工厂;assistant 只有 generate + data
  model: "deepseek-v4-pro",
});
```

`agent/assistant.ts` 里只有应用自己的事:系统提示、四个工具、一个 `generate`(怎么调
`generateText`)和一个 `data`(结构化输出取什么)。会话历史、`isNew` / resume、
tool approval 的停轮与裁决翻译、空结果兜底,全部在 niceeval 的 `aiSdkAgent` 工厂里。

## 每条 eval 演示一个能力档

| eval | 能力档 | 用到的断言 |
|---|---|---|
| `structured-output` | 结构化输出(基础) | `turn.outputMatches`(zod schema)、`t.check` + `equals` / `includes` |
| `weather-tool` | 事件流 | `calledTool`(含 input 匹配)、`toolOrder`、`notCalledTool`、`maxToolCalls`、`noFailedActions`、`eventOrder`、`maxTokens` / `maxCost` |
| `multi-turn` | 多轮会话 | 跨轮记忆 + `t.newSession()` 隔离(`eventsSatisfy` 验证新会话不共享上下文) |
| `hitl-approve` | HITL 批准 | `status === "waiting"`、`event("input.requested")`、`t.requireInputRequest`、`t.respond("approve")`、跨轮 `callId` 配对(`calledTool(..., { status: "completed" })`) |
| `hitl-deny` | HITL 拒绝 | `t.respondAll("deny")`、`calledTool(..., { status: "rejected" })`(人否决 ≠ 工具故障,`noFailedActions` 仍通过) |
| `image-understanding` | 多模态 | `t.sendFile` + 按模型 `t.skip` |

HITL 靠的是 AI SDK v7 的 tool approval:`send_email` 工具带 `needsApproval: true`,模型决定
调它时 SDK 停轮吐出 `tool-approval-request`,`fromAiSdk` 把它映射成 `status: "waiting"` +
`input.requested` 事件;`t.respond("approve" / "deny")` 的文本由工厂翻译成
`tool-approval-response` 塞回 messages 再召一次 —— 拒绝的调用以 `rejected`(而非 `failed`)
落进事件流。

tracing 也开着:`assistant.ts` 声明 `capabilities: { tracing: true }`,埋点用的是 **AI SDK
官方 OTel 集成**(`@ai-sdk/otel`,产 OTel GenAI semconv):`invoke_agent` / `chat` /
`execute_tool` 全 span 树自动生成、直接命中 niceeval 的 canonical 层,零 mapper。
`npx niceeval view` 里直接看瀑布图。

## 双 OTel:AI SDK 自带一个,niceeval 另一个

被测应用自带的 OTel(`@ai-sdk/otel` 埋点)和 niceeval 的接收器是两回事:前者产 span,
后者收 span——中间的接线在 `agent/instrumentation.ts`,两个出口:

- **出口 1(可选)**:你自己的观测后端。设了环境变量 `OTLP_BACKEND_URL`(Langfuse /
  SigNoz / 生产 collector)就一直双发;
- **出口 2**:niceeval 本次运行的接收端点,经 `ctx.telemetry` 逐 attempt 进来。

并发安全的关键是**不用全局 provider**:按 endpoint 缓存 provider,每次 `generateText` 经
`telemetry.integrations` 传入绑定了该 endpoint tracer 的集成(per-call 覆盖全局注册),
并行 attempt 各用各的出口,span 不串流。每轮结束 `forceFlush`——eval 的轮次归属靠
时间窗口,span 必须立刻送到。

这是「进程内直调」场景的接法;长驻服务、子进程等其它形态见 docs-site
「通过 OTel 接入」。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`,`niceeval` 以 link 方式指向仓库根)。

```sh
cd examples/zh/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY / OPENAI_API_KEY

pnpm exec niceeval list                              # 列出 eval
pnpm exec niceeval exp compare-models                # 两个模型并排对比
pnpm exec niceeval exp compare-models/deepseek-v4-pro  # 只跑一格
pnpm exec niceeval exp compare-models weather-tool   # 在实验组里只跑某个 eval
pnpm exec niceeval view                              # 本地查看器(trace 瀑布图在这里)
```

跨模型对比写**多个实验文件**:`experiments/compare-models/` 下每个文件钉一个 `model`
(`model` 是单个字符串,不接受数组)。

注意:

- `image-understanding` 只在支持视觉的模型上真跑,其余模型 `t.skip`。当前 `agent/models.ts`
  把 gpt-5.4 标为不支持 —— 不是模型不行,是经 `OPENAI_BASE_URL` 网关传图会被拒(详见
  `memory/openai-proxy-image-input-broken.md`);直连 OpenAI 后把 `supportsVision` 改回
  `true` 即可。
- 没有 judge API key 时,judge 断言自动跳过,确定性断言照常跑;judge 模型配置在
  `niceeval.config.ts`(默认 `gpt-5.4`,走 `OPENAI_API_KEY`)。
- 这里注册的是 remote(进程内)agent,不创建沙箱;`t.sandbox.*` / diff 断言需要 sandbox
  agent(见 `examples/zh/coding-agent-skill`)。
