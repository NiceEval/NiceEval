import { defineConfig } from "niceeval";

export default defineConfig({
  locale: "en",
  timeoutMs: 60_000,
  maxConcurrency: 2,
  judge: { model: "runner-fixture-v1" },
});
