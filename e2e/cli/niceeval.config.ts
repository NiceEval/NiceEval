import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "cli E2E", en: "cli E2E" },
  // 断言比对的是英文文案:界面语言由配置钉住(没有 NICEEVAL_LANG 这类环境变量),
  // 所以本地中文环境和 CI 上跑出来的输出一致。
  locale: "en",
  timeoutMs: 60_000,
  // 全是 remote agent 直连真实网关(单次 HTTP 往返),不需要高并发。
  maxConcurrency: 4,
});
