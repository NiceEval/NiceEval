// 静态 HTML 查看器:读本地 summary.json,生成一个 Next.js evals 风格的实验榜单。

import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { EvalResult, RunSummary, Usage, Verdict } from "../types.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

interface LoadedSummary {
  path: string;
  summary: RunSummary;
}

interface LeaderboardRow {
  key: string;
  experimentId?: string;
  label: string;
  agent: string;
  model?: string;
  runs: number;
  passed: number;
  failed: number;
  scored: number;
  skipped: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
}

const VERDICT_ORDER: Record<Verdict, number> = {
  failed: 0,
  scored: 1,
  skipped: 2,
  passed: 3,
};

export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const summaries = await loadSummaries(opts.input);
  const out = resolve(opts.out ?? ".fastevals/report.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderHtml(summaries), "utf-8");
  return out;
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      if (url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const summaries = await loadSummaries(input);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(renderHtml(summaries));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(e instanceof Error ? e.stack ?? e.message : String(e));
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((err) => (err ? reject(err) : resolveClose()));
    }),
  };
}

async function listen(server: Server, preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolveListen, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolveListen(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  if (preferredPort === 0) return tryListen(0);
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    try {
      return await tryListen(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new Error(`No available port near ${preferredPort}`);
}

async function loadSummaries(input?: string): Promise<LoadedSummary[]> {
  const target = resolve(input ?? ".fastevals");
  if (!existsSync(target)) return [];
  const s = await stat(target);
  if (s.isFile()) return [{ path: target, summary: await readSummary(target) }];

  const candidates = await findSummaryFiles(target);
  const loaded: LoadedSummary[] = [];
  for (const path of candidates) {
    try {
      loaded.push({ path, summary: await readSummary(path) });
    } catch {
      // Ignore unrelated JSON files under .fastevals.
    }
  }
  loaded.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt));
  return loaded;
}

async function findSummaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries
    .filter((e) => e.isFile() && e.name === "summary.json")
    .map((e) => join(dir, e.name));
  const nested = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map((e) => findSummaryFiles(join(dir, e.name))),
  );
  return [...direct, ...nested.flat()];
}

async function readSummary(path: string): Promise<RunSummary> {
  const data = JSON.parse(await readFile(path, "utf-8")) as RunSummary;
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    throw new Error(`${path} is not a fastevals summary`);
  }
  return data;
}

