import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "example: ai-sdk（uiMessageStreamAgent）", en: "example: ai-sdk (uiMessageStreamAgent)" },
  // 真实模型的多轮往返留余量；30s 内单轮足够，90s 防慢 provider 误伤。
  timeoutMs: 90_000,
});
