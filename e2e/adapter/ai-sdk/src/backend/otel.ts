// AI SDK v7 官方接法:@ai-sdk/otel 集成 + registerTelemetry() 全局注册一次,之后每个
// streamText 调用自动产出 GenAI 语义 span(operation → step → languageModel / tool 四层),
// 不需要改任何调用点。场景拓扑把 exporter 固定指到 niceeval.config.ts 的
// telemetry.port，这是本仓库对 remote-agent telemetry 路径的证明。
import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { OTLP_TRACES_URL } from "../topology.ts";

export interface OTelLifecycle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function setupOtel(serviceName: string): OTelLifecycle {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: OTLP_TRACES_URL }))],
  });
  provider.register();
  registerTelemetry(new OpenTelemetry({ tracer: provider.getTracer(serviceName) }));
  process.stdout.write(`OTel tracing enabled -> ${OTLP_TRACES_URL}\n`);
  return {
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
