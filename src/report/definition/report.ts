// defineReport:唯一可被宿主装载的产物 —— 一层外壳(标题、外链、页脚、head 标签、脚本、样式)加
// 非空页列表;单页与多页不是两种机制,页数只是列表长度(docs/feature/reports/library/shell.md)。
// 入参有两级缩写,各有精确展开:树入参 ≡ { content: 树 } ≡ pages: [{ id: "report",
// title: 内置页名, content: 树 }]。`content` / `pages` / `extends` 恰好声明一个,没有隐式默认;
// `extends` 在另一份报告上叠外壳——页归 base、外壳逐字段覆盖,合并在调用时折叠完成,
// 宿主装载看到的永远是已折叠的普通产物。
//
// text/web 两个宿主的渲染入口(renderReportToText / renderReportToStaticHtml)在 ../runtime/
// (text.ts / web.ts);这里只有 ReportDefinition 的类型体系、装载规范化与元数据折叠
// (buildReportMeta / resolveReportTitle),不做任何渲染。

import type { Sample } from "../../record/types.ts";
import type { ReportNode } from "./tree.ts";
import { localizedTextEquals, type LocalizedText } from "../model/locale.ts";
import { assertDimensionPins, type DimensionPins } from "../presentation.ts";
import type { ThemeDefinition } from "../theme.ts";

// ───────────────────────── 公开形状 ─────────────────────────

export interface ReportLink {
  label: LocalizedText;
  href: string;
  /**
   * 可选内联 SVG 字标,web 面渲染在 label 前,静态导出原样内联。
   * 不收组件:外壳声明经序列化边界进前端,ReactNode 过不去,可序列化是外壳契约的一部分。
   * 内容是作者义务,宿主不校验——与 scripts 同一约定。
   */
  icon?: { svg: string };
}

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
  /** 页头右侧的外部链接,如 GitHub、文档、CI。 */
  links?: ReportLink[];
  /** 每页页脚的一段文字;省略时不渲染页脚(品牌行归 PoweredBy 组件,不占页脚)。 */
  footer?: LocalizedText;
  /**
   * 注入每页 `<head>` 的结构化标签,在官方与外壳样式之后按声明顺序渲染。
   * 第三方 snippet(分析、埋点、评论)、SEO meta、favicon、字体、JSON-LD 的家:
   * 声明什么标签就渲染什么标签,宿主只做结构校验,新的第三方接入不需要契约变更。
   */
  head?: HeadTag[];
  /** 注入每个页面的脚本,在官方增强脚本之后、按声明顺序于 </body> 前加载。 */
  scripts?: ReportAsset[];
  /** 注入每个页面的样式表,在官方样式之后按声明顺序加载。 */
  styles?: ReportAsset[];
}

export type NonEmptyArray<T> = readonly [T, ...T[]];

export interface ReportPageBase {
  /** 页面身份:`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
  /** 这一页的报告树;ReportDefinition 不是 ReportNode,页装不进外壳。 */
  content: ReportNode;
}

/**
 * 页按输入分两种形态,仍是同一个类型族,走同一条 resolve → validate → render 管线
 * (docs/feature/reports/architecture.md「Attempt 详情是一张参数化 page」):
 * - `input` 省略或为 `"scope"`:消费宿主选择的 Sample;省略时规范化为 `navigation: true`。
 * - `input: "attempt"`:以 locator 为参数,消费一份 AttemptEvidence;没有 locator 时不能打开,
 *   必须显式 `navigation: false`,不进导航。
 * 一份报告至多声明一张 attempt-input page。
 */
export type ReportPage =
  | (ReportPageBase & { input?: "scope"; navigation?: boolean })
  | (ReportPageBase & { input: "attempt"; navigation: false });

