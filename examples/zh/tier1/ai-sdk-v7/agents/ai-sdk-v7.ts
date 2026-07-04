// ai-sdk-v7 的 adapter:内置 uiMessageStreamAgent 无侵入对接一个**已经在跑**的 AI SDK 应用
// (UI Message Stream 协议,https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)。
//
// 应用怎么跑是应用自己的事(pnpm dev / 部署在哪都行),eval 侧不代管进程、不另开端口:
// AI_SDK_V7_URL 指到哪就测哪,默认应用自己的本地默认端口 5188。瀑布图/usage 的 span 走
// niceeval 的固定端口接收器(niceeval.config.ts 的 telemetry.port),应用启动时用标准
// OTel 环境变量指过来即可,见 README「跑起来」。
import { uiMessageStreamAgent, otelEvents, otel } from "niceeval/adapter";

const BASE_URL = process.env.AI_SDK_V7_URL ?? "http://127.0.0.1:5188";

export default uiMessageStreamAgent({
  name: "ai-sdk-v7",
  url: `${BASE_URL}/api/chat`,
  // 应用的 /api/chat 支持请求级选模型(GET /api/models 可查),ctx.model 直接透传,
  // compare-models 的多模型对比不用动服务。
  body: (ctx) => ({ model: ctx.model }),
  // usage 协议帧里没有,从应用官方 @ai-sdk/otel 集成产的 GenAI spans 派生补上;
  // 工具/消息事件工厂已从协议直构,同 callId / 同文本的 span 派生结果自动去重。
  // OTel 接入由这一行 events 声明自身触发,不需要其它声明:
  events: otelEvents({ dialects: [otel.genAi] }),
  // 应用用 BatchSpanProcessor,流结束后留一段宽限让最后一批 span 落进本轮收集窗口
  // (配合启动应用时的 OTEL_BSP_SCHEDULE_DELAY=200,见 README;只影响瀑布图/usage)。
  settleMs: 600,
});
