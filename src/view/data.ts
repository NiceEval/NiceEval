// view 的数据层:读取经 niceeval/record 的 openRecord(布局/版本知识只住在那)。
// 这里只做编排:报告槽 Sample 恒经 currentSample(现刻水位;与 show 调同一个函数,
// 两扇门判定不分叉)、快照明细注入(locator / artifactBase)、unreadable 透传、报告装载与逐页渲染
// (裸跑填充 niceeval/report/built-in 的默认导出,--report 整槽替换,en / zh-CN 双语各渲染一遍)。
// --report 只换报告定义,注入的 Sample 与裸跑同一份。统计口径整体住在报告页里
// (报告组件的官方计算函数),viewData 不再携带 overview / 实验列表这类统计产物,
// 见 docs/feature/reports/README.md「打开与收窄」。

import { readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { evalDirOf, experimentDirOf } from "../record/format.ts";
import { MANIFESTS_FILE, parseRunManifests, type EvalManifest, type RunManifests } from "../record/manifest.ts";
import { dedupeAttempts, loadAttemptEvidence, openRecord, withArtifactBase } from "../record/index.ts";
import type { AttemptHandle, Record, Sample, Run, UnreadableRun } from "../record/index.ts";
import { resolveLocator } from "../record/open.ts";
import { buildHostReportMeta,
  hostThemeStylesheet,
  loadHostReport,
  materializeHostPageRendererAssets,
  renderHostPageFromResolved,
  resolveHostPage,
  resolveHostTheme,
  type ReportAsset,
  type ReportDefinition,
  type ReportPage,
  type ResolvedPage,
  type ReportTarget,
  type PageLoadContext,
  type HeadTag,
  type ThemeDefinition,
} from "../report/runtime/host.ts";
import { currentSample, filterExperiments, makeSample } from "../sample/index.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import type { EvalResult, JsonValue } from "../types.ts";
import type { SkippedRunNotice, ViewData, ViewReportMeta, ViewReportPageHtml } from "./shared/types.ts";
import type { ReportLocale } from "../report/model/locale.ts";
import { t } from "../i18n/index.ts";
import { RECORD_SCHEMA_VERSION } from "../types.ts";

export type { ViewReportMeta, ViewReportPageHtml } from "./shared/types.ts";

/**
 * 一次装载出的报告与主题定义。记录变更的重建沿用上一次装载出的这一份,只有闭集里的模块
 * 文件变过才重新装载(docs/feature/reports/README.md「变更分两类,失效到不同深度」)——
 * 模块图没变时重新装载得到的是同一份定义,代价却是把整棵图连同 niceeval 自身重新求值一遍。
 */
export interface LoadedDefinitions {
  report: ReportDefinition;
  theme: ThemeDefinition;
}

/**
 * 报告页的按需渲染面。同一 `(pageId, locale)` 只渲染一次;同一 pageId 的两种语言共用一次
 * page resolve(architecture.md「一次 page resolve 的缓存」),所以按语言分块不会把取数算两遍。
 */
export interface ReportPageRenderer {
  /** scope-input pages 的 id,声明顺序(= `#/page/<id>` 路由与 <template> 块的键)。 */
  ids: readonly string[];
  render(pageId: string, locale: ReportLocale): Promise<string>;
  /** 该 page 实际出现的自定义 renderer 资产；与两种 locale 共用同一次 resolve。 */
  assets(pageId: string): Promise<import("../report/extension/types.ts").PageRendererAssets>;
}

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
   * 报告页的按需渲染面:裸跑填充内建报告(单页 id `report`),--report 整槽替换(树 / 配置对象
   * 形态都规范化成页列表)。渲染出的块作为 <template id="niceeval-report-<pageId>-<locale>">
   * 烘进页面(与 __NICEEVAL_VIEW_DATA__ 相邻),HTML 本体不进 viewData —— 前端只负责把当前页 /
   * 当前界面语言对应的块摆进报告槽位置,不解析。渲染哪些块由宿主决定
   * (docs/feature/reports/README.md「只渲染看得见的那一块」):`--out` 全渲,本地模式只渲订阅中那块。
   */
  reportPages: ReportPageRenderer;
  /** 外壳注入资产(styles / scripts;{src} 已按路径纪律解析成 inline 内容),只进 web 面。 */
  shellAssets: { styles: string[]; scripts: string[]; head: ResolvedHeadTag[] };
  /** 这次扫描用到的报告与主题定义;下一次记录变更的重建原样传回来沿用。 */
  definitions: LoadedDefinitions;
  /**
   * view 恒有全部参数化页（`attempt`、`experiment`……）：报告显式声明的优先，否则用内建
   * `standard` 同 id 的参数化页补位(architecture.md「参数化页是一张普通 page」);核心
   * 不区分实体种类,这份索引按 page id 通用,不为某一种实体单独开字段。
   * 每个条目的 `instances` 是收窄后有效根内 `page.params.enumerate()` 给出的全部实例
   * (encoded key,未经 URL 编码 → 该实例的 params;与 scope-input pages 同一份
   * `scopedExperiments ∩ matchEval ∩ 去重` 口径——去重只吞掉 `--resume` 携带的字面重复,
   * 不排除真实历史 attempt,见 view.md「打开与收窄」);站点管线(site.ts)据此为每个实例
   * 生成一份 `<pageId>/<key>.html`,不在这份索引里的 key 不出站。
   * `render(key)` 装配该实例的输入(`page.load` 或宿主 Sample)并渲染该 page 两种语言的内容
   * HTML(不含外层文档 —— 独立 HTML 文档的组装是 site.ts 的事);pageFailure 语义与 scope
   * pages 一致。
   */
  paramPages: Map<
    string,
    {
      page: ReportPage;
      instances: Map<string, JsonValue>;
      render(key: string): Promise<{
        en: string;
        "zh-CN": string;
        assets: import("../report/extension/types.ts").PageRendererAssets;
      }>;
    }
  >;
}

