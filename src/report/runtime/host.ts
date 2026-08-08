// 报告装载与逐页渲染的中性宿主 facade:show 与 view 共用(docs/feature/reports/architecture.md
// 「共享内核与两个宿主的代码边界」「单一 report runtime 身份」)。ReportDefinition / ReportPage /
// ReportMeta 的类型体系,以及装载规范化、resolve、text/web render 全部住在 niceeval/report 的
// 本文件与报告定义、show、view 一起编进同一个 canonical runtime graph。它只做两个宿主都需要、
// 但属于宿主编排的一件事——文件 vs 内建报告的装载分流、逐页渲染——不重复声明任何报告类型或
// 规范化逻辑。终端专属的可复制命令拼装(`showCommand`)不在这里,只有 show 需要,住在
// src/show/command.ts。动态装载仍保留可选 web 依赖的按需边界，但绝不跳入第二份 report 图。

import type { Record, Sample } from "../../record/index.ts";
import { resolveLocator, loadAttemptEvidence } from "../../record/index.ts";
import type { LocalizedText } from "../../types.ts";
import type { PageContext } from "../definition/tree.ts";
import type {
  PageLoadContext,
  ReportDefinition,
  ReportMeta,
  ReportPage,
  ReportTarget,
} from "../definition/report.ts";
import type { ThemeDefinition } from "../theme.ts";
import type { DimensionPins } from "../presentation.ts";

export type { PageContext } from "../definition/tree.ts";
export type {
  HeadTag,
  ReportAsset,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportPage,
  ReportTarget,
  PageDefinition,
  PageParams,
  PageLoadContext,
} from "../definition/report.ts";
export type { ThemeDefinition } from "../theme.ts";
export type { ResolvedPage } from "./resolved-page.ts";
  // 源码宿主也必须跨公开 entry 进入预编译报告图。宽化为 string 让首次
// build:package 不依赖尚未生成的自引用声明文件。
  const BUILT_IN_REPORT_ENTRY: string = "niceeval/report/built-in";

/** 可预期的装载用户错误(与 ReportLoadError 同待遇:打一句直说问题与下一步,不抛堆栈)。 */
export class HostReportError extends Error {}

/**
 * 项目 config 是动态模块；它的 `report` 字段不能因为 `loadConfigFile()` 的静态返回注解而
 * 被当成已经验证过的 ReportDefinition。这里是 source → dist 的唯一收口点：只把同一份
 * 同一 canonical factory 打过品牌的值交给宿主后续长期持有的 report 槽。
 */
async function normalizeConfiguredReport(value: unknown): Promise<ReportDefinition> {
  const { isReportDefinition } = await import("../definition/report.ts");
  if (!isReportDefinition(value)) {
    throw new HostReportError(
      'The project default report (the "report" field in niceeval.config.ts) must be the result of defineReport(...) from "niceeval/report".',
    );
  }
  return value;
}

/** 与 report 同理：动态 config 值只有通过 canonical factory 品牌后才成为 ThemeDefinition。 */
async function normalizeConfiguredTheme(value: unknown): Promise<ThemeDefinition> {
  const { isThemeDefinition } = await import("../theme.ts");
  if (!isThemeDefinition(value)) {
    throw new HostReportError(
      'The project default theme (the "theme" field in niceeval.config.ts) must be the result of defineTheme(...) from "niceeval/report".',
    );
  }
  return value;
}

// ───────────────────────── 装载 ─────────────────────────

/**
 * 装载宿主报告:`--report <file>` 走 dist 里的 `loadReportFile`;缺省(裸 show / 裸 view)
 * 装载内建 `standard`。两条路的产物都已经是 `defineReport` 规范化后的 `ReportDefinition`——
 * 没有第二个规范化步骤,`defineReport` 本身就是唯一规范化点。
 */
export async function loadHostReport(
  cwd: string,
  reportPath: string | undefined,
  configuredReport?: unknown,
  options?: { freshImport?: boolean },
): Promise<ReportDefinition> {
  if (reportPath !== undefined) {
    const { isExplicitModulePath, loadBuiltInReport, loadReportFile } = await import("./load.ts");
    return (isExplicitModulePath(reportPath) ? loadReportFile(cwd, reportPath, options) : loadBuiltInReport(reportPath)) as Promise<ReportDefinition>;
  }
  if (configuredReport !== undefined) {
    return normalizeConfiguredReport(configuredReport);
  }
  const { standard } = (await import(BUILT_IN_REPORT_ENTRY)) as { standard: ReportDefinition };
  return standard as ReportDefinition;
}

/**
 * 报告出处的人读标签：与 `loadHostReport` 的三档取值链一一对应（`--report` → `config.report`
 * → 内建 `standard`）。宿主报错要点名「这份报告是从哪来的」——把出处判断留在调用点，
 * 消息就会像 `--report` 没给时那样一律说成内建，而实际装载的是配置里的报告。
 */
