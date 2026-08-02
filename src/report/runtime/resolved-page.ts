// 页级 resolve 制品:一次 resolve 产出可复用的 ResolvedPage,text / web / 多 locale 纯同步投影。
// 契约见 plan/report-single-resolve-migration.md 第 1 步与 docs/feature/reports/architecture.md
// 「报告树与两个宿主」——ResolvedPage 不存 locale、终端宽度、主题色或 HTML;collect dimensions
// 在各自 render 前按 face 完成(label keyset 共用逻辑在 allocatePageDimensions,web 才算 visual)。

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Record, Sample } from "../../record/types.ts";
import { Style } from "../definition/primitives.tsx";
import type { ReportMeta, ReportTarget } from "../definition/report.ts";
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
import { ATTEMPT_PAGE_ID } from "../components/shared.ts";

/**
 * 目标里的 locator(只有标准库 attempt 页的目标才有这个形状,`{ locator: AttemptLocator }`,
 * 与 `targetOfRefs`/`standardAttemptPage.params` 同一份约定)。
 */
function attemptLocatorOf(target: ReportTarget): string | undefined {
  if (target.page !== ATTEMPT_PAGE_ID) return undefined;
  const params = target.params;
  if (params === undefined || params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
  const locator = params.locator;
  return typeof locator === "string" ? locator : undefined;
}

/**
 * 默认下钻命令(与 text.ts 同形,供 renderResolvedPageText 缺省注入):只对标准库 attempt 目标
 * 给出真实可跑的 `niceeval show @<locator>`,其它目标返回 `undefined`——CLI 目前只有这一条
 * 位置参数快捷语法,没有通用的“按参数化页 + key 打开”命令,不发明假语法
 * (docs/feature/reports/library.md「目标与下钻」:“text 宿主没有链接，把可服务的目标格式化成
 * 下钻命令”,服务不了就是 undefined)。这是继 `targetOfRefs` 之后第二处允许知道 attempt 这个
 * id 的地方(常量单源见 `components/shared.ts` 的 `ATTEMPT_PAGE_ID` 注释)。
 */
const DEFAULT_ATTEMPT_COMMAND = (target: ReportTarget): string | undefined => {
  const locator = attemptLocatorOf(target);
  return locator === undefined ? undefined : `niceeval show ${locator}`;
};

/**
 * 默认证据室深链(与 web.ts 同形,供 renderResolvedPageWeb 缺省注入):与静态导出的
 * `<pageId>/<key>.html` 布局同形,只是这里的 key 直接是 locator(attempt 页的
 * `params.encode` 本身就是恒等函数)。其它目标返回 `undefined`,组件退化为纯文本。
 */
const DEFAULT_ATTEMPT_HREF = (target: ReportTarget): string | undefined => {
  const locator = attemptLocatorOf(target);
  return locator === undefined ? undefined : `${ATTEMPT_PAGE_ID}/${encodeURIComponent(locator)}.html`;
};

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
  const textCtx = createTextContext({
    ...options,
    command: options?.command ?? DEFAULT_ATTEMPT_COMMAND,
    pageDimensions: collectPageDimensions(resolved.tree, ctx.dimensionPins ?? {}, "text"),
    ...(options?.experimentCommand === undefined && options?.commandContext !== undefined
      ? { experimentCommand: experimentCommandFor(options.commandContext) }
      : {}),
  });
  return renderNodeToText(resolved.tree, textCtx);
}

export interface RenderResolvedWebOptions {
  href?: (target: ReportTarget) => string | undefined;
  locale?: ReportLocale;
}

/** 从 ResolvedPage 同步渲染 web 面;render 前完成 web 的 collectPageDimensions。 */
export function renderResolvedPageWeb(resolved: ResolvedPage, options?: RenderResolvedWebOptions): string {
  const ctx = resolved.context;
  const webCtx: WebContext = {
    href: options?.href ?? DEFAULT_ATTEMPT_HREF,
    locale: options?.locale ?? DEFAULT_REPORT_LOCALE,
    dimension: UNBOUND_DIMENSION,
  };
  withPageDimensions(webCtx, collectPageDimensions(resolved.tree, ctx.dimensionPins ?? {}, "web"));
  return runWithWebContext(webCtx, () => renderToStaticMarkup(resolved.tree as ReactNode));
}