/**
 * 参数化页文档内容(不是 index.html 的 scope page)引用其它目标时的相对 href:同一张页的其它
 * 实例是同目录兄弟文档(`<key>.html`),不同页是兄弟目录(`../<pageId>/<key>.html`)——两种参数化页
 * 文档都住在站点根下的 `<pageId>/` 目录,互为兄弟(site.ts「静态导出」)。
 */
function nestedTargetHref(
  targetHref: (pages: readonly Pick<ReportPage, "id" | "params">[], target: ReportTarget) => string | undefined,
  pages: readonly Pick<ReportPage, "id" | "params">[],
  currentPageId: string,
): (target: ReportTarget) => string | undefined {
  return (target) => {
    const rootRelative = targetHref(pages, target);
    if (rootRelative === undefined) return undefined;
    return target.page === currentPageId ? rootRelative.slice(currentPageId.length + 1) : `../${rootRelative}`;
  };
}

/** view 宿主输入的组合语义(与 show 对齐,docs/feature/reports/README.md「Sample 是计算入口」)。 */
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
  /**
   * 项目配置目录:每次 scan 用 namespaced import 重装 niceeval.config.ts,
   * 取 `report` / `theme`(docs/feature/reports/README.md「持续重建」——config.report
   * 及其 import 图与 --report 文件同级失效)。不预烘焙成对象。
   */
  config?: { cwd: string };
  /** --page:多页报告的初始页 id;未命中任何页按用法错误退出并列出可用页 id。 */
  page?: string;
  /**
   * 单页渲染失败的处置(docs/feature/reports/README.md「管线以页为单位执行」):
   * 本地 server 传 "embed"(该页显示完整错误反馈,其它页照常可读);静态导出与启动前预检
   * 缺省 "throw"(任一页失败整体失败,不产出半套站点)。
   */
  pageFailure?: "throw" | "embed";
  /**
   * 沿用上一次装载出的报告与主题定义,跳过这一次的模块装载。只有记录变更触发的重建传它
   * (docs/feature/reports/README.md「变更分两类,失效到不同深度」);闭集里的模块文件变过时
   * 不传,让整棵 import 图重新装载。
   */
  definitions?: LoadedDefinitions;
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
 * - `manifestsByEvalKey` —— `${experimentId}|${evalId}` → **产出上面那条结果的那一份 Run**
 *   写下的指纹输入清单。差异解释要的是「那一轮的输入长什么样」,所以它与 `results` 取自同一个
 *   Run,不取最新那份;那一轮没写清单的 key 就是缺席,差异如实标 `opaque:no-manifest`。
 * - `incompatibleHistory` —— 版本不兼容的快照里出现过哪些坐标(键见 `incompatibleHistoryKey`)。
 *   这些落盘不解析、不进 `results`,但「这条 eval 跑过、只是那份格式读不动」与「从没跑过」
 *   是两件事:`--dry` 的原因词据此把它标 `incompatible` 而不是 `new`。
 */
