// view 的数据层:读取经 niceeval/record 的 openRecord(布局/版本知识只住在那)。
// 这里只做编排:报告槽 Sample 恒经 currentSample(现刻水位;与 show 调同一个函数,
// 两扇门判定不分叉)、快照明细注入(locator / artifactBase)、unreadable 透传、报告装载与逐页渲染
// (裸跑填充 niceeval/report/built-in 的默认导出,--report 整槽替换,en / zh-CN 双语各渲染一遍)。
// --report 只换报告定义,注入的 Sample 与裸跑同一份。统计口径整体住在报告页里
// (报告组件的官方计算函数),viewData 不再携带 overview / 实验列表这类统计产物,
// 见 docs/feature/reports/view.md「打开与收窄」。

import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { dedupeAttempts, loadAttemptEvidence, openRecord, withArtifactBase } from "../record/index.ts";
import type { AttemptHandle, Record, Sample, Run, UnreadableRun } from "../record/index.ts";
import type { AttemptLocator } from "../record/locator.ts";
import { buildHostReportMeta,
  hostThemeStylesheet,
  loadHostReport,
  renderHostPageFromResolved,
  resolveHostPage,
  resolveHostTheme,
  type ReportAsset,
  type ReportDefinition,
  type ReportPage,
  type HeadTag,
  type ThemeDefinition,
} from "../report/runtime/host.ts";
import { currentSample, filterExperiments } from "../sample/index.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import type { EvalResult, JsonValue } from "../types.ts";
import type { SkippedRunNotice, ViewData, ViewReportMeta, ViewReportPageHtml } from "./shared/types.ts";
import { t } from "../i18n/index.ts";
import { RECORD_SCHEMA_VERSION } from "../types.ts";

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
  shellAssets: { styles: string[]; scripts: string[]; head: ResolvedHeadTag[] };
  /**
   * 报告声明了 attempt-input page 时才存在(architecture.md「Attempt 详情是一张参数化 page」)。
   * `locators` 是收窄后有效根内可达的 locator → AttemptHandle(与 scope-input pages 同一份
   * `scopedExperiments ∩ matchEval ∩ survivors` 口径——去重只吞掉 `--resume` 携带的字面重复,
   * 不排除真实历史 attempt,见 view.md「打开与收窄」);站点管线(site.ts)据此为每个可达
   * locator 生成一份 `attempt/<locator>.html`,不在这份索引里的 locator 不出站。
   * `render` 装配一个 locator 的 `AttemptEvidence` 并渲染该 page 两种语言的内容 HTML(不含外层
   * 文档 —— 独立 HTML 文档的组装是 site.ts 的事);pageFailure 语义与 scope pages 一致。
   */
  attemptPages?: {
    page: ReportPage;
    locators: Map<AttemptLocator, AttemptHandle>;
    render(locator: AttemptLocator, handle: AttemptHandle): Promise<{ en: string; "zh-CN": string }>;
  };
}

/** attempt 页面内容(不是 index.html 的 scope-input page)链去同目录 attempt/ 下的兄弟文档,
 *  不带 `attempt/` 目录前缀(site.ts「站点管线」;两处 href 的对应关系与拆分只住在那)。 */
const SIBLING_ATTEMPT_HREF = (locator: AttemptLocator): string => `${encodeURIComponent(locator)}.html`;

/** view 宿主输入的组合语义(与 show 对齐,docs/feature/reports/architecture.md「Sample 是计算入口」)。 */
export interface ViewScanOptions {
  /** eval id 前缀(位置参数):把根滤成有效根,页面 Sample 与证据(快照明细、artifact 清单)一致收窄。 */
  patterns?: string[];
  /** experiment id 前缀(--exp,可重复):有效根只留匹配实验(union 前缀收窄,与 show 的单/双
   *  个 `--exp` 同一套 `filterExperiments`;view 目前不做 show 对照矩阵那一套"每个 --exp 必须
   *  恰好命中一个 experiment"校验)。 */
  experiment?: string | string[];
  /** --report 报告文件:相对 cwd 的路径。装载失败抛 ReportLoadError(CLI 打印后退出)。 */
  report?: { path: string; cwd: string };
  /** --theme 的显式模块路径或内建名。 */
  theme?: { value: string; cwd: string };
  /** niceeval.config.ts 的读面默认值。 */
  config?: { report?: ReportDefinition; theme?: ThemeDefinition };
  /** --page:多页报告的初始页 id;未命中任何页按用法错误退出并列出可用页 id。 */
  page?: string;
  /** --fresh:报告槽 Selection 只含新执行的 attempt;不改变有效根的收窄(见 view.md「打开与收窄」)。 */
  fresh?: boolean;
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
  producer?: Run["producer"];
}

