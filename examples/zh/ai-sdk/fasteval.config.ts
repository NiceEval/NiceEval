import { defineConfig } from "fasteval";
import { webAgent } from "./agents/web-agent.ts";

// web agent 由 examples/zh/ai-sdk/ai-sdk-agent 单独启动;adapter 通过 HTTP 协议调它。
// baseUrl 在这里(调用方)传入,adapter 自己不写死、不读 env —— direct run 用这个默认实例,
// experiment 可各传各的。
const assistant = webAgent({ baseUrl: "http://127.0.0.1:5188" });

export default defineConfig({
  sandbox: "auto",

  agents: [assistant],
  defaultAgent: "web-agent",

  // judge 模型:用来做开放式质量评测(回复是否有帮助、是否基于工具结果)。
  judge: { model: "gpt-4o-mini" },

  timeoutMs: 60_000,    // 进程内调用很快,60s 足够
  maxConcurrency: 4,    // 并发跑 4 个 eval
});
