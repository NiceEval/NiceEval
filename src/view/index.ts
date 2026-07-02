// 本地结果查看器:读 summary.json,按 experiment 聚合,注入 HTML 模板。

import { existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type RunSummary, type Usage } from "../types.ts";
import { t } from "../i18n/index.ts";

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

/** schemaVersion 与当前 CLI 不同、按设计直接不兼容的 run;只占位提示,不解析内容。 */
export interface IncompatibleRun {
  /** run 目录(summary.json 所在目录),相对 cwd;直接可拼进 npx 命令。 */
  dir: string;
  schemaVersion: number;
  producerVersion?: string;
}

/** 用能读这份报告的 niceeval 版本查看的命令。 */
export function incompatibleViewCommand(run: IncompatibleRun): string {
  return `npx niceeval@${run.producerVersion ?? "<version>"} view ${run.dir}`;
}

/** 版本不匹配的完整提示文案;CLI 单文件模式和目录扫描占位共用。 */
export function incompatibleHint(run: IncompatibleRun): string {
  return t("cli.view.incompatible", {
    dir: run.dir,
    producer: run.producerVersion ?? "?",
    schemaVersion: run.schemaVersion,
    supported: RESULTS_SCHEMA_VERSION,
    command: incompatibleViewCommand(run),
  });
}

/** 单文件模式读到版本不同的 summary 时抛出;CLI 捕获后打印提示退出,不当成普通错误堆栈。 */
export class IncompatibleResultsError extends Error {
  constructor(readonly run: IncompatibleRun) {
    super(incompatibleHint(run));
    this.name = "IncompatibleResultsError";
  }
}

interface ScanResult {
  loaded: LoadedSummary[];
  incompatible: IncompatibleRun[];
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
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  /** 该实验组里最新一次 run 的 startedAt(ISO);详情展示「运行时间」。 */
  lastRunAt?: string;
  results: EvalResult[];
}

const OUTCOME_ORDER: Record<EvalResult["outcome"], number> = {
  errored: 0,
  failed: 0,
  skipped: 1,
  passed: 2,
};

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __NICEEVAL_STYLES__ -->",
  appCode: "__NICEEVAL_APP_CODE__",
  viewData: "__NICEEVAL_VIEW_DATA_JSON__",
} as const;

/** 读最近一次运行的所有 EvalResult，供 --resume 跳过已通过的 eval。 */
export async function loadMostRecentResults(root = ".niceeval"): Promise<EvalResult[]> {
  const { loaded } = await loadSummaries(root);
  // loadSummaries 已按 startedAt 降序，第一个是最新的
  return loaded[0]?.summary.results ?? [];
}

