// niceeval show —— 终端宿主(行为规范:docs/feature/reports/show.md 与分篇;
// 宿主组合语义:docs/feature/reports/architecture.md「Scope 是计算入口」)。
//
// 一次调用 = 范围 × 切片 × 形态(docs/feature/reports/show.md)。范围:eval id 前缀位置参数、
// `@<locator>`(单元素范围)、`--exp`(可重复,>=2 进入对照语义)、`--results`、`--fresh`。
// 切片(每个切片解析成一次报告组件装配,见 architecture.md「show 的切片是组件选择」):
//   无证据 flag 且 --exp < 2   默认榜单(内建报告的 text 面;裸 show / eval 前缀 / 单个 --exp 都落在这里)
//   无证据 flag 且 --exp >= 2  对照矩阵(DeltaTable,接线点见 renderCompareSlice)
//   @<locator> 且无证据 flag   失败诊断首页(当前 report 的 attempt-input page)
//   --source / --execution / --timing / --diff[=路径]   证据切面(宿主本体,不渲染报告槽);
//     接受任意范围,范围含多个 attempt 时按 experimentId、evalId、attempt 序逐 attempt 分节
//     (renderEvidenceSections),单 attempt 范围只是省掉分节
//   --history        执行时间轴(逐 experimentId + evalId 分节),与 --report 互斥
//   --report <文件>  整槽换成用户报告;位置前缀 / --results / --exp 先收窄 Scope 再注入
//   --page <id>      多页报告选页;未命中列出可用页 id 按用法错误退出
//
// 数据全部走 niceeval/results 的读取面(openResults + 合成 Scope + loadAttemptEvidence),
// 不自己爬目录;证据可用性只由 loadAttemptEvidence 在单 Attempt 页面计算。

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  openResults,
  resolveLocator,
  loadAttemptEvidence,
  ATTEMPT_LOCATOR_PREFIX,
  LocatorNotFoundError,
  MalformedLocatorError,
} from "../results/index.ts";
// ReportLoadError must come from the SAME module instance the report runtime is built
// against — `instanceof` is keyed by declaration site, so a raw src copy and the compiled
// dist copy of "the same" class are two different types. The package-owned report runtime
// ships as precompiled ESM (dist/report/**, built by `pnpm run build:report`); all report
// loading/rendering goes through ../report/runtime/host.ts (the shared contact surface).
import { ReportLoadError } from "../../dist/report/runtime/load.js";
import { detectLocale, t } from "../i18n/index.ts";
import { selectCurrentResults, filterExperiments } from "../results/select.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../shared/aggregate.ts";
import { panelCapabilityOf } from "../report/model/panel.ts";
import { formatMetricValue, formatUSD, verdictMark } from "../report/model/format.ts";
import { renderAlignedRows, type ColumnAlign } from "../report/model/text-layout.ts";
import { attemptHistory, attemptHistoryHandles } from "./compose.ts";
import { attemptJsonOf, buildShowScope, renderShowJson, type ShowJsonView } from "./json.ts";
import {
  buildHostReportMeta,
  HostReportError,
  loadHostReport,
  renderHostPageText,
  type HostCommandContext,
  type ReportPage,
} from "../report/runtime/host.ts";
import {
  attemptArtifactsPath,
  attemptEvidenceHeader,
  attemptHistoryText,
  diffText,
  evalSourceText,
  executionText,
  otherPagesText,
  timingText,
  skippedRunsText,
} from "./render.ts";
import type { AttemptEvidence, AttemptHandle, Results, Scope } from "../results/index.ts";
import type { DeltaData, StabilityMatrixData, UsageTableData } from "../report/model/types.ts";

export interface ShowFlags {
  /** --source:该 attempt 运行时保存的 Eval 源码,断言标回源码行(证据切面)。 */
  source?: boolean;
  /** 该 attempt 的标准执行事件流 + OTel enrichment(证据切面)。 */
  execution?: boolean;
  /** --timing:默认有界诊断投影；full 逐节点展开。boolean 仅供库调用兼容，等价 summary。 */
  timing?: boolean | "summary" | "full";
  /** --diff(文件级摘要)。 */
  diff?: boolean;
  /** --diff=<路径>(单个文件的完整改动;路径必须 = 连写,位置参数永远留给 eval id 前缀)。 */
  diffPath?: string;
  /**
   * --grep:只与 --execution 组合(docs/feature/reports/show/execution.md「范围化:跨 attempt
   * 扫描与 --grep」);JS 正则字符串,收窄 --execution text 渲染面的注意力范围,不是事实过滤器。
   * 与 --expand 互斥。
   */
  grep?: string;
  /**
   * --expand:只与 --execution 组合,要求范围恰好命中一个 attempt;句柄语法 `t<turn>.c<card>`
   * 或 `cmd<n>`,输出该卡片完整落盘内容(不截断)。与 --grep 互斥
   * (docs/feature/reports/show/execution.md「卡片预览预算与 --expand」)。
   */
  expand?: string;
  history?: boolean;
  /**
   * --exp(可重复):0/1 个沿用前缀收窄语义(可能匹配多个 experiment);2 个以上进入对照语义——
   * 每个必须恰好解析到一个 experiment,顺序即对照条件顺序、首个是基准
   * (docs/feature/reports/show.md「选择结果范围」)。
   */
  experiment?: string[];
  /** --results:结果根目录(某次快照根或 `copySnapshots` 产物)。 */
  results?: string;
  report?: string;
  /** --page:多页报告选页;未命中按用法错误退出并列出可用页 id。 */
  page?: string;
  /** --fresh:只统计新执行的 attempt(排除携带条目与跨快照拼入的历史执行)。 */
  fresh?: boolean;
  /**
   * --usage:`UsageTable` 在 show 上的零配置装配——范围内逐 attempt 摊成一行,逐 experiment
   * 分节各自合计(docs/feature/reports/show/usage.md)。`@<locator>` 范围下退化成该 attempt
   * 的单行表,不经 --report 传入的 page 声明(docs/feature/reports/show.md「选择结果范围」)。
   */
  usage?: boolean;
  /**
   * --stats:`StabilityMatrix` 在 show 上的零配置装配——eval × experiment 的历史全执行判定
   * 计数矩阵(docs/feature/reports/show/stats.md)。与 `@<locator>`、`--report` 互斥。
   */
  stats?: boolean;
  /**
   * --json:任何切片的结构化形态(docs/feature/reports/show/json.md)——同一范围、同一切片
   * 选出的同一批实体,输出成一个 `ShowJson` 文档到 stdout。text 面消费什么组件产物,`data`
   * 字段就原样携带那份产物,两面同值由构造保证。与 `--report`(报告树表达「怎么看」,
   * `--json` 表达「是什么」)、`--expand`(JSON 不截断卡片,没有可展开的东西)互斥。
   */
  json?: boolean;
}

/** 注入 IO 供测试;默认写 stdout/stderr、宽度取终端列数。 */
export interface ShowIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  width?: number;
  now?: number;
  /** `Section` 的框线传输能力(docs/feature/reports/library/layout.md「区域框」);省略时按
   *  `process.stdout.isTTY` 与 `NO_COLOR` 探测——测试注入固定值,不依赖真实终端设备。 */
  panelMode?: "boxed" | "plain";
}

/** 真实 CLI 入口的框线传输能力探测:是 TTY 且没有要求朴素输出时才画框。 */
function detectPanelMode(): "boxed" | "plain" {
  return panelCapabilityOf({ isTTY: process.stdout.isTTY, noColor: process.env.NO_COLOR, width: process.stdout.columns }).mode;
}

