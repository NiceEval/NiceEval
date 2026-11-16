import type { BrowserOptions, ErrorEvent } from "@sentry/nextjs";
type StreamedSpanJSON = Parameters<NonNullable<BrowserOptions["beforeSendSpan"]>>[0];

// This landing is operated by NiceEval; the DSN is a public ingestion identifier.
export const SITE_SENTRY_DSN = "https://abfcbe175a54f5e3df5ccad19db7b635@o4512439587438592.ingest.us.sentry.io/4512440118149120";
const operations = new Set(["pageload", "navigation", "http.server", "http.client", "resource.script", "resource.css", "resource.img", "ui.react.render", "function", "middleware"]);
const origins = new Set(["manual", "auto.http.browser", "auto.http.otel", "auto.http.nextjs", "auto.navigation.nextjs", "auto.pageload.nextjs", "auto.resource.browser", "auto.ui.react"]);

const mechanismTypes = new Set([
  "generic", "onerror", "onunhandledrejection", "instrument", "chained",
  "auto.browser.global_handlers.onerror", "auto.browser.global_handlers.onunhandledrejection",
  "auto.browser.browserapierrors.addEventListener", "auto.browser.browserapierrors.handleEvent",
  "auto.browser.browserapierrors.requestAnimationFrame", "auto.function.react.error_boundary",
  "auto.node.onuncaughtexception", "auto.node.onunhandledrejection", "auto.node.worker_threads",
  ...["data_fetcher", "generation_function", "on_request_error", "page_class", "page_function", "route_handler", "server_action", "server_component", "underscore_error", "wrap_api_handler", "wrap_middleware", "wrapped"].map((name) => `auto.function.nextjs.${name}`),
  "auto.http.nextjs.api_handler",
]);

function configText(value: string | undefined): string {
  return value && /^[a-zA-Z0-9_@./:-]{1,160}$/.test(value) ? value : "";
}

export function productionEnabled(nodeEnvironment: string | undefined, vercelEnvironment?: string) {
  return nodeEnvironment === "production" && (!vercelEnvironment || vercelEnvironment === "production");
}

function origin(url: string | undefined) {
  try { return url ? new URL(url).origin : undefined; } catch { return undefined; }
}