/** content / pages / extends 三选一由类型表达,不把非法状态留到运行期。 */
export type ReportDef = ReportShell &
  (
    | {
        /** 单页缩写,等价于只含 id `report` 的页列表。 */
        content: ReportNode;
        pages?: never;
        extends?: never;
      }
    | {
        /** 非空页列表;`navigation !== false` 的项按数组顺序显示。 */
        pages: NonEmptyArray<ReportPage>;
        content?: never;
        extends?: never;
      }
    | {
        /**
         * 在另一份报告上叠外壳:页列表取 base 的页列表;本对象声明的外壳字段整字段覆盖
         * base 的同名字段,未声明的沿用 base——没有数组拼接、没有深合并。base 是任何
         * `defineReport` 产物(内建视图或自己别的报告文件的具名导出);合并在
         * `defineReport` 调用时折叠完成,产物仍是普通 ReportDefinition,可以再被 extends。
         */
        extends: ReportDefinition;
        content?: never;
        pages?: never;
      }
  );

const REPORT_DEFINITION: unique symbol = Symbol.for("niceeval.report.definition");

/**
 * defineReport 的唯一产物:只作 --report 文件的默认导出,交给宿主装载。
 * 它不是 ReportNode——不能放进任何 content 或报告树,外壳因此不可嵌套。
 * 字段是装载规范化后的形态:pages 恒非空,links / head / scripts / styles 恒为数组。
 */
export interface ReportDefinition {
  readonly kind: "report";
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly links: readonly ReportLink[];
  readonly footer?: LocalizedText;
  readonly head: readonly HeadTag[];
  readonly scripts: readonly ReportAsset[];
  readonly styles: readonly ReportAsset[];
  readonly pages: NonEmptyArray<ReportPage>;
}

/** 规范化后页列表在 ctx.report 上的元数据形态(id / 导航页名 / 输入声明 / 导航资格)。 */
export interface ReportMetaPage {
  id: string;
  title: LocalizedText;
  input: "scope" | "attempt";
  navigation: boolean;
}

/**
 * 规范化后的报告声明,经组合组件 ctx.report 只读可见(scripts / styles 是注入资产,不进)。
 * 不携带"当前是哪一页"——那由 ctx.page(PageContext)表达,两者不是同一份状态
 * (docs/feature/reports/library/shell.md「行为约束」)。
 */
export interface ReportMeta {
  /** 走完回退链(声明 title → 唯一快照 name → 内置文案「Eval 运行结果 / Eval Record」)后的标题。 */
  title: LocalizedText;
  /** 页头外链;声明省略时为空数组。 */
  links: readonly ReportLink[];
  footer?: LocalizedText;
  /** 规范化后的页列表,恒非空。 */
  pages: NonEmptyArray<ReportMetaPage>;
}

/** 单页缩写展开出的唯一页 id 与内置页名。 */
export const DEFAULT_PAGE_ID = "report";
const DEFAULT_PAGE_TITLE: LocalizedText = { en: "Report", "zh-CN": "报告" };

// ───────────────────────── 装载规范化与静态校验 ─────────────────────────

const EXTENDS_NEXT_STEP =
  'To render the built-in report, write extends: standard (import { standard } from "niceeval/report/built-in").';

function isReportNodeInput(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === "boolean") return true;
  if (Array.isArray(value)) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    (value as { kind?: unknown }).kind !== "report"
  );
}

