// Local browser acceptance fixture using real Browser SDK, Chromium and loopback HTTP ingestion.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const resolveDir = fileURLToPath(new URL("..", import.meta.url));
const sentinel = "SENTRY_BROWSER_PRIVATE_SENTINEL";
const dsn = "https://public@example.invalid/1";
const verifyMode = process.argv.includes("--verify");

const entry = `
import * as Sentry from "@sentry/nextjs";
import { sentryOptions, privacyTransport, installEnvelopePrivacy } from "./lib/sentry";
import { siteOperation } from "./lib/sentry-operation";

const sentinel = ${JSON.stringify(sentinel)};
const dsn = ${JSON.stringify(dsn)};
const params = new URL(location.href).searchParams;
const mode = params.get("mode") || "sampled";

window.__acceptance = { done: false, client: false, parentSpanIsAlwaysRootSpan: null };

if (mode === "off") {
  window.__acceptance = { done: true, client: !!Sentry.getClient(), parentSpanIsAlwaysRootSpan: null };
  document.body.textContent = JSON.stringify(window.__acceptance);
} else {
  const tracesSampleRate = mode === "unsampled" ? 0 : 1;
  const client = Sentry.init({
    ...sentryOptions(dsn, "test", "site@acceptance"),
    parentSpanIsAlwaysRootSpan: false,
    tracesSampleRate,
    tracePropagationTargets: [],
    integrations: (defaults) => [
      ...defaults.filter((i) => !["BrowserSession", "Breadcrumbs", "BrowserTracing"].includes(i.name)),
      Sentry.browserTracingIntegration({ traceXHR: false }),
      Sentry.browserSessionIntegration(),
    ],
    transport: privacyTransport(
      (options) => Sentry.makeFetchTransport({ ...options, url: location.origin + "/ingest" }),
      dsn,
      "test",
      "site@acceptance",
    ),
  });
  installEnvelopePrivacy(client, "test", "site@acceptance");
  Sentry.setUser({ id: sentinel });
  Sentry.setContext("secret", { nested: { value: sentinel } });
  Sentry.setExtra("secret", { nested: { value: sentinel } });

  const overlap = { actions: {}, http: {}, completed: [], after: null };
  client.on("beforeOutgoingRequestSpan", (span, hint) => {
    const url = hint.input[0];
    if (typeof url === "string" && url.includes("overlap=")) {
      overlap.http[new URL(url, location.origin).searchParams.get("overlap")] = span.spanContext().spanId;
    }
  });
  (async () => {
    try {
      // Capture error during real active pageload span.
      Sentry.captureException(new Error("pageload-err " + sentinel));

      // Execute docs & copy operations with child HTTP calls while real pageload root span is active.
      await siteOperation("site.docs.open", async () => {
        Sentry.captureException(new Error("docs-err " + sentinel));
        await fetch("/INIT.md?secret=" + sentinel);
      });

      await siteOperation("site.install_guide.copy", async () => {
        await fetch("/" + sentinel + "?token=" + sentinel);
      });

      // Direct static route fetch under pageload.
      await fetch("/blog?secret=" + sentinel);

      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const first = siteOperation("site.docs.open", async context => {
        overlap.actions.first = Sentry.getActiveSpan().spanContext().spanId;
        await delay(10);
        const request = () => fetch("/INIT.md?overlap=first");
        await (await (context ? context.run(request) : request())).text();
        await delay(100);
        overlap.completed.push("first");
      });
      const second = siteOperation("site.install_guide.copy", async context => {
        overlap.actions.second = Sentry.getActiveSpan().spanContext().spanId;
        await delay(40);
        const request = () => fetch("/INIT.md?overlap=second");
        await (await (context ? context.run(request) : request())).text();
        overlap.completed.push("second");
      });
      await Promise.all([first, second]);
      overlap.after = Sentry.getActiveSpan()?.spanContext().spanId;

      // XHR must not inject trace headers.
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/INIT.md?xhr=" + sentinel);
        xhr.onload = resolve;
        xhr.onerror = reject;
        xhr.send();
      });

      // Wait for pageload idle span to finish, then trigger an unhandled error outside any active span.
      await new Promise((resolve) => setTimeout(resolve, 1300));
      setTimeout(() => {
        throw new Error("unhandled " + sentinel);
      }, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await Sentry.flush(3000);
      window.__acceptance = {
        done: true,
        overlap,
        client: !!Sentry.getClient(),
        parentSpanIsAlwaysRootSpan: Sentry.getClient()?.getOptions().parentSpanIsAlwaysRootSpan ?? null,
      };
      document.body.textContent = JSON.stringify(window.__acceptance);
    } finally {
      await Sentry.close(1000);
    }
  })();
}
`;