export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const scan = await loadSummaries(opts.input);
  const out = resolve(opts.out ?? ".niceeval/report.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderHtml(scan), "utf-8");
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

async function renderHtml(scan: ScanResult): Promise<string> {
  const { loaded, incompatible } = scan;
  const latest = loaded[0]?.summary;
  const rows = aggregateRows(loaded);
  const totals = summarizeAll(loaded);
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");
  const viewData = {
    rows,
    name: latest?.name,
    lastRun: latest ? formatDate(latest.startedAt) : "No runs yet",
    passRate: formatPercent(totals.passRate),
    resultCount: String(totals.results),
    duration: formatDuration(totals.durationMs),
    cost: formatCost(totals.cost),
    incompatibleRuns: incompatible.map((run) => ({
      dir: run.dir,
      schemaVersion: run.schemaVersion,
      producerVersion: run.producerVersion,
      command: incompatibleViewCommand(run),
    })),
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
  const t = resolve(input ?? ".niceeval");
  try {
    return statSync(t).isFile() ? dirname(t) : t;
  } catch {
    return t;
  }
}

async function loadSummaries(input?: string): Promise<ScanResult> {
  const target = resolve(input ?? ".niceeval");
  if (!existsSync(target)) return { loaded: [], incompatible: [] };
  const root = viewRoot(input);
  const s = await stat(target);
  if (s.isFile()) {
    // 单文件模式:版本不同直接抛 IncompatibleResultsError,由 CLI 打印提示退出。
    const summary = await readSummary(target);
    attachArtifactBase(summary, target, root);
    return { loaded: [{ path: target, summary }], incompatible: [] };
  }

  const candidates = await findSummaryFiles(target);
  const loaded: LoadedSummary[] = [];
  const incompatible: IncompatibleRun[] = [];
  for (const path of candidates) {
    try {
      const summary = await readSummary(path);
      attachArtifactBase(summary, path, root);
      loaded.push({ path, summary });
    } catch (e) {
      // 版本不同的 run 不能无声消失:收集起来在 view 里占位提示;其余当无关 JSON 忽略。
      if (e instanceof IncompatibleResultsError) incompatible.push(e.run);
    }
  }
  loaded.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt));
  // run 目录名是时间戳,降序 ≈ 最新在前。
  incompatible.sort((a, b) => b.dir.localeCompare(a.dir));
  return { loaded, incompatible };
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
  // 版本判定:确定是 niceeval 报告但 schemaVersion 不同 → 不兼容,不解析、不迁移、不降级渲染。
  // 缺版本字段的存量文件按 schemaVersion 1 处理(引入版本号不改其余格式)。
  if (data.format === RESULTS_FORMAT && (data.schemaVersion ?? 1) !== RESULTS_SCHEMA_VERSION) {
    throw new IncompatibleResultsError({
      dir: relative(process.cwd(), dirname(path)) || ".",
      schemaVersion: data.schemaVersion ?? 1,
      producerVersion: data.producer?.version,
    });
  }
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    throw new Error(`${path} is not a niceeval summary`);
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
    // 一行 = 一个实验,results 内按 eval id 折叠计票(passed/failed/通过率都是 eval 级)。
    const stats = evalLevelStats(results, (r) => r.id);
    return {
      key,
      experimentId,
      experiment: first.experiment,
      group: experimentGroup(experimentId),
      label: displayExperimentName(experimentId) ?? fallbackExperimentLabel(first),
      agent: first.agent,
      model: first.model,
      lastRunAt: lastRunAt.get(key),
      runs: results.length, // 总 attempt 数(详情里作次要信息)
      evals: stats.evals, // 去重后的 eval 数(成功率分母的口径)
      passed: stats.passed,
      failed: stats.failed,
      errored: stats.errored,
      skipped: stats.skipped,
      passRate: stats.passRate,
      avgDurationMs: avg(results.map((r) => r.durationMs)),
      usage: sumUsage(results.map((r) => r.usage)),
      estimatedCostUSD: cost,
      results: results
        .slice()
        .sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || a.id.localeCompare(b.id)),
    };
  });
}

function resultOutcome(result: EvalResult): EvalResult["outcome"] {
  return result.outcome;
}

/**
 * 把同一个 eval 的多轮 attempt 折叠成单一判决:任一轮通过 → 该 eval 通过(对齐 earlyExit
 * 「先过一次即停」语义),否则按 failed > errored > skipped 取最严重的一个。
 */
function foldEvalOutcome(results: EvalResult[]): EvalResult["outcome"] {
  const outcomes = results.map(resultOutcome);
  if (outcomes.some((o) => o === "passed")) return "passed";
  if (outcomes.some((o) => o === "failed")) return "failed";
  if (outcomes.some((o) => o === "errored")) return "errored";
  return "skipped";
}

/**
 * 通过率与 passed/failed 一律按 eval 计票,不按 attempt:每个 eval 不管跑几轮都只占一票,先把它
 * 的多轮折叠成单一判决再计数。否则 runs>1 时同一 eval 的 N 次 attempt 各算一票 —— 尤其 earlyExit
 * 开时通过的 eval 只留 1 次、失败的 eval 跑满 N 次,失败 eval 被重复计入分母,把通过率拉低
 * (见 docs/runner.md、docs/scoring.md)。keyOf 决定「一个 eval」的粒度:单实验按 eval id,
 * 跨实验组按 experimentId|eval id。
 */
function evalLevelStats(results: EvalResult[], keyOf: (r: EvalResult) => string) {
  const byEval = new Map<string, EvalResult[]>();
  for (const r of results) byEval.set(keyOf(r), [...(byEval.get(keyOf(r)) ?? []), r]);
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const group of byEval.values()) counts[foldEvalOutcome(group)] += 1;
  const ran = counts.passed + counts.failed + counts.errored; // skipped 不进分母
  return { evals: byEval.size, ...counts, passRate: ran ? counts.passed / ran : 0 };
}

function summarizeAll(loaded: LoadedSummary[]) {
  const results = loaded.flatMap((s) => s.summary.results);
  // 顶部总览同样按 eval 计票:每个(实验, eval)只算一份,跨实验/跨 run 不被 runs 灌票。
  const groupKey = (r: EvalResult) => (r.experimentId ? `exp|||${r.experimentId}` : `legacy|||${r.agent}|||${r.model ?? ""}`);
  const stats = evalLevelStats(results, (r) => `${groupKey(r)}|||${r.id}`);
  return {
    results: stats.evals,
    passRate: stats.passRate,
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
