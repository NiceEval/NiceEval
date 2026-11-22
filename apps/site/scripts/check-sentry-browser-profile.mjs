// Proxy the built application locally; inject only an isolated SDK transport.
// No production route or debug API is added to the product.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { identifiers } from "./sentry-profile-assets.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const nextOrigin = process.argv[2];
if (!nextOrigin) throw new Error("Pass a local production Next server origin");
// Verify the deployment-owned endpoint before the fixture proxy can supply its augmented manifest.
const release = JSON.parse(await readFile(resolve(root, ".next/server/sentry-profile-assets.json"), "utf8")).release;
if (!/^site@[a-f0-9]{40}$/.test(release)) throw new Error("Pass a build with a Git SHA release");
const manifestPath = `/_next/static/sentry-profile-assets/${release.slice(5)}.json`;
const response = await fetch(new URL(manifestPath, nextOrigin), { redirect: "error" });
if (!response.ok) throw new Error(`Next profile manifest endpoint returned ${response.status}`);
const manifest = await response.json();
const builtManifest = JSON.parse(
  await readFile(resolve(root, `.next/static/sentry-profile-assets/${release.slice(5)}.json`), "utf8"),
);
if (JSON.stringify(manifest) !== JSON.stringify(builtManifest))
  throw new Error("Next must serve the final build profile manifest unchanged");