/** 用能读这份报告的 niceeval 版本查看的命令;第三方 harness 的落盘拼不出 npx,返回 undefined。 */
export function incompatibleViewCommand(run: IncompatibleRun): string | undefined {
  if (run.producer && run.producer.name !== "niceeval") return undefined;
  return `npx niceeval@${run.producer?.version ?? "<version>"} view --run ${run.dir}/run.json`;
}

/** 版本不匹配的完整提示文案;CLI 单文件模式和目录扫描占位共用。 */
export function incompatibleHint(run: IncompatibleRun): string {
  const command = incompatibleViewCommand(run);
  if (command === undefined) {
    // 第三方 harness:如实报名字和版本,不拼 npx(docs/feature/record/library.md 的裁决)。
    return t("cli.view.incompatibleForeign", {
      dir: run.dir,
      name: run.producer?.name ?? "?",
      version: run.producer?.version ?? "?",
      schemaVersion: run.schemaVersion,
      supported: RECORD_SCHEMA_VERSION,
    });
  }
  return t("cli.view.incompatible", {
    dir: run.dir,
    producer: run.producer?.version ?? "?",
    schemaVersion: run.schemaVersion,
    supported: RECORD_SCHEMA_VERSION,
    command,
  });
}

/** 单文件模式读到版本不同的 run 时抛出;CLI 捕获后打印提示退出,不当成普通错误堆栈。 */
export class IncompatibleResultsError extends Error {
  constructor(readonly run: IncompatibleRun) {
    super(incompatibleHint(run));
    this.name = "IncompatibleResultsError";
  }
}

/**
 * 服务/解析 artifact 的根目录:输入是目录就用它,是文件就上跳两层(run.json 恒在
 * `<root>/<experiment-dir>/<run-dir>/run.json`,root 是 AttemptRef.run
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

/**
 * 读跨历史「每 (experimentId, evalId) 最新一份」的 EvalResult,供续跑携带已通过结果。
 * 只看最近一个快照不行:部分补跑(位置参数只跑几道题)会把携带基线换成那个部分快照,
 * 之后重跑任何实验都携带不到东西,`exp <组>` 的「补齐缺失」语义随之失效。
 * 同一 (experimentId, evalId) 的多个 attempt 整批取自含它的最新快照,不跨快照混装。
 * 携带条目要能被 view 找回 artifact,这里同时把 artifactBase(相对结果根)拼好(runner 依赖它)。
 */
export async function loadLatestResultsPerEval(root = ".niceeval"): Promise<EvalResult[]> {
  return (await loadCarryInputs(root)).results;
}

/**
 * 携带规划要的两份输入,一次扫描出齐(`openRecord` 会 parse 全根每一个 `result.json`,读两遍不划算):
 *
 * - `results` —— 每 `(experimentId, evalId)` 最新一份的 `EvalResult`,口径见 `loadLatestResultsPerEval`。
 * - `flagBagsByExperiment` —— 该实验**全部历史快照**记下过的 `ExperimentRunInfo.flags`(按内容去重)。
 *   [provenance flag](../../docs/feature/experiments/library.md) 的反事实重算拿它当候选假设:
 *   「把 flags 换成这一袋,指纹还相等吗」。候选来自哪个快照不重要——重算相等本身就是证明。
 *   必须扫全历史而不是只看结果所在的那一份:携带条目原样带着**产出它那一轮**的指纹合入新快照,
 *   而新快照记的是**本轮**的 flags,两者在坐标轮换后天然对不上;产出那一轮的 flags 只在更早的
 *   快照里留着。
 */
