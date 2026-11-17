// Local rollout acceptance: actual Next SDK, only the ingestion boundary is replaced.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import * as Sentry from "@sentry/nextjs";
import { productionEnabled, privacyTransport, installEnvelopePrivacy, sentryOptions } from "../lib/sentry";
import { siteOperation } from "../lib/sentry-operation";
import { onRequestError } from "../instrumentation";
import { loadNodeProfiling } from "../lib/sentry-node";

const dsn = "https://public@example.invalid/1";
const sentinel = "SENTRY_PRIVATE_SENTINEL";
const fallback = process.env.SENTRY_PROFILER_BINARY_PATH ? await loadNodeProfiling("site@acceptance") : undefined;
if (fallback) {
  assert.equal(fallback.policy.enabled, false);
  assert.deepEqual(fallback.integrations, []);
}
assert.notEqual(process.env.NODE_ENV, "production", "Run acceptance in development/test with explicit local transport");
await import("../sentry.server.config");
await import("../sentry.edge.config");
assert.equal(Sentry.getClient(), undefined, "non-production config must not create a client");
assert.equal(productionEnabled(undefined, undefined), false);
assert.equal(productionEnabled("development", "production"), false);
assert.equal(productionEnabled("test", "production"), false);
assert.equal(productionEnabled("production", undefined), true);
assert.equal(productionEnabled("production", "preview"), false);
assert.equal(productionEnabled("production", "production"), true);
assert.equal(productionEnabled("production", "development"), false);
assert.equal(sentryOptions(dsn).environment, "production");
assert.equal(sentryOptions(dsn).parentSpanIsAlwaysRootSpan, false);
const clientConfigSource = await readFile(new URL("../instrumentation-client.ts", import.meta.url), "utf8");
assert.match(clientConfigSource, /parentSpanIsAlwaysRootSpan:\s*false/);
const debugId = "12345678-1234-4234-8234-123456789012";
const debugEvent: Sentry.ErrorEvent = {
  type: undefined,
  debug_meta: {
    images: [
      {
        type: "sourcemap",
        debug_id: debugId,
        code_file: `https://niceeval.com/_next/static/chunk.js?secret=${sentinel}`,
      },
      { type: "sourcemap", debug_id: sentinel, code_file: `https://niceeval.com/${sentinel}` },
    ],
  },
  exception: {
    values: [
      {
        type: "Error",
        value: sentinel,
        mechanism: {
          type: "auto.browser.global_handlers.onerror",
          handled: false,
          is_exception_group: true,
          data: { private: sentinel },
          ...{ meta: { nested: { private: sentinel } } },
        },
        stacktrace: {
          frames: [
            {
              filename: "https://niceeval.com/_next/static/chunk.js",
              abs_path: `https://niceeval.com/_next/static/chunk.js?secret=${sentinel}`,
              debug_id: debugId,
            },
          ],
        },
      },
    ],
  },
};
const cleanedDebugEvent = sentryOptions(dsn).beforeSend(debugEvent);
assert.equal(cleanedDebugEvent.exception?.values?.[0].stacktrace?.frames?.[0].debug_id, debugId);
assert.equal(cleanedDebugEvent.debug_meta?.images?.length, 1);
assert.ok(!JSON.stringify(cleanedDebugEvent).includes(sentinel));
assert.deepEqual(cleanedDebugEvent.exception?.values?.[0].mechanism, {
  type: "auto.browser.global_handlers.onerror",
  handled: false,
  is_exception_group: true,
});
const unknownMechanism = sentryOptions(dsn).beforeSend({
  type: undefined,
  exception: { values: [{ mechanism: { type: sentinel, handled: false } }] },
});
assert.deepEqual(unknownMechanism.exception?.values?.[0].mechanism, { type: "generic", handled: false });
const unknownTraceOp = sentryOptions(dsn).beforeSend({
  type: undefined,
  contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: sentinel } },
});
assert.equal(unknownTraceOp.contexts?.trace?.op, "function");
const noTraceOp = sentryOptions(dsn).beforeSend({
  type: undefined,
  contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) } },
});
assert.equal(noTraceOp.contexts?.trace?.op, undefined);
const invalidTraceIds = sentryOptions(dsn).beforeSend({
  type: undefined,
  contexts: { trace: { trace_id: sentinel, span_id: "b".repeat(16), op: "pageload" } },
});
assert.deepEqual(invalidTraceIds.contexts, {});
const envelopes: unknown[] = [];
const receivedHeaders: Record<string, unknown>[] = [];
const server = createServer(async (request, response) => {
  if (request.url === "/ingest") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
    const header = JSON.parse(lines.shift()!);
    const items = [];
    while (lines.length) items.push([JSON.parse(lines.shift()!), JSON.parse(lines.shift()!)]);
    envelopes.push([header, items]);
    response.writeHead(200);
    response.end("{}");
    return;
  }
  receivedHeaders.push(request.headers);
  response.end("ok");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
try {
  Sentry.init({
    ...sentryOptions(dsn, "test", "site@acceptance", fallback?.policy),
    integrations: fallback?.integrations,
    tracesSampleRate: 1,
    transport: privacyTransport(
      (options) => Sentry.makeNodeTransport({ ...options, url: `http://127.0.0.1:${address.port}/ingest` }),
      dsn,
      "test",
      "site@acceptance",
      fallback?.policy,
    ),
  });
  installEnvelopePrivacy(Sentry.getClient(), "test", "site@acceptance");
  const client = Sentry.getClient()!;
  assert.equal(client.getOptions().parentSpanIsAlwaysRootSpan, false);
  await client.sendEnvelope([
    { extra: sentinel, sdk: { name: sentinel }, trace: { transaction: sentinel } },
    [
      "session",
      "sessions",
      "attachment",
      "log",
      "replay_event",
      "replay_recording",
      "profile",
      "profile_chunk",
      "transaction",
      "check_in",
    ].map((type) => [{ type }, { nested: { did: sentinel } }]),
  ] as unknown as Parameters<typeof client.sendEnvelope>[0]);
  Sentry.captureEvent(debugEvent);
  Sentry.withScope((scope) => {
    scope.setUser({ id: sentinel, email: `${sentinel}@example.invalid` });
    scope.setExtra("nested", { private: { value: sentinel } });
    scope.setContext("private", { nested: { value: sentinel } });
    scope.setTag("private", sentinel);
    Sentry.addBreadcrumb({ message: sentinel });
    Sentry.captureException(new Error(`SQL body ${sentinel}`));
  });
  await Sentry.startSpan(
    {
      name: sentinel,
      op: "http.server",
      attributes: {
        private: { value: sentinel } as unknown as string,
        "http.url": `https://example.invalid/${sentinel}?secret=${sentinel}`,
      },
    },
    async () => {
      await Sentry.startSpan(
        {
          name: sentinel,
          op: "http.client",
          attributes: { "gen_ai.prompt": sentinel, "http.request.header.authorization": sentinel },
        },
        async () => {
          await fetch(`http://127.0.0.1:${address.port}/?secret=${sentinel}`);
        },
      );
      onRequestError(
        new Error(sentinel),
        {
          path: `/${sentinel}?secret=${sentinel}`,
          method: "GET",
          headers: { authorization: sentinel, cookie: sentinel },
        },
        { routerKind: "App Router", routePath: "/[lang]/blog/[slug]", routeType: "render" },
      );
    },
  );
  await Sentry.continueTrace(
    { sentryTrace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1", baggage: undefined },
    () =>
      Sentry.startSpan(
        {
          name: "GET /[lang]",
          op: "http.server",
          attributes: { "http.request.method": "GET", "http.route": "/[lang]" },
        },
        () => {
          Sentry.startSpan(
            { name: "Middleware.execute", op: "middleware", attributes: { "sentry.origin": "auto" } },
            () => {
              Sentry.startSpan({ name: `AppRender.getBodyResult ${sentinel}`, op: "function" }, () => {
                Sentry.captureException(new Error(`render error ${sentinel}`));
              });
            },
          );
        },
      ),
  );
  await Sentry.startSpan(
    {
      name: "GET /INIT.md",
      op: "http.server",
      attributes: { "http.request.method": "GET", "http.route": "/INIT.md" },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: `GET /${sentinel}?secret=${sentinel}`,
      op: "http.server",
      attributes: { "http.request.method": "GET", "url.path": `/${sentinel}` },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: "POST /[lang]",
      op: "http.server",
      attributes: { "http.request.method": "POST", "http.route": "/[lang]" },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: "GET https://niceeval.com/INIT.md",
      op: "http.client",
      attributes: { "http.request.method": "GET", "url.full": `https://niceeval.com/INIT.md?secret=${sentinel}` },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: "GET https://example.invalid/INIT.md",
      op: "http.client",
      attributes: { "http.request.method": "GET", "url.full": "https://example.invalid/INIT.md" },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: `GET https://user:${sentinel}@niceeval.com/INIT.md`,
      op: "http.client",
      attributes: { "http.request.method": "GET", "url.full": `https://user:${sentinel}@niceeval.com/INIT.md` },
    },
    () => {},
  );
  await Sentry.startSpan(
    {
      name: `GET //evil.example/INIT.md`,
      op: "http.client",
      attributes: { "http.request.method": "GET", "url.full": "//evil.example/INIT.md" },
    },
    () => {},
  );
  await Sentry.startSpan({ name: "site.page.load", op: "pageload" }, () => {
    Sentry.captureException(new Error("pageload error"));
    siteOperation("site.docs.open", () => {
      Sentry.captureException(new Error("ui action error"));
    });
  });
  await Promise.all(
    ["d", "e"].map((digit) =>
      Sentry.withIsolationScope(() =>
        Sentry.continueTrace({ sentryTrace: `${digit.repeat(32)}-${digit.repeat(16)}-1`, baggage: undefined }, () =>
          Sentry.startSpan(
            {
              name: "GET /zh",
              op: "http.server",
              attributes: { "http.request.method": "GET", "url.path": "/zh" },
            },
            async () => {
              await new Promise((resolve) => setTimeout(resolve, digit === "d" ? 15 : 5));
              Sentry.startSpan({ name: "child-op", op: "function" }, () => {});
            },
          ),
        ),
      ),
    ),
  );
  // A valid unsampled parent must stay unsampled even with the test's local rate of 1.
  await Sentry.continueTrace(
    { baggage: undefined, sentryTrace: "12345678901234567890123456789012-1234567890123456-0" },
    async () => {
      await Sentry.startSpan({ name: "unsampled-parent", op: "function" }, async () => {});
    },
  );
  await Sentry.flush(3000);
  assert.equal(receivedHeaders.length, 1);
  assert.equal(receivedHeaders[0]["sentry-trace"], undefined);
  assert.equal(receivedHeaders[0].baggage, undefined);
  const output = JSON.stringify(envelopes);
  if (output.includes(sentinel)) {
    function paths(value: unknown, path = ""): void {
      if (typeof value === "string" && value.includes(sentinel)) console.log("LEAK", path, value);
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value)) paths(child, `${path}.${key}`);
    }
    paths(envelopes);
  }
  assert.ok(!output.includes(sentinel), "sensitive sentinel escaped the final SDK transport");
  const items = (envelopes as any[]).flatMap((envelope) => envelope[1]);
  for (const [header, entries] of envelopes as any[]) {
    for (const [item, body] of entries) {
      if (item.type !== "span") continue;
      assert.deepEqual(item, {
        type: "span",
        content_type: "application/vnd.sentry.items.span.v2+json",
        item_count: body.items.length,
      });
      assert.equal(body.version, 2);
      assert.equal(header.trace?.public_key, "public");
      assert.ok(body.items.every((span: any) => span.trace_id === header.trace?.trace_id));
    }
  }
  assert.ok(
    items.every(([header]: any) => ["event", "span", "client_report", "trace_metric", "log"].includes(header.type)),
    "out-of-scope envelope item escaped",
  );
  const events = items.filter(([header]: any) => header.type === "event").map(([, payload]: any) => payload);
  const spans = items.filter(([header]: any) => header.type === "span").flatMap(([, payload]: any) => payload.items);
  assert.ok(events.length >= 3, "request hook and scoped exception must reach transport");
  assert.ok(
    events.every(
      (event: any) => event.tags.component === "site" && event.exception.values[0].value === "Application error",
    ),
  );
  const mechanisms = events
    .flatMap((event: any) => event.exception.values.map((value: any) => value.mechanism))
    .filter(Boolean);
  assert.ok(
    mechanisms.some(
      (mechanism: any) =>
        mechanism.type === "auto.browser.global_handlers.onerror" &&
        mechanism.handled === false &&
        mechanism.is_exception_group === true,
    ),
  );
  assert.ok(
    mechanisms.some(
      (mechanism: any) => mechanism.type === "auto.function.nextjs.on_request_error" && mechanism.handled === false,
    ),
  );
  assert.ok(mechanisms.some((mechanism: any) => mechanism.type === "generic" && mechanism.handled === true));
  assert.ok(mechanisms.every((mechanism: any) => !mechanism.data && !mechanism.meta));
  assert.ok(
    events.some((event: any) =>
      event.debug_meta?.images?.some(
        (image: any) => image.debug_id === debugId && image.code_file === "https://niceeval.com/_next/static/chunk.js",
      ),
    ),
    "sourcemap debug metadata lost in transport",
  );
  assert.ok(
    spans.some((span: any) => span.is_segment),
    "root span missing",
  );
  assert.ok(
    spans.some((span: any) => !span.is_segment),
    "child span missing",
  );
  assert.ok(spans.every((span: any) => span.attributes.component.value === "site" && !span.links));
  assert.ok(!spans.some((span: any) => span.trace_id === "12345678901234567890123456789012"));
  assert.ok(
    events.some((event: any) => spans.some((span: any) => span.trace_id === event.contexts?.trace?.trace_id)),
    "error lost active trace",
  );
  const eventOps = new Set(events.map((event: any) => event.contexts?.trace?.op));
  assert.ok(eventOps.has("http.server"), "http.server error op must remain http.server");
  assert.ok(eventOps.has("function"), "function error op must remain function");
  assert.ok(eventOps.has("pageload"), "pageload error op must remain pageload");
  assert.ok(eventOps.has("ui.action"), "ui.action error op must remain ui.action");
  assert.ok(eventOps.has(undefined), "error without active span must not fabricate http.server op");
  const traceA = spans.filter((span: any) => span.trace_id === "a".repeat(32));
  const traceARoot = traceA.find((span: any) => span.parent_span_id === "b".repeat(16));
  const traceAMiddleware = traceA.find((span: any) => span.attributes["sentry.op"]?.value === "middleware");
  const traceAFunction = traceA.find((span: any) => span.attributes["sentry.op"]?.value === "function");
  assert.equal(traceARoot?.name, "site.page.load");
  assert.equal(traceARoot?.attributes["sentry.op"]?.value, "http.server");
  assert.equal(traceAMiddleware?.parent_span_id, traceARoot?.span_id);
  assert.equal(traceAFunction?.name, "function");
  assert.equal(traceAFunction?.parent_span_id, traceAMiddleware?.span_id);
  for (const span of traceA) {
    if (span.parent_span_id && span.parent_span_id !== "b".repeat(16)) {
      assert.ok(
        traceA.some((candidate: any) => candidate.span_id === span.parent_span_id),
        "internal function/middleware parent chain must remain unbroken",
      );
    }
  }
  assert.ok(
    spans.some((s: any) => s.name === "site.docs.open" && s.attributes["sentry.op"]?.value === "http.server"),
    "/INIT.md server route must map to site.docs.open",
  );
  assert.ok(
    spans.some((s: any) => s.name === "site.docs.open" && s.attributes["sentry.op"]?.value === "http.client"),
    "niceeval.com /INIT.md client request must map to site.docs.open with http.client op",
  );
  assert.ok(
    spans.some((s: any) => s.name === "http.server" && s.attributes["sentry.op"]?.value === "http.server"),
    "unknown/non-GET server route must stay http.server",
  );
  assert.ok(
    spans.some((s: any) => s.name === "http.client" && s.attributes["sentry.op"]?.value === "http.client"),
    "external/unknown/userinfo client request must stay http.client",
  );
  for (const digit of ["d", "e"]) {
    const group = spans.filter((span: any) => span.trace_id === digit.repeat(32));
    const root = group.find((span: any) => span.parent_span_id === digit.repeat(16));
    const child = group.find((span: any) => span.parent_span_id === root?.span_id);
    assert.equal(root?.name, "site.page.load");
    assert.ok(child, `concurrent trace ${digit} lost child span`);
  }
  console.log(
    `PASS: production gates, ${events.length} errors, ${spans.length} root/child spans, static route mapping, error trace op, parent chain, concurrent isolation, inherited sampling, sensitive fields, outbound propagation`,
  );
} finally {
  await Sentry.close(3000);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
