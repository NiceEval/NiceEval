import { defineConfig } from "fasteval";

export default defineConfig({
  judge: { model: "gpt-5.4" },
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
