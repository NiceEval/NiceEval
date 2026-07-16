// view 的数据层:读取经 niceeval/results 的 openResults(布局/版本知识只住在那)。
// 这里只做编排:报告槽 Scope 恒经 selectCurrentResults(现刻水位;与 show 调同一个函数,
// 两扇门判定不分叉)、快照明细注入(locator / artifactBase)、skipped 透传、报告装载与逐页渲染
// (裸跑填充 niceeval/report/built-in 的默认导出,--report 整槽替换,en / zh-CN 双语各渲染一遍)。
// --report 只换报告定义,注入的 Scope 与裸跑同一份。统计口径整体住在报告页里
// (报告组件的官方计算函数),viewData 不再携带 overview / 榜单这类统计产物,
// 见 docs/feature/reports/view.md「打开与收窄」。

import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { dedupeAttempts, openResults } from "../results/index.ts";
import type { AttemptHandle, Results, Scope, Snapshot, SkippedDir } from "../results/index.ts";
import {
  loadHostReport,
  renderHostPageHtml,
  reportMetaFor,
  resolveReportTitle,
  type HostReport,
  type HostReportAsset,
} from "../show/report-host.ts";
import { selectCurrentResults, filterExperiments } from "../results/select.ts";
import type { EvalResult } from "../types.ts";
import type {
  SkippedRunNotice,
  ViewData,
  ViewEvalResult,
  ViewReportMeta,
  ViewReportPageHtml,
  ViewSnapshot,
} from "./shared/types.ts";
import { t } from "../i18n/index.ts";
import { RESULTS_SCHEMA_VERSION } from "../types.ts";

export type { ViewReportMeta, ViewReportPageHtml } from "./shared/types.ts";

export interface ViewScan {
  viewData: ViewData;
  /**
   * artifactBase(相对 view 根)→ 宿主机绝对目录。只在 server 端内存里保留;
   * 绝对路径不进 viewData,避免序列化进可分享的静态 HTML(信息泄漏且浏览器端用不到)。
   */
  artifactDirs: Map<string, string>;
  /**
   * artifactBase → AttemptHandle。sources.json 在盘上是去重后的引用(`{path, sha256}[]`),
   * 不能像其它 artifact 那样直接 copyFile / piping 原字节——必须经 `AttemptHandle.sources()`
   * 解引用出完整内容(`{path, content}[]`)才能给浏览器用。这份索引专为那一种 artifact 的特判
   * 准备(`copyFetchedArtifacts`),events.json / trace.json 仍走 `artifactDirs` 的原文件路径。
   */
  attemptsByBase: Map<string, AttemptHandle>;
  /**
   * 报告页:每页渲染成静态 HTML(en / zh-CN 各一份),裸跑填充内建报告(单页 id `report`),
   * --report 整槽替换(树 / 配置对象形态都规范化成页列表)。作为 <template
   * id="niceeval-report-<pageId>-<locale>"> 静态块烘进页面(与 __NICEEVAL_VIEW_DATA__ 相邻),
   * HTML 本体不进 viewData —— 前端只负责把当前页 / 当前界面语言对应的块摆进报告槽位置,不解析。
   */
  reportPages: ViewReportPageHtml[];
  /** 外壳注入资产(styles / scripts;{src} 已按路径纪律解析成 inline 内容),只进 web 面。 */
  shellAssets: { styles: string[]; scripts: string[] };
  /**
   * --out 的数据等级(见 docs/feature/reports/view.md「静态导出」):全部选中快照带
   * publish:{redaction:"applied"} 才是 "applied",否则 "sensitive"(含本地事实根与
   * redaction:"none"——上游声明过原文发布也不豁免导出时的确认)。
   */
  publishState: "applied" | "sensitive";
}

