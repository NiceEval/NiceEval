import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: pi-agent-core (fromPiAgentEvents)", en: "e2e: pi-agent-core (fromPiAgentEvents)" },
  // judge 走 OpenAI 兼容端点,凭据从 NICEEVAL_JUDGE_KEY / NICEEVAL_JUDGE_BASE(本仓库 .env)解析,
  // 与被测的 DeepSeek 模型鉴权无关。
  // judge 端点是配置,niceeval 不再内置读任何环境变量:这里自己读 NICEEVAL_JUDGE_BASE
  // (值在本仓库 .env / CI secret 里),key 仍由 niceeval 按 NICEEVAL_JUDGE_KEY 读。
  judge: { model: "deepseek-v4-flash", baseUrl: process.env.NICEEVAL_JUDGE_BASE },
  timeoutMs: 120_000,
  // 每个 attempt 都要经真实 HTTP+SSE 服务(src/server.ts)+ 真实 DeepSeek 调用,
  // HITL evals 还要在同一个 attempt 内往返一次 /api/chat/approve。
  maxConcurrency: 2,
});