/** 可预期的用户错误:打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
class ShowError extends Error {}

function clampWidth(columns: number | undefined): number {
  if (!Number.isFinite(columns) || (columns ?? 0) <= 0) return 80;
  return Math.max(40, Math.min(columns as number, 160));
}

// --report 的装载住在 ../report/runtime/host.ts(两个宿主共用的中性联系面);规范化本身是
// `defineReport` 自己的职责,不在宿主层重复。
export { loadHostReport, localizeText } from "../report/runtime/host.ts";

/**
 * 证据切面(--source/--execution/--timing/--diff)的范围排序:按 experimentId、evalId、
 * attempt 序(docs/feature/reports/show/execution.md「--execution 接受任意范围」)。单元素
 * 范围(`@<locator>`)排序是恒等操作——locator 与范围通用实现走同一条代码路径,不另立
 * 「locator 专属」分支。
 */
export function sortAttemptsForSections(attempts: readonly AttemptHandle[]): AttemptHandle[] {
  return [...attempts].sort(
    (a, b) =>
      a.experimentId.localeCompare(b.experimentId) ||
      a.evalId.localeCompare(b.evalId) ||
      a.result.attempt - b.result.attempt,
  );
}

/** "N attempt(s)" 的单复数——`--grep` 汇总行与 `--usage` 分节头共用同一条拼法。 */
function attemptCountLabel(n: number): string {
  return `${n} ${n === 1 ? "attempt" : "attempts"}`;
}

/**
 * `--grep` 的跨 attempt 汇总行(docs/feature/reports/show/execution.md「范围化:跨 attempt
 * 扫描与 --grep」):0 命中时明确输出 `0 matches in N attempts`,不带「N attempts with 0
 * matches」括注(该括注在全 0 时是重言,反而稀释「一个词都没匹配到」这件事本身)。
 */
function grepSummaryText(matches: number, attempts: number, zeroMatchAttempts: number): string {
  if (matches === 0) return `0 matches in ${attemptCountLabel(attempts)}`;
  const suffix = zeroMatchAttempts > 0 ? ` (${attemptCountLabel(zeroMatchAttempts)} with 0 matches)` : "";
  return `${matches} matches in ${attemptCountLabel(attempts)}${suffix}`;
}

/**
 * 证据切面(--source/--execution/--timing/--diff)只能选一个当 `--json` 的 view——见 show()
 * 顶层的 evidenceFlagCount 校验,调用这个函数前已保证恰好一个为真。
 */
function evidenceViewOf(flags: Pick<ShowFlags, "source" | "execution" | "timing" | "diff" | "diffPath">): ShowJsonView {
  if (flags.source === true) return "source";
  if (flags.execution === true) return "execution";
  if (flags.timing !== undefined && flags.timing !== false) return "timing";
  return "diff";
}

/**
 * 证据切面单个 attempt 的 `--json` `data`:直接调用该 view 对应的组件 `*Data` 函数
 * (docs/feature/reports/show/json.md「data:按 view 找组件声明」),不重算一遍——与 text 面
 * 消费同一份产物。`--diff=<路径>` 的单文件逐窗口 patch 不进 `AttemptDiffData`(该类型只有
 * 文件级摘要),`--json` 对 `diff` view 恒输出文件级摘要,忽略 `diffPath`。
 */
async function evidenceJsonDataOf(view: ShowJsonView, evidence: AttemptEvidence): Promise<unknown> {
  const mod = await import("../../dist/report/index.js");
  switch (view) {
    case "source":
      return mod.attemptSourceData(evidence);
    case "execution":
      return mod.attemptConversationData(evidence);
    case "timing":
      return mod.attemptTimelineData(evidence);
    default:
      return mod.attemptDiffData(evidence);
  }
}

/**
 * 证据切面的范围通用渲染:对排序后的每个 attempt 装配 flags 选中的区块并拼成一节;范围含
 * 多个 attempt 时天然分节(节头是每节 block 自带的 `attemptEvidenceHeader` 定位行),单
 * attempt 范围只是省掉了分节——两种输入量走同一份实现(docs/feature/reports/show.md
 * 「一次调用 = 范围 × 切片 × 形态」)。
 *
 * `--grep`/`--expand` 只影响 `--execution` 这一块(两者的组合校验在 show() 顶层先于任何 IO
 * 做完,这里不重复):`grep` 收窄命中卡片并在全部分节之后追加一行跨 attempt 汇总
 * (grepSummaryText);`expand` 要求恰好一个 attempt——校验放在这里而不是 show() 顶层,因为
 * 「范围有几个 attempt」只有拿到 `attempts` 之后才知道,`@<locator>` 与范围收窄两条调用路径
 * 因此天然共享同一次校验,不重复。`executionText` 对未命中的展开句柄抛裸 `Error`
 * (docs/feature/reports/show/execution.md「句柄未命中……按用法错误退出」),这里捕获后套成
 * `error:`/`fix:` 三段式,不让一条裸堆栈冒到用户面前。
 */
async function renderEvidenceSections(
  attempts: readonly AttemptHandle[],
  flags: Pick<ShowFlags, "source" | "execution" | "timing" | "diff" | "diffPath" | "expand">,
  grep: RegExp | undefined,
  cwd: string,
  width: number,
): Promise<string> {
  if (flags.expand !== undefined && attempts.length !== 1) {
    throw new ShowError(t("cli.show.expandMultiAttempt", { count: attempts.length }));
  }
  const ordered = sortAttemptsForSections(attempts);
  const sections: string[] = [];
  let grepMatches = 0;
  let grepAttempts = 0;
  let grepZeroMatchAttempts = 0;
  for (const attempt of ordered) {
    const attemptEvidence = await loadAttemptEvidence(attempt);
    const header = attemptEvidenceHeader(attemptEvidence);
    const artifactPath = attemptArtifactsPath(attempt, cwd);
    const blocks: string[] = [];
    if (flags.source) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width }));
    if (flags.execution) {
      let result: { text: string; matches?: number };
      try {
        result = executionText(attemptEvidence, { header, artifactPath, width }, { grep, expand: flags.expand });
      } catch (e) {
        if (flags.expand !== undefined && e instanceof Error) {
          throw new ShowError(t("cli.show.expandNotFound", { message: e.message }));
        }
        throw e;
      }
      if (result.text.length > 0) blocks.push(result.text);
      if (grep !== undefined) {
        grepAttempts += 1;
        grepMatches += result.matches ?? 0;
        if ((result.matches ?? 0) === 0) grepZeroMatchAttempts += 1;
      }
    }
    if (flags.timing !== undefined && flags.timing !== false) {
      blocks.push(
        timingText(attemptEvidence, { header, artifactPath, width, mode: flags.timing === "full" ? "full" : "summary" }),
      );
    }
    if (flags.diff || flags.diffPath !== undefined) {
      blocks.push(diffText({ header, diff: attemptEvidence.diff, artifactPath, file: flags.diffPath }));
    }
    sections.push(blocks.join("\n\n"));
  }
  // `--grep` 常态是「大部分 attempt 0 命中」——0 命中的那一节本身就是空字符串(见上面
  // executionText 的 grep 分支),不过滤会在汇总行前面堆出一串空段落的空行。非 grep 路径不
  // 过滤:那里的空段落理论上不会出现(单/多 attempt 字节相同这条测试假设 join 不丢段落)。
  const body = grep !== undefined ? sections.filter((section) => section.length > 0) : sections;
  if (grep !== undefined) body.push(grepSummaryText(grepMatches, grepAttempts, grepZeroMatchAttempts));
  return body.join("\n\n");
}