export async function loadCarryInputs(
  root = ".niceeval",
): Promise<{ results: EvalResult[]; flagBagsByExperiment: Map<string, globalThis.Record<string, JsonValue>[]> }> {
  const results = await openRecord(root);
  const out: EvalResult[] = [];
  const flagBagsByExperiment = new Map<string, globalThis.Record<string, JsonValue>[]>();
  for (const exp of results.experiments) {
    const bags: globalThis.Record<string, JsonValue>[] = [];
    const seenBags = new Set<string>();
    for (const run of exp.runs) {
      const flags = run.experiment?.flags;
      if (flags === undefined) continue;
      const key = JSON.stringify(Object.entries(flags).sort());
      if (seenBags.has(key)) continue;
      seenBags.add(key);
      bags.push(flags);
    }
    if (bags.length > 0) flagBagsByExperiment.set(exp.id, bags);
  }
  for (const exp of results.experiments) {
    // exp.runs 已按新→旧排序;同一快照内先收本轮的 eval id,收完再整体入 claimed,
    // 保证同 (experiment, eval) 的多 attempt 整批取自同一个快照。
    const claimed = new Set<string>();
    for (const run of exp.runs) {
      const takenThisSnapshot = new Set<string>();
      for (const ev of run.evals) {
        if (claimed.has(ev.id)) continue;
        takenThisSnapshot.add(ev.id);
        for (const attempt of ev.attempts) out.push(withArtifactBase(attempt));
      }
      for (const id of takenThisSnapshot) claimed.add(id);
    }
  }
  return { results: out, flagBagsByExperiment };
}

/**
 * `niceeval view` 的数据装载入口:server 每次请求现读现算,`--out` 导出用同一份。
 * 报告槽 Selection 恒经 currentSample 合成(现刻水位;与 `niceeval show` 调同一个
 * 函数,裸跑与局部收窄不分叉),位置前缀 / --exp 只作为 scope 传入,不切换选择口径。
 * --report 本身不改挑选——它只换报告槽的填充,注入的 Selection 与裸跑同一份,
 * 「裸跑 ≡ --report <ExperimentComparison>」靠这条成立(docs/feature/reports/architecture.md「Selection 是计算入口」)。
 * 命令行收窄作用在有效根上(docs/feature/reports/view.md 开篇):证据室数据与 artifact 清单
 * 与页面一致地只含收窄后的范围,本地与导出无分叉——收窄导出的站点(烘进 HTML 的数据、
 * 证据文件)只含收窄到的内容。收窄之内、不在现刻水位里的历史 attempt 仍在有效根里,深链可达。
 * 零可读结果一律抛 ViewInputError,不渲染/导出空页面(server 起不来,--out 非零退出)。
 */
