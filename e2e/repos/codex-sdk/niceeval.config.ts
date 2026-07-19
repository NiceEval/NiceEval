import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: codex-sdk (fromCodexThreadEvents)", en: "e2e: codex-sdk (fromCodexThreadEvents)" },
  // NICEEVAL_JUDGE_BASE 这个网关只认 deepseek-v4-pro / deepseek-v4-flash——实测确认
  // (2026-07-18,curl 直打 judge base 得到 "supported API model names are deepseek-v4-pro
  // or deepseek-v4-flash"),不是通用 OpenAI 兼容网关,不能沿用 gpt-5.4 之类的模型名。
  judge: { model: "deepseek-v4-flash" },
  timeoutMs: 180_000,
  // Codex 真的在 workspace/ 里跑命令、改文件,外加起一个 MCP 子进程,比纯问答型 adapter 重;
  // 保持较低并发,别把这几条 Eval 的真实副作用互相踩脚。
  maxConcurrency: 2,
});