function codeLocation(value: string | undefined) {
  if (!value) return undefined;
  // Preserve code locations, never URL credentials, query parameters or fragments.
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return value.split(/[?#]/, 1)[0]; }
}

function debugId(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

function staticCodeLocation(value: string | undefined) {
  const location = codeLocation(value);
  return location && /\.(?:[cm]?js|[jt]sx?|wasm)$/i.test(location) ? location : undefined;
}

export function sentryOptions(dsn: string, environment?: string, release?: string) {
  const safeEnvironment = configText(environment) || "production";
  const safeRelease = configText(release);
  return {
    dsn,
    environment: safeEnvironment,
    release: safeRelease,
    traceLifecycle: "stream" as const,
    tracesSampleRate: 0.1,
    tracePropagationTargets: [] as (string | RegExp)[],
    enableLogs: false,
    enableMetrics: false,
    sendClientReports: false,
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
      urlQueryParams: false, graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0,
    },
    initialScope: { tags: { component: "site" } },
    beforeSend(event: ErrorEvent): ErrorEvent {
      const trace = event.contexts?.trace;
      return {
        type: undefined, event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
        level: event.level, environment: safeEnvironment, release: safeRelease,
        tags: { component: "site" },
        debug_meta: { images: event.debug_meta?.images?.flatMap((image) => {
          const id = debugId(image.debug_id);
          const file = image.type === "sourcemap" ? staticCodeLocation(image.code_file) : undefined;
          return id && file ? [{ type: "sourcemap" as const, debug_id: id, code_file: file }] : [];
        }) },
        ...(event.request?.url && origin(event.request.url) ? { request: { url: origin(event.request.url) } } : {}),
        contexts: trace ? { trace: {
          trace_id: trace.trace_id, span_id: trace.span_id, parent_span_id: trace.parent_span_id,
          op: "http.server",
        } } : {},
        exception: { values: event.exception?.values?.map((exception) => ({
          type: exception.type && /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError)$/.test(exception.type) ? exception.type : "Error",
          value: "Application error",
          ...(exception.mechanism ? { mechanism: {
            type: mechanismTypes.has(exception.mechanism.type) ? exception.mechanism.type : "generic",
            ...(typeof exception.mechanism.handled === "boolean" ? { handled: exception.mechanism.handled } : {}),
            ...(typeof exception.mechanism.is_exception_group === "boolean" ? { is_exception_group: exception.mechanism.is_exception_group } : {}),
          } } : {}),
          stacktrace: { frames: exception.stacktrace?.frames?.map((frame) => ({
            filename: codeLocation(frame.filename), abs_path: staticCodeLocation(frame.abs_path), debug_id: debugId(frame.debug_id), function: frame.function, module: frame.module,
            lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
          })) },
        })) },
      };
    },
    beforeSendSpan(span: StreamedSpanJSON): StreamedSpanJSON {
      const op = typeof span.attributes["sentry.op"] === "string" && operations.has(span.attributes["sentry.op"]) ? span.attributes["sentry.op"] : "function";
      const attributes: StreamedSpanJSON["attributes"] = {
        component: "site", "sentry.op": op,
        "sentry.release": safeRelease, "sentry.environment": safeEnvironment,
        "sentry.segment.name": op,
        "sentry.sdk.name": "sentry.javascript.nextjs", "sentry.sdk.version": "11.12.0",
      };
      const sdkOrigin = span.attributes["sentry.origin"];
      if (typeof sdkOrigin === "string" && origins.has(sdkOrigin)) attributes["sentry.origin"] = sdkOrigin;
      const segmentId = span.attributes["sentry.segment.id"];
      if (typeof segmentId === "string" && /^[a-f0-9]{16}$/.test(segmentId)) attributes["sentry.segment.id"] = segmentId;
      for (const key of ["sentry.sample_rate", "http.response.status_code", "sentry.measurement_value"]) {
        const value = span.attributes[key];
        if (typeof value === "number" && Number.isFinite(value)) attributes[key] = value;
      }
      return {
        trace_id: span.trace_id, span_id: span.span_id, parent_span_id: span.parent_span_id,
        start_timestamp: span.start_timestamp, end_timestamp: span.end_timestamp,
        status: span.status, is_segment: span.is_segment, name: op, attributes,
      };
    },
  };
}

// Dynamic sampling context is envelope metadata and bypasses beforeSend/Span.
export function installEnvelopePrivacy(client: ReturnType<typeof import("@sentry/nextjs").init>, environment?: string, release?: string) {
  client?.on("beforeEnvelope", (envelope) => {
    const headers = envelope[0];
    const trace = headers.trace as Record<string, unknown> | undefined;
    envelope[0] = {
      sent_at: new Date().toISOString(),
      sdk: { name: "sentry.javascript.nextjs", version: "11.12.0" },
      ...(typeof headers.event_id === "string" && /^[a-f0-9]{32}$/.test(headers.event_id) ? { event_id: headers.event_id } : {}),
    };
    for (let index = envelope[1].length - 1; index >= 0; index--) {
      const type = envelope[1][index][0].type;
      if (type !== "event" && type !== "span") envelope[1].splice(index, 1);
    }
    if (trace) {
      envelope[0].trace = {
        trace_id: typeof trace.trace_id === "string" && /^[a-f0-9]{32}$/.test(trace.trace_id) ? trace.trace_id : undefined, public_key: client.getDsn()?.publicKey,
        sample_rate: typeof trace.sample_rate === "string" && /^(0(\.\d+)?|1(\.0+)?)$/.test(trace.sample_rate) ? trace.sample_rate : undefined,
        sampled: trace.sampled === "true" || trace.sampled === "false" ? trace.sampled : undefined,
        environment: configText(environment) || "production", release: configText(release),
      };
    }
  });
}
