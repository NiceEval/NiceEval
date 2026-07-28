// 页级 resolve 制品:一次 resolve 产出可复用的 ResolvedPage,text / web / 多 locale 纯同步投影。
// 契约见 plan/report-single-resolve-migration.md 第 1 步与 docs/feature/reports/architecture.md
// 「报告树与两个宿主」——ResolvedPage 不存 locale、终端宽度、主题色或 HTML;collect dimensions
// 在各自 render 前按 face 完成(label keyset 共用逻辑在 allocatePageDimensions,web 才算 visual)。

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttemptLocator } from "../../record/locator.ts";
import type { Record, Sample } from "../../record/types.ts";
import { Style } from "../definition/primitives.tsx";
import type { ReportMeta } from "../definition/report.ts";
import {
  collectPageDimensions,
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  withPageDimensions,
  ResolveMemo,
  type PageContext,
  type ReportNode,
  type TextRenderOptions,
  type WebContext,
} from "../definition/tree.ts";
import { UndeclaredDimensionValueError, type DimensionPins } from "../presentation.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "../model/locale.ts";
import type { HostCommandContext } from "./text.ts";

/** 默认下钻命令:与 text.ts 同形,供 renderResolvedPageText 缺省注入。 */
const DEFAULT_ATTEMPT_COMMAND = (locator: AttemptLocator): string => `niceeval show ${locator}`;

/** 默认证据室深链:与 web.ts 同形,供 renderResolvedPageWeb 缺省注入。 */
const DEFAULT_ATTEMPT_HREF = (locator: AttemptLocator): string => `attempt/${encodeURIComponent(locator)}.html`;

const UNBOUND_DIMENSION = (handle: string) => {
  throw new UndeclaredDimensionValueError(
    `ctx.dimension(${JSON.stringify(handle)}) was called on the host base context, which is not bound to any component. ` +
      "Render the component through the report pipeline so the page can bind its own dimensions().",
    handle,
  );
};

function quoteArg(value: string): string {
  return /^[A-Za-z0-9._/@-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function experimentCommandFor(ctx: HostCommandContext): (experimentIdPrefix: string) => string {
  return (prefix) => {
    const parts = ["niceeval show", ...ctx.patterns.map(quoteArg), `--exp ${quoteArg(prefix)}`];
    if (ctx.record !== undefined) parts.push(`--record ${quoteArg(ctx.record)}`);
    if (ctx.report !== undefined) parts.push(`--report ${quoteArg(ctx.report)}`);
    if (ctx.page !== undefined) parts.push(`--page ${quoteArg(ctx.page)}`);
    return parts.join(" ");
  };
}

/** resolve 时固化的宿主上下文:不含 locale、终端宽度或主题色。 */
export interface ResolvedPageHostContext {
  scope: Sample;
  results: Record;
  report: ReportMeta;
  page: PageContext;
  dimensionPins?: DimensionPins;
}

/** 展开并校验后的页级制品:可序列化 Content 在 tree 节点 props 里;styles 是页内 <Style> 声明顺序。 */
export interface ResolvedPage {
  tree: ReportNode;
  styles: readonly string[];
  context: ResolvedPageHostContext;
}

/** 遍历已 resolve 的树,按声明顺序收集 <Style> 的 CSS 文本。 */
export function collectPageStyles(node: ReportNode): string[] {
  const out: string[] = [];
  const visit = (current: ReportNode): void => {
    if (current === null || current === undefined || typeof current === "boolean") return;
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (typeof current !== "object" || !("type" in current)) return;
    const el = current as { type: unknown; props?: { children?: unknown } };
    if (el.type === Style && typeof el.props?.children === "string") {
      out.push(el.props.children);
    }
    if (el.props && "children" in el.props) visit(el.props.children as ReportNode);
  };
  visit(node);
  return out;
}

/** resolve + validate,产出可复用的 ResolvedPage。 */
export async function resolvePage(tree: ReportNode, context: ResolvedPageHostContext): Promise<ResolvedPage> {
  const resolved = await resolveReportTree(tree, {
    scope: context.scope,
    results: context.results,
    report: context.report,
    page: context.page,
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return { tree: resolved, styles: collectPageStyles(resolved), context };
}

export interface RenderResolvedTextOptions extends TextRenderOptions {
  commandContext?: HostCommandContext;
}

/** 从 ResolvedPage 同步渲染 text 面;render 前完成 text 的 collectPageDimensions。 */
export function renderResolvedPageText(resolved: ResolvedPage, options?: RenderResolvedTextOptions): string {
  const ctx = resolved.context;
  const hasAttemptPage = ctx.report.pages.some((p) => p.input === "attempt");
  const textCtx = createTextContext({
    ...options,
    attemptCommand: options?.attemptCommand ?? (hasAttemptPage ? DEFAULT_ATTEMPT_COMMAND : undefined),
    pageDimensions: collectPageDimensions(resolved.tree, ctx.dimensionPins ?? {}, "text"),
    ...(options?.experimentCommand === undefined && options?.commandContext !== undefined
      ? { experimentCommand: experimentCommandFor(options.commandContext) }
      : {}),
  });
  return renderNodeToText(resolved.tree, textCtx);
}

export interface RenderResolvedWebOptions {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
}

/** 从 ResolvedPage 同步渲染 web 面;render 前完成 web 的 collectPageDimensions。 */
export function renderResolvedPageWeb(resolved: ResolvedPage, options?: RenderResolvedWebOptions): string {
  const ctx = resolved.context;
  const hasAttemptPage = ctx.report.pages.some((p) => p.input === "attempt");
  const webCtx: WebContext = {
    ...(options?.attemptHref !== undefined
      ? { attemptHref: options.attemptHref }
      : hasAttemptPage
        ? { attemptHref: DEFAULT_ATTEMPT_HREF }
        : {}),
    locale: options?.locale ?? DEFAULT_REPORT_LOCALE,
    dimension: UNBOUND_DIMENSION,
  };
  withPageDimensions(webCtx, collectPageDimensions(resolved.tree, ctx.dimensionPins ?? {}, "web"));
  return runWithWebContext(webCtx, () => renderToStaticMarkup(resolved.tree as ReactNode));
}
