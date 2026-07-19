---
name: ai-sdk-agent-otel-timing-subtree-unlinked
description: "aiSdkAgent 的 attempt-scope OTel tracing（tracing: aiSdkOtel()）真的收到了带正确 gen_ai.tool.call.id 的 span——`show --execution` 的节点级关联工作正常——但 `show --timing` 的 OTel 子树永远挂不出来，turn.traceId 从未被赋值"
metadata:
  type: infra-bug
---

**现象**：`e2e/repos/ai-sdk` 用内置 `aiSdkAgent({ tracing: aiSdkOtel(), generate })` 真机跑
一条含 `get_weather` 工具调用的 Eval。`niceeval show @<locator> --execution`
表现完全正确：TOOL 卡片带真实 span 耗时注释（如 `TOOL · get_weather  1.4s · 0ms`），没有
"timing unavailable"，footer 只提示"N unlinked telemetry spans omitted"（这部分是 AI SDK 的
`invoke_agent`/`chat`/`agent_step` 这类没有 callId 的模型级 span，本来就没有骨架节点可挂，
提示本身正确）。但 `niceeval show @<locator> --timing` 的 OTel 子树完全空白——只有 runner
自己的 `eval.run → turn` 时间树，不挂任何 `gen_ai.*` span，即使 `trace.json` 里躺着一模一样
的 span 数据、且 `execute_tool` span 的 `gen_ai.tool.call.id` 与事件流 `action.called.callId`
精确匹配。

**根因**：`--execution` 与 `--timing` 走的是两条**不同**的关联机制，都在
`docs/observability.md`「span 怎么归属到轮」一节里描述过，但没写清楚"仅 shared-pool 走
turn.traceId"这一半：
- `src/o11y/execution-tree.ts`：按 `span.attributes.gen_ai.tool.call.id` 精确匹配
  `action`/`subagent`/`skill.loaded` 节点的 `callId`——纯数据关联，不依赖 `turn.traceId`，
  对 `aiSdkAgent` 这类 attempt-scope tracing 天然工作（已验证）。
- `src/o11y/otlp/turn-otel.ts` 的 `AgentOtelChannel.runTurn()` + `src/context/session.ts` 的
  `sendWithOtel()`：只在 `deps.otel`（`AgentOtelChannel`）存在时才给每个 `onTurn` 记
  `traceId`/`traceAttribution`，而这条共享池只在 `config.telemetry !== undefined ||
  agent.tracing?.scope === "run"` 时才建（`src/runner/attempt.ts` 的 `wantsSharedOtel`）。
  `aiSdkAgent` 的 `tracing` 块永远是空对象 `{}`（`scope` 缺省 = `"attempt"`），所以
  `deps.otel` 恒为 undefined，turn 节点永远没有 `traceId`。`show --timing` 按 turn 保存的
  `traceId` 去挂 OTel 子树（`src/o11y/otlp/turn-otel.ts` 文件头注释「再按 turn 保存的
  traceId 把 OTel agent/model/tool 子树挂进去」），没有 `traceId` 就挂不出来。

  已实测排除"改配置能解"：加 `defineConfig({ telemetry: { port } })` 强制走共享池后，turn
  节点**确实**拿到了 `traceId`（`AgentOtelChannel.runTurn` 的 window-attribution 分支：
  `!this.confirmed` 时用 `randomBytes(16)` 生成一个合成 `traceId`，`attribution: "window"`），
  但这个合成 id **从不匹配** AI SDK `@ai-sdk/otel` 集成给自己 span 打的真实 `traceId`
  （后者由 `@ai-sdk/otel` 自己的 tracer 生成，`aiSdkAgent` 从未把 `ctx.telemetry.headers`
  的 traceparent 传给 `generateText` 的 `telemetry` 选项——`AiSdkGenerateContext` 根本没暴露
  `headers` 字段，`@ai-sdk/otel` 的 `OpenTelemetryOptions` 也没有"接受外部父 trace context"
  的选项）。所以即使 turn 拿到了 `traceId`，`--timing` 按 `traceId` 精确匹配 span 时仍然一个
  都匹配不上——`runTurn()` 内部本来正确算出的窗口内 span 列表（`spans = fresh`）从未被传出去
  给消费方用，只留下一个日后永远配不上真实 span 的合成 id。

**修法**：**未修**——这是 niceeval 侧的真实 gap，不是这个 e2e 仓库能绕过的问题（已尝试两种
配置，见上）。`e2e/repos/ai-sdk/scripts/verify.ts` 把这条断言写成非 gating 的
`console.warn`（真实的、写死的目标断言注释在原地，指向这条记录），不伪造绿灯。

**适用场景**：任何用 `aiSdkAgent({ tracing: aiSdkOtel() })` 或其他 attempt-scope
`AgentTracing`（`scope` 缺省/显式 `"attempt"`）的 Agent，都不要指望 `show --timing` 能挂出
per-turn OTel 子树——`--execution` 的节点级 span 关联能验证"trace 真的收到了"，但"这个 span
属于哪一轮"这件事目前只有 shared-pool（`scope: "run"` 或 `defineConfig({ telemetry })`）配
window-attribution 才尝试做，且window-attribution 的实现本身有 bug（生成的 `traceId` 和真实
span 从不匹配，见上）。修复需要两者之一：(a) `AgentOtelChannel.runTurn()` 把它已经算好的
`spans` 列表（不是合成 `traceId`）传给 turn 记录消费方，`--timing` 改按这份 span 列表而不是
`traceId` 二次过滤；(b) `AiSdkGenerateContext` 暴露 `ctx.telemetry.headers`，`aiSdkAgent`
把 traceparent 传给 `@ai-sdk/otel`（若其 `OpenTelemetryOptions` 支持接受外部 parent context）
换取"traceparent 确认"路径。两者都需要改 `src/context/session.ts` / `src/o11y/otlp/
turn-otel.ts` / `src/agents/ai-sdk.ts`，不在本仓库范围内。
