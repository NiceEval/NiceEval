import { defineConfig } from "niceeval";

export default defineConfig({
  name: {
    "zh-CN": "e2e: Claude Agent SDK 原生事件 converter",
    en: "e2e: Claude Agent SDK native event converter",
  },
  // One real provider session has two sequential SDK queries; leave room for
  // the native CLI while keeping the outer owned process bounded.
  timeoutMs: 12 * 60_000,
  maxConcurrency: 1,
});
