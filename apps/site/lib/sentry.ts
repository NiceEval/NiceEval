import { getActiveSpan, getRootSpan, spanToJSON, type BrowserOptions, type ErrorEvent } from "@sentry/nextjs";
import { cleanProfileChunk, telemetryId, type ProfileManifest } from "./sentry-profile";
import { siteOperations, siteRouteOperations } from "./sentry-operations";
import { cleanLog, cleanMetric, cleanSession, cleanClientReport } from "./sentry-quality";
import { errorHttpStatus, filterErrorCredentials, httpStatus, isRequestAbort } from "./sentry-error";
type StreamedSpanJSON = Parameters<NonNullable<BrowserOptions["beforeSendSpan"]>>[0];

export { siteOperations, siteRouteOperations } from "./sentry-operations";
export type ProfilePolicy = { enabled: boolean; threadId?: number; manifest?: ProfileManifest };

// This landing is operated by NiceEval; the DSN is a public ingestion identifier.
export const SITE_SENTRY_DSN =
  "https://abfcbe175a54f5e3df5ccad19db7b635@o4512439587438592.ingest.us.sentry.io/4512440118149120";
const operations = new Set([
  "pageload",
  "navigation",
  "http.server",
  "http.client",
  "resource.script",
  "resource.css",
  "resource.img",
  "ui.react.render",
  "function",
  "middleware",
  "ui.action",
]);
const origins = new Set([
  "manual",
  "auto",
  "auto.http.browser",
  "auto.http.otel",
  "auto.http.nextjs",
  "auto.navigation.browser",
  "auto.navigation.browser.bfcache",
  "auto.navigation.nextjs",
  "auto.navigation.nextjs.app_router_instrumentation",
  "auto.pageload.browser",
  "auto.pageload.nextjs",
  "auto.pageload.nextjs.app_router_instrumentation",
  "auto.resource.browser",
  "auto.resource.browser.metrics",
  "auto.ui.browser.metrics",
  "auto.ui.react",
]);
const readMethods = new Set(["GET", "HEAD"]);
const siteOrigin = "https://niceeval.com";

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function resolveRouteTarget(raw: string, allowParameterized: boolean): string | undefined {
  if (raw.startsWith("//")) return undefined;
  let pathname: string;
  if (raw.startsWith("/")) {
    pathname = raw.split(/[?#]/, 1)[0];
  } else {
    try {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
        return undefined;
      }
      const allowedOrigin =
        parsed.origin === siteOrigin || (typeof location !== "undefined" && parsed.origin === location.origin);
      if (!allowedOrigin) return undefined;
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  }
  const normalized = normalizePathname(pathname);
  if (!allowParameterized && normalized.includes("[")) return undefined;
  return Object.hasOwn(siteRouteOperations, normalized) ? siteRouteOperations[normalized] : undefined;
}

function staticRouteOperation(span: StreamedSpanJSON, op: string): string | undefined {
  if (op !== "http.server" && op !== "http.client") return undefined;
  const nameMatch = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+(.+)$/.exec(span.name);
  const rawMethod = span.attributes["http.request.method"] ?? span.attributes["http.method"] ?? nameMatch?.[1];
  if (typeof rawMethod === "string" && !readMethods.has(rawMethod.toUpperCase())) return undefined;
  if (op === "http.server") {
    const route = span.attributes["http.route"] ?? span.attributes["next.route"];
    if (typeof route === "string") {
      return Object.hasOwn(siteRouteOperations, route) ? siteRouteOperations[route] : undefined;
    }
    const rawPath = span.attributes["url.path"] ?? nameMatch?.[2];
    return typeof rawPath === "string" ? resolveRouteTarget(rawPath, true) : undefined;
  }
  const rawTarget = span.attributes["url.full"] ?? span.attributes["url.path"] ?? nameMatch?.[2];
  return typeof rawTarget === "string" ? resolveRouteTarget(rawTarget, false) : undefined;
}

function configText(value: string | undefined): string {
  return value && /^[a-zA-Z0-9_@./:-]{1,160}$/.test(value) ? value : "";
}

export function productionEnabled(nodeEnvironment: string | undefined, vercelEnvironment?: string) {
  return nodeEnvironment === "production" && (!vercelEnvironment || vercelEnvironment === "production");
}

export function sentryOptions(dsn: string, environment?: string, release?: string, profile?: ProfilePolicy) {
  const safeEnvironment = configText(environment) || "production";
  const safeRelease = configText(release);
  const filterCredentials = filterErrorCredentials(dsn);
  return {
    dsn,
    environment: safeEnvironment,
    release: safeRelease,
    traceLifecycle: "stream" as const,
    tracesSampleRate: 0.1,
    parentSpanIsAlwaysRootSpan: false,
    tracePropagationTargets: [] as (string | RegExp)[],
    enableLogs: true,
    enableMetrics: true,
    sendClientReports: true,
    beforeSendLog(log: Parameters<NonNullable<BrowserOptions["beforeSendLog"]>>[0]) {
      return (cleanLog(log, safeEnvironment, safeRelease, false) as typeof log | undefined) ?? null;
    },
    beforeSendMetric(metric: Parameters<NonNullable<BrowserOptions["beforeSendMetric"]>>[0]) {
      return (cleanMetric(metric, safeEnvironment, safeRelease, false) as typeof metric | undefined) ?? null;
    },
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    initialScope: { tags: { component: "site" } },
    beforeSend(event: ErrorEvent, hint?: Parameters<NonNullable<BrowserOptions["beforeSend"]>>[1]): ErrorEvent | null {
      const trace = event.contexts?.trace;
      const activeSpan = getActiveSpan();
      const span = activeSpan?.spanContext().spanId === trace?.span_id ? activeSpan : undefined;
      const spanJson = span && spanToJSON(span);
      const rootData = span && spanToJSON(getRootSpan(span)).attributes;
      const rawTraceOp = trace?.op ?? spanJson?.attributes["sentry.op"];
      const traceOp = typeof rawTraceOp === "string" && operations.has(rawTraceOp) ? rawTraceOp : "function";

      const next = event.contexts?.nextjs;
      const mechanism = event.exception?.values?.find(({ mechanism }) => mechanism?.handled === false)?.mechanism?.type;
      const fromRouteHandler = mechanism === "auto.function.nextjs.route_handler";
      const fromServerComponent = mechanism === "auto.function.nextjs.server_component";
      // The SDK can capture from these wrappers before Next calls onRequestError.
      const handlerTransaction = fromRouteHandler ? /^(\S+) (\/.*)$/.exec(event.transaction ?? "") : undefined;
      const componentRoute = fromServerComponent
        ? / Server Component \((\/.*)\)$/.exec(event.transaction ?? "")
        : undefined;
      const route =
        event.tags?.route ??
        next?.router_path ??
        handlerTransaction?.[2] ??
        componentRoute?.[1] ??
        rootData?.["http.route"] ??
        rootData?.["next.route"];
      const method =
        event.tags?.["http.method"] ??
        event.request?.method ??
        handlerTransaction?.[1] ??
        rootData?.["http.request.method"] ??
        rootData?.["http.method"];
      const status = httpStatus(
        event.tags?.["http.status_code"],
        event.contexts?.response?.status_code,
        rootData?.["http.response.status_code"],
        rootData?.["http.status_code"],
        errorHttpStatus(hint?.originalException),
        next?.route_type || fromRouteHandler || fromServerComponent ? 500 : undefined,
      );
      if (
        (status !== undefined && status >= 400 && status < 500) ||
        isRequestAbort(event.exception?.values?.at(-1)?.type)
      )
        return null;

      const operation = spanJson?.name;
      const { trace: _trace, ...contexts } = event.contexts ?? {};
      return filterCredentials({
        ...event,
        environment: safeEnvironment,
        release: safeRelease,
        tags: {
          ...event.tags,
          component: "site",
          ...(typeof route === "string" && route ? { route } : {}),
          ...(typeof method === "string" && method ? { "http.method": method } : {}),
          ...(status !== undefined ? { "http.status_code": status } : {}),
          ...(typeof operation === "string" && siteOperations.has(operation)
            ? { operation: event.tags?.operation ?? operation }
            : {}),
        },
        contexts: {
          ...contexts,
          ...(trace && telemetryId(trace.trace_id) && telemetryId(trace.span_id, 16)
            ? { trace: { ...trace, ...(rawTraceOp !== undefined ? { op: traceOp } : {}) } }
            : {}),
        },
      });
    },
    beforeSendSpan(span: StreamedSpanJSON): StreamedSpanJSON {
      const op =
        typeof span.attributes["sentry.op"] === "string" && operations.has(span.attributes["sentry.op"])
          ? span.attributes["sentry.op"]
          : "function";
      const name = siteOperations.has(span.name)
        ? span.name
        : op === "pageload"
          ? "site.page.load"
          : op === "navigation"
            ? "site.navigation"
            : (staticRouteOperation(span, op) ?? op);
      const attributes: StreamedSpanJSON["attributes"] = {
        component: "site",
        "sentry.op": op,
        "sentry.release": safeRelease,
        "sentry.environment": safeEnvironment,
        "sentry.segment.name": name,
        "sentry.sdk.name": "sentry.javascript.nextjs",
        "sentry.sdk.version": "11.12.0",
      };
      const sdkOrigin = span.attributes["sentry.origin"];
      if (["success", "error", "cancelled"].includes(String(span.attributes.outcome)))
        attributes.outcome = span.attributes.outcome;
      if (profile?.enabled && telemetryId(span.attributes["sentry.profiler_id"])) {
        attributes["sentry.profiler_id"] = span.attributes["sentry.profiler_id"];
        const threadId = profile.threadId ?? span.attributes["thread.id"];
        if (typeof threadId === "number" && Number.isSafeInteger(threadId) && threadId >= 0)
          attributes["thread.id"] = threadId;
      }
      if (typeof sdkOrigin === "string" && origins.has(sdkOrigin)) attributes["sentry.origin"] = sdkOrigin;
      const segmentId = span.attributes["sentry.segment.id"];
      if (typeof segmentId === "string" && /^[a-f0-9]{16}$/.test(segmentId))
        attributes["sentry.segment.id"] = segmentId;
      for (const key of ["sentry.sample_rate", "http.response.status_code", "sentry.measurement_value"]) {
        const value = span.attributes[key];
        if (typeof value === "number" && Number.isFinite(value)) attributes[key] = value;
      }
      return {
        trace_id: span.trace_id,
        span_id: span.span_id,
        parent_span_id: span.parent_span_id,
        start_timestamp: span.start_timestamp,
        end_timestamp: span.end_timestamp,
        status: span.status,
        is_segment: span.is_segment,
        name,
        attributes,
      };
    },
  };
}

// Used at the transport as well as the client hook: sendEnvelope bypasses beforeSend.
type Envelope = Parameters<ReturnType<NonNullable<BrowserOptions["transport"]>>["send"]>[0];
export function sanitizeEnvelope(
  envelope: Envelope,
  dsn: string,
  environment?: string,
  release?: string,
  profile?: ProfilePolicy,
): Envelope {
  const options = sentryOptions(dsn, environment, release, profile);
  const result: Envelope[1] = [];
  let spanTraceId: unknown;
  for (const [header, raw] of envelope[1]) {
    try {
      if (
        (header.type === "log" || header.type === "trace_metric") &&
        raw &&
        typeof raw === "object" &&
        "version" in raw &&
        raw.version === 2 &&
        "items" in raw &&
        Array.isArray(raw.items)
      ) {
        const items = raw.items.flatMap((item: unknown) => {
          const clean =
            header.type === "log"
              ? cleanLog(item, options.environment, options.release)
              : cleanMetric(item, options.environment, options.release);
          return clean ? [clean] : [];
        });
        if (items.length)
          result.push([
            {
              type: header.type,
              content_type:
                header.type === "log"
                  ? "application/vnd.sentry.items.log+json"
                  : "application/vnd.sentry.items.trace-metric+json",
              item_count: items.length,
            },
            {
              version: 2,
              ...(typeof window !== "undefined"
                ? { ingest_settings: { infer_ip: "never", infer_user_agent: "never" } }
                : {}),
              items,
            },
          ] as never);
      } else if (header.type === "session" && typeof window !== "undefined") {
        const session = cleanSession(raw, options.environment, options.release);
        if (session) result.push([{ type: "session" }, session] as never);
      } else if (header.type === "client_report") {
        const report = cleanClientReport(raw);
        if (report) result.push([{ type: "client_report" }, report] as never);
      } else if (header.type === "profile_chunk" && profile?.enabled) {
        const chunk = cleanProfileChunk(raw, options.environment, options.release, profile.manifest);
        if (chunk && header.platform === chunk.platform)
          result.push([{ type: "profile_chunk", platform: chunk.platform }, chunk] as never);
      } else if (header.type === "event" && raw && typeof raw === "object") {
        const event = options.beforeSend(raw as ErrorEvent);
        if (event) result.push([{ type: "event" }, event] as never);
      } else if (
        header.type === "span" &&
        raw &&
        typeof raw === "object" &&
        "items" in raw &&
        "version" in raw &&
        raw.version === 2 &&
        Array.isArray(raw.items)
      ) {
        const items = raw.items.flatMap((value: any) => {
          if (
            !value ||
            !telemetryId(value.trace_id) ||
            !telemetryId(value.span_id, 16) ||
            (value.parent_span_id !== undefined && !telemetryId(value.parent_span_id, 16)) ||
            !Number.isFinite(value.start_timestamp) ||
            !Number.isFinite(value.end_timestamp) ||
            value.end_timestamp < value.start_timestamp
          )
            return [];
          const attributes = Object.fromEntries(
            Object.entries(value.attributes ?? {}).map(([key, attr]: any) => [key, attr?.value]),
          );
          const clean = options.beforeSendSpan({ ...value, attributes });
          // Do not refill a missing wire thread from the hook's runtime fallback.
          const threadId = attributes["thread.id"];
          if (
            profile?.enabled &&
            telemetryId(clean.attributes["sentry.profiler_id"]) &&
            typeof threadId === "number" &&
            Number.isSafeInteger(threadId) &&
            threadId >= 0
          ) {
            clean.attributes["thread.id"] = threadId;
            clean.attributes["sentry.thread.id"] = String(threadId);
          } else {
            delete clean.attributes["sentry.profiler_id"];
            delete clean.attributes["thread.id"];
          }
          const typed = Object.fromEntries(
            Object.entries(clean.attributes).map(([key, val]) => [
              key,
              {
                type: typeof val === "number" ? (Number.isInteger(val) ? "integer" : "double") : typeof val,
                value: val,
              },
            ]),
          );
          return [{ ...clean, attributes: typed }];
        });
        if (!items.length || !items.every((span: any) => span.trace_id === items[0].trace_id)) continue;
        spanTraceId = items[0].trace_id;
        result.push([
          { type: "span", content_type: "application/vnd.sentry.items.span.v2+json", item_count: items.length },
          { version: 2, ingest_settings: { infer_ip: "never", infer_user_agent: "never" }, items },
        ] as never);
      }
    } catch {
      /* Drop only the invalid item; other telemetry remains independent. */
    }
  }
  const headers = envelope[0];
  const trace = headers.trace as Record<string, unknown> | undefined;
  const traceId = spanTraceId ?? trace?.trace_id;
  let publicKey: string | undefined;
  try {
    publicKey = new URL(dsn).username;
  } catch {
    /* Invalid DSN is never propagated. */
  }
  return [
    {
      sent_at: new Date().toISOString(),
      sdk: { name: "sentry.javascript.nextjs", version: "11.12.0" },
      ...(telemetryId(headers.event_id) ? { event_id: headers.event_id } : {}),
      ...(telemetryId(traceId) && publicKey
        ? {
            trace: {
              trace_id: traceId,
              public_key: publicKey,
              ...(typeof trace?.sample_rate === "string" && /^(0(\.\d+)?|1(\.0+)?)$/.test(trace.sample_rate)
                ? { sample_rate: trace.sample_rate }
                : {}),
              ...(trace?.sampled === "true" || trace?.sampled === "false" ? { sampled: trace.sampled } : {}),
              environment: options.environment,
              release: options.release,
            },
          }
        : {}),
    },
    result,
  ] as Envelope;
}

export function privacyTransport(
  factory: NonNullable<BrowserOptions["transport"]>,
  dsn: string,
  environment?: string,
  release?: string,
  profile?: ProfilePolicy,
): NonNullable<BrowserOptions["transport"]> {
  return (transportOptions) => {
    const transport = factory(transportOptions);
    return {
      ...transport,
      send: (envelope) => {
        try {
          const safe = sanitizeEnvelope(envelope, dsn, environment, release, profile);
          return safe[1].length
            ? Promise.resolve(transport.send(safe)).catch(() => ({ statusCode: 0 }))
            : Promise.resolve({ statusCode: 200 });
        } catch {
          return Promise.resolve({ statusCode: 200 });
        }
      },
      flush: (timeout) => {
        // Cleaning is synchronous: no second queue can outlive SDK flush.
        try {
          return Promise.resolve(transport.flush(timeout)).catch(() => false);
        } catch {
          return Promise.resolve(false);
        }
      },
    };
  };
}

export function installEnvelopePrivacy(
  client: ReturnType<typeof import("@sentry/nextjs").init>,
  environment?: string,
  release?: string,
  profile?: ProfilePolicy,
) {
  client?.on("beforeEnvelope", (envelope) => {
    try {
      const options = client.getOptions();
      const safe = sanitizeEnvelope(envelope, options.dsn ?? "", environment, release, profile);
      envelope[0] = safe[0];
      envelope[1] = safe[1];
    } catch {
      envelope[1] = [];
    }
  });
}
