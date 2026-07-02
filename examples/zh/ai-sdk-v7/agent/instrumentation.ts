// 双 OTel:AI SDK 官方埋点(@ai-sdk/otel,产 OTel GenAI semconv)+ 两个出口。
//
//   出口 1(可选):你自己的观测后端 —— 环境变量 OTLP_BACKEND_URL(Langfuse / SigNoz /
//                 生产 collector),设了就一直双发;
//   出口 2:niceeval 本次运行的接收端点 —— 经 ctx.telemetry 逐 attempt 进来。
//
// 并发安全的关键:不用全局 provider。按 endpoint 缓存 provider,每次 generateText 经
// `telemetry.integrations` 传入绑定了该 endpoint tracer 的集成(per-call 覆盖全局注册),
// 并行 attempt 各用各的出口,span 不串流。这是「接收器粒度跟被测进程走」在进程内直调
// 场景的特例:被测就在 eval 进程里,endpoint 可以逐 attempt 拿到,比长驻服务自由。
import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";

const providers = new Map<string, NodeTracerProvider>();

export interface TurnTelemetry {
  /** 传给 generateText 的 `telemetry.integrations`。 */
  integration: OpenTelemetry;
  /** 每轮结束后调用:eval 的轮次归属靠时间窗口,span 必须立刻送到,不能等 batch。 */
  flush(): Promise<void>;
}

/** 没端点(没开 tracing)返回 undefined,generate 不必写分支判断。 */
export function telemetryFor(endpoint: string | undefined): TurnTelemetry | undefined {
  if (!endpoint) return undefined;
  let provider = providers.get(endpoint);
  if (!provider) {
    const spanProcessors = [new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }))];
    const backend = process.env.OTLP_BACKEND_URL; // 出口 1:自己的后端(可选)
    if (backend) spanProcessors.push(new SimpleSpanProcessor(new OTLPTraceExporter({ url: backend })));
    provider = new NodeTracerProvider({ spanProcessors });
    providers.set(endpoint, provider);
  }
  const p = provider;
  return {
    integration: new OpenTelemetry({ tracer: p.getTracer("gen_ai") }),
    flush: () => p.forceFlush(),
  };
}
