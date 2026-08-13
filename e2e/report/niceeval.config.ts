import { defineConfig } from "niceeval";
import classicReport from "./reports/classic.tsx";

export default defineConfig({
  report: classicReport,
  name: { en: "Report E2E fixture", "zh-CN": "Report E2E fixture" },
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