/**
 * 证据切面(--source/--execution/--timing/--diff)的 `--json` `data`:排序与 text 面分节同序
 * (`sortAttemptsForSections`)。范围恰好一个 attempt 时 `data` 是该组件 `*Data` 产物本身;
 * 多个 attempt 时是产物数组(docs/feature/reports/show/json.md「输出是一个顶层 JSON 文档」)——
 * `--grep`/`--expand` 是 text 渲染面的注意力预算选项,不影响这份完整 resolve 产物
 * (docs/feature/reports/architecture.md「show 的切片是组件选择」)。
 */
async function evidenceJsonOf(view: ShowJsonView, attempts: readonly AttemptHandle[]): Promise<unknown> {
  const ordered = sortAttemptsForSections(attempts);
  const perAttempt = await Promise.all(
    ordered.map(async (attempt) => evidenceJsonDataOf(view, await loadAttemptEvidence(attempt))),
  );
  return perAttempt.length === 1 ? perAttempt[0] : perAttempt;
}

/**
 * `--exp` 出现两次以上的对照覆盖行:每个条件在 `data.rows` 里是否有格子。共同 = 全部条件都
 * 有格子;某条件独占 = 只有它自己有格子,其余条件都缺
 * (docs/feature/reports/show/compare.md「头两行报条件数、配对身份、基准与配对覆盖」)。这行
 * 不是 `DeltaTable` 自己的文案——组件的 text 面(deltaText)只产出表格与共同题 footnote,
 * 不产出这行覆盖统计,所以由 show 自己按 `DeltaData.rows[].cells` 算。
 */
function compareCoverageText(data: DeltaData): string {
  const common = data.rows.filter((row) => data.conditions.every((c) => row.cells[c] !== undefined)).length;
  const onlyCounts = data.conditions.map((condition) => {
    const n = data.rows.filter(
      (row) =>
        row.cells[condition] !== undefined &&
        data.conditions.every((other) => other === condition || row.cells[other] === undefined),
    ).length;
    return `${condition} only ${n}`;
  });
  return `common ${common} · ${onlyCounts.join(" · ")}`;
}

/**
 * 缺省切片选择表第二行(`--exp` 出现两次以上 → 对照矩阵):`DeltaTable` 在 show 上的零配置
 * 装配(docs/feature/reports/show/compare.md)。`--exp` 出现顺序即 `conditions`(首个是
 * 基准),已解析成实际 experiment id;数据源是调用方已经按 `selection`(现刻水位 Scope)
 * narrow 好的范围,不重复传 `evals`(eval id 前缀已经收进 `selection` 里)。
 *
 * 头两行(条件数、配对身份、基准、共同/仅某条件覆盖)是 CLI 呈现的行为,不是组件内容——
 * compare.md「聚合口径……单源在 DeltaTable;本页只保留 CLI 呈现的行为与示例」。表格本体
 * 复用组件已实现的 text 面(deltaText 经 `renderHostPageText` 渲染 `<DeltaTable data={data} />`
 * 这棵一元素报告树),不再手写第二份版式。
 */
async function renderCompareSlice(
  cwd: string,
  results: Results,
  selection: Scope,
  conditions: readonly [string, string, ...string[]],
  io: { width: number; locale: string; panelMode: "boxed" | "plain" },
): Promise<string> {
  const { DeltaTable, deltaTableData } = await import("../../dist/report/index.js");
  const data = await deltaTableData(selection, { by: "experiment", conditions });
  const report = await loadHostReport(cwd, undefined);
  const meta = await buildHostReportMeta(report, selection);
  const page: ReportPage = { id: "compare", title: "Compare", content: { type: DeltaTable, props: { data } } };
  const table = await renderHostPageText(
    page,
    { scope: selection, results, report: meta, page: { id: "compare", input: "scope" } },
    { width: io.width, locale: io.locale, panelMode: io.panelMode },
  );
  const head = `compare · ${data.conditions.length} conditions · paired by eval id · baseline ${data.conditions[0]}`;
  return `${head}\n${compareCoverageText(data)}\n\n${table}`;
}

/**
 * `--stats`:`StabilityMatrix` 在 show 上的零配置装配(docs/feature/reports/show/stats.md)。
 * 证据面与 `--history` 相同——全部历史执行,不设可比性门槛,所以传原始 `Snapshot[]`(不是
 * `current()` 现刻水位 Scope);渲染管线要求的 `ctx.scope`/`ctx.report` 只是占位上下文,
 * 实际矩阵数据已经由 `data` 形态算好,不再消费它们(与 compare 分支同一条纪律)。
 *
 * 头行(eval × experiment 计数、证据面说明)是 CLI 呈现的行为,不是组件内容——表格本体复用
 * 组件已实现的 text 面(stabilityMatrixText)。
 */
async function renderStatsSlice(
  cwd: string,
  results: Results,
  experimentFilter: readonly string[] | undefined,
  patterns: readonly string[],
  io: { width: number; locale: string; panelMode: "boxed" | "plain" },
): Promise<string> {
  const experiments = filterExperiments(results.experiments, experimentFilter as string[] | undefined);
  const snapshots = experiments.flatMap((exp) => exp.snapshots);
  const { StabilityMatrix, stabilityMatrixData } = await import("../../dist/report/index.js");
  const data = await stabilityMatrixData(snapshots, {
    by: "experiment",
    ...(patterns.length > 0 ? { evals: [...patterns] } : {}),
  });
  // 只给渲染管线占位用的 Scope——StabilityMatrix 走 data 形态,不重新消费它;单独调用
  // selectCurrentResults 避免借用「现刻水位」口径当稳定性矩阵的真实数据源(上面已用 snapshots)。
  const scope = selectCurrentResults(results, { experiment: experimentFilter as string[] | undefined, patterns: [...patterns] });
  const report = await loadHostReport(cwd, undefined);
  const meta = await buildHostReportMeta(report, scope);
  const page: ReportPage = { id: "stats", title: "Stability", content: { type: StabilityMatrix, props: { data } } };
  const table = await renderHostPageText(
    page,
    { scope, results, report: meta, page: { id: "stats", input: "scope" } },
    { width: io.width, locale: io.locale, panelMode: io.panelMode },
  );
  const head =
    `stability · ${data.rows.length} evals × ${data.columns.length} experiments · ` +
    `all historical executions · ✗ failed / ! errored broken out`;
  return table.length > 0 ? `${head}\n\n${table}` : head;
}

const MISSING_MARK = "—";
const USAGE_COLUMNS = ["locator", "eval", "result", "turns", "tools", "uncached in", "cache read", "out", "requests", "cost"];
const USAGE_ALIGN: readonly ColumnAlign[] = ["left", "left", "left", "right", "right", "right", "right", "right", "right", "right"];

/** uncached in 列的取值:桶恒互斥,inputTokens 本身就是未缓存输入(见 docs/feature/reports/
 *  library/attempt-detail.md#usagetable-组装口径单源)。 */
function uncachedInOf(row: UsageTableData): number | undefined {
  return row.usage?.inputTokens;
}

/**
 * 一列的合计:缺失值不计入求和(与「证据完整性」同一条纪律,见 show/usage.md);该列有任意
 * 一行缺失时在合计数字后标 `*`,表示合计不完整。全部缺失时整格 `—`,不假装合计是 0。
 */
function summarizeUsageColumn(values: readonly (number | undefined)[], format: (n: number) => string): string {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return MISSING_MARK;
  const sum = defined.reduce((a, b) => a + b, 0);
  return defined.length < values.length ? `${format(sum)}*` : format(sum);
}

