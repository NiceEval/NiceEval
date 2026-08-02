// `niceeval/adapter/otel` 入口:aiSdkAgent 的内置 OTel tracing 管线。
//
// 独立子路径导出,不从 `niceeval/adapter` re-export——顶部这三个 OTel 包是可选 peer 依赖,
// 只有显式 import 本入口(要瀑布图)的项目才需要安装;只用 claude-code/codex/bub 等其他
// adapter 的消费者,类型检查和运行时都碰不到这里。
//
// 并发安全的关键:不用全局 provider。按 endpoint 缓存 provider,每轮把绑定该 endpoint
// tracer 的 @ai-sdk/otel 集成经 `telemetry.integrations` 传给 generateText(per-call 覆盖
// 全局注册),并行 attempt 各用各的出口,span 不串流。
import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";

import type { AiSdkTracing, AiSdkTurnTelemetry } from "./ai-sdk.ts";

export interface AiSdkOtelOptions {
  /**
   * 可选双发:span 除发给 niceeval 的接收器外,同一批也发到你自己的 OTLP 后端
   * (Langfuse / SigNoz / 生产 collector)。
   */
  backendUrl?: string;
}

/**
 * 建一条给 `aiSdkAgent` 的 OTel tracing 管线:
 *
 * ```typescript
 * import { aiSdkAgent } from "niceeval/adapter";
 * import { aiSdkOtel } from "niceeval/adapter/otel";
 *
 * export const assistant = aiSdkAgent<ModelMessage>({
 *   tracing: aiSdkOtel(),
 *   generate: ({ messages, signal, telemetry }) =>
 *     generateText({ model, tools, messages, abortSignal: signal, telemetry }),
 * });
 * ```
 *
 * provider 按 endpoint 缓存(per-attempt 端点各建一条,同 attempt 的后续轮复用),
 * 用 SimpleSpanProcessor 即时导出——轮次归属靠时间窗口,span 不能等 batch。
 */
export function aiSdkOtel(options: AiSdkOtelOptions = {}): AiSdkTracing<OpenTelemetry> {
  const providers = new Map<string, NodeTracerProvider>();

  return {
    telemetryForEndpoint(endpoint: string): AiSdkTurnTelemetry<OpenTelemetry> {
      let provider = providers.get(endpoint);
      if (!provider) {
        const spanProcessors = [new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }))];
        if (options.backendUrl) {
          spanProcessors.push(new SimpleSpanProcessor(new OTLPTraceExporter({ url: options.backendUrl })));
        }
        provider = new NodeTracerProvider({ spanProcessors });
        providers.set(endpoint, provider);
      }
      const p = provider;
      return {
        settings: { integrations: [new OpenTelemetry({ tracer: p.getTracer("gen_ai") })] },
        flush: () => p.forceFlush(),
      };
    },
  };
}
