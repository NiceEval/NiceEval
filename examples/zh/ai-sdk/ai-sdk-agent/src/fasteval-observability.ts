import { randomBytes } from "node:crypto";

// 双可观测的【第二路】:把本轮的 turn / model / tool span 按 OTLP/JSON 发到 fasteval
// 为本次运行起的 OTLP 接收器。第一路是 app 自带的 langfuse(见 app-observability.ts);
// 这一路让同一轮活动也出现在 fasteval `view` 的瀑布图里。
//
// 端点由 fasteval 每轮经请求体 otelEndpoint 传进来(adapter 声明 capabilities.tracing →
// ctx.telemetry.endpoint),不读 env、不写默认。没端点(direct 跑没开 tracing)就 no-op。
//
// 刻意手搓 OTLP/JSON、不引 OpenTelemetry SDK:一来例子零额外依赖、好读;二来 span 属性
// 直接按 fasteval 认的 canonical(OTel GenAI semconv)发 —— gen_ai.operation.name 决定
// SpanKind(chat→model、execute_tool→tool),turn.id 让回合 span 归到 "turn"。

type AttrValue = string | number | boolean;
export type SpanAttrs = Record<string, AttrValue>;

interface SpanRecord {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: SpanAttrs;
  error: boolean;
}

export interface FastevalSpan {
  /** 结束本 span;可补属性、标错。重复调用以第一次为准。 */
  end(attrs?: SpanAttrs, opts?: { error?: boolean }): void;
}

export interface FastevalTrace {
  span(name: string, opts?: { parent?: FastevalSpan; attrs?: SpanAttrs }): FastevalSpan;
  /** 把已结束的 span 按 OTLP/JSON POST 到端点。no-op trace 直接返回。 */
  flush(): Promise<void>;
}

const NOOP_SPAN: FastevalSpan = { end() {} };

export function createFastevalTrace(endpoint: string | undefined): FastevalTrace {
  if (!endpoint) return { span: () => NOOP_SPAN, flush: async () => {} };
  const url = endpoint;

  const traceId = randomBytes(16).toString("hex");
  const records: SpanRecord[] = [];
  const idOf = new WeakMap<FastevalSpan, string>();

  function span(name: string, opts?: { parent?: FastevalSpan; attrs?: SpanAttrs }): FastevalSpan {
    const rec: SpanRecord = {
      spanId: randomBytes(8).toString("hex"),
      parentSpanId: opts?.parent ? idOf.get(opts.parent) : undefined,
      name,
      startMs: Date.now(),
      endMs: 0,
      attributes: { ...(opts?.attrs ?? {}) },
      error: false,
    };
    records.push(rec);
    const handle: FastevalSpan = {
      end(attrs, o) {
        if (rec.endMs) return;
        rec.endMs = Date.now();
        if (attrs) Object.assign(rec.attributes, attrs);
        if (o?.error) rec.error = true;
      },
    };
    idOf.set(handle, rec.spanId);
    return handle;
  }

  async function flush(): Promise<void> {
    const closed = records.filter((r) => r.endMs > 0);
    if (closed.length === 0) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toOtlpJson(traceId, closed)),
      });
    } catch (error) {
      // 导出失败不该影响被测一轮:第二路可观测掉了就掉了。
      process.stderr.write(`[fasteval-trace] export failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return { span, flush };
}

function toOtlpJson(traceId: string, spans: SpanRecord[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [kv("service.name", "assistant")] },
        scopeSpans: [
          {
            scope: { name: "fasteval-assistant" },
            spans: spans.map((s) => ({
              traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              startTimeUnixNano: msToNano(s.startMs),
              endTimeUnixNano: msToNano(s.endMs),
              attributes: Object.entries(s.attributes).map(([k, v]) => kv(k, v)),
              status: { code: s.error ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  };
}

/** epoch 毫秒 → unix 纳秒(十进制字符串,补 6 个 0,整数无精度损失)。 */
function msToNano(ms: number): string {
  return `${ms}000000`;
}

function kv(key: string, value: AttrValue): { key: string; value: Record<string, unknown> } {
  return { key, value: anyValue(value) };
}

function anyValue(value: AttrValue): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}
