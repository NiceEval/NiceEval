import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "openclaw E2E", en: "openclaw E2E" },
  timeoutMs: 900_000,
  // 两条重叠的 live Eval 足以验证 adapter / compat provider 的并发能力；第三条排队，
  // 避免三台 3 GiB OpenClaw sandbox 同时争抢共享 CI host 后让某个 CLI 被宿主终止。
  maxConcurrency: 2,
});