/** view 宿主输入的组合语义(与 show 对齐,docs/feature/reports/architecture.md「Scope 是计算入口」)。 */
export interface ViewScanOptions {
  /** eval id 前缀(位置参数):收窄报告槽 Scope;证据室(快照明细)不收窄,深链恒可达。 */
  patterns?: string[];
  /** experiment id 前缀(--experiment):Scope 只留该实验。 */
  experiment?: string;
  /** --report 报告文件:相对 cwd 的路径。装载失败抛 ReportLoadError(CLI 打印后退出)。 */
  report?: { path: string; cwd: string };
  /** --page:多页报告的初始页 id;未命中任何页按用法错误退出并列出可用页 id。 */
  page?: string;
  /**
   * 单页渲染失败的处置(docs/feature/reports/architecture.md「管线以页为单位执行」):
   * 本地 server 传 "embed"(该页显示完整错误反馈,其它页照常可读);静态导出与启动前预检
   * 缺省 "throw"(任一页失败整体失败,不产出半套站点)。
   */
  pageFailure?: "throw" | "embed";
}

/** 可预期的用户输入错误:CLI 打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
export class ViewInputError extends Error {}

/** 版本不同、按设计直接不兼容的落盘;只占位提示,不解析内容。 */
export interface IncompatibleRun {
  /** 快照目录,相对 cwd;直接可拼进 npx 命令。 */
  dir: string;
  schemaVersion: number;
  producer?: Snapshot["producer"];
}

/** 用能读这份报告的 niceeval 版本查看的命令;第三方 harness 的落盘拼不出 npx,返回 undefined。 */
export function incompatibleViewCommand(run: IncompatibleRun): string | undefined {
  if (run.producer && run.producer.name !== "niceeval") return undefined;
  return `npx niceeval@${run.producer?.version ?? "<version>"} view --snapshot ${run.dir}/snapshot.json`;
}

