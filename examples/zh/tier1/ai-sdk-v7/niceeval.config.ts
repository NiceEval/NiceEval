import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "AI SDK v7 HTTP 无侵入示例", en: "AI SDK v7 HTTP non-invasive example" },
  judgeRuntime: { model: "gpt-5.4" },
  timeoutMs: 60_000,
});