export function describeReportSource(reportPath: string | undefined, configuredReport?: ReportDefinition): string {
  if (reportPath !== undefined) return `the report loaded by \`--report ${reportPath}\``;
  if (configuredReport !== undefined) return "the project default report (the `report` field in niceeval.config.ts)";
  return "the built-in report";
}

/**
 * view 的 locator 证据室缺省页。自定义报告可以声明自己的 attempt-input page 覆盖它；
 * 没声明时仍保留官方 AttemptDetails，避免组合组件的 locator 因换了首页而退化成不可点击文本。
 */
export async function loadDefaultHostAttemptPage(): Promise<ReportPage> {
  const { standard } = (await import(BUILT_IN_REPORT_ENTRY)) as { standard: ReportDefinition };
  const page = standard.pages.find((candidate) => candidate.id === "attempt");
  if (page === undefined) throw new Error('The built-in report is missing its "attempt" page.');
  return page;
}

/**
 * `--report` / `--theme` 取值的形态判别:含 `/`、以 `.` 开头或带模块后缀的按文件装载,
 * 其余是内建名。view 的 watch 闭集按同一条判别决定盯不盯文件,不另写一套字符串规则。
 */
export async function isHostModulePath(value: string): Promise<boolean> {
  const { isExplicitModulePath } = await import("./load.ts");
  return isExplicitModulePath(value);
}

/** ctx.report 的构建(不携带当前页——那是 HostRenderContext.page 的事)。 */
export async function buildHostReportMeta(definition: ReportDefinition, scope: Sample): Promise<ReportMeta> {
  const { buildReportMeta } = await import("../definition/report.ts");
  return buildReportMeta(definition, scope);
}

export async function resolveHostTheme(
  cwd: string,
  cliTheme: string | undefined,
  reportTheme: ThemeDefinition | undefined,
  configTheme: unknown,
  options?: { freshImport?: boolean },
): Promise<ThemeDefinition> {
  const { isExplicitModulePath, loadBuiltInTheme, loadThemeFile } = await import("./load.ts");
  if (cliTheme !== undefined) return (isExplicitModulePath(cliTheme) ? loadThemeFile(cwd, cliTheme, options) : loadBuiltInTheme(cliTheme)) as Promise<ThemeDefinition>;
  if (reportTheme !== undefined) return reportTheme;
  if (configTheme !== undefined) return normalizeConfiguredTheme(configTheme);
  return loadBuiltInTheme("basalt") as Promise<ThemeDefinition>;
}

export async function hostThemeStylesheet(theme: ThemeDefinition): Promise<string> {
  const { themeStylesheet } = await import("../theme.ts");
  return themeStylesheet(theme);
}

/**
 * LocalizedText 的确定回退(shell.md「行为约束」):当前 locale → en → 按 locale 键字典序的
 * 第一个非空值。undefined 输入原样返回 undefined——两个宿主用它给"可能没声明"的字段
 * (页标题、外壳字段)取显示字符串。算法与 niceeval/report 的 resolveLocalizedText 是同一份
 * shell.md 文档契约的两处实现(这里没有报告类型或规范化状态,纯字符串函数,不经 dist 边界)。
 */
export function localizeText(text: LocalizedText | undefined, locale: string): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text === "string") return text || undefined;
  const exact = text[locale];
  if (exact) return exact;
  if (text.en) return text.en;
  for (const key of Object.keys(text).sort()) {
    if (text[key]) return text[key];
  }
  return undefined;
}

// ───────────────────────── 索引命令上下文 ─────────────────────────

/**
 * 宿主索引命令的完整上下文(docs/feature/reports/show/reports.md「索引命令携带完整上下文」)。
 * 只是数据形状;拼出实际可复制的 `niceeval show ...` 命令字符串是 show 自己的事
 * (`src/show/command.ts` 的 `showCommand`)——view 走网页路由,不生成终端命令。
 */
export interface HostCommandContext {
  patterns: string[];
  record?: string;
  /** `--exp`;可重复,顺序即用户输入顺序(对照条件顺序)。 */
  experiment?: string | string[];
  report?: string;
  page?: string;
}

// ───────────────────────── 逐页渲染 ─────────────────────────

/** 逐页渲染的宿主上下文:官方口径的 Sample、结果根读取面、规范化声明与当前页判别。 */
export interface HostRenderContext {
  scope: Sample;
  results: Record;
  report: ReportMeta;
  page: PageContext;
  /** 外壳钉色;不进 ReportMeta(Composition 的 ctx.report 读不到),见 shell.md「钉色」。 */
  dimensionPins?: DimensionPins;
}

export interface HostTextRenderOptions {
  width?: number;
  locale?: string;
  /** 索引命令的完整上下文(docs/feature/reports/show/reports.md);逐页渲染时透传。 */
  commandContext?: HostCommandContext;
  /** `Section` 的框线传输能力(docs/feature/reports/library/layout.md「区域框」);宿主按真实
   *  TTY / NO_COLOR 探测结果注入,省略时降级为无框文本(`createTextContext` 的默认值)。 */
  panelMode?: "boxed" | "plain";
}