export async function loadCarryInputs(
  root = ".niceeval",
): Promise<{
  results: EvalResult[];
  evidenceStatesByAttempt: Map<string, "local" | "borrowed" | "dangling">;
  flagBagsByExperiment: Map<string, globalThis.Record<string, JsonValue>[]>;
  manifestsByEvalKey: Map<string, EvalManifest>;
  incompatibleHistory: Set<string>;
}> {
  const results = await openRecord(root);
  const out: EvalResult[] = [];
  const evidenceStatesByAttempt = new Map<string, "local" | "borrowed" | "dangling">();
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
  const manifestsByEvalKey = new Map<string, EvalManifest>();
  for (const exp of results.experiments) {
    // exp.runs 已按新→旧排序;同一快照内先收本轮的 eval id,收完再整体入 claimed,
    // 保证同 (experiment, eval) 的多 attempt 整批取自同一个快照。
    const claimed = new Set<string>();
    for (const run of exp.runs) {
      const takenThisSnapshot = new Set<string>();
      for (const ev of run.evals) {
        if (claimed.has(ev.id)) continue;
        takenThisSnapshot.add(ev.id);
        for (const attempt of ev.attempts) {
          out.push(withArtifactBase(attempt));
          evidenceStatesByAttempt.set(
            `${run.experimentId}|${ev.id}|${attempt.result.attempt}`,
            attempt.evidenceState,
          );
        }
      }
      // 清单只读这一份 Run 的:结果取自它,解释也必须取自它。有条目被取用才读盘。
      if (takenThisSnapshot.size > 0) {
        const manifests = await readRunManifests(run.dir);
        for (const id of takenThisSnapshot) {
          const manifest = manifests[id];
          if (manifest !== undefined) manifestsByEvalKey.set(`${run.experimentId}|${id}`, manifest);
        }
      }
      for (const id of takenThisSnapshot) claimed.add(id);
    }
  }
  return {
    results: out,
    evidenceStatesByAttempt,
    flagBagsByExperiment,
    manifestsByEvalKey,
    incompatibleHistory: await scanIncompatibleHistory(root, results.unreadable),
  };
}

/**
 * 「这个坐标有历史,但那份落盘的 schemaVersion 与本读取器不同」的判定键。
 * 不兼容的快照按格式规则整份不解析(docs/feature/record/architecture.md「版本不匹配时的读取
 * 行为」),所以坐标只能按目录名认:实验目录与 eval 目录恒由 `experimentDirOf` / `evalDirOf`
 * 决定,这两个函数就是这里唯一用到的跨版本稳定知识。
 */
export function incompatibleHistoryKey(experimentId: string, evalId: string): string {
  return `${experimentDirOf(experimentId)}|${evalDirOf(evalId)}`;
}

/** 快照根下的 attempt 目录名:`a<序号>`。 */
const ATTEMPT_DIR_NAME_RE = /^a\d+$/;

