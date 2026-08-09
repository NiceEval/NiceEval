// text 宿主(show)的渲染入口:装载好的 ReportDefinition/page → resolve(组合展开 + spec 取数)
// → validate(两面资格)→ render(纯同步字符输出)。web 宿主的对应入口在 ./web.ts(那一侧才
// import react-dom)。管线以页为单位执行;defineReport 本身与 ReportDefinition 的类型体系在
// ../definition/report.ts,这里只做渲染编排与宿主联系面(页选择、索引命令拼装)。

import type { Record, Sample } from "../../record/types.ts";
import {
  type PageContext,
  type ReportNode,
  type TextRenderOptions,
} from "../definition/tree.ts";
import { renderResolvedPageText, resolvePage } from "./resolved-page.ts";
import { resolveDefinitionPage } from "./page-render.ts";
import {
  buildReportMeta,
  resolveReportTitle,
  type ReportDefinition,
  type ReportMeta,
  type ReportPage,
} from "../definition/report.ts";
import { resolveLocalizedText, type ReportLocale } from "../model/locale.ts";
import type { DimensionPins } from "../presentation.ts";

// ───────────────────────── 页选择与 text 宿主入口 ─────────────────────────

/** `--page` 未命中:宿主据此按用法错误退出并列出可用页 id(只列 navigation !== false 的)。 */
export class ReportPageNotFoundError extends Error {
  readonly pageId: string;
  readonly available: string[];
  constructor(pageId: string, available: string[]) {
    super(`page "${pageId}" not found. Available pages: ${available.join(", ")}`);
    this.pageId = pageId;
    this.available = available;
  }
}

/** 显式请求了一张参数化 page,但当前入口没有参数可注入 render 输入。 */
export class ReportPageNeedsLocatorError extends Error {
  readonly pageId: string;
  constructor(pageId: string) {
    super(
      `Page "${pageId}" is a parametrized page and needs params — it cannot be opened with --page or #/page/<id> directly. ` +
        "Use the host's target addressing instead (niceeval show @<locator> for the standard attempt page, or the view detail route), which resolves this page with the matching params.",
    );
    this.pageId = pageId;
  }
}

/**
 * 挑选要渲染的 page:省略 pageId 时挑第一张 `navigation !== false` 的页(跳过参数化详情页,
 * 它没有 params 就不可打开);显式 pageId 命中参数化 page 时报 ReportPageNeedsLocatorError
 * ——这个入口没有 params,不能拿 Sample 强行 resolve。
 */
export function pickReportPage(definition: ReportDefinition, pageId?: string): ReportPage {
  if (pageId === undefined) {
    return definition.pages.find((p) => p.navigation !== false) ?? definition.pages[0];
  }
  const page = definition.pages.find((p) => p.id === pageId);
  if (!page) {
    throw new ReportPageNotFoundError(
      pageId,
      definition.pages.filter((p) => p.navigation !== false).map((p) => p.id),
    );
  }
  if (page.params !== undefined) throw new ReportPageNeedsLocatorError(page.id);
  return page;
}

/** 宿主注入的渲染上下文:官方口径挑好的 Sample 与结果根完整读取面。 */
export interface ReportHostContext {
  scope: Sample;
  /** 组合组件 ctx.results 的来源;历史视图从这里自行挑 Run[]。 */
  results: Record;
}

export interface RenderReportTextOptions extends TextRenderOptions {
  /** 渲染哪一页;缺省第一张可导航页。命中参数化 page 抛 ReportPageNeedsLocatorError,未命中抛 ReportPageNotFoundError。 */
  pageId?: string;
}

/**
 * text 宿主的装载语义:选页(只能是非参数化 page,见 pickReportPage)→ resolve(组合展开 +
 * spec 取数,唯一的 await 边界)→ 树校验 → 遍历渲染 text 面。不需要 react-dom。宿主不在报告树外
 * 另设警告通道——挑选警告的呈现件是 `ScopeWarnings` 组件,内建报告每页都放它,自定义报告放不放
 * 是作者义务(docs/feature/reports/README.md「Sample 是计算入口」)。
 */
export async function renderReportToText(
  definition: ReportDefinition,
  ctx: ReportHostContext,
  options?: RenderReportTextOptions,
): Promise<string> {
  const page = pickReportPage(definition, options?.pageId);
  const meta = buildReportMeta(definition, ctx.scope);
  const resolved = await resolveDefinitionPage(page, {
    scope: ctx.scope,
    results: ctx.results,
    report: meta,
    page: { id: page.id, input: ctx.scope },
    dimensionPins: definition.dimensionPins,
  });
  return renderResolvedPageText(resolved, options);
}

/** 页索引标题行(show 多页索引 / view 导航共用的解析结果):按 locale 解析的标题字符串。 */
export function reportTitleText(definition: ReportDefinition, scope: Sample, locale: ReportLocale): string {
  return resolveLocalizedText(resolveReportTitle(definition, scope), locale);
}

// ───────────────────────── 逐页(树)渲染入口:宿主联系面 ─────────────────────────

/** 宿主索引命令的完整上下文(docs/feature/reports/README.md「索引命令携带完整上下文」)。 */
export interface HostCommandContext {
  patterns: string[];
  record?: string;
  /** `--exp`;可重复,顺序即用户输入顺序(对照条件顺序)。组索引命令按单个 experiment id
   *  前缀拼 `--exp`(experimentCommandFor),不读这个字段——它只用于跨宿主边界的结构透传。 */
  experiment?: string | string[];
  report?: string;
  page?: string;
}

/** 逐页渲染的宿主上下文:官方口径的 Sample、结果根读取面、规范化声明(ctx.report)与当前页判别。 */
export interface ReportTreeHostContext {
  scope: Sample;
  results: Record;
  report: ReportMeta;
  /** 当前渲染的页:id + 该页的 render 输入(宿主已按该页自己的 load 语义完成寻址与装配)。 */
  page: PageContext;
  /**
   * 外壳钉色。住在宿主渲染上下文而非 ReportMeta——Composition 的 ctx.report 读不到钉色,
   * 页级分配才能保持纯函数(shell.md「钉色」/「行为约束」)。
   */
  dimensionPins?: DimensionPins;
}

export interface RenderTreeTextOptions extends TextRenderOptions {
  /** 组索引命令的完整上下文;给了就按它拼命令,experimentCommand 显式注入时以后者为准。 */
  commandContext?: HostCommandContext;
}

/**
 * 渲染一页报告树的 text 面(宿主逐页调用;页选择归宿主):
 * resolve(组合展开 + spec 取数)→ validate → render。宿主不在报告树外另设警告通道,
 * 挑选警告由页内的 `ScopeWarnings` 组件呈现(内建报告每页都放它)。`ctx.command` 恒存在,
 * 默认实现只对标准库 attempt 目标给出真实命令,其它目标返回 `undefined`(resolved-page.ts
 * 的 DEFAULT_ATTEMPT_COMMAND)。
 */
export async function renderReportTreeToText(
  tree: ReportNode,
  ctx: ReportTreeHostContext,
  options?: RenderTreeTextOptions,
): Promise<string> {
  const resolved = await resolvePage(tree, ctx);
  return renderResolvedPageText(resolved, options);
}
