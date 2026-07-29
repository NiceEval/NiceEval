// defineReport:唯一可被宿主装载的产物 —— 外壳(title、theme、dimensionPins、head)加
// 非空页列表;单页与多页不是两种机制,页数只是列表长度(docs/feature/reports/library/shell.md)。
// 单页缩写:传入 `PageRender<Sample>`,规范化为 id `report` 的 sample page。
// 页函数只放在每页的 `render` 字段,装载期不执行。
//
// text/web 两个宿主的渲染入口在 ../runtime/;这里只有 ReportDefinition 的类型体系、
// 装载规范化与元数据折叠(buildReportMeta / resolveReportTitle),不做任何渲染。

import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import type { Sample } from "../../record/types.ts";
import type { ReportNode } from "./tree.ts";
import { localizedTextEquals, type LocalizedText } from "../model/locale.ts";
import { assertDimensionPins, type DimensionPins } from "../presentation.ts";
import type { ThemeDefinition } from "../theme.ts";

// ───────────────────────── 公开形状 ─────────────────────────

/** src 是相对顶层报告文件的路径;两种形态不可同时出现。 */
export type ReportAsset = { src: string; inline?: never } | { inline: string; src?: never };

/**
 * 结构化 head 标签。tag 是白名单闭集——head 是元数据与第三方脚本的注入口,不是 HTML 后门。
 * attrs 值为 true 渲染裸布尔属性(async、defer),字符串渲染 `key="value"`(值转义后落 HTML);
 * 属性语义与脚本内容同一约定——作者义务,宿主不校验。
 * meta / link 无子内容由类型表达;script / style 的 children 是原样文本,不转义。
 */
export type HeadTag =
  | { tag: "meta" | "link"; attrs: globalThis.Record<string, string | true>; children?: never }
  | { tag: "script" | "style"; attrs?: globalThis.Record<string, string | true>; children?: string };

export interface ReportShell {
  /** 报告自带的整站主题；view 的 --theme 与项目配置可覆盖它。 */
  theme?: ThemeDefinition;
  /**
   * 「哪个维度值恒占哪个视觉槽」的作者判断,是关于数据含义的声明,跨页一致且不随主题走;
   * 色板本身归主题的 `series`(shell.md「钉色」)。
   */
  dimensionPins?: DimensionPins;
  /** 站点标题:浏览器标题、show 页索引标题行与 `ctx.report.title` 的取值源;`Hero` 组件缺省消费它。回退链 def.title → 唯一快照 name → 内置文案「Eval 运行结果 / Eval Record」。 */
  title?: LocalizedText;
  /**
   * 注入每页 `<head>` 的结构化标签,在官方与外壳样式之后按声明顺序渲染。
   * 第三方 snippet(分析、埋点、评论)、SEO meta、favicon、字体、JSON-LD 的家:
   * 声明什么标签就渲染什么标签,宿主只做结构校验,新的第三方接入不需要契约变更。
   */
  head?: HeadTag[];
}

/** page render 函数:装载期不执行,只在被请求的 page 实例上调用一次并缓存 Promise。 */
export type PageRender<Input> = (input: Input) => ReportNode | Promise<ReportNode>;

export type NonEmptyArray<T> = readonly [T, ...T[]];

