// 独立 attempt 文档(attempt/<locator>.html,site.ts 的 renderAttemptDocument)的客户端消费面:
// 拦截同源链接、按 locator 拼 href、把 fetch 回来的文档两种语言内容抠出来塞进 dialog——
// 内容片段与直接打开该文档看到的完全一致,不维护第二份客户端渲染(view.md「静态导出」)。
// 纯字符串切分,不用 DOMParser:结构由同一个 site.ts 的固定模板产出,不需要通用 HTML 解析。

const EN_MARK = '<div data-niceeval-locale="en">';
const ZH_MARK = '<div data-niceeval-locale="zh-CN"';
const SCRIPT_MARK = "<script>";

export interface AttemptDocumentContent {
  en: string;
  "zh-CN": string;
}

/** attempt/<locator>.html 链接的形状(相对于当前文档的相对 href,与 encodeURIComponent(locator) 对应)。 */
const ATTEMPT_HREF_PATTERN = /^attempt\/(.+)\.html$/;

/** locator 串的最小形状:`@` + 至少一个 base36 字符——与 site.ts DEFAULT_ATTEMPT_HREF 编码前的原始值同形。 */
const LOCATOR_SHAPE = /^@[0-9a-z]+$/;

/** 相对 href → 解码后的 locator;不是 attempt 文档链接或 locator 形状不对都返回 undefined。 */
export function attemptLocatorFromHref(href: string): string | undefined {
  const match = ATTEMPT_HREF_PATTERN.exec(href);
  if (!match) return undefined;
  const locator = decodeURIComponent(match[1]!);
  return LOCATOR_SHAPE.test(locator) ? locator : undefined;
}

/** locator → 该文档的根相对 href(与 report/web.ts DEFAULT_ATTEMPT_HREF 同一编码规则)。 */
export function attemptHrefFor(locator: string): string {
  return `attempt/${encodeURIComponent(locator)}.html`;
}

const ATTEMPT_HASH_PREFIX = "#/attempt/";

/** hash → locator;不是这条路由或形状不对(旧格式深链、手打错的 hash)都返回 undefined。 */
export function locatorFromHash(hash: string): string | undefined {
  if (!hash.startsWith(ATTEMPT_HASH_PREFIX)) return undefined;
  const locator = hash.slice(ATTEMPT_HASH_PREFIX.length);
  return LOCATOR_SHAPE.test(locator) ? locator : undefined;
}

export function hashForAttempt(locator: string): string {
  return `${ATTEMPT_HASH_PREFIX}${locator}`;
}

/**
 * 从 attempt 文档的响应文本里取出两种语言的内容片段。两个 locale 块紧邻、且两者之间/之后
 * 不会出现这里搜索的标记字符串(site.ts 的固定模板保证),纯字符串切分足够,不需要 DOMParser。
 * 形状不对(不是这份渲染器产出的文档)返回 null,调用方不开空 dialog。
 */
export function parseAttemptDocument(html: string): AttemptDocumentContent | null {
  const enStart = html.indexOf(EN_MARK);
  if (enStart === -1) return null;
  const afterEnOpen = html.slice(enStart + EN_MARK.length);
  const zhMarkIdx = afterEnOpen.indexOf(ZH_MARK);
  if (zhMarkIdx === -1) return null;
  const en = afterEnOpen.slice(0, zhMarkIdx).replace(/<\/div>\s*$/, "");

  const afterZhMark = afterEnOpen.slice(zhMarkIdx);
  const zhTagEnd = afterZhMark.indexOf(">");
  if (zhTagEnd === -1) return null;
  const afterZhOpen = afterZhMark.slice(zhTagEnd + 1);
  const scriptIdx = afterZhOpen.indexOf(SCRIPT_MARK);
  if (scriptIdx === -1) return null;
  const zh = afterZhOpen.slice(0, scriptIdx).replace(/<\/div>\s*$/, "");

  return { en, "zh-CN": zh };
}
