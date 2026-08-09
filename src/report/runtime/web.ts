// web 宿主(view --report)的装载入口:同一棵树走 web 面,renderToStaticMarkup 吐静态
// HTML 烘进查看器的报告槽。react-dom 的实际 import 在 ./resolved-page.ts(边界即运行时边界),
// 所以本文件不从 niceeval/report 的入口 re-export —— 宿主与测试按源路径 import。

import type { Sample } from "../../record/types.ts";
import type { PageContext } from "../definition/tree.ts";
import type { DimensionPins } from "../presentation.ts";
import { type ReportLocale } from "../model/locale.ts";
import { buildReportMeta, type ReportDefinition, type ReportTarget } from "../definition/report.ts";
import { pickReportPage, type ReportHostContext } from "./text.ts";
import { renderResolvedPageWeb, resolvePage } from "./resolved-page.ts";
import { resolveDefinitionPage } from "./page-render.ts";

export interface StaticHtmlOptions {
  /** 渲染哪一页;缺省第一张可导航页。命中参数化 page 抛 ReportPageNeedsLocatorError。 */
  pageId?: string;
  /** 下钻目标 → URL;省略时使用运行时默认值(只服务标准库 attempt 目标),除非显式传入。 */
  href?: (target: ReportTarget) => string | undefined;
  /** 官方组件 chrome 文案的 locale;默认 "en"。 */
  locale?: ReportLocale;
}

/**
 * web 宿主的装载语义:选页(只能是 scope-input page)→ resolve(组合展开 + spec 取数,
 * 唯一的 await 边界)→ 树校验(与 text 宿主同一遍)→ 静态渲染 web 面。宿主不在报告树外
 * 另设警告通道——挑选警告的呈现件是 `ScopeWarnings` 组件,内建报告每页都放它,自定义报告
 * 放不放是作者义务(docs/feature/reports/README.md「Sample 是计算入口」)。
 */
export async function renderReportToStaticHtml(
  definition: ReportDefinition,
  ctx: ReportHostContext,
  options?: StaticHtmlOptions,
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
  return renderResolvedPageWeb(resolved, options);
}

/**
 * 渲染一页报告树的 web 面(宿主逐页调用;页选择归宿主):resolve → validate → 静态渲染。
 * 挑选警告由页内的 `ScopeWarnings` 组件呈现,宿主不前置任何树外块。
 * ctx.report 是宿主规范化后的声明,ctx.page 是当前页判别(id + 该页的 render 输入)。
 */
export async function renderReportTreeToStaticHtml(
  tree: import("../definition/tree.ts").ReportNode,
  ctx: {
    scope: Sample;
    results: import("../../record/types.ts").Record;
    report: import("../definition/report.ts").ReportMeta;
    page: PageContext;
    /** 外壳钉色;不进 ReportMeta,见 ReportTreeHostContext.dimensionPins。 */
    dimensionPins?: DimensionPins;
  },
  options?: { href?: (target: ReportTarget) => string | undefined; locale?: ReportLocale },
): Promise<string> {
  const resolved = await resolvePage(tree, ctx);
  return renderResolvedPageWeb(resolved, options);
}
