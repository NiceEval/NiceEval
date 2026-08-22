// OTLP traces → niceeval TraceSpan[]。两种线编码都吃,无外部依赖:
//   · OTLP/JSON ——— codex 的 trace_exporter protocol="json";id 是 hex、纳秒是十进制字符串。
//   · OTLP/protobuf — bub-tapestore-otel(Python 的 HTTP 出口只有 protobuf)。
// 只抠瀑布图要的字段:traceId / spanId / parentSpanId / name / 起止纳秒 / status / attributes。
// span 的语义(span 名、属性约定)各 agent 不同,这里不解释,原样带给 view。

import type { JsonValue, TraceSpan } from "../../types.ts";

/** 按 Content-Type 选编码,失败一律回空数组(导出端不该因我们解析挂而报错)。 */
export function parseOtlpTraces(body: Buffer, contentType: string): TraceSpan[] {
  try {
    if (contentType.includes("json")) return parseJsonTraces(body.toString("utf8"));
    return parseProtoTraces(body);
  } catch {
    return [];
  }
}

// ───────────────────────── 纳秒字符串/数字 → epoch 毫秒 ─────────────────────────

function nanoToMs(nano: string | number | bigint | undefined): number {
  if (nano === undefined || nano === null) return 0;
  try {
    return Number(BigInt(nano) / 1_000_000n);
  } catch {
    return 0;
  }
}

function statusFromCode(code: number | string | undefined): TraceSpan["status"] {
  // OTLP StatusCode:0 UNSET / 1 OK / 2 ERROR(JSON 里可能是数字或枚举名)。
  if (code === 2 || code === "STATUS_CODE_ERROR") return "error";
  if (code === 1 || code === "STATUS_CODE_OK") return "ok";
  return "unset";
}

// ───────────────────────── OTLP/JSON ─────────────────────────

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonAnyValue(value: unknown): JsonValue {
  if (!isRecord(value)) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.intValue === "string" || typeof value.intValue === "number") {
    const integer = Number(value.intValue);
    return Number.isFinite(integer) ? integer : null;
  }
  if (typeof value.doubleValue === "number") return Number.isFinite(value.doubleValue) ? value.doubleValue : null;
  if (typeof value.bytesValue === "string") return value.bytesValue;
  if (isRecord(value.arrayValue) && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values.map(jsonAnyValue);
  }
  if (isRecord(value.kvlistValue) && Array.isArray(value.kvlistValue.values)) {
    const obj: globalThis.Record<string, JsonValue> = {};
    for (const entry of value.kvlistValue.values) {
      if (!isRecord(entry) || typeof entry.key !== "string" || entry.key.length === 0) continue;
      obj[entry.key] = jsonAnyValue(entry.value);
    }
    return obj;
  }
  return null;
}

function parseJsonTraces(text: string): TraceSpan[] {
  if (!text.trim()) return [];
  const root: unknown = JSON.parse(text);
  if (!isRecord(root) || !Array.isArray(root.resourceSpans)) return [];
  const out: TraceSpan[] = [];
  for (const resourceSpan of root.resourceSpans) {
    if (!isRecord(resourceSpan) || !Array.isArray(resourceSpan.scopeSpans)) continue;
    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!isRecord(scopeSpan) || !Array.isArray(scopeSpan.spans)) continue;
      for (const span of scopeSpan.spans) {
        if (!isRecord(span)) continue;
        const normalized = jsonSpan(span);
        if (normalized) out.push(normalized);
      }
    }
  }
  return out;
}