/**
 * 扫出版本不兼容的快照都跑过哪些坐标。只读目录名、不读任何文件——那些文件正是读不动的那批。
 * 代价只跟不兼容快照数成正比:没有不兼容落盘时一次 readdir 都不付。
 */
async function scanIncompatibleHistory(root: string, unreadable: UnreadableRun[]): Promise<Set<string>> {
  const keys = new Set<string>();
  const absRoot = resolve(root);
  for (const skipped of unreadable) {
    if (skipped.reason !== "incompatible") continue;
    const segments = relative(absRoot, resolve(skipped.dir)).split(sep);
    if (segments[0] === "..") continue; // 单文件模式:目录不在本次的结果根下
    // 快照目录恒是 `<root>/<实验目录>/<快照目录>`;裸跑(没有 experimentId)少一层,实验目录是空串。
    const experimentDir = segments.length >= 2 ? segments[0]! : "";
    for (const evalDir of await evalDirsUnder(skipped.dir, "", 0)) keys.add(`${experimentDir}|${evalDir}`);
  }
  return keys;
}

/**
 * 快照根下含 attempt 目录的那些相对路径(= eval 目录)。eval id 里的 `/` 落盘时保留成目录
 * 层级,所以要往下走;深度按 eval id 的段数封顶,不做无界遍历。
 */
async function evalDirsUnder(dir: string, prefix: string, depth: number): Promise<string[]> {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 目录读不动:当作没有历史,与它原本的处理一致
  }
  const dirs = entries.filter((e) => e.isDirectory());
  if (prefix !== "" && dirs.some((e) => ATTEMPT_DIR_NAME_RE.test(e.name))) return [prefix];
  const out: string[] = [];
  for (const entry of dirs) {
    out.push(...await evalDirsUnder(join(dir, entry.name), prefix === "" ? entry.name : `${prefix}/${entry.name}`, depth + 1));
  }
  return out;
}

/** 一份 Run 的 `manifests.json`;文件不在(那一轮早于清单落盘)或读不动都按「没有清单」。 */
async function readRunManifests(dir: string): Promise<RunManifests> {
  try {
    return parseRunManifests(JSON.parse(await readFile(join(dir, MANIFESTS_FILE), "utf-8")));
  } catch {
    return {};
  }
}

