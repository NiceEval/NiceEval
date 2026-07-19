// 报告装载的宿主联系面:show 与 view 共用。ReportDefinition / ReportPage / ReportMeta 的
// 类型体系,以及装载规范化、resolve、text/web render 全部住在 niceeval/report 的构建单元
// (src/report/**,经 `pnpm run build:report` 编译进 dist/report/**);这里只做两个宿主都
// 需要、但只属于宿主编排的两件事——文件 vs 内建报告的装载分流、页索引命令拼装——不重复声明
// 任何报告类型或规范化逻辑(docs/feature/reports/architecture.md「单一 report runtime 身份」)。
//
// 值(函数 / 类)一律动态 import dist/report/**:report-host.ts 被 cli.ts 的多数命令间接
// import,不是所有命令都渲染报告,静态 import 会让不需要报告的命令也背上 react / react-dom
// 依赖。类型用 `import type` 从同一批 dist 模块拿——编译期擦除,零运行时代价,不产生
// 第二份模块实例;同一进程不混用 raw src/report/** 与 dist/report/** 的同一状态模块。

import type { Results, Scope } from "../results/index.ts";
import type { LocalizedText } from "../types.ts";
import type { PageContext } from "../../dist/report/tree.js";
import type {
  ReportDefinition,
  ReportMeta,
  ReportPage,
} from "../../dist/report/report.js";

export type { PageContext } from "../../dist/report/tree.js";
export type {
  HeadTag,
  ReportAsset,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportPage,
} from "../../dist/report/report.js";

/** 可预期的装载用户错误(与 ReportLoadError 同待遇:打一句直说问题与下一步,不抛堆栈)。 */
export class HostReportError extends Error {}

// ───────────────────────── 装载 ─────────────────────────

/**
 * 装载宿主报告:`--report <file>` 走 dist 里的 `loadReportFile`;缺省(裸 show / 裸 view)
 * 装载内建 `standard`。两条路的产物都已经是 `defineReport` 规范化后的 `ReportDefinition`——
 * 没有第二个规范化步骤,`defineReport` 本身就是唯一规范化点。
 */
export async function loadHostReport(
  cwd: string,
  reportPath: string | undefined,
  options?: { freshImport?: boolean },
): Promise<ReportDefinition> {
  if (reportPath !== undefined) {
    const { loadReportFile } = await import("../../dist/report/load.js");
    return loadReportFile(cwd, reportPath, options) as Promise<ReportDefinition>;
  }
  const { standard } = await import("../../dist/report/built-in/index.js");
  return standard as ReportDefinition;
}

/** ctx.report 的构建(不携带当前页——那是 HostRenderContext.page 的事)。 */
export async function buildHostReportMeta(definition: ReportDefinition, scope: Scope): Promise<ReportMeta> {
  const { buildReportMeta } = await import("../../dist/report/report.js");
  return buildReportMeta(definition, scope);
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

// ───────────────────────── 页索引命令 ─────────────────────────

/** 宿主索引命令的完整上下文(docs/feature/reports/show/reports.md「索引命令携带完整上下文」)。 */
export interface HostCommandContext {
  patterns: string[];
  results?: string;
  experiment?: string;
  report?: string;
  page?: string;
}

/** 按上下文拼一条可复制的 show 命令(页索引 / 组索引共用的携带规则)。 */
export function showCommand(ctx: HostCommandContext, extra: string[] = []): string {
  const parts = ["niceeval show", ...ctx.patterns];
  if (ctx.experiment !== undefined) parts.push(`--exp ${ctx.experiment}`);
  if (ctx.results !== undefined) parts.push(`--results ${ctx.results}`);
  if (ctx.report !== undefined) parts.push(`--report ${ctx.report}`);
  if (ctx.page !== undefined) parts.push(`--page ${ctx.page}`);
  parts.push(...extra);
  return parts.join(" ");
}

// ───────────────────────── 逐页渲染 ─────────────────────────

/** 逐页渲染的宿主上下文:官方口径的 Scope、结果根读取面、规范化声明与当前页判别。 */
export interface HostRenderContext {
  scope: Scope;
  results: Results;
  report: ReportMeta;
  page: PageContext;
}

export interface HostTextRenderOptions {
  width?: number;
  locale?: string;
  /** 索引命令的完整上下文(docs/feature/reports/show/reports.md);逐页渲染时透传。 */
  commandContext?: HostCommandContext;
}

/** 渲染一页的 text 面。 */
export async function renderHostPageText(
  page: ReportPage,
  ctx: HostRenderContext,
  options: HostTextRenderOptions,
): Promise<string> {
  const { renderReportTreeToText } = await import("../../dist/report/report.js");
  return renderReportTreeToText(page.content, ctx, options);
}

/** 渲染一页的 web 面(静态 HTML)。 */
export async function renderHostPageHtml(
  page: ReportPage,
  ctx: HostRenderContext,
  options: { locale: string },
): Promise<string> {
  const { renderReportTreeToStaticHtml } = await import("../../dist/report/web.js");
  return renderReportTreeToStaticHtml(page.content, ctx, options);
}
