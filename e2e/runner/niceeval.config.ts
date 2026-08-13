import { defineConfig } from "niceeval";

export default defineConfig({
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
