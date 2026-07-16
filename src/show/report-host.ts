// 报告装载的宿主联系面:show 与 view 共用(view 从这里 import;两个宿主对同一份
// defineReport 产物必须得到同一个规范化结果,见 docs/feature/reports/library/shell.md)。
//
// 契约(docs/feature/reports/library/shell.md「行为约束」/ architecture.md「外壳与页:装载规范化」):
// - `--report` 文件默认导出恒为 defineReport 产物;裸宿主装载 `niceeval/report/built-in` 的默认导出,
//   走同一条「装载 → resolve → validate → render」管线。
// - 装载规范化唯一产物是「外壳 + 非空页列表」:`defineReport(树)` ≡ `{ content: 树 }` ≡
//   `pages: [{ id: "report", title: 内置页名, content: 树 }]`。
// - 标题回退单点:def.title → Scope 中唯一且相同(LocalizedText 深相等)的非空快照 name → "NiceEval"。
// - LocalizedText 回退:当前 locale → en → 按 locale 键字典序的第一个非空值。
//
// ⚠ 集成状态:src/report/** 正被并行重写(plan/reports-redesign-implementation.md)。这里把宿主
// 需要的新报告 runtime API 收敛成唯一联系面,并对「新 dist 尚未产出」提供旧 API 桥接
// (旧 ReportDefinition 是 build 函数形态,恒为单页)。集成阶段的对接点(搜索 INTEGRATION):
//   1. `dist/report/built-in/index.js` 默认导出(新内建报告入口;旧桥接读 built-ins 的
//      ExperimentComparison)。
//   2. `normalizeReport(definition)`:装载规范化(外壳 + 非空页列表);旧桥接对 build 形态自行包单页。
//   3. `renderReportTreeToText(tree, ctx, options)` / `renderReportTreeToStaticHtml(tree, ctx, options)`:
//      逐页渲染入口(ctx = { scope, results, report });旧桥接调 renderReportToText /
//      renderReportToStaticHtml(definition 整体)。

import type { Results } from "../results/index.ts";
import type { LocalizedText } from "../types.ts";

/** 页:宿主寻址单位(`--page <id>` / `#/page/<id>`)。content 是报告树(旧桥接下是整个旧 definition)。 */
export interface HostReportPage {
  id: string;
  title: LocalizedText;
  content: unknown;
}

export interface HostReportLink {
  label: LocalizedText;
  href: string;
}

/** `{src}` 与 `{inline}` 两种形态不可同时出现(shell.md「字段穷尽」)。 */
export type HostReportAsset = { src: string; inline?: never } | { inline: string; src?: never };

/** 装载规范化产物:外壳 + 非空页列表。show 只消费 title / pages;其余是 web 面属性。 */
export interface HostReport {
  title?: LocalizedText;
  links: HostReportLink[];
  footer?: LocalizedText;
  scripts: HostReportAsset[];
  styles: HostReportAsset[];
  pages: HostReportPage[];
}

/** 单页缩写展开出的唯一页使用内置页名(shell.md:「报告 / Report」)。 */
export const BUILT_IN_PAGE_TITLE: LocalizedText = { en: "Report", "zh-CN": "报告" };
export const SINGLE_PAGE_ID = "report";

/** 规范化报告声明的只读注入(组合组件 ctx.report;ReportMeta,见 library/layout.md)。 */
export interface HostReportMeta {
  title: LocalizedText;
  links: HostReportLink[];
  footer?: LocalizedText;
  pages: { id: string; title: LocalizedText }[];
  pageId: string;
}

/** 可预期的装载用户错误(与 ReportLoadError 同待遇:打一句直说问题与下一步,不抛堆栈)。 */
export class HostReportError extends Error {}

// ───────────────────────── LocalizedText ─────────────────────────

/**
 * LocalizedText 的确定回退(shell.md「行为约束」):当前 locale → en → 按 locale 键字典序的
 * 第一个非空值。对象没有任何非空值时返回 undefined(装载期应当已报错,渲染兜底不再抛)。
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

/** LocalizedText 深相等:按字段值比较,对象键顺序不影响结果(shell.md「标题回退必须确定」)。 */
export function localizedTextEquals(a: LocalizedText, b: LocalizedText): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i] && a[key] === b[key]);
}

/** LocalizedText 是否有任何非空值(空串 / 全空对象都算空)。 */
function hasText(text: LocalizedText | undefined): text is LocalizedText {
  if (text === undefined) return false;
  if (typeof text === "string") return text.length > 0;
  return Object.values(text).some((v) => typeof v === "string" && v.length > 0);
}

/**
 * 标题回退单点(show 页索引标题与 view 外壳共用):def.title → Scope 中唯一且相同
 * (深相等)的非空快照 name → "NiceEval"。多个不同 name 时不随机挑一个,回退 "NiceEval"。
 */