/** 版本不匹配的完整提示文案;CLI 单文件模式和目录扫描占位共用。 */
export function incompatibleHint(run: IncompatibleRun): string {
  const command = incompatibleViewCommand(run);
  if (command === undefined) {
    // 第三方 harness:如实报名字和版本,不拼 npx(docs/feature/results/library.md 的裁决)。
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

/** 单文件模式读到版本不同的 snapshot 时抛出;CLI 捕获后打印提示退出,不当成普通错误堆栈。 */
export class IncompatibleResultsError extends Error {
  constructor(readonly run: IncompatibleRun) {
    super(incompatibleHint(run));
    this.name = "IncompatibleResultsError";
  }
}

/**
 * 服务/解析 artifact 的根目录:输入是目录就用它,是文件就上跳两层(snapshot.json 恒在
 * `<root>/<experiment-dir>/<snapshot-dir>/snapshot.json`,root 是 AttemptRef.snapshot
 * 两段路径的锚点)。
 */
export function viewRoot(input?: string): string {
  const target = resolve(input ?? ".niceeval");
  try {
    return statSync(target).isFile() ? dirname(dirname(target)) : target;
  } catch {
    return target;
  }
}

/** 携带条目 / 新算的 artifactBase:`result.artifactBase ?? `${ref.snapshot}/${ref.attempt}``(posix 拼接)。 */
function withArtifactBase(attempt: AttemptHandle): EvalResult {
  const r = attempt.result;
  if (r.artifactBase !== undefined) return r;
  return { ...r, artifactBase: `${attempt.ref.snapshot}/${attempt.ref.attempt}` };
}

/**
 * 读跨历史「每 (experimentId, evalId) 最新一份」的 EvalResult,供续跑携带已通过结果。
 * 只看最近一个快照不行:部分补跑(位置参数只跑几道题)会把携带基线换成那个部分快照,
 * 之后重跑任何实验都携带不到东西,`exp <组>` 的「补齐缺失」语义随之失效。
 * 同一 (experimentId, evalId) 的多个 attempt 整批取自含它的最新快照,不跨快照混装。
 * 携带条目要能被 view 找回 artifact,这里同时把 artifactBase(相对结果根)拼好(runner 依赖它)。
 */
export async function loadLatestResultsPerEval(root = ".niceeval"): Promise<EvalResult[]> {
  const results = await openResults(root);
  const out: EvalResult[] = [];
  for (const exp of results.experiments) {
    // exp.snapshots 已按新→旧排序;同一快照内先收本轮的 eval id,收完再整体入 claimed,
    // 保证同 (experiment, eval) 的多 attempt 整批取自同一个快照。
    const claimed = new Set<string>();
    for (const snapshot of exp.snapshots) {
      const takenThisSnapshot = new Set<string>();
      for (const ev of snapshot.evals) {
        if (claimed.has(ev.id)) continue;
        takenThisSnapshot.add(ev.id);
        for (const attempt of ev.attempts) out.push(withArtifactBase(attempt));
      }
      for (const id of takenThisSnapshot) claimed.add(id);
    }
  }
  return out;
}

/**
 * `niceeval view` 的数据装载入口:server 每次请求现读现算,`--out` 导出用同一份。
 * 报告槽 Selection 恒经 selectCurrentResults 合成(现刻水位;与 `niceeval show` 调同一个
 * 函数,裸跑与局部收窄不分叉),位置前缀 / --experiment 只作为 scope 传入,不切换选择口径。
 * --report 本身不改挑选——它只换报告槽的填充,注入的 Selection 与裸跑同一份,
 * 「裸跑 ≡ --report <ExperimentComparison>」靠这条成立(docs/feature/reports/architecture.md「Selection 是计算入口」)。
 * 证据室数据(快照明细 / skipped)恒为全量,深链在任何收窄下都可达。
 * 零可读结果一律抛 ViewInputError,不渲染/导出空页面(server 起不来,--out 非零退出)。
 */
export async function loadViewScan(input?: string, opts: ViewScanOptions = {}): Promise<ViewScan> {
  const target = resolve(input ?? ".niceeval");
  const root = viewRoot(input);
  const results = await openResults(target);
  assertSingleFileReadable(results, target);

  const patterns = opts.patterns ?? [];

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

  // 报告槽 Selection:恒经现刻水位选择器合成,与 show 裸跑同口径(两扇门判定不分叉)。
  const selection = selectCurrentResults(results, { experiment: opts.experiment, patterns });
  // latestPerExperiment 只服务证据室 UI 的 latest 标记(ViewSnapshot.latest / viewData.snapshots),
  // 与报告槽 Selection 完全无关,绝不复用为报告 Selection。
  const latestPerExperiment = results.latest();

  if (patterns.length > 0 && selection.snapshots.every((s) => s.evals.length === 0)) {
    const known = [
      ...new Set(filterExperiments(results.experiments, opts.experiment).flatMap((e) => e.evalIds)),
    ].sort();
    throw new ViewInputError(
      t("cli.show.noEvalMatch", { patterns: patterns.join(", "), evals: known.join(", ") || "(none)" }).trimEnd(),
    );
  }

  // 报告槽:裸跑装载内建报告默认导出,--report 整槽替换——同一条「装载 → 规范化 → 逐页渲染」
  // 管线(docs/feature/reports/library/shell.md)。报告吃同一份注入 Scope,web 面在计算侧
  // 静态渲染成 HTML(en / zh-CN 各一遍,切界面语言不重算数据)。
  const slot = await renderReportSlot(opts.report, opts.page, results, selection, opts.pageFailure ?? "throw");

  // 跨快照按身份键去重:--resume 携带的条目在多份落盘里重复,只保留最新快照里的那份
  // (与官方计算函数的聚合口径一致,Runs / Traces 的计数因此不被复印件灌票)。
  const artifactDirs = new Map<string, string>();
  const attemptsByBase = new Map<string, AttemptHandle>();
  // latest 标记恒按 results.latest() 口径打(ViewSnapshot.latest 的声明语义),
  // 与报告槽 Selection(现刻水位,可能合成自更早快照)是两个独立概念,不混用。
  const latestSet = new Set(latestPerExperiment.snapshots);
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
        agent: snap.agent,
        ...(snap.model !== undefined ? { model: snap.model } : {}),
        startedAt: snap.startedAt,
        // 与 reader 的 AttemptRef.snapshot 同一公式(祖父目录名/自身目录名),不依赖 root——
        // 单文件模式的 root 是从目标文件上跳算出的,两条计算各自独立更不容易踩偏差。
        run: `${basename(dirname(snap.dir))}/${basename(snap.dir)}`,
        latest,
        results: kept.map((a) => {
          const { annotated, base, abs } = annotateResult(a, root);
          artifactDirs.set(base, abs);
          attemptsByBase.set(base, a);
          return annotated;
        }),
      });
    }
  }

  // 全局最新快照(跨全部实验):hero 的项目名 / 最近一次运行时刻从这里取。
  let latestSnapshot: Snapshot | undefined;
  for (const exp of results.experiments) {
    const candidate = exp.snapshots[0];
    if (!candidate) continue;
    if (!latestSnapshot || candidate.startedAt > latestSnapshot.startedAt) latestSnapshot = candidate;
  }

  const viewData: ViewData = {
    ...(latestSnapshot?.name !== undefined ? { name: latestSnapshot.name } : {}),
    ...(latestSnapshot ? { lastRunAt: latestSnapshot.startedAt } : {}),
    // 合成 Scope 的快照是跨快照拼出来的,来源物理 run 数从 attempt 自己的 snapshot
    // 反向引用取——每个 attempt 的 .snapshot 恒指向它真实所在的贡献快照(无论 Scope
    // 是否合成),所以这条对裸跑与收窄一律成立,不需要分支。
    composedRuns: new Set(selection.snapshots.flatMap((s) => s.attempts.map((a) => a.snapshot.dir))).size,
    snapshots,
    skippedRuns: results.skipped.map(toSkippedNotice),
    report: slot.meta,
  };
  const publishState =
    selection.snapshots.length > 0 && selection.snapshots.every((snap) => snap.publish?.redaction === "applied")
      ? ("applied" as const)
      : ("sensitive" as const);
  return {
    viewData,
    artifactDirs,
    attemptsByBase,
    reportPages: slot.pages,
    shellAssets: slot.shellAssets,
    publishState,
  };
}