/** 渲染一页的 text 面。 */
export async function renderHostPageText(
  page: ReportPage,
  ctx: HostRenderContext,
  options: HostTextRenderOptions,
): Promise<string> {
  const { renderReportTreeToText } = await import("./text.ts");
  const { resolveDefinitionPage } = await import("./page-render.ts");
  const resolved = await resolveDefinitionPage(page, ctx);
  const { renderResolvedPageText } = await import("./resolved-page.ts");
  return renderResolvedPageText(resolved, options);
}

/**
 * 宿主专属懒加载来源的唯一装配点:按 locator 装配 AttemptEvidence(经 `loadAttemptEvidence`
 * 管线),供 `renderHostTarget` 的 `page.load` 调用。**不**委托给
 * `page-render.ts` 的同名 helper：它和 show/view 都在同一份 canonical record 模块图中运行。
 * `resolveLocator` 的 locator 索引按 `results` 对象身份建 WeakMap，必须由构造 `results` 的同一
 * 模块实例读取；共享图保证 `show @<locator> --report standard` 不会因双份 runtime 而误报
 * LocatorNotFoundError。这里直接用这份 record 模块实现 `PageLoadContext`，保证索引同源。
 */
export async function createHostPageLoadContext(results: Record): Promise<PageLoadContext> {
  return {
    evidence: (locator) => loadAttemptEvidence(resolveLocator(results, locator)),
  };
}

/** `renderTarget` 求 resolve 所需的宿主上下文(scope 由 `base` 参数单独给出)。 */
export interface HostTargetContext {
  results: Record;
  report: ReportMeta;
  dimensionPins?: DimensionPins;
}

/**
 * 按目标(`page` id + `params`)渲染 text 面:唯一的目标寻址路径
 * (architecture.md「执行模型」)——拿目标找 page、按页自己的 `load` 求输入(省略 `load`
 * 时输入就是 `base`)、render、resolve。`show @<locator>` 这类"选中一个参数化页并注入它自己
 * 声明的 load"的调用点走这里,不在宿主里另起一套"已经算好 input 直接注入"的旁路
 * (那条旁路会让自定义报告自己声明的 `load` 被绕过,产出与页面作者声明不一致的结果)。
 */
export async function renderHostTarget(
  definition: ReportDefinition,
  target: ReportTarget,
  base: Sample,
  ctx: PageLoadContext,
  host: HostTargetContext,
  options: HostTextRenderOptions,
): Promise<string> {
  const { renderTarget } = await import("./page-render.ts");
  const resolved = await renderTarget(definition, target, base, ctx, host);
  const { renderResolvedPageText } = await import("./resolved-page.ts");
  return renderResolvedPageText(resolved, options);
}

/** 解析一页报告树,产出可复用的 ResolvedPage(同一页只 resolve 一次,再投影多 locale)。 */
export async function resolveHostPage(
  page: ReportPage,
  ctx: HostRenderContext,
  options?: { renderCache?: Map<string, Promise<import("../definition/tree.ts").ReportNode>> },
): Promise<import("./resolved-page.ts").ResolvedPage> {
  const { resolveDefinitionPage } = await import("./page-render.ts");
  return resolveDefinitionPage(page, ctx, options);
}

/** 从 ResolvedPage 同步渲染 web 面(静态 HTML);动态 import dist 产物,render 本身无 await。 */
export async function renderHostPageFromResolved(
  resolved: import("./resolved-page.ts").ResolvedPage,
  options: { locale: string; href?: (target: ReportTarget) => string | undefined },
): Promise<string> {
  const { renderResolvedPageWeb } = await import("./resolved-page.ts");
  return renderResolvedPageWeb(resolved, options);
}

/**
 * 收集并物化一张已经 resolve 的 page 实际用到的自定义 renderer 资产。
 * 资产跟 page tree 走，不能在报告装载期扫描定义：未请求的惰性 page 不应执行 render，
 * 条件分支里没有出现的 renderer 也不应进入产物。
 */
export async function materializeHostPageRendererAssets(
  resolved: import("./resolved-page.ts").ResolvedPage,
): Promise<import("../extension/types.ts").PageRendererAssets> {
  const { readFile } = await import("node:fs/promises");
  const { collectRendererAssetDeclarations, materializeRendererAssets } =
    await import("../extension/index.ts");
  const declarations = collectRendererAssetDeclarations(resolved.tree);
  return materializeRendererAssets(declarations, readFile);
}

/**
 * 渲染一页的 web 面(静态 HTML)。`href` 缺省时用 niceeval/report 的根相对默认值(只服务
 * 标准库 attempt 目标,`attempt/<encodeURIComponent(locator)>.html`,index.html 视角);
 * 从参数化页面自身内容渲染时(该 page 引用了其它目标)view 显式传入同级相对版本覆盖它——
 * 两种情形都不在这里判断,只透传。
 */
export async function renderHostPageHtml(
  page: ReportPage,
  ctx: HostRenderContext,
  options: { locale: string; href?: (target: ReportTarget) => string | undefined },
): Promise<string> {
  const resolved = await resolveHostPage(page, ctx);
  return renderHostPageFromResolved(resolved, options);
}
