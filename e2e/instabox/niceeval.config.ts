import { defineConfig } from "niceeval";
export default defineConfig({
  name: { en: "Instabox transport", "zh-CN": "Instabox transport" },
  timeoutMs: 180_000,
  maxConcurrency: 1,
  sandboxCache: { before: "bypass" },
});