export async function loadViewScan(input?: string, opts: ViewScanOptions = {}): Promise<ViewScan> {
  const target = resolve(input ?? ".niceeval");
  const root = viewRoot(input);
  const results = await openRecord(target);
  assertSingleFileReadable(results, target);

  const patterns = opts.patterns ?? [];

  // 零可读结果直说,不渲染/导出一张空页面(与 show 的「匹配不到直说」同一原则;
  // CI 静态发布还靠这个非零退出保住上一次部署,空报告不顶上线)。零可读最常见的
  // 根因不是目录空,而是落盘整批 schemaVersion 不兼容被跳过,所以带上 unreadable 摘要。
  if (results.experiments.length === 0) {
    throw new ViewInputError(noReadableResults(target, results.unreadable));
  }
  if (
    opts.experiment !== undefined &&
    results.experiments.length > 0 &&
    filterExperiments(results.experiments, opts.experiment).length === 0
  ) {
    throw new ViewInputError(
      t("cli.show.noExperimentMatch", {
        arg: Array.isArray(opts.experiment) ? opts.experiment.join(", ") : opts.experiment,
        experiments: results.experiments.map((e) => e.id).join(", "),
      }).trimEnd(),
    );
  }

  // 报告槽 Selection:恒经现刻水位选择器合成,与 show 裸跑同口径(两扇门判定不分叉)。
  const selection = currentSample(results, { experiments: opts.experiment, evals: patterns, fresh: opts.fresh });

  if (patterns.length > 0 && selection.runs.every((s) => s.evals.length === 0)) {
    const known = [
      ...new Set(filterExperiments(results.experiments, opts.experiment).flatMap((e) => e.knownEvalIds)),
    ].sort();
    throw new ViewInputError(
      t("cli.show.noEvalMatch", { pattern: patterns.join(", "), evals: known.join(", ") || "(none)" }).trimEnd(),
    );
  }

  // 报告槽:裸跑装载内建报告默认导出,--report 整槽替换——同一条「装载 → 规范化 → 逐页渲染」
  // 管线(docs/feature/reports/library/shell.md)。报告吃同一份注入 Sample,web 面在计算侧
  // 静态渲染成 HTML(en / zh-CN 各一遍,切界面语言不重算数据)。
  const slot = await renderReportSlot(opts.report, opts.theme, opts.config, opts.page, results, selection, opts.pageFailure ?? "throw");

  // 有效根:命令行收窄把根滤成只含匹配实验与 attempt(docs/feature/reports/view.md 开篇)。
  // 证据室数据与 artifact 清单从这里取数,与页面 Sample 一致收窄——本地与导出无分叉,
  // 收窄导出的站点(烘进 HTML 的数据、证据文件)只含收窄后的范围。
  const scopedExperiments = filterExperiments(results.experiments, opts.experiment);
  const matchEval = patterns.length > 0 ? evalPrefixPredicate(patterns) : () => true;

  // 跨快照按身份键去重:--resume 携带的条目在多份落盘里重复,只保留最新快照里的那份
  // (与官方计算函数的聚合口径一致,attempt/<locator>.html 的计数因此不被复印件灌票)。
  const artifactDirs = new Map<string, string>();
  const attemptsByBase = new Map<string, AttemptHandle>();
  // 报告没有 attempt-input page 时不建这份索引:没有 attempt/ 目录,站点管线不需要它
  // (view.md「静态导出」)。
  const attemptsByLocator = slot.attemptPage ? new Map<AttemptLocator, AttemptHandle>() : undefined;
  const allAttempts: AttemptHandle[] = [];
  for (const exp of scopedExperiments) {
    for (const snap of exp.runs) allAttempts.push(...snap.attempts.filter((a) => matchEval(a.evalId)));
  }
  for (const attempt of dedupeAttempts(allAttempts).attempts) {
    const { base, abs } = artifactLocation(attempt, root);
    artifactDirs.set(base, abs);
    attemptsByBase.set(base, attempt);
    if (attemptsByLocator && attempt.locator !== undefined) attemptsByLocator.set(attempt.locator, attempt);
  }

  // 全局最新快照(跨有效根内全部实验):viewData.lastRunAt 从这里取。页内 hero 的「最后运行」
  // 显示由 Hero 组件按 heroData(scope) 自己算,不吃这份字段。
  let latestSnapshot: Run | undefined;
  for (const exp of scopedExperiments) {
    const candidate = exp.runs[0];
    if (!candidate) continue;
    if (!latestSnapshot || candidate.startedAt > latestSnapshot.startedAt) latestSnapshot = candidate;
  }

  const viewData: ViewData = {
    ...(latestSnapshot ? { lastRunAt: latestSnapshot.startedAt } : {}),
    // 合成 Sample 的快照是跨快照拼出来的,来源物理 run 数从 attempt 自己的 run
    // 反向引用取——每个 attempt 的 .run 恒指向它真实所在的贡献快照(无论 Sample
    // 是否合成),所以这条对裸跑与收窄一律成立,不需要分支。
    composedRuns: new Set(selection.runs.flatMap((s) => s.attempts.map((a) => a.run.dir))).size,
    skippedRuns: results.unreadable.map(toSkippedNotice),
    report: slot.meta,
  };
  return {
    viewData,
    artifactDirs,
    attemptsByBase,
    reportPages: slot.pages,
    shellAssets: slot.shellAssets,
    ...(slot.attemptPage && attemptsByLocator
      ? { attemptPages: { page: slot.attemptPage, locators: attemptsByLocator, render: slot.renderAttemptPage } }
      : {}),
  };
}

/**
 * base(withArtifactBase 同一公式)→ AttemptHandle 的轻量索引,供 server.ts 的 artifact 路由
 * 按 URL 反查 attempt——只有 sources.json 请求需要这份索引(其余 artifact 直接读盘文件更便宜),
 * 所以特意不跑 loadViewScan 的全套 Selection 合成 + 报告双语渲染,只做一次 openRecord() 扫描。
 * 不做去重收窄:遍历全部落盘 attempt,同一 base 只可能来自同一份物理落盘,历史快照里被去重
 * 吸走的重复条目 base 天然不同,不会冲突;不会被 UI 引用的 base 混进来也无害(纯查表,
 * 从不主动枚举 key)。
 */