export interface ReportPageBase {
  /** 页面身份:`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
}

export interface SamplePageDefinition extends ReportPageBase {
  input?: "sample";
  navigation?: boolean;
  render: PageRender<Sample>;
}

export interface AttemptPageDefinition extends ReportPageBase {
  input: "attempt";
  navigation: false;
  render: PageRender<AttemptEvidence>;
}

export type PageDefinition = SamplePageDefinition | AttemptPageDefinition;

/**
 * 页按输入分两种形态,仍是同一个类型族,走同一条 render → resolve → validate → render 管线
 * (docs/feature/reports/architecture.md「Attempt 详情是一张参数化 page」):
 * - `input` 省略或为 `"sample"`:消费宿主选择的 Sample;省略时规范化为 `navigation: true`。
 * - `input: "attempt"`:以 locator 为参数,消费一份 AttemptEvidence;没有 locator 时不能打开,
 *   必须显式 `navigation: false`,不进导航。
 * 一份报告至多声明一张 attempt-input page。
 */
export type ReportPage = SamplePageDefinition | AttemptPageDefinition;

/** 作者向 page 声明;装载期规范化 input / navigation,不执行 render。 */
export type PageDefinitionInput =
  | (ReportPageBase & {
      input?: "sample";
      navigation?: boolean;
      render: PageRender<Sample>;
    })
  | (ReportPageBase & {
      input: "attempt";
      navigation: false;
      render: PageRender<AttemptEvidence>;
    });

/** pages 是非空有序数组;单页函数缩写不经此类型。 */
export type ReportOptions = ReportShell & {
  pages: NonEmptyArray<PageDefinitionInput>;
};

export type ReportDef = ReportOptions;

const REPORT_DEFINITION: unique symbol = Symbol.for("niceeval.report.definition");

/**
 * defineReport 的唯一产物:只作 --report 文件的默认导出,交给宿主装载。
 * 它不是 ReportNode——不能放进任何 content 或报告树,外壳因此不可嵌套。
 * 字段是装载规范化后的形态:pages 恒非空,head 恒为数组。
 */
export interface ReportDefinition {
  readonly kind: "report";
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly head: readonly HeadTag[];
  readonly pages: NonEmptyArray<ReportPage>;
}

/** 规范化后页列表在 ctx.report 上的元数据形态(id / 导航页名 / 输入声明 / 导航资格)。 */
export interface ReportMetaPage {
  id: string;
  title: LocalizedText;
  input: "sample" | "attempt";
  navigation: boolean;
}

/**
 * 规范化后的报告声明,经组合组件 ctx.report 只读可见(dimensionPins / head 是注入资产与视觉配置,不进)。
 * 不携带"当前是哪一页"——那由 ctx.page(PageContext)表达,两者不是同一份状态
 * (docs/feature/reports/library/shell.md「行为约束」)。
 */
export interface ReportMeta {
  /** 走完回退链(声明 title → 唯一快照 name → 内置文案「Eval 运行结果 / Eval Record」)后的标题。 */
  title: LocalizedText;
  /** 规范化后的页列表,恒非空。 */
  pages: NonEmptyArray<ReportMetaPage>;
}

/** 单页缩写展开出的唯一页 id 与内置页名。 */
export const DEFAULT_PAGE_ID = "report";
const DEFAULT_PAGE_TITLE: LocalizedText = { en: "Report", "zh-CN": "报告" };

// ───────────────────────── 装载规范化与静态校验 ─────────────────────────

// 复用内建视图是普通 JavaScript:import 它的 pages,自己拼进 pages 数组。报告之间没有
// 继承,也没有部分覆盖——读一份报告文件就能看出它会渲染什么。
const BUILT_IN_NEXT_STEP =
  'To render the built-in report, write pages: [...standard.pages] (import { standard } from "niceeval/report/built-in") ' +
  "and declare this report's own shell fields; reports do not inherit from one another.";

function assertNotDefinition(value: unknown, where: string): void {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "report" &&
    (value as globalThis.Record<symbol, unknown>)[REPORT_DEFINITION] === true
  ) {
    throw new Error(
      `${where} received a defineReport(...) product, but a report definition is not a report node — the shell cannot nest. ` +
        "Pass the page's tree or component here. To reuse another report's pages, spread them into this report's pages array " +
        "(e.g. pages: [myPage, ...standard.pages]); otherwise export the defineReport product as the file's default export.",
    );
  }
}

function assertLocalizedText(value: unknown, where: string): asserts value is LocalizedText {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error(`${where} must not be an empty string. Give it a visible label, e.g. "Overview".`);
    }
    return;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const hasNonEmpty = Object.values(value as globalThis.Record<string, unknown>).some(
      (v) => typeof v === "string" && v.length > 0,
    );
    if (!hasNonEmpty) {
      throw new Error(
        `${where} is a LocalizedText object with no non-empty value. Provide at least one locale entry, e.g. { en: "Overview" }.`,
      );
    }
    return;
  }
  throw new Error(
    `${where} must be a LocalizedText (a string, or a { [locale]: string } record); got ${typeof value}.`,
  );
}

const PAGE_ID_PATTERN = /^[a-z0-9-]+$/;