export function resolveReportTitle(
  defTitle: LocalizedText | undefined,
  snapshots: readonly { name?: LocalizedText }[],
): LocalizedText {
  if (hasText(defTitle)) return defTitle;
  let unique: LocalizedText | undefined;
  for (const snapshot of snapshots) {
    if (!hasText(snapshot.name)) continue;
    if (unique === undefined) {
      unique = snapshot.name;
    } else if (!localizedTextEquals(unique, snapshot.name)) {
      return "NiceEval";
    }
  }
  return unique ?? "NiceEval";
}

/** 组合组件 ctx.report 的形状(走完回退链的 title;scripts / styles 不进)。 */
export function reportMetaFor(
  report: HostReport,
  pageId: string,
  snapshots: readonly { name?: LocalizedText }[],
): HostReportMeta {
  return {
    title: resolveReportTitle(report.title, snapshots),
    links: report.links,
    ...(report.footer !== undefined ? { footer: report.footer } : {}),
    pages: report.pages.map((p) => ({ id: p.id, title: p.title })),
    pageId,
  };
}

// ───────────────────────── 装载与规范化 ─────────────────────────

/** 旧(集成前)ReportDefinition:build 函数形态,恒为单页。集成阶段删除。 */
interface LegacyReportDefinition {
  build: (ctx: unknown) => unknown;
}

function isLegacyDefinition(value: unknown): value is LegacyReportDefinition {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as Partial<LegacyReportDefinition>).build === "function"
  );
}

const PAGE_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * 装载规范化:把 defineReport 产物折成「外壳 + 非空页列表」。三种入参写法
 * (树 / `content:` / `pages:`)展开成同一形状;page id 的唯一性与字符纪律在这里校验
 * (shell.md「校验分两期」的装载期部分)。
 */
export function normalizeHostReport(definition: unknown, sourceLabel: string): HostReport {
  // INTEGRATION(2):新 defineReport 产物(kind === "report")。规范化后的外壳与页列表
  // 若由新报告 runtime 导出的 normalizeReport 承担,这里改为直接调它;当前按 docs 的
  // 字段穷尽读取产物自带的声明。
  if (typeof definition === "object" && definition !== null && (definition as { kind?: unknown }).kind === "report") {
    const def = definition as {
      title?: LocalizedText;
      links?: HostReportLink[];
      footer?: LocalizedText;
      scripts?: HostReportAsset[];
      styles?: HostReportAsset[];
      content?: unknown;
      pages?: { id: string; title: LocalizedText; content: unknown }[];
    };
    const hasContent = def.content !== undefined;
    const hasPages = def.pages !== undefined;
    if (hasContent === hasPages) {
      // content / pages 同缺或同给:装载期完整用户反馈,下一步是 content: <ExperimentComparison />。
      throw new HostReportError(
        `${sourceLabel}: a report declares exactly one of "content" or "pages" — ` +
          (hasContent ? "it declares both. " : "it declares neither. ") +
          `To render the built-in report content, write: content: <ExperimentComparison />.`,
      );
    }
    const pages: HostReportPage[] = hasPages
      ? def.pages!.map((p) => ({ id: p.id, title: p.title, content: p.content }))
      : [{ id: SINGLE_PAGE_ID, title: BUILT_IN_PAGE_TITLE, content: def.content }];
    if (pages.length === 0) {
      throw new HostReportError(`${sourceLabel}: "pages" must be a non-empty list of report pages.`);
    }
    const seen = new Set<string>();
    for (const page of pages) {
      if (!PAGE_ID_PATTERN.test(page.id)) {
        throw new HostReportError(
          `${sourceLabel}: page id "${page.id}" is invalid. Page ids use lowercase letters, digits and hyphens.`,
        );
      }
      if (seen.has(page.id)) {
        throw new HostReportError(`${sourceLabel}: duplicate page id "${page.id}". Page ids must be unique per file.`);
      }
      seen.add(page.id);
    }
    return {
      ...(def.title !== undefined ? { title: def.title } : {}),
      links: def.links ?? [],
      ...(def.footer !== undefined ? { footer: def.footer } : {}),
      scripts: def.scripts ?? [],
      styles: def.styles ?? [],
      pages,
    };
  }

  // INTEGRATION(2) 桥接:旧 build 函数形态(集成前的 dist);恒为单页,无外壳字段。
  if (isLegacyDefinition(definition)) {
    return {
      links: [],
      scripts: [],
      styles: [],
      pages: [{ id: SINGLE_PAGE_ID, title: BUILT_IN_PAGE_TITLE, content: definition }],
    };
  }

  throw new HostReportError(
    `${sourceLabel} does not default-export a report. Export default defineReport(<ExperimentComparison />) (or defineReport({ title, content })) from "niceeval/report".`,
  );
}

/**
 * 装载宿主报告:`--report <file>` 走 loadReportFile;缺省(裸 show / 裸 view)装载内建报告的
 * 默认导出。两条路都进 normalizeHostReport,同一条装载管线。
 */
