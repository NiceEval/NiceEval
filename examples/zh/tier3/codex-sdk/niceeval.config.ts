import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "Codex SDK 示例", en: "Codex SDK example" },
  judgeRuntime: { model: "gpt-5.4" },
  timeoutMs: 180_000,
  // span 接收钉在 OTLP 标准端口:起应用时 OTEL_EXPORTER_OTLP_ENDPOINT 指过来即可(见 README)。
  telemetry: { port: 4318 },
  // 每个 attempt 都要经一个真实子进程(server.ts)+ Codex CLI 子进程(真的在工作目录里
  // 跑命令/改文件)+ 网络调用,比其它示例都重,别开太高并发。
  maxConcurrency: 2,
});