/** 本地资产路径纪律(shell.md「行为约束」):相对报告文件的普通相对路径,拒绝 `..` 段、绝对路径与 `~`。 */
function assertLocalAssetPath(src: string, where: string): void {
  const segments = src.split(/[\\/]+/);
  if (src.startsWith("/") || /^[A-Za-z]:/.test(src) || src.startsWith("~") || segments.includes("..")) {
    throw new Error(
      `defineReport ${where} "${src}" is not allowed: only plain relative paths (optionally with a ./ prefix) resolve against the report file — no ".." segments, absolute paths, or "~". Move the asset next to the report file and reference it relatively.`,
    );
  }
}

const HEAD_TAG_NAMES = new Set(["meta", "link", "script", "style"]);
const HEAD_ATTR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.:-]*$/;

function assertHeadTags(tags: unknown): HeadTag[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) {
    throw new Error(
      'defineReport head must be an array of { tag, attrs?, children? } entries (tag: "meta" | "link" | "script" | "style").',
    );
  }
  for (const entry of tags as Array<globalThis.Record<string, unknown>>) {
    const tag = entry?.tag;
    // 白名单闭集:head 是元数据与第三方脚本的注入口,不是 HTML 后门;标题走 title 字段回退链。
    if (typeof tag !== "string" || !HEAD_TAG_NAMES.has(tag)) {
      throw new Error(
        `defineReport head tag ${JSON.stringify(tag)} is not allowed — head injects metadata and third-party tags, and the allowed tags are "meta", "link", "script", "style". For the document title, use the shell "title" field instead.`,
      );
    }
    const attrs = entry.attrs;
    if (attrs !== undefined && (typeof attrs !== "object" || attrs === null || Array.isArray(attrs))) {
      throw new Error(
        `defineReport head <${tag}> attrs must be a { name: string | true } record (true renders a bare boolean attribute like async).`,
      );
    }
    if ((tag === "meta" || tag === "link") && attrs === undefined) {
      throw new Error(
        `defineReport head <${tag}> needs attrs — a bare <${tag}> renders nothing. Declare e.g. { tag: "${tag}", attrs: { ${tag === "meta" ? 'name: "…", content: "…"' : 'rel: "…", href: "…"'} } }.`,
      );
    }
    const attrRecord = (attrs ?? {}) as globalThis.Record<string, unknown>;
    for (const [name, value] of Object.entries(attrRecord)) {
      if (!HEAD_ATTR_NAME_PATTERN.test(name)) {
        throw new Error(
          `defineReport head <${tag}> attribute name ${JSON.stringify(name)} is not a valid HTML attribute name. Use letters, digits, "-", "_", ":" or ".".`,
        );
      }
      if (value !== true && typeof value !== "string") {
        throw new Error(
          `defineReport head <${tag}> attribute "${name}" must be a string or true (true renders a bare boolean attribute like async); got ${typeof value}.`,
        );
      }
    }
    // 宿主自有的文档单例:charset / viewport 由宿主外壳拥有,声明它们装载报错。
    if (tag === "meta" && attrRecord.charset !== undefined) {
      throw new Error(
        "defineReport head must not declare <meta charset> — the document charset is owned by the host shell. Remove the entry.",
      );
    }
    if (tag === "meta" && typeof attrRecord.name === "string" && attrRecord.name.toLowerCase() === "viewport") {
      throw new Error(
        'defineReport head must not declare <meta name="viewport"> — the viewport is owned by the host shell. Remove the entry.',
      );
    }
    const children = entry.children;
    if (children !== undefined) {
      if (tag === "meta" || tag === "link") {
        throw new Error(
          `defineReport head <${tag}> does not take children — <${tag}> is a void element; put the content in attrs.`,
        );
      }
      if (typeof children !== "string") {
        throw new Error(
          `defineReport head <${tag}> children must be a string of literal ${tag === "script" ? "JavaScript" : "CSS"}; got ${typeof children}.`,
        );
      }
      // children 原样落进标签,闭合序列在该上下文无法转义,会提前截断标签。
      if (children.toLowerCase().includes(`</${tag}`)) {
        throw new Error(
          `defineReport head <${tag}> children contain "</${tag}>" — that sequence cannot be escaped inside a <${tag}> and would close the tag early. Split the content into two entries or move it into a local file asset.`,
        );
      }
    }
    // src / href 按 scheme 分流:http(s) 外链原样透传;其余按本地路径纪律解析。
    for (const name of ["src", "href"]) {
      const value = attrRecord[name];
      if (typeof value !== "string") continue;
      if (/^https?:\/\//i.test(value)) continue;
      if (value.startsWith("//")) {
        throw new Error(
          `defineReport head <${tag}> ${name} "${value}" is protocol-relative — declare the scheme explicitly, e.g. "https:${value}".`,
        );
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        throw new Error(
          `defineReport head <${tag}> ${name} "${value}" uses a scheme other than http(s) — external head assets must be http(s) URLs. Anything else, ship as a local file next to the report and reference it relatively.`,
        );
      }
      assertLocalAssetPath(value, `head <${tag}> ${name}`);
    }
  }
  return tags as HeadTag[];
}