function jsonSpan(span: globalThis.Record<string, unknown>): TraceSpan | undefined {
  if (typeof span.traceId !== "string" || span.traceId.length === 0) return undefined;
  if (typeof span.spanId !== "string" || span.spanId.length === 0) return undefined;
  const attributes: globalThis.Record<string, JsonValue> = {};
  if (Array.isArray(span.attributes)) {
    for (const attribute of span.attributes) {
      if (!isRecord(attribute) || typeof attribute.key !== "string" || attribute.key.length === 0) continue;
      attributes[attribute.key] = jsonAnyValue(attribute.value);
    }
  }
  const status = isRecord(span.status) ? span.status : undefined;
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: typeof span.parentSpanId === "string" && span.parentSpanId ? span.parentSpanId : undefined,
    name: typeof span.name === "string" ? span.name : "span",
    startMs: nanoToMs(typeof span.startTimeUnixNano === "string" || typeof span.startTimeUnixNano === "number" ? span.startTimeUnixNano : undefined),
    endMs: nanoToMs(typeof span.endTimeUnixNano === "string" || typeof span.endTimeUnixNano === "number" ? span.endTimeUnixNano : undefined),
    status: statusFromCode(typeof status?.code === "number" || typeof status?.code === "string" ? status.code : undefined),
    attributes: Object.keys(attributes).length ? attributes : undefined,
  };
}

// ───────────────────────── OTLP/protobuf ─────────────────────────
// 手写一个够用的 protobuf 读取器 + OTLP trace 消息游走(字段号见 opentelemetry-proto)。

class Reader {
  pos = 0;
  constructor(
    private readonly buf: Buffer,
    private readonly end = buf.length,
  ) {}
  get eof(): boolean {
    return this.pos >= this.end;
  }
  varint(): bigint {
    let shift = 0n;
    let result = 0n;
    for (;;) {
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
    }
    return result;
  }
  fixed64(): bigint {
    const lo = BigInt(this.buf.readUInt32LE(this.pos));
    const hi = BigInt(this.buf.readUInt32LE(this.pos + 4));
    this.pos += 8;
    return (hi << 32n) | lo;
  }
  double(): number {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  bytes(): Buffer {
    const len = Number(this.varint());
    const b = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }
  /** 跳过当前 wire type 的一个值(遇到不认识的字段)。 */
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // 注意:必须先读完 length varint(它会推进 pos),再加 len。
      // 写成 `this.pos += Number(this.varint())` 有 bug:+= 会先取旧 pos,丢掉 length 前缀字节 → 错位。
      const len = Number(this.varint());
      this.pos += len;
    } else if (wire === 5) this.pos += 4;
  }
}

/** 遍历一个 message 的字段;cb 负责消费当前字段值(读或 r.skip(wire))。 */
function eachField(buf: Buffer, cb: (field: number, wire: number, r: Reader) => void): void {
  const r = new Reader(buf);
  while (!r.eof) {
    const tag = Number(r.varint());
    cb(tag >> 3, tag & 7, r);
  }
}

function parseProtoTraces(buf: Buffer): TraceSpan[] {
  const spans: TraceSpan[] = [];
  // ExportTraceServiceRequest { 1: repeated ResourceSpans }
  eachField(buf, (field, wire, r) => {
    if (field === 1 && wire === 2) protoResourceSpans(r.bytes(), spans);
    else r.skip(wire);
  });
  return spans;
}

function protoResourceSpans(buf: Buffer, spans: TraceSpan[]): void {
  // ResourceSpans { 2: repeated ScopeSpans }(忽略 resource 属性)
  eachField(buf, (field, wire, r) => {
    if (field === 2 && wire === 2) protoScopeSpans(r.bytes(), spans);
    else r.skip(wire);
  });
}

function protoScopeSpans(buf: Buffer, spans: TraceSpan[]): void {
  // ScopeSpans { 2: repeated Span }
  eachField(buf, (field, wire, r) => {
    if (field === 2 && wire === 2) spans.push(protoSpan(r.bytes()));
    else r.skip(wire);
  });
}

