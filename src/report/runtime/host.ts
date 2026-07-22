// 报告装载与逐页渲染的中性宿主 facade:show 与 view 共用(docs/feature/reports/architecture.md
// 「共享内核与两个宿主的代码边界」「单一 report runtime 身份」)。ReportDefinition / ReportPage /
// ReportMeta 的类型体系,以及装载规范化、resolve、text/web render 全部住在 niceeval/report 的
// 构建单元(src/report/**,经 `pnpm run build:report` 编译进 dist/report/**);这里只做两个
// 宿主都需要、但只属于宿主编排的一件事——文件 vs 内建报告的装载分流、逐页渲染——不重复声明
// 任何报告类型或规范化逻辑。终端专属的可复制命令拼装(`showCommand`)不在这里,只有 show 需要,
// 住在 src/show/command.ts。
//
// 本文件物理上住在 src/report/runtime/(host facade 的架构归属),但**不**参与
// tsconfig.report-build.json 的编译单元(见该文件的 exclude 注释):它是调用方经 tsx 直接执行的
// raw TypeScript,内部一律动态 import 兄弟 dist/report/** 产物——不是所有 show / view 命令都
// 渲染报告,静态 import 会让不需要报告的命令也背上 react / react-dom 依赖(web.ts 静态 import
// react-dom/server);同一进程也不能混用 raw src/report/** 与 dist/report/** 的同一状态模块,
// 所以值和类型都从同一批 dist 模块拿,不从本文件的兄弟源码拿。

import type { Results, Scope } from "../../results/index.ts";
import type { LocalizedText } from "../../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import type { PageContext } from "../../../dist/report/definition/tree.js";
import type {
  ReportDefinition,
  ReportMeta,
  ReportPage,
} from "../../../dist/report/definition/report.js";

export type { PageContext } from "../../../dist/report/definition/tree.js";
export type {
  HeadTag,
  ReportAsset,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportPage,
} from "../../../dist/report/definition/report.js";

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
    const { loadReportFile } = await import("../../../dist/report/runtime/load.js");
    return loadReportFile(cwd, reportPath, options) as Promise<ReportDefinition>;
  }
  const { standard } = await import("../../../dist/report/built-in/index.js");
  return standard as ReportDefinition;
}

/** ctx.report 的构建(不携带当前页——那是 HostRenderContext.page 的事)。 */
export async function buildHostReportMeta(definition: ReportDefinition, scope: Scope): Promise<ReportMeta> {
  const { buildReportMeta } = await import("../../../dist/report/definition/report.js");
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

// ───────────────────────── 索引命令上下文 ─────────────────────────

/**
 * 宿主索引命令的完整上下文(docs/feature/reports/show/reports.md「索引命令携带完整上下文」)。
 * 只是数据形状;拼出实际可复制的 `niceeval show ...` 命令字符串是 show 自己的事
 * (`src/show/command.ts` 的 `showCommand`)——view 走网页路由,不生成终端命令。
 */
export interface HostCommandContext {
  patterns: string[];
  results?: string;
  experiment?: string;
  report?: string;
  page?: string;
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
  const { renderReportTreeToText } = await import("../../../dist/report/runtime/text.js");
  return renderReportTreeToText(page.content, ctx, options);
}

/**
 * 渲染一页的 web 面(静态 HTML)。attemptHref 缺省时报告有 attempt-input page 就用
 * niceeval/report 的根相对默认值(`attempt/<encodeURIComponent(locator)>.html`,index.html
 * 视角);从 attempt 页面自身内容渲染时(该 page 引用了其它 locator)view 显式传入同级
 * 相对版本覆盖它——两种情形都不在这里判断,只透传。
 */
export async function renderHostPageHtml(
  page: ReportPage,
  ctx: HostRenderContext,
  options: { locale: string; attemptHref?: (locator: AttemptLocator) => string },
): Promise<string> {
  const { renderReportTreeToStaticHtml } = await import("../../../dist/report/runtime/web.js");
  return renderReportTreeToStaticHtml(page.content, ctx, options);
}