/**
 * page 的 input / navigation 规范化(shell.md「page 显式声明输入」):省略或 "sample" 时补
 * `input: "sample"`,`navigation` 缺省为 true;"attempt" 必须显式 `navigation: false`。
 */
function normalizePageRender(page: globalThis.Record<string, unknown>): ReportPage {
  const input = page.input;
  if (typeof page.render !== "function") {
    throw new Error(`Report page "${page.id}" must declare "render": (input) => tree.`);
  }
  const render = page.render as PageRender<Sample | AttemptEvidence>;
  if (input === undefined || input === "sample") {
    return {
      id: page.id as string,
      title: page.title as LocalizedText,
      render: render as PageRender<Sample>,
      input: "sample",
      navigation: page.navigation !== false,
    };
  }
  if (input === "attempt") {
    if (page.navigation !== false) {
      throw new Error(
        `Report page "${page.id}" declares input: "attempt" but not navigation: false — an attempt-input page has no content without a locator, so it must not appear in navigation. Add navigation: false.`,
      );
    }
    return {
      id: page.id as string,
      title: page.title as LocalizedText,
      render: render as PageRender<AttemptEvidence>,
      input: "attempt",
      navigation: false,
    };
  }
  throw new Error(
    `Report page "${page.id}" input ${JSON.stringify(input)} is not valid — input is omitted, "sample", or "attempt".`,
  );
}

/** 一份报告至多一张 attempt-input page,避免 show @<locator> 与 locator 链接出现多个目标。 */
function assertAtMostOneAttemptPage(pages: readonly ReportPage[]): void {
  const attemptPages = pages.filter((p) => p.input === "attempt");
  if (attemptPages.length > 1) {
    throw new Error(
      `A report can declare at most one input: "attempt" page — got ${attemptPages.length} (${attemptPages
        .map((p) => `"${p.id}"`)
        .join(", ")}). Keep one and remove the others, or fold their content into a single attempt-input page.`,
    );
  }
}

export function defineReport(render: PageRender<Sample>): ReportDefinition;
export function defineReport(def: ReportOptions): ReportDefinition;
export function defineReport(input: PageRender<Sample> | ReportOptions): ReportDefinition {
  if (typeof input === "function") {
    return defineReportFromDef({
      pages: [
        {
          id: DEFAULT_PAGE_ID,
          title: DEFAULT_PAGE_TITLE,
          render: input,
        },
      ],
    });
  }
  assertNotDefinition(input, "defineReport(...)");
  return defineReportFromDef(input);
}

