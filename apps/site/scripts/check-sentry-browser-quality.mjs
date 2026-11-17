// Small loopback fixture: actual Browser SDK, session integration and serialized fetch transport.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const received = [];
const sentinel = "SENTRY_BROWSER_QUALITY_PRIVATE_SENTINEL";
const entry = `
import * as Sentry from "@sentry/nextjs";
import {sentryOptions,privacyTransport,installEnvelopePrivacy} from "./lib/sentry";
import {siteOperation} from "./lib/sentry-operation";
const sentinel=${JSON.stringify(sentinel)};
const dsn="https://public@example.invalid/1";
const off=new URL(location.href).searchParams.has("off");
window.quality={off,client:false};
if (!off) {
 const client=Sentry.init({
  ...sentryOptions(dsn,"test","site@quality"), tracesSampleRate:0,
  integrations:defaults=>[...defaults.filter(i=>!["Breadcrumbs","BrowserSession"].includes(i.name)), Sentry.browserSessionIntegration()],
  transport:privacyTransport(opts=>Sentry.makeFetchTransport({...opts,url:location.origin+"/ingest"}),dsn,"test","site@quality"),
 });
 installEnvelopePrivacy(client,"test","site@quality");
 window.quality={
  client:true,
  async operation() { return siteOperation("site.install_guide.copy",async()=>42); },
  async handled() {
   Sentry.getGlobalScope().setAttributes({private:sentinel});
   Sentry.getIsolationScope().setAttributes({isolation:sentinel});
   Sentry.withScope(scope=>{scope.setAttributes({current:sentinel});Sentry.captureException(new Error(sentinel));});
   await Sentry.flush(2000);
  },
  unhandled() { setTimeout(function unhandledTest(){throw new Error(sentinel)},0); },
  async telemetry() {
   await Sentry.withScope(async scope=>{
    scope.setAttributes({scope:sentinel});
    await this.operation();
    try { await siteOperation("site.docs.open",async()=>{throw new Error(sentinel)}); } catch {}
    try { await siteOperation("site.install_guide.copy",async()=>{throw new DOMException(sentinel,"AbortError")}); } catch {}
    Sentry.logger.warn("operation.degraded",{private:sentinel,nested:{value:sentinel}});
    Sentry.logger.error(sentinel);
    client.recordDroppedEvent("queue_overflow","log_item",2);
   });
   await Sentry.flush(2000);
  },
  flush:()=>Sentry.flush(2000),
  report:()=>client.recordDroppedEvent("queue_overflow","log_item",2),
  async poison() {
   const session=Sentry.getIsolationScope().getSession();
   const raw=session.toJSON();
   await client.getTransport().send([{},[[{type:"session"},{...raw,did:sentinel,private:sentinel,attrs:{release:sentinel,environment:sentinel,user_agent:sentinel,ip_address:sentinel}}],[{type:"check_in"},{private:sentinel}],[{type:"replay_event"},{private:sentinel}]]]);
   await client.getTransport().send([{},[[{type:"session"},{...raw,started:raw.started+" ("+sentinel+")"}]]]);
  },
 };
}
`;
const built = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  platform: "browser",
  write: false,
  alias: {
    "@sentry/nextjs": require.resolve("@sentry/react", {
      paths: [realpathSync(`${root}/node_modules/@sentry/nextjs`)],
    }),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
function summary() {
  const items = received.flatMap((e) => e[1]);
  const sessions = items
    .filter(([h]) => h.type === "session")
    .map(([, s]) => ({ sid: s.sid, init: s.init, status: s.status, errors: s.errors }));
  const metrics = items.filter(([h]) => h.type === "trace_metric").flatMap(([, b]) => b.items);
  const logs = items.filter(([h]) => h.type === "log").flatMap(([, b]) => b.items);
  return {
    safe: !JSON.stringify(received).includes(sentinel),
    sessions,
    healthy: sessions.some((s) => s.init && s.status === "ok" && s.errors === 0),
    handled: sessions.some((s) => !s.init && s.status === "ok" && s.errors >= 1),
    unhandled: sessions.some((s) => !s.init && ["crashed", "unhandled"].includes(s.status) && s.errors >= 1),
    identityRemoved: items
      .filter(([h]) => h.type === "session")
      .every(([, s]) => !s.did && Object.keys(s.attrs).every((key) => ["release", "environment"].includes(key))),
    counts: metrics.filter((m) => m.name === "app.operation.count").length,
    durations: metrics.filter((m) => m.name === "app.operation.duration").length,
    outcomes: [...new Set(metrics.map((m) => m.attributes.outcome.value))].sort(),
    logs: logs.map((l) => ({ body: l.body, level: l.level })),
    clientReport: items.some(
      ([h, p]) =>
        h.type === "client_report" && p.discarded_events.some((e) => e.reason === "queue_overflow" && e.quantity >= 2),
    ),
    protocol: items.every(
      ([h, p]) =>
        !["log", "trace_metric"].includes(h.type) ||
        (p.version === 2 &&
          h.item_count === p.items.length &&
          p.ingest_settings.infer_ip === "never" &&
          p.ingest_settings.infer_user_agent === "never"),
    ),
    items: [...new Set(items.map(([h]) => h.type))].sort(),
  };
}
const server = createServer(async (req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(built.outputFiles[0].contents);
  }
  if (req.url === "/results") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(summary()));
  }
  if (req.url === "/ingest") {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const lines = Buffer.concat(buffers).toString("utf8").trim().split("\n");
    const header = JSON.parse(lines.shift());
    const items = [];
    while (lines.length) items.push([JSON.parse(lines.shift()), JSON.parse(lines.shift())]);
    received.push([header, items]);
    res.writeHead(200);
    return res.end("{}");
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><body>LOCAL QUALITY ACCEPTANCE<script src="/bundle.js"></script></body></html>');
});
server.listen(0, "127.0.0.1", () => console.log(`READY http://127.0.0.1:${server.address().port}/`));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
