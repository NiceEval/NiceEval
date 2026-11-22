// Real SDK + native sampling. Only ingestion and HTTP upstreams are isolated.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { loadNodeProfiling } from "../lib/sentry-node";
import { siteOperation } from "../lib/sentry-operation";
import { readProfileManifest } from "../lib/sentry-profile";
import { sentryOptions, privacyTransport, installEnvelopePrivacy, type ProfilePolicy } from "../lib/sentry";

const sentinel = "SENTRY_PROFILE_PRIVATE_SENTINEL";
const manifest = JSON.parse(await readFile(".next/server/sentry-profile-assets.json", "utf8"));
const release = manifest.release;
const policy: ProfilePolicy = { enabled: true, threadId: 0, manifest: readProfileManifest(manifest, release) };
const fallback = await loadNodeProfiling(release, async () => {
  throw new Error(sentinel);
});
assert.equal(fallback.policy.enabled, false);
assert.deepEqual(fallback.integrations, []);
const envelopes: any[] = [];
const originals: any[] = [];
const headers: any[] = [];
const server = createServer((req, res) => {
  headers.push(req.headers);
  if (req.url === "/302" || req.url === "/307") {
    res.writeHead(Number(req.url.slice(1)), { location: "/receiver" });
  }
  res.end("ok");
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address !== "string");
const dsn = "https://public@example.invalid/1";
Sentry.init({
  ...sentryOptions(dsn, "test", release, policy),
  integrations: [nodeProfilingIntegration()],
  profileLifecycle: "trace",
  profileSessionSampleRate: 1,
  tracesSampleRate: 1,
  transport: privacyTransport(
    () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
    dsn,
    "test",
    release,
    policy,
  ),
});
const client = Sentry.getClient()!;
client.on("beforeEnvelope", (envelope) => {
  originals.push(JSON.parse(JSON.stringify(envelope)));
});
installEnvelopePrivacy(client, "test", release, policy);

function busy() {
  const deadline = performance.now() + 180;
  while (performance.now() < deadline) Math.sqrt(Math.random());
}
try {
  const error = new Error("copy install instructions failed");
  const abort = new DOMException(sentinel, "AbortError");
  await Sentry.withIsolationScope(async () => {
    await Sentry.startSpan({ name: "site.page.load", op: "pageload" }, async () => {
      assert.equal(
        await siteOperation("site.install_guide.copy", async () => {
          busy();
          return 17;
        }),
        17,
      );
      await assert.rejects(
        siteOperation("site.install_guide.copy", async () => {
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
      assert.throws(
        () =>
          siteOperation("site.docs.open", () => {
            throw error;
          }),
        (e) => e === error,
      );
      await Promise.all([302, 307].map((status) => fetch(`http://127.0.0.1:${address.port}/${status}`)));
    });
  });
  await Promise.all(
    ["a", "c"].map((digit) =>
      Sentry.withIsolationScope(() =>
        Sentry.continueTrace(
          {
            sentryTrace: `${digit.repeat(32)}-${digit.repeat(16)}-1`,
            baggage: `user=${sentinel},sentry-transaction=${sentinel}`,
          },
          () =>
            Sentry.startSpan({ name: "site.navigation", op: "navigation" }, async () => {
              await new Promise((done) => setTimeout(done, digit === "a" ? 20 : 5));
              await siteOperation("site.docs.open", async () => {
                busy();
                Sentry.captureException(error);
              });
            }),
        ),
      ),
    ),
  );
  await Sentry.withIsolationScope(() =>
    Sentry.continueTrace({ sentryTrace: `${"b".repeat(32)}-${"b".repeat(16)}-0`, baggage: undefined }, () =>
      Sentry.startSpan({ name: "site.navigation", op: "navigation" }, busy),
    ),
  );
  await Sentry.flush(3000);
  const originalChunks = originals.flatMap((e) => e[1]).filter(([h]: any) => h.type === "profile_chunk");
  const chunks = envelopes.flatMap((e) => e[1]).filter(([h]: any) => h.type === "profile_chunk");
  assert.ok(chunks.length && chunks.length === originalChunks.length, "Real native chunks lost");
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index][1],
      original = originalChunks[index][1];
    assert.equal(chunk.version, "2");
    assert.equal(chunk.platform, "node");
    assert.deepEqual(chunk.profile.stacks, original.profile.stacks);
    assert.deepEqual(
      chunk.profile.samples,
      original.profile.samples.map(({ stack_id, timestamp, thread_id }: any) => ({ stack_id, timestamp, thread_id })),
    );
    assert.equal(chunk.profile.frames.length, original.profile.frames.length);
  }
  // Mutate a real chunk to exercise complete validation and the final transport, never fake a successful sample.
  const raw = originalChunks[0][1];
  const artifact = Object.keys(manifest.files).find((file) => manifest.files[file].length)!;
  const symbol = manifest.files[artifact][0];
  const poisoned = structuredClone(raw);
  poisoned.secret = { nested: sentinel };
  poisoned.measurements = { [sentinel]: { values: [sentinel] } };
  poisoned.profile.frames[0] = {
    file: `/host/${artifact}?secret=${sentinel}`,
    function: sentinel,
    lineno: 1,
    colno: 2,
    private: sentinel,
  };
  poisoned.profile.queue_metadata = { private: { label: sentinel } };
  poisoned.profile.thread_metadata["0"].name = sentinel;
  await client.sendEnvelope([{ secret: sentinel }, [[{ type: "profile_chunk", platform: "node" }, poisoned]]] as any);
  const safe = envelopes.at(-1)[1][0][1];
  assert.equal(safe.profile.frames[0].file, artifact);
  assert.equal(safe.profile.frames[0].function, "redacted");
  assert.deepEqual(safe.profile.stacks, raw.profile.stacks);
  const positive = structuredClone(poisoned);
  positive.profile.frames[0].function = symbol;
  await client.sendEnvelope([{}, [[{ type: "profile_chunk", platform: "node" }, positive]]] as any);
  assert.equal(envelopes.at(-1)[1][0][1].profile.frames[0].function, symbol);
  for (const mutate of [
    (v: any) => {
      v.version = 2;
    },
    (v: any) => {
      v.profiler_id = "0".repeat(32);
    },
    (v: any) => {
      v.profile.samples[0].stack_id = v.profile.stacks.length;
    },
    (v: any) => {
      v.profile.stacks[0][0] = -1;
    },
    (v: any) => {
      v.profile.samples[0].thread_id = sentinel;
    },
    (v: any) => {
      v.profile.samples[0].timestamp = Infinity;
    },
  ]) {
    const invalid = structuredClone(poisoned);
    mutate(invalid);
    const count = envelopes.length;
    await client.sendEnvelope([{}, [[{ type: "profile_chunk", platform: "node" }, invalid]]] as any);
    assert.equal(envelopes.length, count, "Invalid profile reached transport");
  }
  for (const path of [
    `/host/.next/server/${sentinel}.js`,
    "data:text/javascript,secret",
    "blob:https://niceeval.com/secret",
  ]) {
    const value = structuredClone(positive);
    value.profile.frames[0].file = path;
    await client.sendEnvelope([{}, [[{ type: "profile_chunk", platform: "node" }, value]]] as any);
    assert.deepEqual(envelopes.at(-1)[1][0][1].profile.frames[0], { function: "redacted" });
  }
  policy.manifest = readProfileManifest(manifest, "site@different-release");
  await client.sendEnvelope([{}, [[{ type: "profile_chunk", platform: "node" }, positive]]] as any);
  assert.ok(envelopes.at(-1)[1][0][1].profile.frames.every((f: any) => f.function === "redacted" && !f.file));
  await Sentry.flush(3000);
  const spans = envelopes
    .flatMap((e) => e[1])
    .filter(([h]: any) => h.type === "span")
    .flatMap(([, b]: any) => b.items);
  assert.ok(spans.some((s: any) => s.name === "site.install_guide.copy"));
  assert.ok(spans.filter((s: any) => s.name === "site.install_guide.copy").some((s: any) => s.status === "error"));
  for (const outcome of ["success", "error", "cancelled"])
    assert.ok(spans.some((s: any) => s.name === "site.install_guide.copy" && s.attributes.outcome?.value === outcome));
  for (const [digit] of [["a"], ["c"]]) {
    const group = spans.filter((s: any) => s.trace_id === digit.repeat(32));
    const root = group.find((s: any) => s.name === "site.navigation");
    const child = group.find((s: any) => s.name === "site.docs.open");
    assert.equal(root.parent_span_id, digit.repeat(16));
    assert.equal(child.parent_span_id, root.span_id);
  }
  assert.ok(!spans.some((s: any) => s.trace_id === "b".repeat(32)));
  assert.ok(
    spans.some((s: any) =>
      chunks.some(
        ([, chunk]: any) =>
          s.attributes["sentry.profiler_id"]?.value === chunk.profiler_id &&
          s.attributes["thread.id"]?.value === 0 &&
          chunk.profile.samples.some(
            (sample: any) => sample.timestamp >= s.start_timestamp && sample.timestamp <= s.end_timestamp,
          ),
      ),
    ),
  );
  assert.ok(headers.length >= 4 && headers.every((h) => !h["sentry-trace"] && !h.baggage));
  assert.ok(!JSON.stringify(envelopes).includes(sentinel));
  console.log(
    `PASS final native transport: ${chunks.length} real chunks; ${spans.length} spans; parent/-0/concurrency, HTTP302/307, success/error/cancel, manifest/indices/sentinels/fallback`,
  );
} finally {
  await Sentry.close(3000);
  await new Promise<void>((done) => server.close(() => done()));
}