export async function loadHostReport(
  cwd: string,
  reportPath: string | undefined,
  options?: { freshImport?: boolean },
): Promise<HostReport> {
  if (reportPath !== undefined) {
    const { loadReportFile } = await import("../../dist/report/load.js");
    const definition = await loadReportFile(cwd, reportPath, options);
    return normalizeHostReport(definition, reportPath);
  }
  return normalizeHostReport(await loadBuiltInDefinition(), "the built-in report");
}

/** INTEGRATION(1):新内建入口是 `niceeval/report/built-in` 的默认导出;旧桥接读 built-ins 的具名导出。 */
async function loadBuiltInDefinition(): Promise<unknown> {
  try {
    const mod = (await import("../../dist/report/built-in/index.js" as string)) as { default?: unknown };
    if (mod.default !== undefined) return mod.default;
  } catch {
    // 新 dist 未产出:落回集成前的内建组件(报告兼组件,build 面在其上)。
  }
  const legacy = (await import("../../dist/report/built-ins/index.js")) as { ExperimentComparison?: unknown };
  return legacy.ExperimentComparison;
}

// ───────────────────────── 逐页渲染 ─────────────────────────

export interface HostRenderContext {
  /** 宿主按官方现刻水位挑好的 Scope(集成前类型名仍是 Selection;两者同物)。 */
  scope: unknown;
  results: Results;
  report: HostReportMeta;
}

export interface HostTextRenderOptions {
  width?: number;
  locale?: string;
  /**
   * 索引命令的完整上下文(docs/feature/reports/show/reports.md:「索引命令携带完整上下文」):
   * 组索引 / 页索引输出的每一条可复制命令都保留当前 --results / --report / --page 与位置参数。
   * INTEGRATION(3):由新 text 面消费;旧桥接的 renderReportToText 不认识该字段,原样忽略。
   */
  commandContext?: HostCommandContext;
}

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
  if (ctx.experiment !== undefined) parts.push(`--experiment ${ctx.experiment}`);
  if (ctx.results !== undefined) parts.push(`--results ${ctx.results}`);
  if (ctx.report !== undefined) parts.push(`--report ${ctx.report}`);
  if (ctx.page !== undefined) parts.push(`--page ${ctx.page}`);
  parts.push(...extra);
  return parts.join(" ");
}

/**
 * 渲染一页的 text 面。INTEGRATION(3):新 runtime 的入口是
 * `renderReportTreeToText(tree, { scope, results, report }, options)`;旧桥接下 content 是
 * 整个旧 definition,调 renderReportToText(definition, { selection, results }, options)。
 */
export async function renderHostPageText(
  page: HostReportPage,
  ctx: HostRenderContext,
  options: HostTextRenderOptions,
): Promise<string> {
  const mod = (await import("../../dist/report/report.js")) as Record<string, unknown>;
  const renderTree = mod.renderReportTreeToText as
    | ((tree: unknown, ctx: HostRenderContext, options: HostTextRenderOptions) => Promise<string>)
    | undefined;
  if (typeof renderTree === "function" && !isLegacyDefinition(page.content)) {
    return renderTree(page.content, ctx, options);
  }
  if (isLegacyDefinition(page.content)) {
    const renderLegacy = mod.renderReportToText as (
      definition: unknown,
      ctx: { selection: unknown; results: Results },
      options: { width?: number; locale?: string },
    ) => Promise<string>;
    return renderLegacy(
      page.content,
      { selection: ctx.scope, results: ctx.results },
      { ...(options.width !== undefined ? { width: options.width } : {}), ...(options.locale !== undefined ? { locale: options.locale } : {}) },
    );
  }
  throw new HostReportError(
    "The installed report runtime cannot render this report page yet (renderReportTreeToText is missing). Rebuild dist/report with `pnpm run build:report`.",
  );
}

/** 渲染一页的 web 面(静态 HTML)。INTEGRATION(3) 同上,web 侧入口在 dist/report/web.js。 */
export async function renderHostPageHtml(
  page: HostReportPage,
  ctx: HostRenderContext,
  options: { locale: string },
): Promise<string> {
  const mod = (await import("../../dist/report/web.js")) as Record<string, unknown>;
  const renderTree = mod.renderReportTreeToStaticHtml as
    | ((tree: unknown, ctx: HostRenderContext, options: { locale: string }) => Promise<string>)
    | undefined;
  if (typeof renderTree === "function" && !isLegacyDefinition(page.content)) {
    return renderTree(page.content, ctx, options);
  }
  if (isLegacyDefinition(page.content)) {
    const renderLegacy = mod.renderReportToStaticHtml as (
      definition: unknown,
      ctx: { selection: unknown; results: Results },
      options: { locale: string },
    ) => Promise<string>;
    return renderLegacy(page.content, { selection: ctx.scope, results: ctx.results }, options);
  }
  throw new HostReportError(
    "The installed report runtime cannot render this report page yet (renderReportTreeToStaticHtml is missing). Rebuild dist/report with `pnpm run build:report`.",
  );
}
