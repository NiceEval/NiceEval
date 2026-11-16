// Start a local browser acceptance fixture; no production route or ingestion calls.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const resolveDir = fileURLToPath(new URL("..", import.meta.url));
const entry = `
import * as Sentry from "@sentry/react";
import { sentryOptions, installEnvelopePrivacy } from "./lib/sentry";

const envelopes = [];
const sentinel = "SENTRY_BROWSER_PRIVATE_SENTINEL";
const mode = new URL(location.href).searchParams.get("mode");
if (mode === "off") {
  document.body.textContent = JSON.stringify({ client: !!Sentry.getClient(), status: !Sentry.getClient() ? "PASS" : "FAIL" });
} else {
  const client = Sentry.init({
    ...sentryOptions("https://public@example.invalid/1", "test", "site@acceptance"),
    tracesSampleRate: 1,
    integrations: defaults => defaults.filter(i => !["BrowserSession", "Breadcrumbs"].includes(i.name)),
    transport: () => ({ send: async envelope => { envelopes.push(envelope); return {statusCode:200}; }, flush: async () => true }),
  });
  installEnvelopePrivacy(client, "test", "site@acceptance");
  Sentry.setUser({ id: sentinel });
  Sentry.setContext("secret", { nested: { value: sentinel } });
  Sentry.setExtra("secret", { nested: { value: sentinel } });
  Sentry.startSpan({ name: sentinel, op: "navigation", attributes: { secret: sentinel } }, () => {
    Sentry.startSpan({ name: sentinel, op: "function", attributes: { "gen_ai.prompt": sentinel } }, () => Sentry.captureException(new Error(sentinel)));
  });
  setTimeout(() => { throw new Error(sentinel); }, 0);
  setTimeout(async () => {
    await Sentry.flush(3000);
    const items = envelopes.flatMap(e => e[1]);
    const errors = items.filter(i => i[0].type === "event");
    const spans = items.filter(i => i[0].type === "span").flatMap(i => i[1].items);
    const safe = !JSON.stringify(envelopes).includes(sentinel);
    const status = safe && errors.length >= 2 && spans.some(s => s.is_segment) && spans.some(s => !s.is_segment) ? "PASS" : "FAIL";
    document.body.textContent = JSON.stringify({status, safe, errors: errors.length, spans: spans.length});
    await Sentry.close(1000);
  }, 100);
}
`;
const result = await build({ stdin: { contents: entry, resolveDir, loader: "ts" }, bundle: true, platform: "browser", write: false, alias: { "@sentry/react": require.resolve("@sentry/react", { paths: [realpathSync(resolveDir + "/node_modules/@sentry/nextjs")] }) }, define: {
  "process.env.NODE_ENV": '"production"',
  "process.env.NEXT_PUBLIC_SENTRY_DSN": '""',
  "process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT": '""',
  "process.env.NEXT_PUBLIC_SENTRY_RELEASE": '""',
} });
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].contents);
  } else {
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><body>RUNNING<script src="/bundle.js"></script></body></html>');
  }
});
server.listen(0, "127.0.0.1", () => console.log(`READY http://127.0.0.1:${server.address().port}`));