/** 一个 experiment 分节的用量表:一行一个 attempt,尾行合计(docs/feature/reports/show/usage.md)。 */
function usageSectionText(experimentId: string, rows: readonly UsageTableData[]): string {
  const head = `usage · ${experimentId} · ${rows.length} ${rows.length === 1 ? "attempt" : "attempts"}`;
  const body = rows.map((r) => [
    r.locator,
    r.evalId,
    `${verdictMark(r.verdict)} ${r.verdict}`,
    r.turns !== undefined ? String(r.turns) : MISSING_MARK,
    r.toolCalls !== undefined ? String(r.toolCalls) : MISSING_MARK,
    uncachedInOf(r) !== undefined ? formatMetricValue(uncachedInOf(r)!) : MISSING_MARK,
    r.usage?.cacheReadTokens !== undefined ? formatMetricValue(r.usage.cacheReadTokens) : MISSING_MARK,
    r.usage?.outputTokens !== undefined ? formatMetricValue(r.usage.outputTokens) : MISSING_MARK,
    r.usage?.requests !== undefined ? String(r.usage.requests) : MISSING_MARK,
    r.estimatedCostUSD !== undefined ? formatUSD(r.estimatedCostUSD) : MISSING_MARK,
  ]);
  const passed = rows.filter((r) => r.verdict === "passed").length;
  const totals = [
    "total",
    "",
    `${passed}/${rows.length} passed`,
    summarizeUsageColumn(rows.map((r) => r.turns), (n) => String(n)),
    summarizeUsageColumn(rows.map((r) => r.toolCalls), (n) => String(n)),
    summarizeUsageColumn(rows.map(uncachedInOf), formatMetricValue),
    summarizeUsageColumn(rows.map((r) => r.usage?.cacheReadTokens), formatMetricValue),
    summarizeUsageColumn(rows.map((r) => r.usage?.outputTokens), formatMetricValue),
    summarizeUsageColumn(rows.map((r) => r.usage?.requests), (n) => String(n)),
    summarizeUsageColumn(rows.map((r) => r.estimatedCostUSD), formatUSD),
  ];
  const table = renderAlignedRows([USAGE_COLUMNS, ...body, totals], USAGE_ALIGN);
  return `${head}\n\n${table}`;
}

/**
 * `--usage`:`UsageTable` 逐 attempt 装配的表(docs/feature/reports/show/usage.md)。行按
 * experimentId、evalId、attempt 序排列(与证据切面共用的 `sortAttemptsForSections`),范围
 * 含多个 experiment 时逐 experiment 分节、节尾各自合计;单 attempt 范围(`@<locator>
 * --usage`)只是退化成一节一行的表,与这里共用同一份实现。`usageTableData` 全部三项
 * (turns/toolCalls/usage)都缺时返回 null(没有 usage 时零输出的组件口径),但这张表要求
 * 「范围内每个 attempt 逐条映射成一行」——即便某个 attempt 没有任何用量事实,行本身仍要
 * 出现,数值格全部落 `—`,所以 null 时在这里现场兜底出一行只有身份字段的 `UsageTableData`。
 */
async function usageRowsOf(attempts: readonly AttemptHandle[]): Promise<UsageTableData[]> {
  const { usageTableData } = await import("../../dist/report/index.js");
  const ordered = sortAttemptsForSections(attempts);
  const rows: UsageTableData[] = [];
  for (const attempt of ordered) {
    const evidence = await loadAttemptEvidence(attempt);
    rows.push(
      usageTableData(evidence) ?? {
        locator: evidence.locator,
        experimentId: evidence.identity.experimentId,
        evalId: evidence.identity.evalId,
        attempt: evidence.identity.attempt,
        verdict: evidence.result.verdict,
      },
    );
  }
  return rows;
}

async function renderUsageSlice(attempts: readonly AttemptHandle[]): Promise<string> {
  const rows = await usageRowsOf(attempts);
  const byExperiment = new Map<string, UsageTableData[]>();
  for (const row of rows) {
    const list = byExperiment.get(row.experimentId);
    if (list) list.push(row);
    else byExperiment.set(row.experimentId, [row]);
  }
  if (byExperiment.size === 0) return "usage · no attempts matched this range";
  return [...byExperiment.entries()].map(([experimentId, list]) => usageSectionText(experimentId, list)).join("\n\n");
}

/** `--usage` 对照矩阵每条件一组的用量列:usage.md 单条件表 `USAGE_COLUMNS` 去掉 locator/eval/
 *  result 后剩下的 7 项(docs/feature/reports/show/usage.md「范围化的用量表」)。 */
const USAGE_MATRIX_METRIC_COLUMNS = USAGE_COLUMNS.slice(3);
const USAGE_MATRIX_METRIC_ALIGN: readonly ColumnAlign[] = USAGE_ALIGN.slice(3);

/** 对照矩阵一格的用量合计:同一 evalId × condition 下全部 attempt 的合计,不是均值——与
 *  `DeltaCell.totalTokens`/`totalCostUSD` 同一条纪律(docs/feature/reports/library/
 *  metric-views.md「DeltaTable」)。字段各自缺失时求和跳过缺失项(`sumUsageColumn`),整格
 *  是否存在(该条件在这道题上有没有 attempt)由调用方按 `deltaTableData` 的 `cells[condition]`
 *  判定,不在这里重复判定——避免两套「缺席」判据分岔。 */
interface UsageMatrixCell {
  turns?: number;
  toolCalls?: number;
  uncachedIn?: number;
  cacheRead?: number;
  out?: number;
  requests?: number;
  costUSD?: number;
}

function sumUsageColumn(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length === 0 ? undefined : defined.reduce((a, b) => a + b, 0);
}

function usageMatrixCellOf(rows: readonly UsageTableData[]): UsageMatrixCell {
  return {
    turns: sumUsageColumn(rows.map((r) => r.turns)),
    toolCalls: sumUsageColumn(rows.map((r) => r.toolCalls)),
    uncachedIn: sumUsageColumn(rows.map(uncachedInOf)),
    cacheRead: sumUsageColumn(rows.map((r) => r.usage?.cacheReadTokens)),
    out: sumUsageColumn(rows.map((r) => r.usage?.outputTokens)),
    requests: sumUsageColumn(rows.map((r) => r.usage?.requests)),
    costUSD: sumUsageColumn(rows.map((r) => r.estimatedCostUSD)),
  };
}

/** 一格的 7 列文案;`historical` 时在最后一列(成本)追加 `↩`——与 `DeltaTable` 把 `↩` 叠在
 *  同一格末尾同一条排版纪律(faces.ts `deltaConditionCellText`),不是新发明的标注位置。 */
function usageMatrixCellText(cell: UsageMatrixCell, historical: boolean): string[] {
  const cost = cell.costUSD !== undefined ? formatUSD(cell.costUSD) : MISSING_MARK;
  return [
    cell.turns !== undefined ? String(cell.turns) : MISSING_MARK,
    cell.toolCalls !== undefined ? String(cell.toolCalls) : MISSING_MARK,
    cell.uncachedIn !== undefined ? formatMetricValue(cell.uncachedIn) : MISSING_MARK,
    cell.cacheRead !== undefined ? formatMetricValue(cell.cacheRead) : MISSING_MARK,
    cell.out !== undefined ? formatMetricValue(cell.out) : MISSING_MARK,
    cell.requests !== undefined ? String(cell.requests) : MISSING_MARK,
    historical ? `${cost} ↩` : cost,
  ];
}

