import { defineConfig } from "niceeval";
import { OTLP_PORT } from "./src/topology.ts";

export default defineConfig({
  name: { "zh-CN": "e2e: ai-sdk（uiMessageStreamAgent + OTel）", en: "e2e: ai-sdk (uiMessageStreamAgent + OTel)" },
  // Multi-turn HITL evals (draft -> approve/deny -> resume) can take a few real model
  // round-trips per attempt; 90s keeps headroom without masking genuine hangs.
  timeoutMs: 90_000,
  maxConcurrency: 4,
  // 固定端口接收 OTel span；场景拓扑把被测应用的官方 @ai-sdk/otel exporter 指到
  // 同一个端口——这是本仓库对
  // remote-agent telemetry 路径的证明(docs/engineering/testing/e2e/adapter/ai-sdk.md)。
  telemetry: { port: OTLP_PORT },
});
