import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({ model: "gpt-5.4" }),
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
