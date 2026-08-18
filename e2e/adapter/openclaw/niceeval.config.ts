import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "openclaw E2E", en: "openclaw E2E" },
  timeoutMs: 900_000,
  // OpenClaw 的 embedded agent 与同一 compat provider 串行交互；并发 Eval 会让其中一条
  // live session 在原生 120 秒边界退出，不能把 provider 突发压力误判成 adapter 回归。
  maxConcurrency: 1,
});
