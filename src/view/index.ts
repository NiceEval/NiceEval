// 本地结果查看器:读 summary.json,按 experiment 聚合,注入 HTML 模板。

import { existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
  experiment?: EvalResult["experiment"];
  group?: string;
  label: string;
  agent: string;
  model?: string;
  runs: number;
  passed: number;
  failed: number;
  errored: number;
  scored: number;
  skipped: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  /** 该实验组里最新一次 run 的 startedAt(ISO);详情展示「运行时间」。 */
  lastRunAt?: string;
  results: EvalResult[];
}

const VERDICT_ORDER: Record<Verdict, number> = {
  failed: 0,
  scored: 1,
  skipped: 2,
  passed: 3,
};

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __FASTEVAL_STYLES__ -->",
  appCode: "__FASTEVAL_APP_CODE__",
  viewData: "__FASTEVAL_VIEW_DATA_JSON__",
} as const;

export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const summaries = await loadSummaries(opts.input);
  const out = resolve(opts.out ?? ".fasteval/report.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderHtml(summaries), "utf-8");
  return out;
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  const root = viewRoot(input);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      // 按需提供拆分工件(trace.json / events.json / …),前端展开时 fetch。
      if (url.pathname === "/artifact") {
        await serveArtifact(root, url.searchParams.get("p") ?? "", res);
        return;
      }
      if (url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(await renderHtml(await loadSummaries(input)));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(e instanceof Error ? e.stack ?? e.message : String(e));
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

/** 安全地把 root 下的工件文件吐回去(限定 .json,且解析后必须仍在 root 内)。 */
async function serveArtifact(
  root: string,
  rel: string,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const abs = resolve(root, rel);
  const within = abs === root || abs.startsWith(root + "/");
  if (!within || !rel.endsWith(".json")) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad artifact path");
    return;
  }
  try {
    const body = await readFile(abs, "utf-8");
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("artifact not found");
  }
}

async function renderHtml(loaded: LoadedSummary[]): Promise<string> {
  const latest = loaded[0]?.summary;
  const rows = aggregateRows(loaded);
  const totals = summarizeAll(loaded);
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");
  const viewData = {
    rows,
    lastRun: latest ? formatDate(latest.startedAt) : "No runs yet",
    passRate: formatPercent(totals.passRate),
    resultCount: String(totals.results),
    duration: formatDuration(totals.durationMs),
    cost: formatCost(totals.cost),
  };

  return template
    .replace(TEMPLATE_PLACEHOLDERS.styles, () => `<style>\n${styles}\n</style>`)
    .replace(TEMPLATE_PLACEHOLDERS.viewData, () => JSON.stringify(viewData).replace(/</g, "\\u003c"))
    .replace(TEMPLATE_PLACEHOLDERS.appCode, () => JSON.stringify(app).replace(/</g, "\\u003c"));
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
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

/** 服务/解析工件的根目录:输入是目录就用它,是文件就用其所在目录。 */
function viewRoot(input?: string): string {
  const t = resolve(input ?? ".fasteval");
  try {
    return statSync(t).isFile() ? dirname(t) : t;
  } catch {
    return t;
  }
}

async function loadSummaries(input?: string): Promise<LoadedSummary[]> {
  const target = resolve(input ?? ".fasteval");
  if (!existsSync(target)) return [];
  const root = viewRoot(input);
  const s = await stat(target);
  if (s.isFile()) {
    const summary = await readSummary(target);
    attachArtifactBase(summary, target, root);
    return [{ path: target, summary }];
  }

  const candidates = await findSummaryFiles(target);
  const loaded: LoadedSummary[] = [];
  for (const path of candidates) {
    try {
      const summary = await readSummary(path);
      attachArtifactBase(summary, path, root);
      loaded.push({ path, summary });
    } catch {
      // Ignore unrelated JSON files under .fasteval.
    }
  }
  loaded.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt));
  return loaded;
}

/** 给每条 result 拼出相对 view 根的工件目录(前端据此 fetch trace.json 等)。 */
function attachArtifactBase(summary: RunSummary, summaryPath: string, root: string): void {
  const runDir = dirname(summaryPath);
  for (const r of summary.results) {
    if (!r.artifactsDir) continue;
    const abs = join(runDir, r.artifactsDir);
    r.artifactBase = relative(root, abs).split(/[\\/]/).join("/");
    r.artifactAbsBase = abs;
  }
}

async function findSummaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries.filter((e) => e.isFile() && e.name === "summary.json").map((e) => join(dir, e.name));
  const nested = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => findSummaryFiles(join(dir, e.name))));
  return [...direct, ...nested.flat()];
}

async function readSummary(path: string): Promise<RunSummary> {
  const data = JSON.parse(await readFile(path, "utf-8")) as RunSummary;
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    throw new Error(`${path} is not a fasteval summary`);
  }
  return data;
}

function aggregateRows(loaded: LoadedSummary[]): LeaderboardRow[] {
  const groups = new Map<string, EvalResult[]>();
  const lastRunAt = new Map<string, string>();
  for (const item of loaded) {
    for (const result of item.summary.results) {
      const key = result.experimentId ? `exp|||${result.experimentId}` : `legacy|||${result.agent}|||${result.model ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), result]);
      const prev = lastRunAt.get(key);
      if (!prev || item.summary.startedAt > prev) lastRunAt.set(key, item.summary.startedAt);
    }
  }

  return Array.from(groups.entries()).map(([key, results]) => {
    const first = results[0]!;
    const experimentId = first.experimentId;
    const cost = sumMaybe(results.map((r) => r.estimatedCostUSD));
    return {
      key,
      experimentId,
      experiment: first.experiment,
      group: experimentGroup(experimentId),
      label: displayExperimentName(experimentId) ?? fallbackExperimentLabel(first),
      agent: first.agent,
      model: first.model,
      lastRunAt: lastRunAt.get(key),
      runs: results.length,
      passed: results.filter((r) => resultOutcome(r) === "passed").length,
      failed: results.filter((r) => resultOutcome(r) === "failed").length,
      errored: results.filter((r) => resultOutcome(r) === "errored").length,
      scored: results.filter((r) => resultOutcome(r) === "scored").length,
      skipped: results.filter((r) => resultOutcome(r) === "skipped").length,
      passRate: results.length ? results.filter((r) => r.verdict === "passed").length / results.length : 0,
      avgDurationMs: avg(results.map((r) => r.durationMs)),
      usage: sumUsage(results.map((r) => r.usage)),
      estimatedCostUSD: cost,
      results: results
        .slice()
        .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id)),
    };
  });
}

function resultOutcome(result: EvalResult): EvalResult["outcome"] {
  return result.outcome ?? (result.error !== undefined ? "errored" : result.verdict);
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
  return known.length ? known.reduce((sum, n) => sum + n, 0) : undefined;
}

function avg(items: number[]): number {
  return items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0;
}

function displayExperimentName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split("/").filter(Boolean).at(-1) ?? id;
}

function experimentGroup(id: string | undefined): string | undefined {
  if (!id || !id.includes("/")) return undefined;
  return id.split("/").slice(0, -1).join("/");
}

function fallbackExperimentLabel(result: EvalResult): string {
  if (result.experiment?.id) return displayExperimentName(result.experiment.id) ?? result.experiment.id;
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
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