const result = await build({
  stdin: { contents: entry, resolveDir, loader: "ts" },
  bundle: true,
  platform: "browser",
  write: false,
  alias: {
    "@sentry/nextjs": require.resolve("@sentry/react", {
      paths: [realpathSync(`${resolveDir}/node_modules/@sentry/nextjs`)],
    }),
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_SENTRY_DSN": '""',
    "process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT": '""',
    "process.env.NEXT_PUBLIC_SENTRY_RELEASE": '""',
  },
});

const state = {
  envelopes: [],
  outboundRequests: [],
};

function resetState() {
  state.envelopes.length = 0;
  state.outboundRequests.length = 0;
}

const server = createServer(async (req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(result.outputFiles[0].contents);
  }
  if (req.url === "/ingest") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").filter(Boolean);
    const header = JSON.parse(lines.shift());
    const items = [];
    while (lines.length) items.push([JSON.parse(lines.shift()), JSON.parse(lines.shift())]);
    state.envelopes.push([header, items]);
    res.writeHead(200);
    return res.end("{}");
  }
  if (req.url === "/results") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(state));
  }
  if (req.url?.startsWith("/INIT.md") || req.url?.startsWith("/blog") || req.url?.includes(sentinel)) {
    state.outboundRequests.push({
      url: req.url,
      sentryTrace: req.headers["sentry-trace"] ?? null,
      baggage: req.headers.baggage ?? null,
    });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><body>RUNNING<script src="/bundle.js"></script></body></html>');
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

if (!verifyMode) {
  console.log(`READY ${origin}`);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. mode=off must not initialize SDK or emit envelopes.
    resetState();
    const offPage = await browser.newPage();
    await offPage.goto(`${origin}/?mode=off`);
    await offPage.waitForFunction(() => window.__acceptance?.done === true);
    const offStatus = await offPage.evaluate(() => window.__acceptance);
    assert.equal(offStatus.client, false, "mode=off must not create client");
    assert.equal(state.envelopes.length, 0, "mode=off must not emit envelopes");
    await offPage.close();

    // 2. mode=unsampled must emit 0 spans while preserving operation metrics.
    resetState();
    const unsampledPage = await browser.newPage();
    unsampledPage.on("pageerror", () => {});
    await unsampledPage.goto(`${origin}/?mode=unsampled`);
    await unsampledPage.waitForFunction(() => window.__acceptance?.done === true, null, { timeout: 15000 });
    const unsampledItems = state.envelopes.flatMap((e) => e[1]);
    const unsampledSpans = unsampledItems.filter(([h]) => h.type === "span");
    const unsampledMetrics = unsampledItems.filter(([h]) => h.type === "trace_metric").flatMap(([, b]) => b.items);
    assert.equal(unsampledSpans.length, 0, "tracesSampleRate=0 must not emit spans");
    assert.equal(
      unsampledMetrics.filter((m) => m.name === "app.operation.count").length,
      4,
      "all four independent operations must count once when trace sampling is 0",
    );
    assert.equal(unsampledMetrics.filter((m) => m.name === "app.operation.duration").length, 4);
    await unsampledPage.close();

    // 3. mode=sampled: real pageload -> siteOperation -> http.client parent/child, static routes, error trace op, sentinels.
    resetState();
    const page = await browser.newPage();
    page.on("pageerror", () => {});
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.__acceptance?.done === true, null, { timeout: 15000 });
    const status = await page.evaluate(() => window.__acceptance);
    assert.equal(status.client, true);
    assert.equal(status.parentSpanIsAlwaysRootSpan, false);

    assert.ok(!JSON.stringify(state.envelopes).includes(sentinel), "sentinel leaked in browser wire envelopes");
    assert.ok(
      state.outboundRequests.length >= 4 &&
        state.outboundRequests.every((r) => r.sentryTrace === null && r.baggage === null),
      "browser fetch/XHR must never attach sentry-trace or baggage headers",
    );

    const items = state.envelopes.flatMap((e) => e[1]);
    const spans = items.filter(([h]) => h.type === "span").flatMap(([, b]) => b.items);
    const events = items.filter(([h]) => h.type === "event").map(([, payload]) => payload);

    const pageload = spans.find((s) => s.attributes["sentry.op"]?.value === "pageload");
    assert.ok(pageload, "real browser pageload span missing");
    assert.equal(pageload.name, "site.page.load");
    assert.equal(pageload.is_segment, true);

    assert.deepEqual(status.overlap.completed, ["second", "first"]);
    for (const flow of ["first", "second"]) {
      const http = spans.find((s) => s.span_id === status.overlap.http[flow]);
      assert.ok(http, `overlapping ${flow} HTTP span missing`);
      assert.equal(
        http.parent_span_id,
        status.overlap.actions[flow],
        `overlapping ${flow} request borrowed another operation`,
      );
      const action = spans.find((s) => s.span_id === status.overlap.actions[flow]);
      assert.equal(action.parent_span_id, pageload.span_id, `overlapping ${flow} operation borrowed another operation`);
    }
    assert.equal(status.overlap.after, pageload.span_id, "completed operations left active scope");

    const docsSpan = spans.find((s) => s.name === "site.docs.open" && s.attributes["sentry.op"]?.value === "ui.action");
    const copySpan = spans.find(
      (s) => s.name === "site.install_guide.copy" && s.attributes["sentry.op"]?.value === "ui.action",
    );
    assert.ok(docsSpan && copySpan, "site.docs.open and site.install_guide.copy spans missing");
    assert.equal(docsSpan.parent_span_id, pageload.span_id, "docs operation must be child of pageload");
    assert.equal(copySpan.parent_span_id, pageload.span_id, "copy operation must be child of pageload");

    const docsHttpChild = spans.find(
      (s) =>
        s.attributes["sentry.op"]?.value === "http.client" &&
        s.parent_span_id === docsSpan.span_id &&
        s.name === "site.docs.open",
    );
    const copyUnknownHttpChild = spans.find(
      (s) =>
        s.attributes["sentry.op"]?.value === "http.client" &&
        s.parent_span_id === copySpan.span_id &&
        s.name === "http.client",
    );
    const pageloadBlogHttpChild = spans.find(
      (s) =>
        s.attributes["sentry.op"]?.value === "http.client" &&
        s.parent_span_id === pageload.span_id &&
        s.name === "site.page.load",
    );
    assert.ok(
      docsHttpChild,
      "http.client under site.docs.open must have docsSpan as parent (not promoted to pageload) and map /INIT.md to site.docs.open",
    );
    assert.ok(
      copyUnknownHttpChild,
      "http.client under site.install_guide.copy must have copySpan as parent and fallback unknown path to http.client",
    );
    assert.ok(
      pageloadBlogHttpChild,
      "direct /blog fetch under pageload must map to site.page.load with http.client op",
    );

    const errorOps = new Set(events.map((e) => e.contexts?.trace?.op));
    assert.ok(errorOps.has("pageload"), "browser error during pageload must preserve op=pageload");
    assert.ok(errorOps.has("ui.action"), "browser error during siteOperation must preserve op=ui.action");
    assert.ok(!errorOps.has("http.server"), "browser error must never fabricate contexts.trace.op=http.server");
    assert.ok(events.length >= 3, "expected pageload, ui.action, and unhandled errors");

    console.log(
      `PASS browser real Chromium: ${spans.length} spans (pageload -> docs/copy -> http.client parent/child), ${events.length} errors (ops: ${[...errorOps].map((v) => v ?? "none").join(",")}), unsampled=0/off gates, zero sentinel/header leak`,
    );
    await page.close();
  } finally {
    await browser.close();
    server.close();
    server.closeAllConnections();
  }
}
