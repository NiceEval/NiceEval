import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: ai-sdk（uiMessageStreamAgent + OTel）", en: "e2e: ai-sdk (uiMessageStreamAgent + OTel)" },
  // Multi-turn HITL evals (draft -> approve/deny -> resume) can take a few real model
  // round-trips per attempt; 90s keeps headroom without masking genuine hangs.
  timeoutMs: 90_000,
  // 固定端口接收 OTel span:test/ai-sdk.test.ts 把 OTEL_EXPORTER_OTLP_ENDPOINT 指到
  // 同一个端口并启动被测应用,应用的官方 @ai-sdk/otel 集成把 span 发过来——这是本仓库对
  // remote-agent telemetry 路径的证明(docs/engineering/testing/e2e/adapter/ai-sdk.md)。
  telemetry: { port: 4318 },
});