function renderHtml(loaded: LoadedSummary[]): string {
  const latest = loaded[0]?.summary;
  const rows = aggregateRows(loaded);
  const totals = summarizeAll(loaded);
  const lastRun = latest ? formatDate(latest.startedAt) : "No runs yet";
  const sourceList = loaded.slice(0, 6).map((s) => relativeName(s.path)).join(", ");
  const rowsJson = JSON.stringify(rows).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fastevals experiment view</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: light-dark(#fafafa, #050505);
      --panel: light-dark(#ffffff, #0b0b0b);
      --panel-2: light-dark(#f4f4f5, #111111);
      --line: light-dark(#dedee2, #262626);
      --line-strong: light-dark(#c9c9cf, #343434);
      --text: light-dark(#111113, #ededed);
      --muted: light-dark(#62636a, #a1a1aa);
      --soft: light-dark(#8b8d98, #74747b);
      --good: light-dark(#087f5b, #3ddc97);
      --bad: light-dark(#b42318, #ff6b6b);
      --warn: light-dark(#9a6700, #e8b84a);
      --focus: light-dark(#111113, #ededed);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html {
      overflow-y: scroll;
      scrollbar-gutter: stable;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
    }
    a { color: inherit; }
    .topbar {
      height: 64px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 clamp(20px, 5vw, 80px);
      background: color-mix(in oklch, var(--bg), transparent 4%);
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(10px);
    }
    .brand {
      display: flex;
      align-items: baseline;
      gap: 12px;
      font-weight: 690;
      font-size: 20px;
    }
    .mark {
      width: 18px;
      height: 18px;
      border: 1.25px solid var(--text);
      transform: rotate(45deg);
      display: inline-block;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 22px;
      color: var(--muted);
      font-size: 14px;
    }
    .nav strong { color: var(--text); font-weight: 560; }
    main {
      width: min(1120px, calc(100vw - 40px));
      margin: 0 auto;
      padding: clamp(52px, 7vw, 82px) 0 72px;
    }
    .hero {
      text-align: center;
      max-width: 740px;
      margin: 0 auto clamp(38px, 6vw, 58px);
    }
    h1 {
      margin: 0;
      font-size: clamp(42px, 5.6vw, 66px);
      line-height: 0.94;
      font-weight: 760;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 20px auto 0;
      color: color-mix(in oklch, var(--muted), var(--text) 12%);
      font-size: clamp(17px, 2vw, 21px);
      line-height: 1.58;
      max-width: 660px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 14px;
      margin-top: 24px;
      color: var(--muted);
      font-size: 14px;
    }
    .meta b { color: var(--text); font-weight: 570; }
    .slash { color: var(--line-strong); }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      margin: 0 auto 36px;
      background: linear-gradient(
        180deg,
        color-mix(in oklch, var(--panel), var(--panel-2) 18%),
        var(--panel)
      );
      max-width: 100%;
    }
    .metric {
      padding: 14px 20px 15px;
      border-right: 1px solid var(--line);
      min-width: 0;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: baseline;
      column-gap: 12px;
    }
    .metric:last-child { border-right: 0; }
    .metric .label {
      color: var(--soft);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric .value {
      margin-top: 0;
      font-size: clamp(19px, 2vw, 24px);
      line-height: 1;
      font-weight: 680;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .section-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0;
      font-size: clamp(24px, 2.6vw, 31px);
      line-height: 1.1;
      font-weight: 720;
    }
    .controls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search {
      height: 36px;
      min-width: 240px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 0 12px;
      background: var(--panel);
      color: var(--text);
      outline: none;
    }
    .search:focus { border-color: var(--focus); }
    .table-wrap {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: auto;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 880px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 0 16px;
      height: 52px;
      text-align: left;
      vertical-align: middle;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-weight: 500;
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    th button {
      color: inherit;
      background: transparent;
      border: 0;
      padding: 0;
      cursor: pointer;
      font: inherit;
      height: 100%;
    }
    th button::after {
      content: "↕";
      margin-left: 6px;
      color: var(--soft);
      font-size: 11px;
    }
    tbody tr.main-row { cursor: pointer; }
    tbody tr.main-row:hover { background: color-mix(in oklch, var(--panel-2), var(--panel) 34%); }
    tbody tr.is-open { background: var(--panel-2); }
    tbody tr:last-child td { border-bottom: 0; }
    .chev {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-right: 1.5px solid var(--muted);
      border-bottom: 1.5px solid var(--muted);
      transform: rotate(-45deg);
      margin-right: 12px;
      transition: transform 160ms ease;
    }
    .is-open .chev { transform: rotate(45deg); }
    .name { font-weight: 610; }
    .sub { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .num {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      font-feature-settings: "tnum";
    }
    .good { color: var(--good); }
    .bad { color: var(--bad); }
    .warn { color: var(--warn); }
    .pill {
      display: inline-flex;
      align-items: center;
      height: 22px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .detail-cell {
      padding: 0;
      background: color-mix(in oklch, var(--panel-2), var(--panel) 24%);
    }
    .detail {
      padding: 20px 30px 24px;
      border-bottom: 1px solid var(--line);
    }
    .detail-kpis {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      border-bottom: 1px solid var(--line);
      margin: -2px 0 18px;
    }
    .detail-kpi {
      padding: 0 18px 16px 0;
      min-width: 0;
    }
    .detail-kpi span {
      display: block;
      color: var(--soft);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .detail-kpi b {
      display: block;
      margin-top: 7px;
      font-size: 18px;
      font-weight: 680;
      font-variant-numeric: tabular-nums;
    }
    .detail h3 {
      margin: 0 0 14px;
      font-size: 13px;
      color: var(--muted);
      font-weight: 580;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .eval-list {
      display: grid;
      max-height: 430px;
      overflow: auto;
      padding-right: 4px;
    }
    .eval-grid-head,
    .eval-item {
      display: grid;
      grid-template-columns: 76px minmax(220px, 1.1fr) minmax(260px, 1fr) 84px 86px 82px 54px;
      column-gap: 16px;
      align-items: baseline;
      padding: 11px 0;
      border-bottom: 1px solid color-mix(in oklch, var(--line), transparent 35%);
      font-size: 13px;
    }
    .eval-grid-head {
      position: sticky;
      top: 0;
      z-index: 1;
      background: color-mix(in oklch, var(--panel-2), var(--panel) 24%);
      color: var(--soft);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .eval-id {
      overflow-wrap: anywhere;
      font-weight: 560;
    }
    .assertions {
      color: color-mix(in oklch, var(--muted), var(--text) 6%);
      overflow-wrap: anywhere;
      line-height: 1.25;
    }
    .raw-details {
      margin-top: 16px;
      border-top: 1px solid color-mix(in oklch, var(--line), transparent 15%);
      padding-top: 14px;
      color: color-mix(in oklch, var(--muted), var(--text) 6%);
    }
    .raw-details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
      font-weight: 560;
      user-select: none;
    }
    .raw-details pre {
      margin-top: 12px;
    }
    .raw-note {
      margin-left: 8px;
      color: var(--soft);
      font-weight: 400;
    }
    .reason-empty {
      color: var(--soft);
    }
    pre {
      margin: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: color-mix(in oklch, var(--panel), black 8%);
      color: var(--muted);
      overflow-wrap: anywhere;
      overflow: auto;
      max-height: 360px;
      font-size: 12px;
      line-height: 1.5;
    }
    .empty {
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      padding: 40px 24px;
      color: var(--muted);
      text-align: center;
      background: var(--panel);
    }
    @media (max-width: 760px) {
      .topbar { padding: 0 20px; }
      .nav { display: none; }
      main { width: min(100vw - 28px, 1120px); padding-top: 42px; }
      .hero { text-align: left; margin-left: 0; }
      .meta { justify-content: flex-start; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric { grid-template-columns: 1fr; row-gap: 8px; }
      .metric:nth-child(2) { border-right: 0; }
      .metric:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
      .section-head { align-items: stretch; flex-direction: column; }
      .search { width: 100%; min-width: 0; }
      .detail { padding: 18px 16px 20px; }
      .detail-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 10px; }
      .eval-grid-head,
      .eval-item { grid-template-columns: 72px minmax(180px, 1fr) minmax(220px, 1fr) 76px 78px 72px 50px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="mark"></span><span>fastevals</span></div>
    <nav class="nav" aria-label="Report">
      <strong>Experiments</strong>
      <span>Runs</span>
      <span>Traces</span>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>Eval Run Results</h1>
      <p class="subtitle">Local experiment results for coding agents, comparing pass rate, execution time, token usage, and estimated cost.</p>
      <div class="meta">
        <span><b>Last run:</b> ${escapeHtml(lastRun)}</span>
        <span class="slash">/</span>
        <span><b>Sources:</b> ${escapeHtml(sourceList || ".fastevals")}</span>
      </div>
    </section>

    <section class="summary" aria-label="Run summary">
      <div class="metric"><div class="label">Pass Rate</div><div class="value">${formatPercent(totals.passRate)}</div></div>
      <div class="metric"><div class="label">Eval Results</div><div class="value">${totals.results}</div></div>
      <div class="metric"><div class="label">Duration</div><div class="value">${formatDuration(totals.durationMs)}</div></div>
      <div class="metric"><div class="label">Estimated Cost</div><div class="value">${formatCost(totals.cost)}</div></div>
    </section>

    <section>
      <div class="section-head">
        <h2>Experiment Performance Results</h2>
        <div class="controls">
          <input id="search" class="search" type="search" placeholder="Filter experiment, agent, model, or eval..." autocomplete="off">
        </div>
      </div>
      ${rows.length ? renderTable(rows) : `<div class="empty">No summary.json files found. Run <code>fastevals</code> or pass <code>fastevals view path/to/summary.json</code>.</div>`}
    </section>
  </main>
  <script>
    const rows = ${rowsJson};
    const state = { sort: "passRate", dir: -1, query: "", open: new Set() };
    const tbody = document.querySelector("#results-body");
    const search = document.querySelector("#search");

    function render() {
      if (!tbody) return;
      const q = state.query.trim().toLowerCase();
      const filtered = rows.filter(row => {
        if (!q) return true;
        return [row.label, row.experimentId || "", row.agent, row.model || "", ...row.results.map(r => r.id)].join(" ").toLowerCase().includes(q);
      });
      filtered.sort((a, b) => compareRows(a, b, state.sort) * state.dir);
      tbody.innerHTML = filtered.map(row => renderRow(row)).join("");
    }

    function compareRows(a, b, key) {
      const av = valueFor(a, key);
      const bv = valueFor(b, key);
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
      return Number(av) - Number(bv);
    }

    function valueFor(row, key) {
      if (key === "experiment") return row.label;
      if (key === "agent") return row.agent;
      if (key === "cost") return row.estimatedCostUSD || 0;
      return row[key] || 0;
    }

    function renderRow(row) {
      const open = state.open.has(row.key);
      const tone = row.passRate >= 0.8 ? "good" : row.passRate >= 0.5 ? "warn" : "bad";
      return \`
        <tr class="main-row \${open ? "is-open" : ""}" data-key="\${escapeAttr(row.key)}" tabindex="0">
          <td><span class="chev"></span><span class="name">\${escapeHtml(row.label)}</span><div class="sub">\${escapeHtml(row.model ? row.model + " · " : "")}\${row.runs} eval result\${row.runs === 1 ? "" : "s"}</div></td>
          <td>\${escapeHtml(row.agent)}</td>
          <td class="num">\${formatDuration(row.avgDurationMs)}</td>
          <td class="num \${tone}">\${formatPercent(row.passRate)}</td>
          <td class="num">\${formatTokens(totalTokens(row.usage))}</td>
          <td class="num">\${formatCost(row.estimatedCostUSD)}</td>
          <td><span class="pill">\${row.passed} passed / \${row.failed} failed</span></td>
        </tr>
        \${open ? renderDetail(row) : ""}
      \`;
    }

    function renderDetail(row) {
      const totalDuration = row.results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
      const sampleResult = row.results.find(r => r.verdict === "failed") || row.results[0] || {};
      const details = row.results
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt)
        .map(r => {
          const bad = (r.assertions || []).filter(a => !a.passed).map(a => a.name).join(", ");
          const statusClass = r.verdict === "passed" ? "good" : r.verdict === "failed" ? "bad" : "warn";
          const reason = r.error || bad;
          return \`<div class="eval-item"><span class="\${statusClass}">\${r.verdict}</span><span class="eval-id">\${escapeHtml(r.id)}</span><span class="assertions">\${reason ? escapeHtml(reason) : '<span class="reason-empty">all assertions passed</span>'}</span><span class="num">\${formatDuration(r.durationMs)}</span><span class="num">\${formatTokens(totalTokens(r.usage))}</span><span class="num">\${formatCost(r.estimatedCostUSD)}</span><span class="num">#\${r.attempt}</span></div>\`;
        }).join("");
      const sample = JSON.stringify(sampleResult, null, 2);
      return \`
        <tr class="detail-row">
          <td class="detail-cell" colspan="7">
            <div class="detail">
              <div class="detail-kpis">
                <div class="detail-kpi"><span>Attempts</span><b>\${row.runs}</b></div>
                <div class="detail-kpi"><span>Passed</span><b class="good">\${row.passed}</b></div>
                <div class="detail-kpi"><span>Failed</span><b class="\${row.failed ? 'bad' : ''}">\${row.failed}</b></div>
                <div class="detail-kpi"><span>Total Time</span><b>\${formatDuration(totalDuration)}</b></div>
                <div class="detail-kpi"><span>Total Cost</span><b>\${formatCost(row.estimatedCostUSD)}</b></div>
              </div>
              <h3>Evaluation Attempts</h3>
              <div class="eval-list"><div class="eval-grid-head"><span>Status</span><span>Eval</span><span>Reason</span><span>Time</span><span>Tokens</span><span>Cost</span><span>Run</span></div>\${details}</div>
              <details class="raw-details">
                <summary>Raw sample result <span class="raw-note">debug JSON, defaults to first failure when available</span></summary>
                <pre>\${escapeHtml(sample)}</pre>
              </details>
            </div>
          </td>
        </tr>
      \`;
    }

    function totalTokens(usage) {
      return (usage?.inputTokens || 0) + (usage?.outputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
    }
    function formatPercent(v) { return Math.round(v * 100) + "%"; }
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return "0ms";
      if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
      if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
      return Math.round(ms) + "ms";
    }
    function formatTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return "0";
      if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
      if (n >= 1000) return (n / 1000).toFixed(1) + "k";
      return String(Math.round(n));
    }
    function formatCost(n) {
      if (!Number.isFinite(n) || n <= 0) return "$0";
      return "$" + n.toFixed(n < 1 ? 3 : 2);
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function escapeAttr(value) { return escapeHtml(value); }

    document.addEventListener("click", event => {
      const sort = event.target.closest("[data-sort]");
      if (sort) {
        const key = sort.dataset.sort;
        if (state.sort === key) state.dir *= -1;
        else { state.sort = key; state.dir = key === "experiment" || key === "agent" ? 1 : -1; }
        render();
        return;
      }
      const row = event.target.closest(".main-row");
      if (!row) return;
      const key = row.dataset.key;
      if (state.open.has(key)) state.open.delete(key);
      else state.open.add(key);
      render();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest(".main-row");
      if (!row) return;
      event.preventDefault();
      row.click();
    });
    search?.addEventListener("input", event => {
      state.query = event.target.value;
      render();
    });
    render();
  </script>
</body>
</html>`;
}

function renderTable(rows: LeaderboardRow[]): string {
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th><button data-sort="experiment">Experiment</button></th>
          <th><button data-sort="agent">Agent</button></th>
          <th><button data-sort="avgDurationMs">Avg Duration</button></th>
          <th><button data-sort="passRate">Success Rate</button></th>
          <th><button data-sort="tokens">Tokens</button></th>
          <th><button data-sort="cost">Est. Cost</button></th>
          <th>Verdicts</th>
        </tr>
      </thead>
      <tbody id="results-body"></tbody>
    </table>
  </div>`;
}

function aggregateRows(loaded: LoadedSummary[]): LeaderboardRow[] {
  const groups = new Map<string, EvalResult[]>();
  for (const item of loaded) {
    for (const result of item.summary.results) {
      const key = result.experimentId
        ? `exp|||${result.experimentId}`
        : `legacy|||${result.agent}|||${result.model ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), result]);
    }
  }

  return Array.from(groups.entries()).map(([key, results]) => {
    const first = results[0]!;
    const experimentId = first.experimentId;
    const agent = first.agent;
    const modelRaw = first.model;
    const label = experimentId ?? fallbackExperimentLabel(first);
    const usage = sumUsage(results.map((r) => r.usage));
    const passed = results.filter((r) => r.verdict === "passed").length;
    const failed = results.filter((r) => r.verdict === "failed").length;
    const scored = results.filter((r) => r.verdict === "scored").length;
    const skipped = results.filter((r) => r.verdict === "skipped").length;
    const cost = sumMaybe(results.map((r) => r.estimatedCostUSD));
    const sorted = results
      .slice()
      .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id));
    return {
      key,
      experimentId,
      label,
      agent,
      model: modelRaw || undefined,
      runs: results.length,
      passed,
      failed,
      scored,
      skipped,
      passRate: results.length ? passed / results.length : 0,
      avgDurationMs: avg(results.map((r) => r.durationMs)),
      usage,
      estimatedCostUSD: cost,
      results: sorted,
    };
  });
}

function fallbackExperimentLabel(result: EvalResult): string {
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
}

function summarizeAll(loaded: LoadedSummary[]) {
  const results = loaded.flatMap((s) => s.summary.results);
  const passed = results.filter((r) => r.verdict === "passed").length;
  return {
    results: results.length,
    passRate: results.length ? passed / results.length : 0,
    durationMs: loaded.reduce((sum, s) => sum + (s.summary.durationMs ?? 0), 0),
    cost: sumMaybe(loaded.map((s) => s.summary.estimatedCostUSD)),
  };
}

function sumUsage(items: Array<Usage | undefined>): Usage {
  return {
    inputTokens: items.reduce((n, u) => n + (u?.inputTokens ?? 0), 0),
    outputTokens: items.reduce((n, u) => n + (u?.outputTokens ?? 0), 0),
    cacheReadTokens: items.reduce((n, u) => n + (u?.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: items.reduce((n, u) => n + (u?.cacheWriteTokens ?? 0), 0),
    requests: items.reduce((n, u) => n + (u?.requests ?? 0), 0),
  };
}

function sumMaybe(items: Array<number | undefined>): number | undefined {
  const known = items.filter((n): n is number => n !== undefined);
  if (!known.length) return undefined;
  return known.reduce((sum, n) => sum + n, 0);
}

function avg(items: number[]): number {
  return items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatCost(n: number | undefined): string {
  if (n === undefined || n <= 0) return "$0";
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function relativeName(path: string): string {
  const dir = basename(dirname(path));
  return extname(dir) ? basename(path) : `${dir}/${basename(path)}`;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}
