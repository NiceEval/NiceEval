import { defineConfig } from "niceeval";

export default defineConfig({
  name: "e2e: source-first Record handoff and maintenance",
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