/**
 * base(withArtifactBase 同一公式)→ AttemptHandle 的轻量索引,供 server.ts 的 artifact 路由
 * 按 URL 反查 attempt——只有 sources.json 请求需要这份索引(其余 artifact 直接读盘文件更便宜),
 * 所以特意不跑 loadViewScan 的全套 Selection 合成 + 报告双语渲染,只做一次 openResults() 扫描。
 * 不做去重收窄:遍历全部落盘 attempt,同一 base 只可能来自同一份物理落盘,历史快照里被去重
 * 吸走的重复条目 base 天然不同,不会冲突;不会被 UI 引用的 base 混进来也无害(纯查表,
 * 从不主动枚举 key)。
 */
export async function loadAttemptIndex(input?: string): Promise<Map<string, AttemptHandle>> {
  const target = resolve(input ?? ".niceeval");
  const results = await openResults(target);
  const index = new Map<string, AttemptHandle>();
  for (const exp of results.experiments) {
    for (const snap of exp.snapshots) {
      for (const attempt of snap.attempts) {
        index.set(withArtifactBase(attempt).artifactBase!, attempt);
      }
    }
  }
  return index;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 外壳 `{src}` 资产的路径纪律(shell.md「行为约束」):相对报告文件解析;拒绝 `..` 路径段、绝对路径与 `~`。 */
function resolveShellAssets(assets: HostReportAsset[], baseDir: string | undefined, kind: "styles" | "scripts"): string[] {
  const out: string[] = [];
  for (const asset of assets) {
    if (asset.inline !== undefined) {
      out.push(asset.inline);
      continue;
    }
    const src = asset.src;
    if (src.startsWith("/") || src.startsWith("~") || src.split("/").includes("..")) {
      throw new ViewInputError(
        `Report ${kind} asset "${src}" is not a plain relative path. Assets resolve relative to the report file; ".." segments, absolute paths and "~" are not allowed.`,
      );
    }
    const abs = resolve(baseDir ?? process.cwd(), src);
    try {
      out.push(readFileSync(abs, "utf-8"));
    } catch {
      throw new ViewInputError(`Report ${kind} asset not found: ${abs} (declared as "${src}").`);
    }
  }
  return out;
}

/**
 * 报告装载与逐页渲染:装载报告文件(--report;dev server 语义 —— 文件变更下次请求整页重算,
 * 经 mtime cache-busting),缺省装载内建报告默认导出 → 规范化成「外壳 + 非空页列表」→
 * 注入 Scope → 每页 web 面渲染成静态 HTML,en / zh-CN 各渲染一遍(chrome 文案按 locale)。
 * 本地 server 下单页渲染失败折成该页的完整错误反馈块,其它页照常可读(静态导出的
 * 「任一页失败整体失败」由 buildView 侧的 failFast 保证)。
 * react / react-dom 动态加载:data.ts 还被 runner 的续跑携带(loadLatestResultsPerEval)
 * 消费,渲染依赖不进那条路径。attemptHref 缺省即 `#/attempt/@<locator>` 深链路由,
 * 报告页深链与证据室深链是同一条路由的两个来源。
 */
async function renderReportSlot(
  report: { path: string; cwd: string } | undefined,
  page: string | undefined,
  results: Results,
  selection: Scope,
  pageFailure: "throw" | "embed" = "throw",
): Promise<{ meta: ViewReportMeta; pages: ViewReportPageHtml[]; shellAssets: { styles: string[]; scripts: string[] } }> {
  // 报告 runtime 走预编译产物(dist/report/**,`pnpm run build:report` 产出),不受 view
  // 消费方 cwd/tsconfig 影响;装载与渲染统一经 ../show/report-host.ts(两个宿主共用的联系面)。
  const hostReport: HostReport = await loadHostReport(report?.cwd ?? process.cwd(), report?.path, {
    freshImport: true,
  });

  const initialPageId = page ?? hostReport.pages[0]!.id;
  if (!hostReport.pages.some((p) => p.id === initialPageId)) {
    throw new ViewInputError(
      `error: page "${page}" not found in ${report?.path ?? "the built-in report"}. Available pages: ${hostReport.pages.map((p) => p.id).join(", ")}`,
    );
  }

  const reportDir = report ? dirname(resolve(report.cwd, report.path)) : undefined;
  const shellAssets = {
    styles: resolveShellAssets(hostReport.styles, reportDir, "styles"),
    scripts: resolveShellAssets(hostReport.scripts, reportDir, "scripts"),
  };

  const pages: ViewReportPageHtml[] = [];
  for (const hostPage of hostReport.pages) {
    const meta = reportMetaFor(hostReport, hostPage.id, selection.snapshots);
    const ctx = { scope: selection, results, report: meta };
    try {
      pages.push({
        id: hostPage.id,
        html: {
          en: await renderHostPageHtml(hostPage, ctx, { locale: "en" }),
          "zh-CN": await renderHostPageHtml(hostPage, ctx, { locale: "zh-CN" }),
        },
      });
    } catch (e) {
      if (pageFailure !== "embed") throw e;
      // 本地 server:该页显示完整错误反馈,其它页照常可读(不让一页的树错误拖垮整站)。
      const message = e instanceof Error ? e.message : String(e);
      const block = `<div class="nre nre-page-error"><pre>${escapeHtml(message)}</pre></div>`;
      pages.push({ id: hostPage.id, html: { en: block, "zh-CN": block } });
    }
  }

  const meta: ViewReportMeta = {
    title: resolveReportTitle(hostReport.title, selection.snapshots),
    links: hostReport.links,
    ...(hostReport.footer !== undefined ? { footer: hostReport.footer } : {}),
    pages: hostReport.pages.map((p) => ({ id: p.id, title: p.title })),
    initialPageId,
  };
  return { meta, pages, shellAssets };
}

/**
 * 单文件模式(`niceeval view path/to/snapshot.json`)是用户明确指定的目标:
 * 读不了就让命令失败并给可执行的下一步,不打开一个空页面。目录模式不走这里
 * (读不了的进 skipped,页面顶部横幅展示,单个坏快照不拖垮整页)。
 */
function assertSingleFileReadable(results: Results, target: string): void {
  let isFile = false;
  try {
    isFile = statSync(target).isFile();
  } catch {
    return; // 目标不存在:按空结果渲染(还没跑过 eval 不是错误)。
  }
  const hasSnapshots = results.experiments.some((e) => e.snapshots.length > 0);
  if (!isFile || hasSnapshots) return;
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
      `${target}: ${skip.detail ?? "unreadable report"}. The report may be corrupted; re-run the eval or delete this snapshot directory.`,
    );
  }
  throw new Error(`${target} is not a niceeval snapshot`);
}

