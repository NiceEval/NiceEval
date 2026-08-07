import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "cli E2E", en: "cli E2E" },
  // 断言比对的是英文文案:界面语言由配置钉住(没有 NICEEVAL_LANG 这类环境变量),
  // 所以本地中文环境和 CI 上跑出来的输出一致。
  locale: "en",
  timeoutMs: 60_000,
  // 所有 Experiment 使用签入的进程内确定性 Direct Agent，不依赖网络或凭据。
  maxConcurrency: 4,
});