function protoSpan(buf: Buffer): TraceSpan {
  let traceId = "";
  let spanId = "";
  let parentSpanId = "";
  let name = "span";
  let startNano = 0n;
  let endNano = 0n;
  let status: TraceSpan["status"] = "unset";
  const attributes: globalThis.Record<string, JsonValue> = {};
  // Span { 1:trace_id 2:span_id 4:parent_span_id 5:name 7:start(fixed64)
  //        8:end(fixed64) 9:repeated KeyValue attrs 15:Status }
  eachField(buf, (field, wire, r) => {
    switch (field) {
      case 1:
        traceId = r.bytes().toString("hex");
        break;
      case 2:
        spanId = r.bytes().toString("hex");
        break;
      case 4:
        parentSpanId = r.bytes().toString("hex");
        break;
      case 5:
        name = r.bytes().toString("utf8");
        break;
      case 7:
        if (wire === 1) startNano = r.fixed64();
        else r.skip(wire);
        break;
      case 8:
        if (wire === 1) endNano = r.fixed64();
        else r.skip(wire);
        break;
      case 9:
        if (wire === 2) {
          const kv = protoKeyValue(r.bytes());
          if (kv.key) attributes[kv.key] = kv.value;
        } else r.skip(wire);
        break;
      case 15:
        if (wire === 2) status = protoStatus(r.bytes());
        else r.skip(wire);
        break;
      default:
        r.skip(wire);
    }
  });
  return {
    traceId,
    spanId,
    parentSpanId: parentSpanId || undefined,
    name,
    startMs: nanoToMs(startNano),
    endMs: nanoToMs(endNano),
    status,
    attributes: Object.keys(attributes).length ? attributes : undefined,
  };
}

function protoStatus(buf: Buffer): TraceSpan["status"] {
  let code = 0;
  // Status { 2:message 3:code(enum varint) }
  eachField(buf, (field, wire, r) => {
    if (field === 3 && wire === 0) code = Number(r.varint());
    else r.skip(wire);
  });
  return statusFromCode(code);
}

function protoKeyValue(buf: Buffer): { key?: string; value: JsonValue } {
  let key: string | undefined;
  let value: JsonValue = null;
  // KeyValue { 1:key 2:AnyValue }
  eachField(buf, (field, wire, r) => {
    if (field === 1 && wire === 2) key = r.bytes().toString("utf8");
    else if (field === 2 && wire === 2) value = protoAnyValue(r.bytes());
    else r.skip(wire);
  });
  return { key, value };
}

function protoAnyValue(buf: Buffer): JsonValue {
  let value: JsonValue = null;
  // AnyValue { 1:string 2:bool 3:int(varint) 4:double(fixed64) 5:array 6:kvlist 7:bytes }
  eachField(buf, (field, wire, r) => {
    switch (field) {
      case 1:
        value = r.bytes().toString("utf8");
        break;
      case 2:
        value = Number(r.varint()) !== 0;
        break;
      case 3:
        value = Number(r.varint());
        break;
      case 4:
        if (wire === 1) value = r.double();
        else r.skip(wire);
        break;
      case 5:
        if (wire === 2) value = protoArray(r.bytes());
        else r.skip(wire);
        break;
      case 6:
        if (wire === 2) value = protoKvList(r.bytes());
        else r.skip(wire);
        break;
      case 7:
        value = r.bytes().toString("utf8");
        break;
      default:
        r.skip(wire);
    }
  });
  return value;
}

function protoArray(buf: Buffer): JsonValue {
  const out: JsonValue[] = [];
  // ArrayValue { 1:repeated AnyValue }
  eachField(buf, (field, wire, r) => {
    if (field === 1 && wire === 2) out.push(protoAnyValue(r.bytes()));
    else r.skip(wire);
  });
  return out;
}

function protoKvList(buf: Buffer): JsonValue {
  const obj: globalThis.Record<string, JsonValue> = {};
  // KeyValueList { 1:repeated KeyValue }
  eachField(buf, (field, wire, r) => {
    if (field === 1 && wire === 2) {
      const kv = protoKeyValue(r.bytes());
      if (kv.key) obj[kv.key] = kv.value;
    } else r.skip(wire);
  });
  return obj;
}
