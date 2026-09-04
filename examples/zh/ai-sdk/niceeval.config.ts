import { defineConfig } from "niceeval";

export default defineConfig({
  judgeRuntime: { model: "gpt-5.4" },
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