function defineReportFromDef(def: ReportOptions): ReportDefinition {
  if (typeof def !== "object" || def === null) {
    throw new Error(
      "defineReport expects a page render function or a config object ({ title?, theme?, dimensionPins?, head?, pages }). " +
        BUILT_IN_NEXT_STEP,
    );
  }

  if ("extends" in def && (def as { extends?: unknown }).extends !== undefined) {
    throw new Error(
      'defineReport no longer takes "extends" — reports do not inherit from one another, and no field is partially overridden. ' +
        "Spread the pages you want into this report's own pages array (e.g. pages: [myPage, ...standard.pages]) " +
        "and declare its shell fields here.",
    );
  }
  if ("content" in def && (def as { content?: unknown }).content !== undefined) {
    throw new Error(
      'defineReport no longer accepts LEGACY "content" — declare pages: [{ id, title, render }] or pass a single page render function. ' +
        BUILT_IN_NEXT_STEP,
    );
  }
  for (const field of ["links", "footer", "scripts", "styles"] as const) {
    if ((def as unknown as globalThis.Record<string, unknown>)[field] !== undefined) {
      const hint =
        field === "links" || field === "footer"
          ? "Put header links and footers in page render trees (e.g. wrap each page render with a footer helper)."
          : field === "scripts" || field === "styles"
            ? 'Put component CSS/JS on defineRenderer({ assets }) or declare site-wide tags in "head".'
            : "";
      throw new Error(`defineReport no longer accepts LEGACY "${field}" — ${hint}`);
    }
  }
  const raw = def.pages as unknown;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `defineReport "pages" must be a non-empty array of { id, title, render }. ${BUILT_IN_NEXT_STEP}`,
    );
  }

  const seen = new Set<string>();
  const normalized: ReportPage[] = [];
  for (const page of raw as Array<globalThis.Record<string, unknown>>) {
    if (typeof page?.id !== "string" || !PAGE_ID_PATTERN.test(page.id)) {
      throw new Error(
        `Report page id ${JSON.stringify(page?.id)} is invalid: ids are lowercase letters, digits and hyphens (they become --page values and #/page/<id> routes). Rename it, e.g. "overview".`,
      );
    }
    if (seen.has(page.id)) {
      throw new Error(
        `Report page id "${page.id}" is declared twice — ids must be unique within one file (they are the --page selector and the web route). Rename one of the pages.`,
      );
    }
    seen.add(page.id);
    assertLocalizedText(page.title, `Report page "${page.id}" title`);
    if (page.content !== undefined) {
      throw new Error(
        `Report page "${page.id}" declares LEGACY "content" — use render: (input) => tree instead.`,
      );
    }
    if (page.render !== undefined) {
      assertNotDefinition(page.render, `Report page "${page.id}" render`);
    }
    normalized.push(normalizePageRender(page));
  }
  const pages = normalized;
  assertAtMostOneAttemptPage(pages);

  if (def.title !== undefined) assertLocalizedText(def.title, "defineReport title");
  assertDimensionPins(def.dimensionPins);

  const title = def.title;
  const theme = def.theme;

  const definition = {
    kind: "report" as const,
    ...(title !== undefined ? { title } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(def.dimensionPins !== undefined ? { dimensionPins: def.dimensionPins } : {}),
    head: def.head !== undefined ? assertHeadTags(def.head) : [],
    pages: pages as unknown as NonEmptyArray<ReportPage>,
  };
  Object.defineProperty(definition, REPORT_DEFINITION, { value: true });
  return definition;
}

/** 宿主装载报告文件时用:默认导出是不是 defineReport 的产物。 */
export function isReportDefinition(value: unknown): value is ReportDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "report" &&
    (value as globalThis.Record<symbol, unknown>)[REPORT_DEFINITION] === true
  );
}

// ───────────────────────── ReportMeta(标题回退单点)─────────────────────────

/** 标题回退链的终点:内置文案「Eval 运行结果 / Eval Record」(shell.md「行为约束」)。 */
export const FALLBACK_REPORT_TITLE: LocalizedText = { en: "Eval Record", "zh-CN": "Eval 运行结果" };

/**
 * 标题回退链的单点实现:def.title → Sample 中唯一且相同(LocalizedText 深相等)的非空快照
 * name → 内置文案「Eval 运行结果 / Eval Record」。快照中没有 name 或存在多个不同 name 时
 * 都落到内置文案,不按数组顺序挑。
 */
export function resolveReportTitle(definition: ReportDefinition, scope: Sample): LocalizedText {
  if (definition.title !== undefined) return definition.title;
  const names = scope.runs
    .map((s) => s.name)
    .filter((name): name is LocalizedText => name !== undefined && name !== "");
  if (names.length === 0) return FALLBACK_REPORT_TITLE;
  const first = names[0]!;
  return names.every((name) => localizedTextEquals(name, first)) ? first : FALLBACK_REPORT_TITLE;
}

/** 规范化声明 → 组合组件可见的 ReportMeta(dimensionPins / head 是注入资产与视觉配置,不进;不携带当前页)。 */
export function buildReportMeta(definition: ReportDefinition, scope: Sample): ReportMeta {
  return {
    title: resolveReportTitle(definition, scope),
    pages: definition.pages.map((page) => ({
      id: page.id,
      title: page.title,
      input: page.input ?? "sample",
      navigation: page.navigation ?? true,
    })) as unknown as NonEmptyArray<ReportMetaPage>,
  };
}