/**
 * 给单条 attempt 注入 view 侧标注:
 * - locator:不透明的 AttemptLocator(与 Reports 的 MetricCell.refs / `ctx.attemptHref` 同一身份),
 *   `#/attempt/@<locator>` 深链路由的参数——证据室按它在 viewData.snapshots 里定位回同一条 attempt。
 * - artifactBase:相对 view 根的 artifact 目录(前端据此 fetch trace.json 等)。本快照跑出的
 *   条目落盘没有这个字段,按 `${ref.snapshot}/${ref.attempt}` 现算;携带条目(--resume 合入)
 *   落盘自带 artifactBase,指向原快照,原样沿用。
 * 返回新对象,不 mutate 读入的结果;宿主机绝对路径只回给调用方写进 artifactDirs
 * (server 端内存),不挂到 result 上,避免随 viewData 进静态 HTML。
 */
function annotateResult(
  attempt: AttemptHandle,
  root: string,
): { annotated: ViewEvalResult; base: string; abs: string } {
  const r = attempt.result;
  const base = r.artifactBase ?? `${attempt.ref.snapshot}/${attempt.ref.attempt}`;
  const abs = join(root, base);
  const annotated: ViewEvalResult = { ...r, locator: attempt.locator, artifactBase: base };
  return { annotated, base, abs };
}

