import { defineConfig } from "niceeval";

export default defineConfig({
  name: {
    "zh-CN": "e2e: AI SDK 进程内 Direct Agent",
    en: "e2e: in-process AI SDK Direct Agent",
  },
  timeoutMs: 90_000,
  maxConcurrency: 4,
});