/**
 * `--usage` 在对照范围(`--exp` 出现两次以上)下的逐 eval 用量矩阵
 * (docs/feature/reports/show/usage.md「范围化的用量表」)。配对身份、缺席占位、跨快照携带的
 * `↩` 时效标注,复用 `deltaTableData` 已经算好的这份判定——与 `renderCompareSlice` 消费同一次
 * 计算(条件解析、eval id 配对、watermark/carried 派生的 `historical`),不重新实现一遍;这个
 * pivot 只在它之上叠一层用量字段的逐条件合计,数据源是 `usageRowsOf` 已有的逐 attempt 行,按
 * experimentId + evalId 分组求和。每个条件一组 7 列(`USAGE_MATRIX_METRIC_COLUMNS`),缺席
 * 条件整组落 `—`。
 */
async function renderUsageCompareSlice(
  selection: Scope,
  conditions: readonly [string, string, ...string[]],
): Promise<string> {
  const { deltaTableData } = await import("../../dist/report/index.js");
  const data: DeltaData = await deltaTableData(selection, { by: "experiment", conditions });
  const head = `usage · ${conditions.length} conditions · paired by eval id · baseline ${conditions[0]}`;
  if (data.rows.length === 0) return `${head} · no attempts matched this range`;

  const usageRows = await usageRowsOf(selection.attempts);
  const byConditionByEval = new Map<string, UsageTableData[]>();
  for (const row of usageRows) {
    const key = `${row.experimentId}\u0000${row.evalId}`;
    const list = byConditionByEval.get(key);
    if (list) list.push(row);
    else byConditionByEval.set(key, [row]);
  }

  const headGroup = ["", ...conditions.flatMap((c) => [c, ...USAGE_MATRIX_METRIC_COLUMNS.slice(1).map(() => "")])];
  const headLabels = ["eval", ...conditions.flatMap(() => USAGE_MATRIX_METRIC_COLUMNS)];
  const align: ColumnAlign[] = ["left", ...conditions.flatMap(() => USAGE_MATRIX_METRIC_ALIGN)];
  const body = data.rows.map((row) => {
    const cellsText = conditions.flatMap((condition) => {
      const deltaCell = row.cells[condition];
      if (!deltaCell) return USAGE_MATRIX_METRIC_COLUMNS.map(() => MISSING_MARK);
      const usageCell = usageMatrixCellOf(byConditionByEval.get(`${condition}\u0000${row.key}`) ?? []);
      return usageMatrixCellText(usageCell, deltaCell.historical);
    });
    return [row.key, ...cellsText];
  });

  const table = renderAlignedRows([headGroup, headLabels, ...body], align);
  return `${head}\n\n${table}`;
}

/**
 * attempt 诊断首页在 `usage:` 行后追加的 `facts:` 行(docs/feature/reports/show/attempt.md
 * 「facts: 行」)。`usage:`、`facts:`、`trace:` 都是「一个事实的摘要」,本来就不是
 * `Section`——两行紧邻、中间不空行,与文档示例的排版一致。facts 不是报告组件的公开面(源码
 * 边界:本节点不动 `src/report/**`),`usage:` 行已经由内建 `UsageTable` 产出,这里只做
 * 字符串级别的紧邻插入,不重新实现 `usage:` 的组装。没有 facts 时原样返回 pageText——
 * 与「没有证据的块不出现」同一条规则。找不到 `usage:` 行时退而找 `trace:` 行前插入(两者都
 * 不在时追加到页尾),保持 AttemptDetail 声明顺序(Timeline → Diagnostics → UsageTable →
 * Conversation → Trace → Diff)里 facts 应处的相对位置。
 */
function insertFactsLine(pageText: string, facts: Record<string, string | number | boolean> | undefined): string {
  if (!facts) return pageText;
  const entries = Object.entries(facts);
  if (entries.length === 0) return pageText;
  const line = `facts: ${entries.map(([key, value]) => `${key}=${value}`).join(" · ")}`;
  if (/^usage: .*$/m.test(pageText)) return pageText.replace(/^(usage: .*)$/m, `$1\n${line}`);
  if (/^trace: .*$/m.test(pageText)) return pageText.replace(/^(trace: .*)$/m, `${line}\n\n$1`);
  return `${pageText}\n\n${line}`;
}

/**
 * `--exp` 的范围校验(docs/feature/reports/show.md「选择结果范围」):0/1 个沿用前缀收窄
 * (可能匹配多个 experiment,如目录前缀);2 个以上进入对照语义,每个必须恰好解析到一个
 * experiment——零命中按现有的 noExperimentMatch 报,命中多个列出全部候选 id,不猜测意图。
 */
function assertExperimentSelectors(experimentIds: readonly string[], selectors: readonly string[]): void {
  if (selectors.length < 2) return;
  for (const raw of selectors) {
    const selector = raw.replace(/\/+$/, "");
    const matches = matchExperimentSelector(experimentIds, selector);
    if (matches.length === 0) {
      throw new ShowError(t("cli.show.noExperimentMatch", { arg: raw, experiments: experimentIds.join(", ") }));
    }
    if (matches.length > 1) {
      throw new ShowError(t("cli.show.expAmbiguous", { arg: raw, matched: matches.length, candidates: matches.join(", ") }));
    }
  }
}

/**
 * 对照条件解析:`assertExperimentSelectors` 已经校验过每个 selector 恰好命中一个 experiment,
 * 这里只做映射,顺序即条件顺序、首个是基准。缺省切片的对照矩阵分支与 `--usage` 的对照矩阵
 * 分支共用同一份解析,不各自重复调用 `matchExperimentSelector`。
 */
function resolveCompareConditions(
  experimentIds: readonly string[],
  selectors: readonly string[],
): [string, string, ...string[]] {
  return selectors.map((sel) => matchExperimentSelector(experimentIds, sel.replace(/\/+$/, ""))[0]!) as [
    string,
    string,
    ...string[],
  ];
}