const received = [];
const receiver = createServer((req, res) => {
  received.push({ trace: req.headers["sentry-trace"], baggage: req.headers.baggage });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "sentry-trace,baggage,content-type");
  res.end("receiver");
});
await new Promise((done) => receiver.listen(0, "127.0.0.1", done));
const external = `http://127.0.0.1:${receiver.address().port}`;
const entry = `
import * as Sentry from "@sentry/nextjs";
import { sentryOptions, privacyTransport, installEnvelopePrivacy } from "./lib/sentry";
import { readProfileManifest } from "./lib/sentry-profile";
const sentinel = "SENTRY_BROWSER_PROFILE_PRIVATE_SENTINEL";
const envelopes = [], originals = [];
const profile = { enabled: "Profiler" in window, threadId: 0 };
const release = ${JSON.stringify(manifest.release)};
const dsn = "https://public@example.invalid/1";
const mode = new URL(location.href).searchParams.get("mode");
const client = Sentry.init({
  ...sentryOptions(dsn, "test", release, profile), tracesSampleRate: 1,
  profileLifecycle: "trace", profileSessionSampleRate: mode === "unsampled" ? 0 : 1,
  integrations: defaults => [
    ...defaults.filter(i => !["BrowserSession", "Breadcrumbs", "BrowserTracing"].includes(i.name)),
    Sentry.browserTracingIntegration({traceXHR: false}),
    ...(profile.enabled ? [Sentry.browserProfilingIntegration()] : []),
  ],
  transport: privacyTransport(() => ({ send: async envelope => { envelopes.push(envelope); return {statusCode:200}; }, flush: async () => true }), dsn, "test", release, profile),
});
client.on("beforeEnvelope", envelope => originals.push(JSON.parse(JSON.stringify(envelope))));
installEnvelopePrivacy(client, "test", release, profile);
function busy() { const end = performance.now() + 220; while(performance.now() < end) Math.sqrt(Math.random()); }
// The clipboard is the only external business boundary replaced.
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { busy(); await new Promise(r => setTimeout(r, 30)); } } });
window.acceptance = {
  envelopes, originals, profile,
  ready: fetch(${JSON.stringify(manifestPath)}).then(r => r.json()).then(m => { profile.manifest = readProfileManifest(m, release); }),
  async exercise() {
    await this.ready;
    await Sentry.startSpan({name:"site.navigation", op:"navigation", forceTransaction:true}, async () => {
      busy();
      for (const path of ["/302", "/307"]) await fetch(path);
      await fetch(new Request("/302", {redirect:"follow"}));
      await fetch(new Request("/307", {redirect:"manual"}));
      await new Promise((done, reject) => { const xhr = new XMLHttpRequest(); xhr.open("GET", "/307"); xhr.onload=done; xhr.onerror=reject; xhr.send(); });
      Sentry.captureException(new Error(sentinel));
    });
    for (const decision of ["1", "0"]) await Sentry.continueTrace({sentryTrace:"a".repeat(32)+"-"+"b".repeat(16)+"-"+decision}, () =>
      Sentry.startSpan({name:"site.docs.open",op:"ui.action",forceTransaction:true}, busy));
    await Sentry.flush(3000);
    return {capability:profile.enabled};
  },
  async result() {
    await Sentry.flush(3000);
    const all = envelopes.flatMap(e=>e[1]);
    const chunks = all.filter(([h])=>h.type === "profile_chunk");
    const raw = originals.flatMap(e=>e[1]).filter(([h])=>h.type === "profile_chunk");
    const spans = all.filter(([h])=>h.type === "span").flatMap(([,p])=>p.items);
    const received = await fetch("/received").then(r=>r.json());
    return {
      capability:profile.enabled, chunks:chunks.length, spans:spans.length,
      copy:spans.some(s=>s.name === "site.install_guide.copy"), docs:spans.some(s=>s.name === "site.docs.open"),
      safe:!JSON.stringify(envelopes).includes(sentinel),
      indices:chunks.every(([,p],i)=>JSON.stringify(p.profile.stacks)===JSON.stringify(raw[i][1].profile.stacks) && p.profile.frames.length===raw[i][1].profile.frames.length && JSON.stringify(p.profile.samples.map(s=>[s.stack_id,s.thread_id,s.timestamp]))===JSON.stringify(raw[i][1].profile.samples.map(s=>[s.stack_id,s.thread_id,s.timestamp]))),
      artifact:chunks.some(([,p])=>p.profile.frames.some(f=>f.abs_path && f.function !== "redacted")),
      debugImages:chunks.some(([,p])=>p.debug_meta.images.length),
      mappingFrame:chunks.flatMap(([,p])=>p.profile.frames).find(f=>f.abs_path === "/sentry-acceptance.js" && f.function === "busy"),
      association:chunks.some(([,p])=>spans.some(s=>s.attributes["sentry.profiler_id"]?.value===p.profiler_id && s.attributes["thread.id"]?.value===0 && p.profile.samples.some(sample=>sample.timestamp >= s.start_timestamp && sample.timestamp <= s.end_timestamp))),
      noOutbound:received.length >= 5 && received.every(h=>!h.trace && !h.baggage),
      parent:spans.some(s=>s.trace_id === "a".repeat(32) && s.parent_span_id === "b".repeat(16)),
    };
  },
};
`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts", sourcefile: "sentry-acceptance.ts" },
  bundle: true,
  platform: "browser",
  write: false,
  sourcemap: "external",
  outfile: resolve(root, ".next/profile-acceptance-assets/sentry-acceptance.js"),
  alias: {
    "@sentry/nextjs": require.resolve("@sentry/react", {
      paths: [dirname(require.resolve("@sentry/nextjs/package.json", { paths: [root] }))],
    }),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
await mkdir(resolve(root, ".next/profile-acceptance-assets"), { recursive: true });
for (const output of result.outputFiles) await writeFile(output.path, output.contents);
const nextRequire = createRequire(require.resolve("@sentry/nextjs/package.json", { paths: [root] }));
const { createSentryBuildPluginManager } = nextRequire("@sentry/bundler-plugins/core");
const manager = createSentryBuildPluginManager(
  { telemetry: false, silent: true, release: { create: false, inject: false } },
  { buildTool: "esbuild", loggerPrefix: "local-profile-acceptance" },
);
// Official debug-ID injection only: no upload, release mutation or production connection.
await manager.injectDebugIds([resolve(root, ".next/profile-acceptance-assets")]);
const bundle = await readFile(resolve(root, ".next/profile-acceptance-assets/sentry-acceptance.js"), "utf8");
manifest.files["/sentry-acceptance.js"] = identifiers(bundle);
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/sentry-acceptance.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(bundle);
    }
    if (req.url === manifestPath) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(manifest));
    }
    if (req.url === "/received") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(received));
    }
    if (["/302", "/307"].includes(req.url)) {
      received.push({ trace: req.headers["sentry-trace"], baggage: req.headers.baggage });
      res.writeHead(Number(req.url.slice(1)), { Location: external });
      return res.end();
    }
    const upstream = await fetch(new URL(req.url, nextOrigin), { redirect: "manual" });
    for (const [key, value] of upstream.headers)
      if (!["content-length", "content-encoding", "transfer-encoding"].includes(key)) res.setHeader(key, value);
    res.statusCode = upstream.status;
    // Prevent external trackers and analytics from sending during local acceptance.
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${external}`,
    );
    if (upstream.headers.get("content-type")?.includes("text/html")) {
      return res.end(
        (await upstream.text()).replace("</head>", '<script src="/sentry-acceptance.js"></script></head>'),
      );
    }
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(500);
    res.end("Local acceptance proxy failed");
  }
});
server.listen(0, "127.0.0.1", () => console.log(`READY http://127.0.0.1:${server.address().port}/`));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close();
    receiver.close();
    server.closeAllConnections();
    receiver.closeAllConnections();
  });
