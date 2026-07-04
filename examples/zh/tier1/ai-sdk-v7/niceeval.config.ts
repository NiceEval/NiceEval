import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "AI SDK v7 HTTP 无侵入示例", en: "AI SDK v7 HTTP non-invasive example" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 60_000,
  // 被测应用是用户自己起的长驻服务(eval 不代管进程),接收 span 用固定端口:
  // 应用启动时 OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 指过来即可,跑多少次
  // eval 都不用改(见 docs-site「通过 OTel 接入 → 端点怎么交给应用 → 固定端口模式」)。
  telemetry: { port: 4318 },
});