/**
 * `niceeval view` 的数据装载入口:server 每次请求现读现算,`--out` 导出用同一份。
 * 报告槽 Selection 恒经 currentSample 合成(现刻水位;与 `niceeval show` 调同一个
 * 函数,裸跑与局部收窄不分叉),位置前缀 / --exp 只作为 scope 传入,不切换选择口径。
 * --report 本身不改挑选——它只换报告槽的填充,注入的 Selection 与裸跑同一份,
 * 「裸跑 ≡ --report <ExperimentComparison>」靠这条成立(docs/feature/reports/README.md「Selection 是计算入口」)。
 * 命令行收窄作用在有效根上(docs/feature/reports/README.md 开篇):证据室数据与 artifact 清单
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
  const selection = currentSample(results, { experiments: opts.experiment, evals: patterns });

  if (patterns.length > 0 && selection.runs.every((s) => s.evals.length === 0)) {
    const known = [
      ...new Set(filterExperiments(results.experiments, opts.experiment).flatMap((e) => e.knownEvalIds)),
    ].sort();
    throw new ViewInputError(
      t("cli.show.noEvalMatch", { pattern: patterns.join(", "), evals: known.join(", ") || "(none)" }).trimEnd(),
    );
  }

  // 报告槽:裸跑装载内建报告默认导出,--report 整槽替换——同一条「装载 → 规范化 → 逐页渲染」
  // 管线(docs/feature/reports/README.md)。报告吃同一份注入 Sample,web 面在计算侧
  // 静态渲染成 HTML(en / zh-CN 各一遍,切界面语言不重算数据)。
  const slot = await renderReportSlot(opts.report, opts.theme, opts.config, opts.page, results, selection, opts.pageFailure ?? "throw", opts.definitions);

  // 有效根:命令行收窄把根滤成只含匹配实验与 attempt(docs/feature/reports/README.md 开篇)。
  // 证据室数据与 artifact 清单从这里取数,与页面 Sample 一致收窄——本地与导出无分叉,
  // 收窄导出的站点(烘进 HTML 的数据、证据文件)只含收窄后的范围。
  const scopedExperiments = filterExperiments(results.experiments, opts.experiment);
  const matchEval = patterns.length > 0 ? evalPrefixPredicate(patterns) : () => true;

  // 跨快照按身份键去重:--resume 携带的条目在多份落盘里重复,只保留最新快照里的那份
  // (与官方计算函数的聚合口径一致,<pageId>/<key>.html 的计数因此不被复印件灌票)。
  const artifactDirs = new Map<string, string>();
  const attemptsByBase = new Map<string, AttemptHandle>();
  const allAttempts: AttemptHandle[] = [];
  for (const exp of scopedExperiments) {
    for (const snap of exp.runs) allAttempts.push(...snap.attempts.filter((a) => matchEval(a.evalId)));
  }
  const dedupedAttempts = dedupeAttempts(allAttempts).attempts;
  for (const attempt of dedupedAttempts) {
    const { base, abs } = artifactLocation(attempt, root);
    artifactDirs.set(base, abs);
    attemptsByBase.set(base, attempt);
  }

  // 有效根 Sample:参数化页 `params.enumerate()` 的 base(见 view.md「打开与收窄」——深链对
  // 收窄之内、即使不在现刻水位里的历史 attempt 也能打开)。`attempts` 用上面刚去重的有效根
  // 全集(不是 selection.attempts 的现刻水位),`runs` 用有效根内全部历史快照(不narrowed 到
  // 「现刻贡献」),`coverage` 沿用 selection 的覆盖事实(同一份 scopedExperiments ∩ matchEval
  // 口径算出,已经覆盖零 attempt 的实验)。只用于 `enumerate()`,不参与页面渲染的
  // Selection(那仍是 `selection`)。
  const effectiveRoot: Sample = makeSample(
    "current",
    scopedExperiments.flatMap((exp) => exp.runs),
    dedupedAttempts,
    [],
    selection.coverage,
    dedupedAttempts,
  );

  // 每张参数化页(声明或补位后的最终形态)按 `params.enumerate(effectiveRoot)` 枚举有效根内
  // 全部实例;encode 失败的实例跳过(与 `encodeTargetKey` 的安全求值同一原则,组件侧已经把它
  // 退化成纯文本,这里不该另外抛错打断整个 scan)。
  const paramPages = new Map<
    string,
    { page: ReportPage; instances: Map<string, JsonValue>; render(key: string): ReturnType<typeof slot.renderParamPage> }
  >();
  for (const [id, page] of slot.paramPageDefs) {
    const instances = new Map<string, JsonValue>();
    if (page.params) {
      for (const params of page.params.enumerate(effectiveRoot)) {
        try {
          instances.set(page.params.encode(params), params);
        } catch {
          continue;
        }
      }
    }
    paramPages.set(id, {
      page,
      instances,
      render: (key) => {
        const params = instances.get(key);
        if (params === undefined) throw new Error(`No parameterized page instance "${id}/${key}" exists in this view scope.`);
        return slot.renderParamPage(page, params);
      },
    });
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
    definitions: slot.definitions,
    paramPages,
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
 * 报告装载与逐页渲染:装载报告文件(--report)或项目配置的 report 字段;dev server 语义
 * 经 tsx namespaced import 让入口及其整棵项目内 import 图失效(docs/feature/reports/README.md
 * 「持续重建」),缺省装载内建报告默认导出 → 规范化成「外壳 + 非空页列表」→
 * 注入 Sample → 每页 web 面渲染成静态 HTML,en / zh-CN 各渲染一遍(chrome 文案按 locale)。
 * 本地 server 下单页渲染失败折成该页的完整错误反馈块,其它页照常可读(静态导出的
 * 「任一页失败整体失败」由 buildView 侧的 failFast 保证)。
 * react / react-dom 动态加载:data.ts 还被 runner 的续跑携带(loadLatestResultsPerEval)
 * 消费,渲染依赖不进那条路径。`targetHref` 缺省即 `#/<pageId>/<key>` 深链路由(attempt 形如
 * `#/attempt/@<locator>`,experiment 形如 `#/experiment/<key>`),报告页深链与证据室深链是
 * 同一条路由的两个来源。
 */
