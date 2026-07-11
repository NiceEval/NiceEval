import { defineConfig } from "niceeval";

// 回归夹具:SandboxSpec.setup()/.teardown() 生命周期钩子 + ctx.experimentId。
// 全程不联网、不起真沙箱(defineSandbox() 自定义 provider 返回一个内存假 Sandbox)。
export default defineConfig({
  name: { en: "Sandbox Hooks Regression", "zh-CN": "沙箱钩子回归夹具" },
  timeoutMs: 30_000,
  maxConcurrency: 2,
});
