import { defineConfig } from "niceeval";

// judge 走独立凭据(NICEEVAL_JUDGE_KEY / NICEEVAL_JUDGE_BASE),不与 .env 里应用自己的
// OPENAI_API_KEY / OPENAI_BASE_URL(走 DeepSeek 兼容端点)混用。
export default defineConfig({
  name: { "zh-CN": "langgraph E2E", en: "langgraph E2E" },
  // judge 端点是配置,niceeval 不再内置读任何环境变量:这里自己读 NICEEVAL_JUDGE_BASE
  // (值在本仓库 .env / CI secret 里),key 仍由 niceeval 按 NICEEVAL_JUDGE_KEY 读。
  judge: { model: "deepseek-v4-flash", baseUrl: process.env.NICEEVAL_JUDGE_BASE },
  timeoutMs: 120_000,
  // 被测应用是本仓库自己起的单进程长驻服务(见 scripts/e2e.ts),别开太高并发。
  maxConcurrency: 2,
});
