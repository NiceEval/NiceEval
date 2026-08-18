import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "openclaw E2E", en: "openclaw E2E" },
  timeoutMs: 900_000,
  // 这个 owner 恰有三条彼此独立的 live Eval；同轮启动才能验证 adapter / compat
  // provider 的真实并发能力，不能把单次 120 秒尾延迟固化成永久串行。
  maxConcurrency: 3,
});
