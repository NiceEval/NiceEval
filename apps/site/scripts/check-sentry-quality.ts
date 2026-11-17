// Actual SDK -> privacy transport -> SDK serialization -> loopback HTTP ingestion.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as Sentry from "@sentry/nextjs";
import { sentryOptions, privacyTransport, installEnvelopePrivacy } from "../lib/sentry";
import { siteOperation } from "../lib/sentry-operation";

const sentinel = "SENTRY_QUALITY_PRIVATE_SENTINEL";
const received: any[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  const lines = text.trim().split("\n");
  const header = JSON.parse(lines.shift()!);
  const items = [];
  while (lines.length) items.push([JSON.parse(lines.shift()!), JSON.parse(lines.shift()!)]);
  received.push([header, items]);
  res.writeHead(200);
  res.end("{}");
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address !== "string");
const dsn = "https://public@example.invalid/1";
const factory = privacyTransport(
  (options) => Sentry.makeNodeTransport({ ...options, url: `http://127.0.0.1:${address.port}/ingest` }),
  dsn,
  "test",
  "site@quality",
);
Sentry.init({ ...sentryOptions(dsn, "test", "site@quality"), tracesSampleRate: 0, transport: factory });
const client = Sentry.getClient()!;
installEnvelopePrivacy(client, "test", "site@quality");
try {
  Sentry.getGlobalScope().setAttributes({ private: sentinel, component: sentinel, [sentinel]: sentinel });
  await Sentry.withIsolationScope(async (isolation) => {
    isolation.setAttributes({ "user.email": sentinel, scope: sentinel });
    isolation.setUser({ id: sentinel, email: sentinel, ip_address: sentinel });
    await Sentry.withScope(async (scope) => {
      scope.setAttributes({ current: sentinel });
      assert.equal(
        siteOperation("site.docs.open", () => 11),
        11,
      );
      assert.equal(
        await siteOperation("site.install_guide.copy", async () => {
          return siteOperation("site.docs.open", () => 12);
        }),
        12,
      );
      const error = new Error(sentinel),
        abort = new DOMException(sentinel, "AbortError");
      assert.throws(
        () =>
          siteOperation("site.install_guide.copy", () => {
            throw error;
          }),
        (e) => e === error,
      );
      await assert.rejects(
        siteOperation("site.install_guide.copy", async () => {
          throw abort;
        }),
        (e) => e === abort,
      );
      await Sentry.continueTrace({ sentryTrace: `${"a".repeat(32)}-${"b".repeat(16)}-0`, baggage: undefined }, () =>
        siteOperation("site.docs.open", () => {}),
      );
      Sentry.logger.info("service.started", { private: sentinel, nested: { value: sentinel } });
      Sentry.logger.warn("operation.degraded", { private: sentinel });
      Sentry.logger.info(sentinel, { private: sentinel });
      Sentry.metrics.count(sentinel, 1, { attributes: { private: sentinel } });
    });
  });
  client.recordDroppedEvent("queue_overflow", "log_item", 2);
  client.recordDroppedEvent(sentinel as any, "error", 3);
  await Sentry.flush(3000);
  const items = received.flatMap((e) => e[1]);
  const metrics = items.filter(([h]: any) => h.type === "trace_metric").flatMap(([, b]: any) => b.items);
  const logs = items.filter(([h]: any) => h.type === "log").flatMap(([, b]: any) => b.items);
  const counts = metrics.filter((m: any) => m.name === "app.operation.count");
  const durations = metrics.filter((m: any) => m.name === "app.operation.duration");
  assert.equal(counts.length, 5, "Each top-level logical operation counted once, even with trace sampling=0");
  assert.equal(durations.length, 5);
  assert.ok(counts.every((m: any) => m.type === "counter" && m.value === 1));
  assert.ok(durations.every((m: any) => m.type === "distribution" && m.unit === "millisecond" && m.value >= 0));
  for (const outcome of ["success", "error", "cancelled"])
    assert.ok(counts.some((m: any) => m.attributes.outcome?.value === outcome));
  assert.ok(!items.some(([h]: any) => h.type === "span"), "Unsampled traces must not be forced on for metrics");
  for (const body of ["operation.failed", "operation.degraded", "service.started"])
    assert.ok(logs.some((log: any) => log.body === body));
  assert.equal(logs.filter((l: any) => l.body === "operation.failed").length, 1, "Cancellation is not an error log");
  assert.ok(
    items.some(
      ([h, body]: any) =>
        h.type === "client_report" &&
        body.discarded_events.some((e: any) => e.reason === "queue_overflow" && e.quantity === 2),
    ),
  );
  for (const [header, body] of items) {
    if (!["log", "trace_metric"].includes(header.type)) continue;
    assert.equal(body.version, 2);
    assert.equal(header.item_count, body.items.length);
    assert.equal(
      header.content_type,
      header.type === "log"
        ? "application/vnd.sentry.items.log+json"
        : "application/vnd.sentry.items.trace-metric+json",
    );
  }
  // Bypass every client hook through the real final transport, using a real SDK payload.
  const log = structuredClone(logs[0]);
  log.private = sentinel;
  log.attributes.private = { type: "string", value: sentinel };
  log.attributes.component = { type: "string", value: sentinel };
  const metric = structuredClone(metrics[0]);
  metric.attributes.private = { type: "string", value: sentinel };
  await client.getTransport()!.send([
    {},
    [
      [
        { type: "log", item_count: 999 },
        { version: 2, private: sentinel, items: [log] },
      ],
      [{ type: "trace_metric" }, { version: 2, private: sentinel, items: [metric] }],
      [
        { type: "client_report" },
        {
          timestamp: Date.now() / 1000,
          private: sentinel,
          discarded_events: [
            { reason: "before_send", category: "trace_metric", quantity: 4, private: sentinel },
            { reason: sentinel, category: "error", quantity: 1 },
          ],
        },
      ],
      ...["session", "sessions", "check_in", "replay_event", "attachment", "metric_buckets"].map((type) => [
        { type },
        { nested: sentinel },
      ]),
    ],
  ] as any);
  await Sentry.flush(3000);
  assert.ok(!JSON.stringify(received).includes(sentinel), "Scope/global/call/transport bypass sentinel escaped");
  assert.ok(
    received.flatMap((e) => e[1]).every(([h]: any) => ["log", "trace_metric", "client_report"].includes(h.type)),
  );
  let flushTimeout: number | undefined;
  const failing = privacyTransport(
    () => ({
      send: () => Promise.reject(new Error(sentinel)),
      flush: (timeout) => {
        flushTimeout = timeout;
        return Promise.reject(new Error(sentinel));
      },
    }),
    dsn,
    "test",
    "site@quality",
  )({} as any);
  assert.equal((await failing.send([{}, [[{ type: "log" }, { version: 2, items: [log] }]]] as any)).statusCode, 0);
  assert.equal(await failing.flush(37), false);
  assert.equal(flushTimeout, 37, "Synchronous privacy filter must preserve the bounded underlying flush");
  console.log(
    `PASS quality final HTTP wire: ${counts.length} operation pairs at trace rate0, nested suppression, error/cancel outcomes, fixed logs, scope sentinels, client_report, bypass, rejection and flush isolation`,
  );
} finally {
  await Sentry.close(3000);
  await new Promise<void>((done) => server.close(() => done()));
}
