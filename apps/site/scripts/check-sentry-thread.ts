// Actual SDK serialization and final transport; only ingestion is replaced.
import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { sentryOptions, privacyTransport } from "../lib/sentry";
const dsn = "https://public@example.invalid/1";
const profiler = "a".repeat(32);
const secret = "SENSITIVE_LEGACY_THREAD";
const sent: any[] = [];
const policy = { enabled: true, threadId: 0 };
const client = Sentry.init({
  ...sentryOptions(dsn, "test", "site@test", policy),
  defaultIntegrations: false,
  tracesSampleRate: 1,
  transport: privacyTransport(
    () => ({
      send: async (envelope) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
    dsn,
    "test",
    "site@test",
    policy,
  ),
})!;
Sentry.startSpan(
  {
    name: "site.docs.open",
    op: "ui.action",
    attributes: { "sentry.profiler_id": profiler, "sentry.thread.id": secret },
  },
  () => {},
);
await client.flush(2000);
const spans = () => sent.flatMap((e) => e[1].filter((i: any) => i[0].type === "span").flatMap((i: any) => i[1].items));
const first = spans()[0];
assert.ok(first, "actual SDK must emit a streamed span");
assert.deepEqual(first.attributes["thread.id"], { type: "integer", value: 0 });
assert.deepEqual(first.attributes["sentry.thread.id"], { type: "string", value: "0" });
const cases: Array<[unknown, unknown, boolean]> = [
  [profiler, 0, true],
  [profiler, 7, true],
  [profiler, Number.MAX_SAFE_INTEGER, true],
  [undefined, 0, false],
  ["0".repeat(32), 0, false],
  ["invalid", 0, false],
  [profiler, undefined, false],
  [profiler, -1, false],
  [profiler, 0.5, false],
  [profiler, Number.MAX_SAFE_INTEGER + 1, false],
  [profiler, "0", false],
];
for (const [id, thread, valid] of cases) {
  const attributes: any = { "sentry.thread.id": { type: "string", value: secret } };
  if (id !== undefined) attributes["sentry.profiler_id"] = { type: "string", value: id };
  if (thread !== undefined)
    attributes["thread.id"] = { type: typeof thread === "number" ? "integer" : "string", value: thread };
  await client.sendEnvelope([{}, [[{ type: "span" }, { version: 2, items: [{ ...first, attributes }] }]]] as never);
  const last = spans().at(-1);
  assert.deepEqual(last.attributes["sentry.thread.id"], valid ? { type: "string", value: String(thread) } : undefined);
  assert.deepEqual(last.attributes["thread.id"], valid ? { type: "integer", value: thread } : undefined);
  assert.equal(last.attributes["sentry.profiler_id"]?.value, valid ? profiler : undefined);
}
assert.ok(!JSON.stringify(sent).includes(secret));
await client.close(2000);
console.log(
  `PASS: real Next SDK streamed span + ${cases.length} final wire cases; numeric thread preserved, derived legacy string, no invented association`,
);
