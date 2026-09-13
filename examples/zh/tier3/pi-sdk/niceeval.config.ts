import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "pi-agent-core 示例", en: "pi-agent-core example" },
  judgeRuntime: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  // 每个 attempt 都要经一个真实子进程(server.ts)+ DeepSeek 网络调用,偏重,别开太高并发。
  maxConcurrency: 2,
});