async function renderReportSlot(
  report: { path: string; cwd: string } | undefined,
  theme: { value: string; cwd: string } | undefined,
  config: { cwd: string } | undefined,
  page: string | undefined,
  results: Record,
  selection: Sample,
  pageFailure: "throw" | "embed" = "throw",
  reuse?: LoadedDefinitions,
): Promise<{
  meta: ViewReportMeta;
  pages: ReportPageRenderer;
  shellAssets: { styles: string[]; scripts: string[]; head: ResolvedHeadTag[] };
  definitions: LoadedDefinitions;
  /** id → 参数化页(声明或补位后的最终形态);见下方「参数化页补位」。 */
  paramPageDefs: Map<string, ReportPage>;
  renderParamPage: (
    page: ReportPage,
    params: JsonValue,
  ) => Promise<{
    en: string;
    "zh-CN": string;
    assets: import("../report/extension/types.ts").PageRendererAssets;
  }>;
}> {
  // 报告 runtime 与 view 同属一个预编译 canonical graph，不受消费方 cwd/tsconfig 影响；
  // 装载与渲染统一经 ../report/runtime/host.ts(两个宿主共用的中性联系面)。
  // config 每次重建 fresh 装载——不能吃启动时那份已求值的 report 对象,否则改 reports/*.tsx
  // 只会触发 watch/SSE,内容仍是旧定义。
  const loadDefinitions = async (): Promise<LoadedDefinitions> => {
    // 配置模块与 host 都落到同一 canonical graph；私有品牌不再跨源码/构建图重新证明。
    let configReport: ReportDefinition | undefined;
    let configTheme: ThemeDefinition | undefined;
    if (config !== undefined) {
      const { loadConfigFile } = await import("../load-config.ts");
      const loaded = await loadConfigFile(config.cwd, { freshImport: true });
      configReport = loaded.report;
      configTheme = loaded.theme;
    }
    const loadedReport: ReportDefinition = await loadHostReport(report?.cwd ?? config?.cwd ?? process.cwd(), report?.path, configReport, {
      freshImport: true,
    });
    const loadedTheme = await resolveHostTheme(
      theme?.cwd ?? report?.cwd ?? config?.cwd ?? process.cwd(),
      theme?.value,
      loadedReport.theme,
      configTheme,
      { freshImport: true },
    );
    return { report: loadedReport, theme: loadedTheme };
  };
  const definitions = reuse ?? (await loadDefinitions());
  const hostReport = definitions.report;
  const hostTheme = definitions.theme;

  // 参数化页的唯一 href 派生(target.ts 的 `targetHref`),两个宿主(scope pages 与参数化页
  // 自己的内容)共用同一份纯函数,不各自重新拼字符串。
  const { targetHref } = await import("../report/runtime/target.ts");

  // 自定义报告替换的是可见页面，不该顺手切断官方组件的下钻目标。核心不区分实体种类
  // (docs/feature/reports/README.md「参数化页:attempt 与 experiment 详情」)：内建 `standard`
  // 的每一张参数化页(attempt、experiment……)按 id 补位，报告显式声明同 id 页时覆盖它，
  // 且不把补位页塞进导航或报告元数据。
  const { standard } = await import("../report/built-in/index.tsx");
  const paramPageDefs = new Map<string, ReportPage>();
  for (const p of (standard as ReportDefinition).pages) {
    if (p.params !== undefined) paramPageDefs.set(p.id, p as ReportPage);
  }
  for (const p of hostReport.pages) {
    if (p.params !== undefined) paramPageDefs.set(p.id, p);
  }

  // 非参数化页(没有 `params` 声明)才参与本函数的「全部烘进 index.html」渲染;参数化页(如果
  // 报告声明了)没有 params 就不能 resolve,它的每实例静态文档是独立机制,不在这里渲染
  // (docs/feature/reports/README.md「参数化页」)。
  const scopePages = hostReport.pages.filter((p) => p.params === undefined);
  const navigablePages = scopePages.filter((p) => p.navigation !== false);
  // 目标可能指向导航页也可能指向参数化页(声明或补位后的最终形态);href 解析要认得两者。
  const hrefPages: Pick<ReportPage, "id" | "params">[] = [...scopePages, ...paramPageDefs.values()];

  const initialPageId = page ?? navigablePages[0]?.id ?? scopePages[0]?.id;
  const initialPage = initialPageId !== undefined ? scopePages.find((p) => p.id === initialPageId) : undefined;
  if (initialPageId === undefined || !initialPage) {
    const requested = hostReport.pages.find((p) => p.id === page);
    if (requested?.params !== undefined) {
      throw new ViewInputError(
        `error: page "${page}" in ${report?.path ?? "the built-in report"} is a parametrized page and needs params — it cannot be opened as the initial page directly.`,
      );
    }
    throw new ViewInputError(
      `error: page "${page}" not found in ${report?.path ?? "the built-in report"}. Available pages: ${navigablePages.map((p) => p.id).join(", ")}`,
    );
  }

  const reportDir = report ? dirname(resolve(report.cwd, report.path)) : undefined;
  const shellAssets = {
    styles: [await hostThemeStylesheet(hostTheme), ...resolveThemeStyles(hostTheme, theme ? dirname(resolve(theme.cwd, theme.value)) : undefined)],
    scripts: [] as string[],
    head: resolveShellHead(hostReport.head, reportDir),
  };

  const hostMeta = await buildHostReportMeta(hostReport, selection);

  // 按需渲染:一次 page resolve 记忆化在 pageId 上,两种语言共用它——按语言分块是为了少传
  // 一半字节,不该把取数算两遍(architecture.md「一次 page resolve 的缓存」)。渲染结果再按
  // (pageId, locale) 记忆化一层,同一块被 index.html 预烘与 report/ 路径同时要到时只渲染一次。
  const resolvedPages = new Map<string, Promise<ResolvedPage>>();
  const renderedBlocks = new Map<string, Promise<string>>();
  const resolveScopePage = (pageId: string): Promise<ResolvedPage> => {
    const hostPage = scopePages.find((p) => p.id === pageId);
    if (!hostPage) return Promise.reject(new ViewInputError(`error: page "${pageId}" not found in the loaded report.`));
    let resolved = resolvedPages.get(pageId);
    if (resolved === undefined) {
      // 非参数化页当前不声明 `load`(内建 report/attempts/traces 页都没有);输入就是宿主选好
      // 的 Sample(`PageContext.input` 的定义:「省略 load 时宿主选择的 Sample」)。
      resolved = resolveHostPage(hostPage, {
        scope: selection,
        results,
        report: hostMeta,
        page: { id: hostPage.id, input: selection },
        dimensionPins: hostReport.dimensionPins,
      });
      resolvedPages.set(pageId, resolved);
    }
    return resolved;
  };
  const renderBlock = async (pageId: string, locale: ReportLocale): Promise<string> => {
    try {
      const resolved = resolveScopePage(pageId);
      return await renderHostPageFromResolved(await resolved, {
        locale,
        href: (target) => targetHref(hrefPages, target),
      });
    } catch (e) {
      if (pageFailure !== "embed") throw e;
      // 本地 server:该页显示完整错误反馈,其它页照常可读(不让一页的树错误拖垮整站)。
      const message = e instanceof Error ? e.message : String(e);
      return `<div class="niceeval-report niceeval-page-error"><pre>${escapeHtml(message)}</pre></div>`;
    }
  };
  const pages: ReportPageRenderer = {
    ids: scopePages.map((p) => p.id),
    render(pageId, locale) {
      const key = `${pageId}\0${locale}`;
      let block = renderedBlocks.get(key);
      if (block === undefined) {
        block = renderBlock(pageId, locale);
        renderedBlocks.set(key, block);
      }
      return block;
    },
    async assets(pageId) {
      try {
        const resolved = await resolveScopePage(pageId);
        return materializeHostPageRendererAssets(
          resolved,
        );
      } catch (error) {
        if (pageFailure !== "embed") throw error;
        return { styles: [], scripts: [] };
      }
    },
  };

  const meta: ViewReportMeta = {
    title: hostMeta.title,
    // 每一张要烘进 index.html 的 scope-input page 都在列(这份列表同时是 <template> 静态块与
    // `#/page/<id>` 路由的键),声明了 `navigation: false` 的带标记出场——导航列不列由外壳按标记
    // 决定,不靠从列表里删页实现(docs/feature/reports/README.md「导航机器与品牌位」)。
    pages: scopePages.map((p) => ({ id: p.id, title: p.title, ...(p.navigation === false ? { navigation: false as const } : {}) })),
    initialPageId,
    // 外壳按这份清单判定 `<pageId>/<key>.html` 链接与 `#/<pageId>/<key>` hash 是不是参数化页
    // 目标(view.md「参数化页的 dialog 摆放」),不出现在 `pages`(参数化页不是导航路由)。
    paramPageIds: [...paramPageDefs.keys()],
  };

  // 参数化页的唯一装配来源:按 locator 装配 AttemptEvidence(当前唯一的懒加载来源;
  // library.md「参数化页」)。核心不区分实体种类——`page.load` 缺省时输入就是宿主 Sample。
  const loadCtx: PageLoadContext = {
    evidence: (locator) => loadAttemptEvidence(resolveLocator(results, locator)),
  };

  // 渲染一张参数化页某个实例两种语言的内容 HTML(不含外层文档 —— 独立 HTML 文档的组装是
  // site.ts 的事);pageFailure 语义与 scope pages 相同 —— 本地 server 折成该文档的完整
  // 错误反馈块,静态导出直接抛出(writeSite 侧汇总成「整体失败,不留半套目录」)。attempt、
  // experiment 这些词不出现在这个函数里,新实体注册新标准库参数化页即可,不需要改这里的分支。
  const renderParamPage = async (
    paramPage: ReportPage,
    params: JsonValue,
  ): Promise<{
    en: string;
    "zh-CN": string;
    assets: import("../report/extension/types.ts").PageRendererAssets;
  }> => {
    const input =
      paramPage.params !== undefined
        ? await paramPage.load(selection, params, loadCtx)
        : paramPage.load !== undefined
          ? await paramPage.load(selection, undefined, loadCtx)
          : selection;
    const ctx = {
      scope: selection,
      results,
      report: hostMeta,
      page: { id: paramPage.id, input },
      dimensionPins: hostReport.dimensionPins,
    };
    try {
      const resolved = await resolveHostPage(paramPage, ctx);
      const href = nestedTargetHref(targetHref, hrefPages, paramPage.id);
      return {
        en: await renderHostPageFromResolved(resolved, { locale: "en", href }),
        "zh-CN": await renderHostPageFromResolved(resolved, { locale: "zh-CN", href }),
        assets: await materializeHostPageRendererAssets(resolved),
      };
    } catch (e) {
      if (pageFailure !== "embed") throw e;
      const message = e instanceof Error ? e.message : String(e);
      const block = `<div class="niceeval-report niceeval-page-error"><pre>${escapeHtml(message)}</pre></div>`;
      return { en: block, "zh-CN": block, assets: { styles: [], scripts: [] } };
    }
  };

  return { meta, pages, shellAssets, definitions, paramPageDefs, renderParamPage };
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
    "Re-run your experiments with this niceeval to produce new results.",
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