export async function runShow(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: ShowIO = {},
): Promise<number> {
  const out = io.out ?? ((text: string) => void process.stdout.write(text));
  const err = io.err ?? ((text: string) => void process.stderr.write(text));
  try {
    await show(cwd, patterns, flags, {
      out,
      err,
      width: clampWidth(io.width ?? process.stdout.columns),
      now: io.now ?? Date.now(),
      panelMode: io.panelMode ?? detectPanelMode(),
    });
    return 0;
  } catch (e) {
    if (e instanceof ShowError || e instanceof ReportLoadError || e instanceof HostReportError) {
      err(e.message.endsWith("\n") ? e.message : `${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function show(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: { out: (s: string) => void; err: (s: string) => void; width: number; now: number; panelMode: "boxed" | "plain" },
): Promise<void> {
  const evidence =
    flags.source === true ||
    flags.execution === true ||
    (flags.timing !== undefined && flags.timing !== false) ||
    flags.diff === true ||
    flags.diffPath !== undefined;

  // 组合语义矩阵(docs/feature/reports/show.md「选择结果范围」):--history 与 --report 互斥,先于任何 IO 报出来。
  if (flags.history && flags.report !== undefined) {
    throw new ShowError(t("cli.show.historyReportConflict"));
  }

  // --page 只在报告槽里有意义:证据切面 / 时间轴 / 零配置切片(--stats/--usage)与它组合是
  // 用法矛盾,先于任何 IO 报出来。
  if (flags.page !== undefined && (evidence || flags.history || flags.stats || flags.usage)) {
    throw new ShowError(
      `--page selects a report page and cannot be combined with ${flags.history ? "--history" : flags.stats ? "--stats" : flags.usage ? "--usage" : "evidence flags"}.\n`,
    );
  }

  // `@<locator>` 与重复 `--exp` 互斥:locator 已经唯一确定了 experiment,再给对照条件没有
  // 可执行的语义(docs/feature/reports/show.md「选择结果范围」),先于任何 IO 报出来。
  const expSelectors = flags.experiment ?? [];
  const locatorArgForMutex = patterns.find((p) => p.startsWith(ATTEMPT_LOCATOR_PREFIX));
  if (locatorArgForMutex !== undefined && expSelectors.length >= 2) {
    throw new ShowError(
      t("cli.show.locatorExpConflict", { locator: locatorArgForMutex, exp: expSelectors.join(", ") }),
    );
  }

  // `--stats` 与 `@<locator>`、`--report` 互斥(docs/feature/reports/show/stats.md「边界」):
  // 单 attempt 没有稳定性可言;零配置装配不经用户显式报告树。先于任何 IO 报出来。
  if (locatorArgForMutex !== undefined && flags.stats) {
    throw new ShowError(t("cli.show.statsLocatorConflict", { locator: locatorArgForMutex }));
  }
  if (flags.stats && flags.report !== undefined) {
    throw new ShowError(t("cli.show.statsReportConflict", { report: flags.report }));
  }

  // `--grep`/`--expand` 只是 `--execution` text 渲染面的选项,不是独立切片(docs/feature/
  // reports/show/execution.md「范围化:跨 attempt 扫描与 --grep」「卡片预览预算与 --expand」);
  // 两者互斥;出现在其它切片上(或裸出现,没有 --execution)按用法错误退出,先于任何 IO 报出来。
  if (flags.grep !== undefined && flags.expand !== undefined) {
    throw new ShowError(t("cli.show.grepExpandConflict"));
  }
  if (flags.grep !== undefined && flags.execution !== true) {
    throw new ShowError(t("cli.show.grepExecutionOnly"));
  }
  if (flags.expand !== undefined && flags.execution !== true) {
    throw new ShowError(t("cli.show.expandExecutionOnly"));
  }
  let grep: RegExp | undefined;
  if (flags.grep !== undefined) {
    try {
      grep = new RegExp(flags.grep);
    } catch (e) {
      throw new ShowError(
        t("cli.show.grepInvalidPattern", { pattern: flags.grep, message: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  // `--json` 的用法冲突(docs/feature/reports/show/json.md「边界」):与 `--report` 互斥(报告树
  // 表达「怎么看」,`--json` 表达「是什么」);与 `--expand` 互斥(JSON 不截断卡片,没有可展开的
  // 东西)。先于任何 IO 报出来。
  if (flags.json && flags.report !== undefined) {
    throw new ShowError(t("cli.show.jsonReportConflict", { report: flags.report }));
  }
  if (flags.json && flags.expand !== undefined) {
    throw new ShowError(t("cli.show.jsonExpandConflict"));
  }
  // 信封的 `view` 是单一枚举值(docs/feature/reports/show/json.md「信封」);证据切面在 text 面
  // 允许同时点多个 flag(逐 attempt 拼成一个块),但 `--json` 一次调用只能落在一个 view 上——
  // 同时点多个证据 flag 时没有「合并成一个 view」的字段形状,按用法错误退出,不猜合并成哪种。
  const evidenceFlagCount = [
    flags.source === true,
    flags.execution === true,
    flags.timing !== undefined && flags.timing !== false,
    flags.diff === true || flags.diffPath !== undefined,
  ].filter(Boolean).length;
  if (flags.json && evidenceFlagCount > 1) {
    throw new ShowError(t("cli.show.jsonMultiEvidenceConflict"));
  }

  const root = flags.results !== undefined ? resolve(cwd, flags.results) : join(cwd, ".niceeval");
  if (flags.results !== undefined && !existsSync(root)) {
    throw new ShowError(t("cli.show.runDirMissing", { dir: root }));
  }

  const results = await openResults(root);
  if (results.experiments.length === 0) {
    const skipped = results.skipped.length > 0 ? `\n${skippedRunsText(results.skipped, root, cwd)}\n` : "";
    throw new ShowError(t("cli.show.noResults", { root }) + skipped);
  }

  // `@<locator>` 位置参数:身份直达单个 attempt,与 eval id 前缀匹配完全不同的语义
  // (`@` 打头对 eval id 天然无歧义,见 locator.ts),必须在下面的前缀匹配逻辑之前分流掉,
  // 不然 "@1x7f3q" 会被当成一个谁都匹配不到的 eval id 前缀,报「no eval match」这种文不对题的
  // 错误。(mutex 校验已在 openResults 之前用 locatorArgForMutex 做过,这里复用同一个值。)
  const locatorArg = locatorArgForMutex;
  if (locatorArg !== undefined) {
    if (patterns.length !== 1) {
      throw new ShowError(
        `An attempt locator ("${locatorArg}") must be the only positional argument; got ${patterns.length}: ${patterns.join(", ")}.`,
      );
    }
    let attempt;
    try {
      attempt = resolveLocator(results, locatorArg);
    } catch (e) {
      if (e instanceof MalformedLocatorError) throw new ShowError(t("cli.show.locatorMalformed", { message: e.message }));
      if (e instanceof LocatorNotFoundError) throw new ShowError(t("cli.show.locatorNotFound", { message: e.message }));
      throw e;
    }
    if (flags.usage) {
      if (flags.json) {
        // `--usage` 的 `data` 恒为数组(与「范围含多个 attempt 才是数组」的一般规则不同——
        // usage 表的实体本来就是逐 attempt 一行,单 attempt 范围只是退化成 1 元素数组,不塌成
        // 单个对象,与 text 面「一行一个 attempt」的表格语义对齐)。
        const rows = await usageRowsOf([attempt]);
        io.out(
          renderShowJson({
            format: "niceeval.show",
            schemaVersion: 1,
            view: "usage",
            scope: buildShowScope({ resultsRoot: root, patterns: [], experiments: [attempt.experimentId], fresh: flags.fresh === true }),
            data: rows,
          }),
        );
        return;
      }
      // `@<locator> --usage`:UsageTable 的单行装配,与下面「范围含多个 attempt」的表格
      // 分节共用同一个实现(renderUsageSlice)——单元素范围只是退化成一个 1 行的表。
      io.out((await renderUsageSlice([attempt])) + "\n");
      return;
    }
    if (evidence) {
      if (flags.json) {
        const view = evidenceViewOf(flags);
        const data = await evidenceJsonOf(view, [attempt]);
        io.out(
          renderShowJson({
            format: "niceeval.show",
            schemaVersion: 1,
            view,
            scope: buildShowScope({ resultsRoot: root, patterns: [], experiments: [attempt.experimentId], fresh: flags.fresh === true }),
            data,
          }),
        );
        return;
      }
      // locator = 单元素范围:与下面「证据切面是宿主本体」分支共用同一个范围通用实现
      // (renderEvidenceSections),不另立「locator 专属」代码路径。
      io.out((await renderEvidenceSections([attempt], flags, grep, cwd, io.width)) + "\n");
      return;
    }
    const attemptEvidence = await loadAttemptEvidence(attempt);
    if (flags.json) {
      // 默认 attempt 首页(view "attempt"):`AttemptDetail` 装配的区块 `*Data` 全集
      // (docs/feature/reports/show/json.md「data:按 view 找组件声明」)——JSON 面恒为完整
      // resolve 产物,因此全部 11 个叶子区块都计算,不因 text 面「有 source 时不重复
      // AttemptConversation」这条渲染面去重规则而省略 conversation。`--report` 已经与
      // `--json` 互斥(见 show() 顶层),这里不需要装载报告就能直接算数据。
      const mod = await import("../../dist/report/index.js");
      const data = {
        summary: mod.attemptSummaryData(attemptEvidence),
        error: mod.attemptErrorData(attemptEvidence),
        assertions: mod.attemptAssertionsData(attemptEvidence),
        source: mod.attemptSourceData(attemptEvidence),
        fixPrompt: mod.attemptFixPromptData(attemptEvidence),
        timeline: mod.attemptTimelineData(attemptEvidence),
        conversation: mod.attemptConversationData(attemptEvidence),
        diagnostics: mod.attemptDiagnosticsData(attemptEvidence),
        usage: mod.usageTableData(attemptEvidence),
        trace: mod.attemptTraceData(attemptEvidence),
        diff: mod.attemptDiffData(attemptEvidence),
      };
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view: "attempt",
          scope: buildShowScope({ resultsRoot: root, patterns: [], experiments: [attempt.experimentId], fresh: flags.fresh === true }),
          data,
        }),
      );
      return;
    }
    // 无证据 flag:选中当前 report definition 里唯一的 attempt-input page,注入这份 evidence,
    // 走与其它 page 完全相同的 resolve → validate → render 管线(docs/feature/reports/show/attempt.md;
    // docs/feature/reports/library/attempt-detail.md「在 show 与 view 怎样渲染」)。不带 --report
    // 时装载内建 standard,其中就带这张 page;--report 指向的自定义报告没有声明 attempt-input page
    // 时报完整用户反馈,不回退到内建详情(三条解决路径都在错误文案里给出)。
    const report = await loadHostReport(cwd, flags.report);
    const attemptPage = report.pages.find((p) => p.input === "attempt");
    if (attemptPage === undefined) {
      const sourceLabel = flags.report ?? "the built-in report";
      throw new ShowError(
        `error: ${sourceLabel} has no attempt-input page — "${locatorArg}" cannot be opened without one. ` +
          `Add one: use \`extends: standard\` (inherits its attempt page), import { standardAttemptPage } from ` +
          `"niceeval/report/built-in" and add it to your pages list, or declare your own \`input: "attempt"\` page.\n`,
      );
    }
    const locale = detectLocale();
    const selection = selectCurrentResults(results, { fresh: flags.fresh });
    const meta = await buildHostReportMeta(report, selection);
    const text = await renderHostPageText(
      attemptPage,
      {
        scope: selection,
        results,
        report: meta,
        page: { id: attemptPage.id, input: "attempt", locator: attempt.locator!, evidence: attemptEvidence },
      },
      { width: io.width, locale, panelMode: io.panelMode },
    );
    io.out(insertFactsLine(text, attemptEvidence.result.facts) + "\n");
    return;
  }

  // `--exp` 的范围校验(docs/feature/reports/show.md「选择结果范围」):0/1 个沿用前缀收窄
  // (可能匹配多个 experiment);2 个以上进入对照语义,每个必须恰好解析到一个 experiment。
  const experimentIds = results.experiments.map((e) => e.id);
  assertExperimentSelectors(experimentIds, expSelectors);
  if (expSelectors.length === 1 && filterExperiments(results.experiments, expSelectors).length === 0) {
    throw new ShowError(t("cli.show.noExperimentMatch", { arg: expSelectors[0], experiments: experimentIds.join(", ") }));
  }

  const experimentFilter = expSelectors.length > 0 ? expSelectors : undefined;
  // 「本次调用解析后的 experiment id 全集」(docs/feature/reports/show/json.md「信封」):非对照
  // 视图的 `--json` `scope.experiments` 统一取这份——范围收窄之后、不局限于「有 attempt 命中」
  // 的子集(与 `--stats`/`--usage`/证据切面/`--history`/leaderboard 各自的现有 experiment 过滤
  // 逻辑同源,不重新发明一套)。
  const resolvedExperimentIds = filterExperiments(results.experiments, experimentFilter).map((e) => e.id);

  // `--stats`:历史全执行的稳定性矩阵(docs/feature/reports/show/stats.md)。证据面与
  // `--history` 相同——不是 `current()` 现刻水位,所以在下面的 `selection`/`matchedEvalIds`
  // (现刻水位专属)计算与 noEvalMatch 校验之前分流掉,不借用那份口径。
  if (flags.stats) {
    if (flags.json) {
      const experiments = filterExperiments(results.experiments, experimentFilter);
      const snapshots = experiments.flatMap((exp) => exp.snapshots);
      const { stabilityMatrixData } = await import("../../dist/report/index.js");
      const data = await stabilityMatrixData(snapshots, {
        by: "experiment",
        ...(patterns.length > 0 ? { evals: [...patterns] } : {}),
      });
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view: "stats",
          scope: buildShowScope({ resultsRoot: root, patterns, experiments: resolvedExperimentIds, fresh: flags.fresh === true }),
          data,
        }),
      );
      return;
    }
    io.out(
      (await renderStatsSlice(cwd, results, experimentFilter, patterns, {
        width: io.width,
        locale: detectLocale(),
        panelMode: io.panelMode,
      })) + "\n",
    );
    return;
  }

  const selection = selectCurrentResults(results, { experiment: experimentFilter, patterns, fresh: flags.fresh });
  const matchedEvalIds = [...new Set(selection.attempts.map((a) => a.evalId))].sort();

  if (patterns.length > 0 && matchedEvalIds.length === 0) {
    const known = [
      ...new Set(filterExperiments(results.experiments, experimentFilter).flatMap((e) => e.evalIds)),
    ].sort();
    throw new ShowError(
      t("cli.show.noEvalMatch", { patterns: patterns.join(", "), evals: known.join(", ") || "(none)" }),
    );
  }

  // `--usage`:UsageTable 逐 attempt 装配的表(docs/feature/reports/show/usage.md)。`--json`
  // 恒是 usageTableData 行数组——pivot 只是 text 渲染面的排布,不造第二种 data 形状
  // (docs/feature/reports/show/json.md「data:按 view 找组件声明」)。text 面:对照范围(`--exp`
  // 出现两次以上)下是逐 eval 的用量矩阵(renderUsageCompareSlice,配对/占位/时效复用
  // `deltaTableData`);否则是逐 attempt、逐 experiment 分节的通用表(renderUsageSlice)。
  if (flags.usage) {
    if (flags.json) {
      const rows = await usageRowsOf(selection.attempts);
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view: "usage",
          scope: buildShowScope({ resultsRoot: root, patterns, experiments: resolvedExperimentIds, fresh: flags.fresh === true }),
          data: rows,
        }),
      );
      return;
    }
    const text =
      expSelectors.length >= 2
        ? await renderUsageCompareSlice(selection, resolveCompareConditions(experimentIds, expSelectors))
        : await renderUsageSlice(selection.attempts);
    io.out(text + "\n");
    return;
  }

  // 证据切面是宿主本体:出现即走证据室,不渲染报告槽(与默认报告同规则)。每个切片接受任意
  // 范围——范围含多个 attempt 时按 experimentId、evalId、attempt 序逐 attempt 分节
  // (renderEvidenceSections,与上面 `@<locator>` 单元素范围共用同一份实现)。
  if (evidence) {
    if (flags.json) {
      const view = evidenceViewOf(flags);
      const data = await evidenceJsonOf(view, selection.attempts);
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view,
          scope: buildShowScope({ resultsRoot: root, patterns, experiments: resolvedExperimentIds, fresh: flags.fresh === true }),
          data,
        }),
      );
      return;
    }
    io.out((await renderEvidenceSections(selection.attempts, flags, grep, cwd, io.width)) + "\n");
    return;
  }

  // --history:执行时间轴(docs/feature/reports/show.md「--history:一个 eval 的执行时间轴」)。
  // 对 Scope 中匹配的每个 experimentId + evalId 分节,逐 attempt 而非逐快照;时间轴只列
  // 真实执行 —— resume 携带的复印件按 attempt 身份键去重后不占行。与重复 `--exp` 正交且不
  // 变形:时间轴本来就按 experimentId 分节,条件只是收窄节集合。
  if (flags.history) {
    const experiments = filterExperiments(results.experiments, experimentFilter);
    // eval 位置参数与 Scope 选择用同一个前缀谓词(单点在 shared/aggregate.ts),不另立口径。
    const matchesPattern = patterns.length > 0 ? evalPrefixPredicate(patterns) : () => true;
    if (flags.json) {
      // `history` 不进组件模型,直接投影 Results evidence(docs/feature/reports/show/json.md
      // 「data:按 view 找组件声明」)——每节携带 `AttemptJson`(完整落盘字段 + 归属身份),
      // 不是 text 面的单行摘要。
      const sections: { experimentId: string; evalId: string; attempts: unknown[] }[] = [];
      for (const exp of experiments) {
        const evalIds = [...exp.evalIds].filter(matchesPattern).sort();
        for (const evalId of evalIds) {
          const handles = attemptHistoryHandles(exp, evalId);
          if (handles.length === 0) continue;
          sections.push({ experimentId: exp.id, evalId, attempts: handles.map(attemptJsonOf) });
        }
      }
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view: "history",
          scope: buildShowScope({ resultsRoot: root, patterns, experiments: resolvedExperimentIds, fresh: flags.fresh === true }),
          data: sections,
        }),
      );
      return;
    }
    const blocks: string[] = [];
    for (const exp of experiments) {
      const evalIds = [...exp.evalIds].filter(matchesPattern).sort();
      for (const evalId of evalIds) {
        const rows = attemptHistory(exp, evalId);
        if (rows.length === 0) continue;
        blocks.push(attemptHistoryText({ experimentId: exp.id, evalId, rows }));
      }
    }
    io.out(blocks.join("\n\n") + "\n");
    return;
  }

  // 缺省切片选择表(docs/feature/reports/show.md「缺省切片的选择规则」):`--exp` 出现两次以上
  // 且没有被 `--report` 接管时是对照矩阵,不是报告槽的裸榜单——与 `--report` 互斥(缺省切片被
  // 报告树替换时对照矩阵不再适用)。
  if (flags.report === undefined && expSelectors.length >= 2) {
    const conditions = resolveCompareConditions(experimentIds, expSelectors);
    if (flags.json) {
      const { deltaTableData } = await import("../../dist/report/index.js");
      const data = await deltaTableData(selection, { by: "experiment", conditions });
      io.out(
        renderShowJson({
          format: "niceeval.show",
          schemaVersion: 1,
          view: "compare",
          scope: buildShowScope({ resultsRoot: root, patterns, experiments: conditions, fresh: flags.fresh === true }),
          data,
        }),
      );
      return;
    }
    io.out(
      (await renderCompareSlice(cwd, results, selection, conditions, {
        width: io.width,
        locale: detectLocale(),
        panelMode: io.panelMode,
      })) + "\n",
    );
    return;
  }

  if (flags.json) {
    // 缺省切片(leaderboard):内建报告首页的 `ExperimentComparison`/`ExperimentList` 对应的两个
    // 计算函数(docs/feature/reports/show/json.md「data:按 view 找组件声明」)。`--report` 已经
    // 与 `--json` 互斥,不需要装载报告就能直接算数据。
    const { experimentListData, scopeSummaryData } = await import("../../dist/report/index.js");
    const data = { experiments: await experimentListData(selection), summary: await scopeSummaryData(selection) };
    io.out(
      renderShowJson({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        scope: buildShowScope({ resultsRoot: root, patterns, experiments: resolvedExperimentIds, fresh: flags.fresh === true }),
        data,
      }),
    );
    return;
  }

  // 报告槽:裸 show / eval id 前缀 / 单个 `--exp` 都落在这里,装载 `niceeval/report/built-in`
  // 的默认导出,--report 整槽替换——同一条
  // 「装载 → 规范化(外壳 + 非空页列表)→ 逐页渲染」管线(docs/feature/reports/library/shell.md)。
  // locale = CLI 界面语言(NICEEVAL_LANG / LC_* / LANG 检测):报告 chrome 文案跟随终端语言。
  const report = await loadHostReport(cwd, flags.report);
  const locale = detectLocale();
  const commandContext: HostCommandContext = {
    patterns,
    ...(flags.results !== undefined ? { results: flags.results } : {}),
    ...(flags.report !== undefined ? { report: flags.report } : {}),
    ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
  };
  const sourceLabel = flags.report ?? "the built-in report";

  // 初始页 = --page 指定的页,缺省第一张可导航页(docs/feature/reports/show/reports.md
  // Case 2);本地宿主只 resolve 被打开的这一页——其余页只留 id / title,不触发取数(见
  // shell.md「行为约束」「本地宿主只 resolve 被打开的页」)。navigation:false 的页(参数化
  // attempt 详情)不参与缺省选择,也不能被 --page 直接打开——没有 locator 不能拿 Scope 强行
  // resolve(architecture.md「Attempt 详情是一张参数化 page」)。
  let page = report.pages.find((p) => p.navigation !== false) ?? report.pages[0];
  if (flags.page !== undefined) {
    const hit = report.pages.find((p) => p.id === flags.page);
    if (!hit) {
      // 用法错误:列出可用页 id(docs/feature/reports/show/reports.md Case 1/2 的报错样例)。
      throw new ShowError(
        `error: page "${flags.page}" not found in ${sourceLabel}. Available pages: ${report.pages.filter((p) => p.navigation !== false).map((p) => p.id).join(", ")}\n`,
      );
    }
    if (hit.input === "attempt") {
      throw new ShowError(
        `error: page "${hit.id}" in ${sourceLabel} is an attempt-input page and needs a locator — it cannot be opened with --page directly. Use niceeval show @<locator> instead.\n`,
      );
    }
    page = hit;
  }

  // attemptCommand 留给渲染管线的默认值:AttemptLocator 已经是可直接 `niceeval show @<locator>`
  // 的真实 CLI 语法,不需要再反查 eval id 拼一条近似命令。
  const meta = await buildHostReportMeta(report, selection);
  const text = await renderHostPageText(
    page,
    { scope: selection, results, report: meta, page: { id: page.id, input: "scope" } },
    {
      width: io.width,
      locale,
      panelMode: io.panelMode,
      commandContext: { ...commandContext, ...(flags.page !== undefined ? { page: flags.page } : {}) },
    },
  );

  // 页数大于一时尾部附「其余页」索引(只列未渲染、且可导航的页,不倾倒内容);单页定义
  // 没有这段;隐藏的 attempt page 不出现在「其余页」里。
  const remaining = report.pages.filter((p) => p.id !== page.id && p.navigation !== false);
  if (remaining.length === 0) {
    io.out(text + "\n");
    return;
  }
  const tail = otherPagesText({
    otherPages: remaining.map((p) => ({ id: p.id, title: p.title })),
    command: commandContext,
    locale,
  });
  io.out(`${text}\n\n${tail}\n`);
}