/**
 * 零可读结果的报错文案。目录真空时给「先跑一轮」的入门提示(与 show 的 noResults 同形态);
 * 有 skipped 时逐条列目录与原因——schemaVersion 不兼容的 niceeval 落盘给出可跑的
 * npx 命令,让「全被跳过」和「真没跑过」在错误里就能分清,不用进查看器排查。
 */
function noReadableResults(target: string, skipped: SkippedDir[]): string {
  if (skipped.length === 0) return t("cli.view.noResults", { root: target }).trimEnd();
  const lines = skipped.map((skip) => {
    const notice = toSkippedNotice(skip);
    const version = notice.schemaVersion !== undefined ? `, schemaVersion ${notice.schemaVersion}` : "";
    const hint = notice.command ? ` — view it with \`${notice.command.trim()}\`` : "";
    return `  ${notice.dir}: ${notice.reason}${version}${hint}`;
  });
  const runs = skipped.length === 1 ? "1 snapshot directory was" : `${skipped.length} snapshot directories were`;
  return [
    `No readable results under ${target} — ${runs} skipped:`,
    ...lines,
    "Re-run your experiments with this niceeval to produce fresh results.",
  ].join("\n");
}

function toSkippedNotice(skip: SkippedDir): SkippedRunNotice {
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