export async function loadAttemptIndex(input?: string): Promise<Map<string, AttemptHandle>> {
  const target = resolve(input ?? ".niceeval");
  const results = await openRecord(target);
  const index = new Map<string, AttemptHandle>();
  for (const exp of results.experiments) {
    for (const snap of exp.runs) {
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

/**
 * head 标签的解析形态:attrs 里的本地 `src` / `href` 已解析成宿主机绝对路径,
 * 由站点管线(site.ts)按内容哈希物化为 `assets/<sha256><ext>` 并回填该属性;
 * 外链与无资产标签原样透传(shell.md「行为约束」)。
 */
export interface ResolvedHeadTag {
  tag: "meta" | "link" | "script" | "style";
  attrs: globalThis.Record<string, string | true>;
  children?: string;
  localAsset?: { attr: "src" | "href"; abs: string; ext: string };
}

/** head 标签 attrs 的 src/href 解析:外链透传,本地路径按 `{src}` 同一路径纪律落成绝对路径并验存在。 */
function resolveShellHead(tags: readonly HeadTag[], baseDir: string | undefined): ResolvedHeadTag[] {
  const out: ResolvedHeadTag[] = [];
  for (const entry of tags) {
    const attrs = { ...(entry.attrs ?? {}) };
    const resolved: ResolvedHeadTag = {
      tag: entry.tag,
      attrs,
      ...(entry.children !== undefined ? { children: entry.children } : {}),
    };
    for (const attr of ["src", "href"] as const) {
      const value = attrs[attr];
      if (typeof value !== "string" || /^https?:\/\//i.test(value)) continue;
      // 形状与 scheme 已在 defineReport 装载期校验;这里只剩本地文件的存在性。
      if (value.startsWith("/") || value.startsWith("~") || value.split("/").includes("..")) {
        throw new ViewInputError(
          `Report head <${entry.tag}> ${attr} "${value}" is not a plain relative path. Assets resolve relative to the report file; ".." segments, absolute paths and "~" are not allowed.`,
        );
      }
      const abs = resolve(baseDir ?? process.cwd(), value);
      try {
        statSync(abs);
      } catch {
        throw new ViewInputError(`Report head <${entry.tag}> ${attr} asset not found: ${abs} (declared as "${value}").`);
      }
      resolved.localAsset = { attr, abs, ext: extname(abs) };
      break;
    }
    out.push(resolved);
  }
  return out;
}

/** 外壳 `{src}` 资产的路径纪律(shell.md「行为约束」):相对报告文件解析;拒绝 `..` 路径段、绝对路径与 `~`。 */
function resolveShellAssets(assets: readonly ReportAsset[], baseDir: string | undefined, kind: "styles" | "scripts"): string[] {
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

/** 主题样式与报告外壳资产同一条本地路径纪律；主题文件的 src 相对它自身解析。 */
function resolveThemeStyles(theme: ThemeDefinition, baseDir: string | undefined): string[] {
  return resolveShellAssets(theme.styles ?? [], baseDir, "styles");
}

/**
 * 报告装载与逐页渲染:装载报告文件(--report;dev server 语义 —— 文件变更下次请求整页重算,
 * 经 mtime cache-busting),缺省装载内建报告默认导出 → 规范化成「外壳 + 非空页列表」→
 * 注入 Sample → 每页 web 面渲染成静态 HTML,en / zh-CN 各渲染一遍(chrome 文案按 locale)。
 * 本地 server 下单页渲染失败折成该页的完整错误反馈块,其它页照常可读(静态导出的
 * 「任一页失败整体失败」由 buildView 侧的 failFast 保证)。
 * react / react-dom 动态加载:data.ts 还被 runner 的续跑携带(loadLatestResultsPerEval)
 * 消费,渲染依赖不进那条路径。attemptHref 缺省即 `#/attempt/@<locator>` 深链路由,
 * 报告页深链与证据室深链是同一条路由的两个来源。
 */
async function renderReportSlot(
  report: { path: string; cwd: string } | undefined,
  theme: { value: string; cwd: string } | undefined,
  config: { report?: ReportDefinition; theme?: ThemeDefinition } | undefined,
  page: string | undefined,
  results: Record,
  selection: Sample,
  pageFailure: "throw" | "embed" = "throw",
): Promise<{
  meta: ViewReportMeta;
  pages: ViewReportPageHtml[];
  shellAssets: { styles: string[]; scripts: string[]; head: ResolvedHeadTag[] };
  attemptPage: ReportPage | undefined;
  renderAttemptPage: (locator: AttemptLocator, handle: AttemptHandle) => Promise<{ en: string; "zh-CN": string }>;
}> {
  // 报告 runtime 走预编译产物(dist/report/**,`pnpm run build:report` 产出),不受 view
  // 消费方 cwd/tsconfig 影响;装载与渲染统一经 ../report/runtime/host.ts(两个宿主共用的中性联系面)。
  const hostReport: ReportDefinition = await loadHostReport(report?.cwd ?? process.cwd(), report?.path, config?.report, {
    freshImport: true,
  });
  const hostTheme = await resolveHostTheme(theme?.cwd ?? report?.cwd ?? process.cwd(), theme?.value, hostReport.theme, config?.theme, {
    freshImport: true,
  });

  // scope-input pages 只有这些参与本函数的「全部烘进 index.html」渲染;attempt-input page(如果
  // 报告声明了)没有 locator 就不能 resolve,它的每-locator 静态文档是独立机制,不在这里渲染
  // (docs/feature/reports/architecture.md「Attempt 详情是一张参数化 page」)。
  const scopePages = hostReport.pages.filter((p) => p.input !== "attempt");
  const navigablePages = scopePages.filter((p) => p.navigation !== false);

  const initialPageId = page ?? navigablePages[0]?.id ?? scopePages[0]?.id;
  const initialPage = initialPageId !== undefined ? scopePages.find((p) => p.id === initialPageId) : undefined;
  if (initialPageId === undefined || !initialPage) {
    const requested = hostReport.pages.find((p) => p.id === page);
    if (requested?.input === "attempt") {
      throw new ViewInputError(
        `error: page "${page}" in ${report?.path ?? "the built-in report"} is an attempt-input page and needs a locator — it cannot be opened as the initial page directly.`,
      );
    }
    throw new ViewInputError(
      `error: page "${page}" not found in ${report?.path ?? "the built-in report"}. Available pages: ${navigablePages.map((p) => p.id).join(", ")}`,
    );
  }

  const reportDir = report ? dirname(resolve(report.cwd, report.path)) : undefined;
  const shellAssets = {
    styles: [await hostThemeStylesheet(hostTheme), ...resolveThemeStyles(hostTheme, theme ? dirname(resolve(theme.cwd, theme.value)) : undefined), ...resolveShellAssets(hostReport.styles, reportDir, "styles")],
    scripts: resolveShellAssets(hostReport.scripts, reportDir, "scripts"),
    head: resolveShellHead(hostReport.head, reportDir),
  };

  const hostMeta = await buildHostReportMeta(hostReport, selection);
  const pages: ViewReportPageHtml[] = [];
  for (const hostPage of scopePages) {
    const ctx = {
      scope: selection,
      results,
      report: hostMeta,
      page: { id: hostPage.id, input: "scope" as const },
      dimensionPins: hostReport.dimensionPins,
    };
    try {
      const resolved = await resolveHostPage(hostPage.content, ctx);
      pages.push({
        id: hostPage.id,
        html: {
          en: await renderHostPageFromResolved(resolved, { locale: "en" }),
          "zh-CN": await renderHostPageFromResolved(resolved, { locale: "zh-CN" }),
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
    title: hostMeta.title,
    links: [...hostReport.links],
    ...(hostReport.footer !== undefined ? { footer: hostReport.footer } : {}),
    // 每一张要烘进 index.html 的 scope-input page 都在列(这份列表同时是 <template> 静态块与
    // `#/page/<id>` 路由的键),声明了 `navigation: false` 的带标记出场——导航列不列由外壳按标记
    // 决定,不靠从列表里删页实现(docs/feature/reports/view.md「导航机器与品牌位」)。
    pages: scopePages.map((p) => ({ id: p.id, title: p.title, ...(p.navigation === false ? { navigation: false as const } : {}) })),
    initialPageId,
  };

  const attemptPage = hostReport.pages.find((p) => p.input === "attempt");
  // 装配一个 locator 的 AttemptEvidence 并渲染该 page 两种语言的内容 HTML(不含外层文档);
  // pageFailure 语义与 scope pages 相同 —— 本地 server 折成该文档的完整错误反馈块,
  // 静态导出直接抛出(writeSite 侧汇总成「整体失败,不留半套目录」)。
  const renderAttemptPage = async (
    locator: AttemptLocator,
    handle: AttemptHandle,
  ): Promise<{ en: string; "zh-CN": string }> => {
    const evidence = await loadAttemptEvidence(handle);
    const ctx = {
      scope: selection,
      results,
      report: hostMeta,
      page: { id: attemptPage!.id, input: "attempt" as const, locator, evidence },
      dimensionPins: hostReport.dimensionPins,
    };
    try {
      const resolved = await resolveHostPage(attemptPage!.content, ctx);
      return {
        en: await renderHostPageFromResolved(resolved, { locale: "en", attemptHref: SIBLING_ATTEMPT_HREF }),
        "zh-CN": await renderHostPageFromResolved(resolved, { locale: "zh-CN", attemptHref: SIBLING_ATTEMPT_HREF }),
      };
    } catch (e) {
      if (pageFailure !== "embed") throw e;
      const message = e instanceof Error ? e.message : String(e);
      const block = `<div class="nre nre-page-error"><pre>${escapeHtml(message)}</pre></div>`;
      return { en: block, "zh-CN": block };
    }
  };

  return { meta, pages, shellAssets, attemptPage, renderAttemptPage };
}

/**
 * 单文件模式(`niceeval view path/to/run.json`)是用户明确指定的目标:
 * 读不了就让命令失败并给可执行的下一步,不打开一个空页面。目录模式不走这里
 * (读不了的进 unreadable,页面顶部横幅展示,单个坏快照不拖垮整页)。
 */
function assertSingleFileReadable(results: Record, target: string): void {
  let isFile = false;
  try {
    isFile = statSync(target).isFile();
  } catch {
    return; // 目标不存在:按空结果渲染(还没跑过 eval 不是错误)。
  }
  const hasSnapshots = results.experiments.some((e) => e.runs.length > 0);
  if (!isFile || hasSnapshots) return;
  const skip = results.unreadable[0];
  if (skip?.reason === "incompatible") {
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
  throw new Error(`${target} is not a niceeval run`);
}

/**
 * 一条 attempt 的 artifact 目录:相对 view 根的 base(前端据此 fetch trace.json 等)与宿主机
 * 绝对路径。本快照跑出的条目落盘没有 artifactBase 字段,按 `${ref.run}/${ref.attempt}`
 * 现算;携带条目(--resume 合入)落盘自带 artifactBase,指向原快照,原样沿用。绝对路径只
 * 回给调用方写进 artifactDirs(server 端内存),不进 viewData,避免随静态 HTML 泄漏宿主机路径。
 */
function artifactLocation(attempt: AttemptHandle, root: string): { base: string; abs: string } {
  const base = attempt.result.artifactBase ?? `${attempt.ref.run}/${attempt.ref.attempt}`;
  return { base, abs: join(root, base) };
}

/**
 * 零可读结果的报错文案。目录真空时给「先跑一轮」的入门提示(与 show 的 noResults 同形态);
 * 有 unreadable 时逐条列目录与原因——schemaVersion 不兼容的 niceeval 落盘给出可跑的
 * npx 命令,让「全被跳过」和「真没跑过」在错误里就能分清,不用进查看器排查。
 */
function noReadableResults(target: string, unreadable: UnreadableRun[]): string {
  if (unreadable.length === 0) return t("cli.view.noResults", { root: target }).trimEnd();
  const lines = unreadable.map((skip) => {
    const notice = toSkippedNotice(skip);
    const version = notice.schemaVersion !== undefined ? `, schemaVersion ${notice.schemaVersion}` : "";
    const hint = notice.command ? ` — view it with \`${notice.command.trim()}\`` : "";
    return `  ${notice.dir}: ${notice.reason}${version}${hint}`;
  });
  const runs = unreadable.length === 1 ? "1 run directory was" : `${unreadable.length} run directories were`;
  return [
    `No readable results under ${target} — ${runs} unreadable:`,
    ...lines,
    "Re-run your experiments with this niceeval to produce fresh results.",
  ].join("\n");
}

function toSkippedNotice(skip: UnreadableRun): SkippedRunNotice {
  const dir = relative(process.cwd(), skip.dir) || ".";
  const command =
    skip.reason === "incompatible" && skip.producer?.name === "niceeval" && skip.producer.version
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
