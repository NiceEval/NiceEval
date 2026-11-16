// Local rollout acceptance: actual Next SDK, only the ingestion boundary is replaced.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as Sentry from "@sentry/nextjs";
import { productionEnabled, installEnvelopePrivacy, sentryOptions } from "../lib/sentry";
import { onRequestError } from "../instrumentation";

const dsn = "https://public@example.invalid/1";
const sentinel = "SENTRY_PRIVATE_SENTINEL";
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
const envelopes: unknown[] = [];
const receivedHeaders: Record<string, unknown>[] = [];
const server = createServer((request, response) => {
  receivedHeaders.push(request.headers);
  response.end("ok");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
try {
  Sentry.init({
    ...sentryOptions(dsn, "test", "site@acceptance"),
    tracesSampleRate: 1,
    transport: () => ({
      send: async (envelope: Parameters<ReturnType<NonNullable<Sentry.BrowserOptions["transport"]>>["send"]>[0]) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  installEnvelopePrivacy(Sentry.getClient(), "test", "site@acceptance");
  const client = Sentry.getClient()!;
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
      Sentry.startSpan({ name: "request", op: "http.server" }, () => {
        Sentry.startSpan({ name: "child", op: "function" }, () => {});
      }),
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
    items.every(([header]: any) => header.type === "event" || header.type === "span"),
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
  console.log(
    `PASS: production gates, ${events.length} errors, ${spans.length} root/child spans, inherited sampling, sensitive fields, outbound propagation`,
  );
} finally {
  await Sentry.close(3000);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
