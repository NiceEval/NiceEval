// ai-sdk-v7 的 adapter:内置 uiMessageStreamAgent 无侵入对接一个**已经在跑**的 AI SDK 应用
// (UI Message Stream 协议,https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)。
//
// 应用怎么跑是应用自己的事(pnpm dev / 部署在哪都行),eval 侧不代管进程、不另开端口:
// AI_SDK_V7_URL 指到哪就测哪,默认应用自己的本地默认端口 34001。
//
// 断言依据(工具/消息/HITL)全部从协议帧直构,工厂替你做好。这是 Tier 3(侵入改造 +
// experiment flags):比 ../../tier2/ai-sdk-v7 多一层——应用侧把 system prompt / 工具集
// 提升为请求体可选字段(src/backend/{ai-sdk-runtime,server}.ts),本文件把 experiment 的
// flags 经 ctx.flags 随请求体透传过去,feature A/B 见 experiments/compare-prompts/。
// OTel 部分(settleMs + telemetry)与 Tier 2 相同。
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE_URL = process.env.AI_SDK_V7_URL ?? "http://127.0.0.1:34001";

export default uiMessageStreamAgent({
  name: "ai-sdk-v7",
  url: `${BASE_URL}/api/chat`,
  // 应用的 /api/chat 支持请求级选模型(GET /api/models 可查),ctx.model 直接透传,
  // compare-models 的多模型对比不用动服务。Tier 3:params 的 instructions / tools
  // 同样走请求体(见 experiments/compare-prompts/)。
  body: (ctx) => ({
    model: ctx.model,
    instructions: ctx.flags.instructions as string | undefined,
    tools: ctx.flags.tools as string[] | undefined,
  }),
  // 应用用 BatchSpanProcessor,流结束后留一段宽限让最后一批 span 落进本轮收集窗口
  // (配合启动应用时的 OTEL_BSP_SCHEDULE_DELAY=200,见 README;只影响瀑布图)。
  settleMs: 600,
});