function assertNotDefinition(value: unknown, where: string): void {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "report" &&
    (value as globalThis.Record<symbol, unknown>)[REPORT_DEFINITION] === true
  ) {
    throw new Error(
      `${where} received a defineReport(...) product, but a report definition is not a report node — the shell cannot nest. ` +
        "Pass the page's tree or component here. To layer a shell over another report, write defineReport({ extends: base, … }); " +
        "otherwise export the defineReport product as the file's default export.",
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

function assertAssets(assets: unknown, field: "scripts" | "styles"): ReportAsset[] {
  if (assets === undefined) return [];
  if (!Array.isArray(assets)) {
    throw new Error(`defineReport ${field} must be an array of { src } or { inline } entries.`);
  }
  for (const asset of assets as Array<globalThis.Record<string, unknown>>) {
    const hasSrc = typeof asset?.src === "string";
    const hasInline = typeof asset?.inline === "string";
    if (hasSrc === hasInline) {
      throw new Error(
        `Each defineReport ${field} entry must have exactly one of "src" (a path relative to the report file) or "inline" (literal content).`,
      );
    }
    if (hasSrc) {
      const src = asset.src as string;
      // 外链不属于增强层资产:第三方外链标签的家是 head 通道。
      if (/^https?:\/\//i.test(src) || src.startsWith("//")) {
        throw new Error(
          `defineReport ${field} src "${src}" is an external URL — ${field} take local files and inline content (the host pipeline vendors them). Declare third-party external tags in "head" instead, e.g. head: [{ tag: "script", attrs: { async: true, src: "…" } }].`,
        );
      }
      assertLocalAssetPath(src, `${field} src`);
    }
  }
  return assets as ReportAsset[];
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
 * page 的 input / navigation 规范化(shell.md「page 显式声明输入」):省略或 "scope" 时补
 * `input: "scope"`,`navigation` 缺省为 true;"attempt" 必须显式 `navigation: false`——
 * 没有 locator 时不可打开,不能悄悄挤进导航,省略或传 true 都在装载期报错。
 */
function normalizePageInputAndNavigation(page: globalThis.Record<string, unknown>): ReportPage {
  const input = page.input;
  if (input === undefined || input === "scope") {
    return {
      id: page.id as string,
      title: page.title as LocalizedText,
      content: page.content as ReportNode,
      input: "scope",
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
      content: page.content as ReportNode,
      input: "attempt",
      navigation: false,
    };
  }
  throw new Error(
    `Report page "${page.id}" input ${JSON.stringify(input)} is not valid — input is omitted, "scope", or "attempt".`,
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

export function defineReport(content: ReportNode): ReportDefinition;
export function defineReport(def: ReportDef): ReportDefinition;
export function defineReport(input: ReportNode | ReportDef): ReportDefinition {
  assertNotDefinition(input, "defineReport(...)");
  const def: ReportDef = isReportNodeInput(input)
    ? ({ content: input as ReportNode } as ReportDef)
    : (input as ReportDef);
  if (typeof def !== "object" || def === null) {
    throw new Error(
      "defineReport expects a report tree or a config object ({ title?, links?, footer?, head?, scripts?, styles?, content | pages | extends }). " +
        EXTENDS_NEXT_STEP,
    );
  }

  const hasContent = "content" in def && def.content !== undefined;
  const hasPages = "pages" in def && def.pages !== undefined;
  const hasExtends = "extends" in def && (def as { extends?: unknown }).extends !== undefined;
  const declared = [hasContent && '"content"', hasPages && '"pages"', hasExtends && '"extends"'].filter(
    (name): name is string => typeof name === "string",
  );
  if (declared.length > 1) {
    throw new Error(
      `defineReport got ${declared.join(" and ")} — declare exactly one of "content" (a single tree), "pages" (a multi-page report), or "extends" (another report plus this shell). ${EXTENDS_NEXT_STEP}`,
    );
  }
  if (declared.length === 0) {
    throw new Error(
      `defineReport got none of "content", "pages" or "extends" — declare exactly one; omission is not a meaningful value, the file must show what renders. ${EXTENDS_NEXT_STEP}`,
    );
  }

  // extends:报告级复用的唯一位置。页归 base,本对象只贡献外壳;base 已经过 defineReport
  // 校验,页不重验。
  let base: ReportDefinition | undefined;
  let pages: readonly ReportPage[];
  if (hasExtends) {
    const candidate = (def as { extends: unknown }).extends;
    if (!isReportDefinition(candidate)) {
      throw new Error(
        'defineReport "extends" must be a defineReport(...) product — the base report whose pages this report inherits. ' +
          EXTENDS_NEXT_STEP,
      );
    }
    base = candidate;
    pages = base.pages;
  } else if (hasContent) {
    assertNotDefinition(def.content, 'defineReport "content"');
    pages = [
      { id: DEFAULT_PAGE_ID, title: DEFAULT_PAGE_TITLE, input: "scope", navigation: true, content: def.content as ReportNode },
    ];
  } else {
    const raw = def.pages as unknown;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(
        `defineReport "pages" must be a non-empty array of { id, title, content }. ${EXTENDS_NEXT_STEP}`,
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
      assertNotDefinition(page.content, `Report page "${page.id}" content`);
      normalized.push(normalizePageInputAndNavigation(page));
    }
    pages = normalized;
  }
  assertAtMostOneAttemptPage(pages);

  if (def.title !== undefined) assertLocalizedText(def.title, "defineReport title");
  if (def.footer !== undefined) assertLocalizedText(def.footer, "defineReport footer");
  assertDimensionPins(def.dimensionPins);
  // 外壳合并:声明即整字段覆盖,未声明沿用 base(base 的字段已规范化,不重验)。
  let links: readonly ReportLink[];
  if (def.links !== undefined) {
    if (!Array.isArray(def.links)) throw new Error("defineReport links must be an array of { label, href }.");
    for (const link of def.links) {
      assertLocalizedText((link as ReportLink)?.label, "defineReport link label");
      if (typeof (link as ReportLink)?.href !== "string" || (link as ReportLink).href.length === 0) {
        throw new Error("defineReport link href must be a non-empty string URL.");
      }
      // icon 唯一合法形状是 { svg: string }(无类型 JS 传组件 / ReactNode / 裸字符串都在装载期拒绝):
      // 外壳声明经序列化边界进前端,ReactNode 过不去,可序列化是外壳契约的一部分。
      const icon = (link as { icon?: unknown }).icon;
      if (icon !== undefined) {
        const svg = (icon as { svg?: unknown })?.svg;
        if (typeof icon !== "object" || icon === null || typeof svg !== "string" || svg.length === 0) {
          throw new Error(
            'defineReport link "icon" must be { svg: string } — an inline SVG string rendered before the label. ' +
              "Components and React nodes are not accepted: the shell declaration crosses a serialization boundary. " +
              'Write e.g. icon: { svg: "<svg …>…</svg>" }.',
          );
        }
      }
    }
    links = def.links;
  } else {
    links = base?.links ?? [];
  }
  const title = def.title !== undefined ? def.title : base?.title;
  const theme = def.theme !== undefined ? def.theme : base?.theme;
  const footer = def.footer !== undefined ? def.footer : base?.footer;
  const dimensionPins = def.dimensionPins !== undefined ? def.dimensionPins : base?.dimensionPins;

  const definition = {
    kind: "report" as const,
    ...(title !== undefined ? { title } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(dimensionPins !== undefined ? { dimensionPins } : {}),
    links: [...links],
    ...(footer !== undefined ? { footer } : {}),
    head: def.head !== undefined ? assertHeadTags(def.head) : [...(base?.head ?? [])],
    scripts: def.scripts !== undefined ? assertAssets(def.scripts, "scripts") : [...(base?.scripts ?? [])],
    styles: def.styles !== undefined ? assertAssets(def.styles, "styles") : [...(base?.styles ?? [])],
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

/** 规范化声明 → 组合组件可见的 ReportMeta(scripts / styles / dimensionPins 是注入资产与视觉配置,不进;不携带当前页)。 */
export function buildReportMeta(definition: ReportDefinition, scope: Sample): ReportMeta {
  return {
    title: resolveReportTitle(definition, scope),
    links: definition.links,
    ...(definition.footer !== undefined ? { footer: definition.footer } : {}),
    pages: definition.pages.map((page) => ({
      id: page.id,
      title: page.title,
      input: page.input ?? "scope",
      navigation: page.navigation ?? true,
    })) as unknown as NonEmptyArray<ReportMetaPage>,
  };
}
