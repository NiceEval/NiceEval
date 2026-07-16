# ai-sdk-v7 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/ai-sdk-v7`](../../tier1/ai-sdk-v7/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter、
同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的调用瀑布
图——应用内部每次模型调用、各自的耗时与 token,按轮铺成时间线。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span,应用启动时用
  标准 OTel 环境变量指过来,跑多少次 eval 都不用改(见 docs-site「通过 OTel 接入 →
  端点怎么交给应用 → 固定端口模式」)。
- `agents/ai-sdk-v7.ts`:加 `settleMs: 600`——应用用 `BatchSpanProcessor`,流结束后留一段
  宽限让最后一批 span 落进本轮收集窗口,只影响瀑布图完整性。
- 本 README。

**应用侧依然零改动**:ai-sdk-v7 本来就带官方 `@ai-sdk/otel` 集成(`src/backend/otel.ts`,
产标准 GenAI 语义的 span),Tier 2 只是让它把 span **也发给 niceeval 一份**——这属于应用
已有的可观测性能力,不是为 eval 定制的改造。

## span 只进瀑布图,不喂断言

事件映射、HITL、会话续接全部还是 `uiMessageStreamAgent` 从协议帧直构(见 tier1 README),
和有没有接 OTel 无关。span 晚到、缺失时也只是瀑布图缺尾巴,断言判决不受影响。一个已知
gap:`@ai-sdk/otel` 对 `needsApproval` 工具的审批链路不产 `execute_tool` span(见
`memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md`)——断言不依赖 span,该 gap 只让
瀑布图少一条 span。

## 跑起来

和 tier1 的唯一区别:起应用时把 OTel 指到 niceeval 的固定接收端口。

```sh
cd examples/zh/tier2/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY

# 终端 1:起应用(把 OTel 指到 niceeval 的固定接收端口,标准 OTLP 4318;本机 4318 被占时,
# 两边一起换:应用改这里的端口,eval 侧改 niceeval.config.ts 的 telemetry.port)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_BSP_SCHEDULE_DELAY=200 pnpm run dev:server

# 终端 2:跑 eval(应用部署在别处时设 AI_SDK_V7_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```
