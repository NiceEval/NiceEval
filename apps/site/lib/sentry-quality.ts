import { telemetryId } from "./sentry-profile";
import { siteOperations } from "./sentry-operations";
type Fields = Record<string, any>;
const fields = (value: unknown): value is Fields => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const outcomes = new Set(["success", "error", "cancelled", "rejected"]);
const messages: Record<string, { level: string; severity: number }> = {
  "operation.failed": { level: "error", severity: 17 },
  "operation.degraded": { level: "warn", severity: 13 },
  "service.started": { level: "info", severity: 9 },
  "service.stopped": { level: "info", severity: 9 },
};

export function qualityAttributes(raw: unknown, environment: string, release: string) {
  const value = fields(raw) ? raw : {};
  const clean: Fields = {
    component: "site",
    "sentry.release": release,
    "sentry.environment": environment,
    "sentry.sdk.name": "sentry.javascript.nextjs",
    "sentry.sdk.version": "11.12.0",
  };
  if (typeof value.operation === "string" && siteOperations.has(value.operation)) clean.operation = value.operation;
  if (typeof value.outcome === "string" && outcomes.has(value.outcome)) clean.outcome = value.outcome;
  if (finite(value.duration_ms)) clean.duration_ms = value.duration_ms;
  const status = value["http.response.status_code"];
  if (Number.isInteger(status) && status >= 100 && status <= 599) clean["http.response.status_code"] = status;
  if (telemetryId(value["sentry.trace.parent_span_id"], 16))
    clean["sentry.trace.parent_span_id"] = value["sentry.trace.parent_span_id"];
  return clean;
}

export function cleanLog(raw: unknown, environment: string, release: string, wire = true) {
  if (!fields(raw)) return;
  const body = wire ? raw.body : raw.message;
  if (typeof body !== "string" || !Object.hasOwn(messages, body) || raw.level !== messages[body].level) return;
  if (wire && !finite(raw.timestamp)) return;
  const attributes = qualityAttributes(wire ? untyped(raw.attributes) : raw.attributes, environment, release);
  if (wire)
    return {
      timestamp: raw.timestamp,
      body,
      level: messages[body].level,
      severity_number:
        Number.isInteger(raw.severity_number) &&
        raw.severity_number >= messages[body].severity &&
        raw.severity_number < messages[body].severity + 4
          ? raw.severity_number
          : messages[body].severity,
      ...(telemetryId(raw.trace_id) ? { trace_id: raw.trace_id } : {}),
      attributes: typed(attributes),
    };
  return { level: messages[body].level, message: body, severityNumber: messages[body].severity, attributes };
}

export function cleanMetric(raw: unknown, environment: string, release: string, wire = true) {
  if (!fields(raw) || !finite(raw.value) || (wire && (!finite(raw.timestamp) || !telemetryId(raw.trace_id)))) return;
  // The site has no scheduler. No scheduler metric or gauge has a producer here.
  if (raw.name === "app.operation.count") {
    if (raw.type !== "counter" || raw.value !== 1 || (raw.unit !== undefined && raw.unit !== "none")) return;
  } else if (raw.name === "app.operation.duration") {
    if (raw.type !== "distribution" || raw.unit !== "millisecond") return;
  } else return;
  const attributes = qualityAttributes(wire ? untyped(raw.attributes) : raw.attributes, environment, release);
  if (!attributes.operation || !attributes.outcome) return;
  return {
    ...(wire
      ? {
          timestamp: raw.timestamp,
          ...(telemetryId(raw.trace_id) ? { trace_id: raw.trace_id } : {}),
          ...(telemetryId(raw.span_id, 16) ? { span_id: raw.span_id } : {}),
        }
      : {}),
    name: raw.name,
    type: raw.type,
    value: raw.value,
    ...(raw.unit === "millisecond" || raw.unit === "none" ? { unit: raw.unit } : {}),
    attributes: wire ? typed(attributes) : attributes,
  };
}

export function untyped(value: unknown): Fields {
  if (!fields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      fields(item) && ["string", "integer", "double", "boolean"].includes(item.type) && typeof item.value !== "object"
        ? [[key, item.value]]
        : [],
    ),
  );
}
function typed(value: Fields) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      {
        type: typeof item === "number" ? (Number.isInteger(item) ? "integer" : "double") : typeof item,
        value: item,
      },
    ]),
  );
}

export function cleanSession(raw: unknown, environment: string, release: string) {
  if (
    !fields(raw) ||
    !telemetryId(raw.sid) ||
    typeof raw.init !== "boolean" ||
    typeof raw.started !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.started) ||
    !Number.isFinite(Date.parse(raw.started)) ||
    typeof raw.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.timestamp) ||
    !Number.isFinite(Date.parse(raw.timestamp)) ||
    !["ok", "exited", "crashed", "abnormal", "unhandled"].includes(raw.status) ||
    !Number.isSafeInteger(raw.errors) ||
    raw.errors < 0 ||
    (raw.duration !== undefined && !finite(raw.duration))
  )
    return;
  return {
    sid: raw.sid,
    init: raw.init,
    started: raw.started,
    timestamp: raw.timestamp,
    status: raw.status,
    errors: raw.errors,
    ...(raw.duration !== undefined ? { duration: raw.duration } : {}),
    attrs: { release, environment },
  };
}

// Exact @sentry/core 11.12.0 EventDropReason/DataCategory unions.
const reasons = new Set([
  "before_send",
  "callback_error",
  "event_processor",
  "network_error",
  "queue_overflow",
  "ratelimit_backoff",
  "sample_rate",
  "send_error",
  "internal_sdk_error",
  "buffer_overflow",
  "ignored",
  "invalid",
  "no_parent_span",
]);
const categories = new Set([
  "default",
  "error",
  "transaction",
  "replay",
  "security",
  "attachment",
  "session",
  "internal",
  "profile",
  "monitor",
  "feedback",
  "span",
  "log_item",
  "log_byte",
  "trace_metric",
  "unknown",
]);
export function cleanClientReport(raw: unknown) {
  if (!fields(raw) || !finite(raw.timestamp) || !Array.isArray(raw.discarded_events)) return;
  const discarded_events = raw.discarded_events.flatMap((item: unknown) =>
    fields(item) &&
    reasons.has(item.reason) &&
    categories.has(item.category) &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity > 0
      ? [{ reason: item.reason, category: item.category, quantity: item.quantity }]
      : [],
  );
  return discarded_events.length ? { timestamp: raw.timestamp, discarded_events } : undefined;
}
