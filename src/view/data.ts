// view 的数据层:读取经 niceeval/results 的 openResults(布局/版本知识只住在那),
// 统计经 niceeval/report 的官方计算函数(RunOverview.data / MetricTable.data 的实现,
// 从 compute.ts 直接引用 —— 调用侧适配,不经 components.tsx,避免把 react 拉进 CLI 路径)。
// 这里只做编排:挑选(results.latest();位置前缀 / --experiment / --report 在场时经
// composeShowSelection 与 show 同口径合成)、快照明细注入(attemptRef / artifactBase)、
// skipped / warnings 透传、--report 的报告槽渲染(renderReportSlot)。旧 loader
// (readSummary / loadSummaries / 目录扫描 / 版本判定)与旧聚合(aggregateRows)已删,
// 见 docs/view.md「用 Reports 积木重建 view」迁移顺序 1–2。

import { statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { dedupeAttempts, openResults } from "../results/index.ts";
import type { AttemptHandle, Results, RunDir, Selection, SkippedRun } from "../results/index.ts";
import { overviewData, tableData } from "../report/compute.ts";
import { costUSD, durationMs, passRate, tokens } from "../report/metrics.ts";
import { loadReportFile } from "../report/load.ts";
import { composeShowSelection, filterExperiments } from "../show/compose.ts";
import type { EvalResult, RunSummary } from "../types.ts";
import type { SkippedRunNotice, ViewData, ViewEvalResult, ViewSnapshot } from "./shared/types.ts";
import { t } from "../i18n/index.ts";
import { RESULTS_SCHEMA_VERSION } from "../types.ts";

/** 榜单列:官方内置指标,与 `niceeval show` 榜单同一批口径(通过率 / 耗时 / tokens / 成本)。 */
const BOARD_COLUMNS = [passRate, durationMs, tokens, costUSD] as const;

/** hero 整体通过率的常量维度:全部选中 attempt 一组,走同一台两级聚合引擎。 */
const OVERALL_DIMENSION = { name: "overall", of: () => "all" } as const;

export interface ViewScan {
  viewData: ViewData;
  /**
   * artifactBase(相对 view 根)→ 宿主机绝对目录。只在 server 端内存里保留;
   * 绝对路径不进 viewData,避免序列化进可分享的静态 HTML(信息泄漏且浏览器端用不到)。
   */
  artifactDirs: Map<string, string>;
  /**
   * --report:报告树经 renderReportToStaticHtml 渲染出的静态 HTML,整槽替换查看器的
   * 报告槽。作为独立静态块烘进页面(与 __NICEEVAL_VIEW_DATA__ 相邻),不进 viewData ——
   * 证据室沿用官方数据契约不动,前端只负责把这块 HTML 摆进报告槽位置,不解析。
   */
  reportHtml?: string;
}

/** view 宿主输入的组合语义(与 show 对齐,docs/reports.md「宿主输入的组合语义」)。 */
export interface ViewScanOptions {
  /** eval id 前缀(位置参数):收窄报告槽选集;证据室(快照明细)不收窄,深链恒可达。 */
  patterns?: string[];
  /** experiment id 前缀(--experiment):选集只留该实验。 */
  experiment?: string;
  /** --report 报告文件:相对 cwd 的路径。装载失败抛 ReportLoadError(CLI 打印后退出)。 */
  report?: { path: string; cwd: string };
}

/** 可预期的用户输入错误:CLI 打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
export class ViewInputError extends Error {}

/** 版本不同、按设计直接不兼容的 run;只占位提示,不解析内容。 */
export interface IncompatibleRun {
  /** run 目录,相对 cwd;直接可拼进 npx 命令。 */
  dir: string;
  schemaVersion: number;
  producer?: RunSummary["producer"];
}

/** 用能读这份报告的 niceeval 版本查看的命令;第三方 harness 的落盘拼不出 npx,返回 undefined。 */
export function incompatibleViewCommand(run: IncompatibleRun): string | undefined {
  if (run.producer && run.producer.name !== "niceeval") return undefined;
  return `npx niceeval@${run.producer?.version ?? "<version>"} view ${run.dir}`;
}

/** 版本不匹配的完整提示文案;CLI 单文件模式和目录扫描占位共用。 */
export function incompatibleHint(run: IncompatibleRun): string {
  const command = incompatibleViewCommand(run);
  if (command === undefined) {
    // 第三方 harness:如实报名字和版本,不拼 npx(docs/results-lib.md 的裁决)。
    return t("cli.view.incompatibleForeign", {
      dir: run.dir,
      name: run.producer?.name ?? "?",
      version: run.producer?.version ?? "?",
      schemaVersion: run.schemaVersion,
      supported: RESULTS_SCHEMA_VERSION,
    });
  }
  return t("cli.view.incompatible", {
    dir: run.dir,
    producer: run.producer?.version ?? "?",
    schemaVersion: run.schemaVersion,
    supported: RESULTS_SCHEMA_VERSION,
    command,
  });
}

/** 单文件模式读到版本不同的 summary 时抛出;CLI 捕获后打印提示退出,不当成普通错误堆栈。 */
export class IncompatibleResultsError extends Error {
  constructor(readonly run: IncompatibleRun) {
    super(incompatibleHint(run));
    this.name = "IncompatibleResultsError";
  }
}

/** 服务/解析工件的根目录:输入是目录就用它,是文件就用其所在目录。 */
export function viewRoot(input?: string): string {
  const target = resolve(input ?? ".niceeval");
  try {
    return statSync(target).isFile() ? dirname(target) : target;
  } catch {
    return target;
  }
}

/**
 * 读跨历史「每 (experimentId, evalId) 最新一份」的 EvalResult,供续跑携带已通过结果。
 * 只看最近一个 run 不行:部分补跑(位置参数只跑几道题)会把携带基线换成那个部分 run,
 * 之后重跑任何实验都携带不到东西,`exp <组>` 的「补齐缺失」语义随之失效。
 * 同一 (experimentId, evalId) 的多个 attempt 整批取自含它的最新 run,不跨 run 混装。
 * 携带条目要能被 view 找回工件,这里同时把 artifactBase(相对结果根)拼好(runner 依赖它)。
 */
export async function loadLatestResultsPerEval(root = ".niceeval"): Promise<EvalResult[]> {
  const results = await openResults(root);
  const rootAbs = resolve(root);
  const claimed = new Set<string>();
  const out: EvalResult[] = [];
  for (const run of results.runDirs) {
    // runDirs 已按新→旧排序;同一 run 内先收本轮的 key,收完再整体入 claimed,
    // 保证同 (experiment, eval) 的多 attempt 整批取自同一个 run。
    const takenThisRun = new Set<string>();
    for (const attempt of run.attempts) {
      const key = `${attempt.experimentId}|${attempt.evalId}`;
      if (claimed.has(key)) continue;
      takenThisRun.add(key);
      out.push(annotateResult(attempt, run, rootAbs).annotated);
    }
    for (const key of takenThisRun) claimed.add(key);
  }
  return out;
}

/**
 * `niceeval view` 的数据装载入口:server 每次请求现读现算,`--out` 导出用同一份。
 * 位置前缀 / --experiment / --report 在场时,报告槽选集经 composeShowSelection 合成
 * (与 `niceeval show` 同一口径,两扇门判定不分叉);全部缺省时维持 results.latest(),
 * 默认行为不变。证据室数据(快照明细 / skipped)恒为全量,深链在任何收窄下都可达。
 * 零可读结果一律抛 ViewInputError,不渲染/导出空页面(server 起不来,--out 非零退出)。
 */
export async function loadViewScan(input?: string, opts: ViewScanOptions = {}): Promise<ViewScan> {
  const target = resolve(input ?? ".niceeval");
  const root = viewRoot(input);
  const results = await openResults(target);
  assertSingleFileReadable(results, target);

  const patterns = opts.patterns ?? [];
  const narrowed = patterns.length > 0 || opts.experiment !== undefined || opts.report !== undefined;

  // 零可读结果直说,不渲染/导出一张空页面(与 show 的「匹配不到直说」同一原则;
  // CI 静态发布还靠这个非零退出保住上一次部署,空报告不顶上线)。零可读最常见的
  // 根因不是目录空,而是落盘整批 schemaVersion 不兼容被跳过,所以带上 skipped 摘要。
  if (results.experiments.length === 0) {
    throw new ViewInputError(noReadableResults(target, results.skipped));
  }
  if (
    opts.experiment !== undefined &&
    results.experiments.length > 0 &&
    filterExperiments(results.experiments, opts.experiment).length === 0
  ) {
    throw new ViewInputError(
      t("cli.show.noExperimentMatch", {
        arg: opts.experiment,
        experiments: results.experiments.map((e) => e.id).join(", "),
      }).trimEnd(),
    );
  }

  const baseSelection = results.latest();
  const selection = narrowed
    ? composeShowSelection(results, { experiment: opts.experiment, patterns })
    : baseSelection;

  if (patterns.length > 0 && selection.snapshots.every((s) => s.evals.length === 0)) {
    const known = [
      ...new Set(filterExperiments(results.experiments, opts.experiment).flatMap((e) => e.evalIds)),
    ].sort();
    throw new ViewInputError(
      t("cli.show.noEvalMatch", { patterns: patterns.join(", "), evals: known.join(", ") || "(none)" }).trimEnd(),
    );
  }

  const [overview, table, overall] = [
    await overviewData(selection),
    await tableData(selection, { rows: "experiment", columns: BOARD_COLUMNS, sort: passRate }),
    await tableData(selection, { rows: OVERALL_DIMENSION, columns: [passRate] }),
  ];

  // --report:整槽替换。报告吃同一份注入选集,web 面在计算侧静态渲染成 HTML。
  const reportHtml = opts.report
    ? await renderReportSlot(opts.report, results, selection)
    : undefined;

  // 跨快照按身份键去重:--resume 携带的条目在多份落盘里重复,只保留最新 run 里的那份
  // (与官方计算函数的聚合口径一致,Runs / Traces 的计数因此不被复印件灌票)。
  const artifactDirs = new Map<string, string>();
  // latest 标记恒按 results.latest() 口径打(ViewSnapshot.latest 的声明语义),
  // 不随收窄后的合成选集漂移 —— 榜单行与快照的关联靠它成立。
  const latestSet = new Set(baseSelection.snapshots);
  const allAttempts: AttemptHandle[] = [];
  for (const exp of results.experiments) {
    for (const snap of exp.snapshots) allAttempts.push(...snap.attempts);
  }
  const survivors = new Set(dedupeAttempts(allAttempts).attempts);

  const snapshots: ViewSnapshot[] = [];
  for (const exp of results.experiments) {
    for (const snap of exp.snapshots) {
      const kept = snap.attempts.filter((a) => survivors.has(a));
      const latest = latestSet.has(snap);
      // 条目全被去重吸走的历史快照不再携带(它的内容原样活在更新的落盘里)。
      if (kept.length === 0 && !latest) continue;
      snapshots.push({
        experimentId: snap.experimentId,
        ...(snap.synthetic ? { synthetic: true } : {}),
        agent: snap.agent,
        ...(snap.model !== undefined ? { model: snap.model } : {}),
        startedAt: snap.startedAt,
        run: basename(snap.runDir.dir),
        latest,
        results: kept.map((a) => {
          const { annotated, base, abs } = annotateResult(a, snap.runDir, root);
          if (base && abs) artifactDirs.set(base, abs);
          return annotated;
        }),
      });
    }
  }

  const latestRun = results.runDirs[0];
  const viewData: ViewData = {
    ...(latestRun?.summary.name !== undefined ? { name: latestRun.summary.name } : {}),
    ...(latestRun ? { lastRunAt: latestRun.summary.startedAt } : {}),
    // 合成选集的快照是跨 run 拼出来的,来源 run 数从 attempt 的 runDir 数;
    // 默认选集(latest 口径)保持原表达式,行为不变。
    composedRuns: narrowed
      ? new Set(selection.snapshots.flatMap((s) => s.attempts.map((a) => a.runDir.dir))).size
      : new Set(selection.snapshots.map((s) => s.runDir.dir)).size,
    overview,
    table,
    overall,
    snapshots,
    skippedRuns: results.skipped.map(toSkippedNotice),
  };
  return { viewData, artifactDirs, ...(reportHtml !== undefined ? { reportHtml } : {}) };
}

/**
 * 报告槽渲染:装载报告文件(dev server 语义 —— 文件变更下次请求整页重算,经 mtime
 * cache-busting)→ 注入与默认报告同口径的选集 → web 面 renderToStaticMarkup 成静态 HTML。
 * react-dom 只在 --report 在场时动态加载,默认 CLI 路径不背 react。
 * attemptHref 缺省即 `#/attempt/<run>/<result>`(view 的 attempt 深链路由)。
 */
async function renderReportSlot(
  report: { path: string; cwd: string },
  results: Results,
  selection: Selection,
): Promise<string> {
  const definition = await loadReportFile(report.cwd, report.path, { freshImport: true });
  const { renderReportToStaticHtml } = await import("../report/web.ts");
  return renderReportToStaticHtml(definition, { selection, results });
}

/**
 * 单文件模式(`niceeval view path/to/summary.json`)是用户明确指定的目标:
 * 读不了就让命令失败并给可执行的下一步,不打开一个空页面。目录模式不走这里
 * (读不了的进 skipped,页面顶部横幅展示,单个坏 run 不拖垮整页)。
 */
function assertSingleFileReadable(results: Results, target: string): void {
  let isFile = false;
  try {
    isFile = statSync(target).isFile();
  } catch {
    return; // 目标不存在:按空结果渲染(还没跑过 eval 不是错误)。
  }
  if (!isFile || results.runDirs.length > 0) return;
  const skip = results.skipped[0];
  if (skip?.reason === "incompatible-version") {
    throw new IncompatibleResultsError({
      dir: relative(process.cwd(), skip.dir) || ".",
      schemaVersion: skip.schemaVersion ?? 0,
      ...(skip.producer ? { producer: skip.producer } : {}),
    });
  }
  if (skip?.reason === "malformed") {
    throw new Error(
      `${target}: ${skip.detail ?? "unreadable report"}. The report may be corrupted; re-run the eval or delete this run directory.`,
    );
  }
  throw new Error(`${target} is not a niceeval summary`);
}

/**
 * 给单条 attempt 注入 view 侧标注:
 * - attemptRef:直接用 niceeval/results 的证据引用(与 Reports 的 MetricCell.refs 同一身份)。
 * - artifactBase:相对 view 根的工件目录(前端据此 fetch trace.json 等)。--resume 携带的
 *   条目 artifactsDir 为空、artifactBase 指向原 run,原样沿用(同一套候选顺序)。
 * 返回新对象,不 mutate 读入的 summary;宿主机绝对路径只回给调用方写进 artifactDirs
 * (server 端内存),不挂到 result 上,避免随 viewData 进静态 HTML。
 */
function annotateResult(
  attempt: AttemptHandle,
  run: RunDir,
  root: string,
): { annotated: ViewEvalResult; base?: string; abs?: string } {
  const r = attempt.result;
  const annotated: ViewEvalResult = { ...r, attemptRef: attempt.ref };
  if (r.artifactsDir) {
    const abs = join(run.dir, r.artifactsDir);
    const base = relative(root, abs).split(/[\\/]/).join("/");
    return { annotated: { ...annotated, artifactBase: base }, base, abs };
  }
  if (r.artifactBase) {
    // 已是相对结果根的路径(携带条目),工件留在原 run 目录里。
    return { annotated, base: r.artifactBase, abs: join(root, r.artifactBase) };
  }
  return { annotated };
}

/**
 * 零可读结果的报错文案。目录真空时给「先跑一轮」的入门提示(与 show 的 noResults 同形态);
 * 有 skipped 时逐条列目录与原因——schemaVersion 不兼容的 niceeval 落盘给出可跑的
 * npx 命令,让「全被跳过」和「真没跑过」在错误里就能分清,不用进查看器排查。
 */
function noReadableResults(target: string, skipped: SkippedRun[]): string {
  if (skipped.length === 0) return t("cli.view.noResults", { root: target }).trimEnd();
  const lines = skipped.map((skip) => {
    const notice = toSkippedNotice(skip);
    const version = notice.schemaVersion !== undefined ? `, schemaVersion ${notice.schemaVersion}` : "";
    const hint = notice.command ? ` — view it with \`${notice.command.trim()}\`` : "";
    return `  ${notice.dir}: ${notice.reason}${version}${hint}`;
  });
  const runs = skipped.length === 1 ? "1 run directory was" : `${skipped.length} run directories were`;
  return [
    `No readable results under ${target} — ${runs} skipped:`,
    ...lines,
    "Re-run your experiments with this niceeval to produce fresh results.",
  ].join("\n");
}

function toSkippedNotice(skip: SkippedRun): SkippedRunNotice {
  const dir = relative(process.cwd(), skip.dir) || ".";
  const command =
    skip.reason === "incompatible-version" && skip.producer?.name === "niceeval" && skip.producer.version
      ? incompatibleViewCommand({ dir, schemaVersion: skip.schemaVersion ?? 0, producer: skip.producer })
      : undefined;
  return {
    dir,
    reason: skip.reason,
    ...(skip.schemaVersion !== undefined ? { schemaVersion: skip.schemaVersion } : {}),
    ...(skip.producer?.name !== undefined ? { producerName: skip.producer.name } : {}),
    ...(skip.producer?.version !== undefined ? { producerVersion: skip.producer.version } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(skip.detail !== undefined ? { detail: skip.detail } : {}),
  };
}
