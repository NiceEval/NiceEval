import { defineConfig } from "niceeval";
import { basalt, chalk } from "niceeval/report/built-in";

if (basalt === chalk) throw new Error("official report themes must remain distinct");

export default defineConfig({
  name: { en: "Report E2E fixture", "zh-CN": "Report E2E fixture" },
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
