// ai-sdk-v7 的 adapter:内置 uiMessageStreamAgent 无侵入对接一个**已经在跑**的 AI SDK 应用
// (UI Message Stream 协议,https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)。
//
// 应用怎么跑是应用自己的事(pnpm dev / 部署在哪都行),eval 侧不代管进程、不另开端口:
// AI_SDK_V7_URL 指到哪就测哪,默认应用自己的本地默认端口 34001。
//
// 断言依据(工具/消息/HITL)全部从协议帧直构,工厂替你做好。只接 send,不接 OTel——
// e2e 不测瀑布图(docs/engineering/e2e-ci/README.md 第 9 节);带 OTel 的完整接入示例见
// examples/zh/tier2/ai-sdk-v7/。
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE_URL = process.env.AI_SDK_V7_URL ?? "http://127.0.0.1:34001";

export default uiMessageStreamAgent({
  name: "ai-sdk-v7",
  url: `${BASE_URL}/api/chat`,
  // 应用的 /api/chat 支持请求级选模型(GET /api/models 可查),ctx.model 直接透传,
  // compare-models 的多模型对比不用动服务。
  body: (ctx) => ({ model: ctx.model }),
});
