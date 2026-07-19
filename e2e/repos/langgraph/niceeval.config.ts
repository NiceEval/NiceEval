import { defineConfig } from "niceeval";

// judge 走独立凭据(NICEEVAL_JUDGE_KEY / NICEEVAL_JUDGE_BASE),不与 .env 里应用自己的
// OPENAI_API_KEY / OPENAI_BASE_URL(走 DeepSeek 兼容端点)混用。
export default defineConfig({
  name: { "zh-CN": "langgraph E2E", en: "langgraph E2E" },
  judge: { model: "deepseek-v4-flash" },
  timeoutMs: 120_000,
  // 被测应用是本仓库自己起的单进程长驻服务(见 scripts/e2e.ts),别开太高并发。
  maxConcurrency: 2,
});
