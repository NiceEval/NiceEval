// 独立参数化页文档(`<pageId>/<key>.html`,site.ts 的 renderParamDocument)的客户端消费面:
// 拦截同源链接、按 (pageId, key) 拼 href、把 fetch 回来的文档两种语言内容抠出来塞进 dialog——
// 内容片段与直接打开该文档看到的完全一致,不维护第二份客户端渲染(view.md「静态导出」)。
// 通用于任意参数化页(attempt、experiment、未来的自定义参数化页):这里只认 pageId + key,
// 不出现任何具体实体词——拦截按报告清单里的参数化页 id 判定(view.md「参数化页的 dialog 摆放」),
// 由调用方传入当前报告声明的 `paramPageIds` 全集。
// 纯字符串切分,不用 DOMParser:结构由同一个 site.ts 的固定模板产出,不需要通用 HTML 解析。

const EN_MARK = '<div data-niceeval-locale="en">';
const ZH_MARK = '<div data-niceeval-locale="zh-CN"';
const SCRIPT_MARK = "<script>";

export interface TargetDocumentContent {
  en: string;
  "zh-CN": string;
}

/** 一个参数化页实例的寻址:哪张页、该实例的 key(page.params.encode 的原始产物,未经 URL 编码)。 */
export interface PageTarget {
  pageId: string;
  key: string;
}

/** `<pageId>/<key>.html` 形态的相对 href(相对于当前文档),与 encodeURIComponent(key) 对应。 */
const HREF_PATTERN = /^([a-z0-9-]+)\/(.+)\.html$/;

/**
 * 相对 href → 目标(pageId + 解码后的 key);不是这个形状、或 pageId 不在报告声明的参数化页
 * 全集里都返回 undefined——宿主不认识具体实体,只认报告清单(view.md「参数化页的 dialog 摆放」)。
 */
export function targetFromHref(href: string, paramPageIds: readonly string[]): PageTarget | undefined {
  const match = HREF_PATTERN.exec(href);
  if (!match) return undefined;
  const [, pageId, encodedKey] = match;
  if (!paramPageIds.includes(pageId!)) return undefined;
  return { pageId: pageId!, key: decodeURIComponent(encodedKey!) };
}

/** 目标 → 该文档的根相对 href(与 report/runtime/target.ts targetHref 同一编码规则)。 */
export function hrefForTarget(pageId: string, key: string): string {
  return `${pageId}/${encodeURIComponent(key)}.html`;
}

const HASH_PATTERN = /^#\/([a-z0-9-]+)\/(.+)$/;

/**
 * hash → 目标;不是这条路由、pageId 不在参数化页全集里,或 key 为空都返回 undefined
 * (旧格式深链、手打错的 hash、页导航路由 `#/page/<id>` 都在这里被排除)。key 不做 URL 解码——
 * hash 路由沿用 params.encode 的原始字符串,与 site.ts 的独立文档 href(URL 编码后)是两条
 * 不同的表示,互不影响。
 */
export function targetFromHash(hash: string, paramPageIds: readonly string[]): PageTarget | undefined {
  const match = HASH_PATTERN.exec(hash);
  if (!match) return undefined;
  const [, pageId, key] = match;
  if (!paramPageIds.includes(pageId!) || !key) return undefined;
  return { pageId: pageId!, key };
}

export function hashForTarget(pageId: string, key: string): string {
  return `#/${pageId}/${key}`;
}

/**
 * 从参数化页文档的响应文本里取出两种语言的内容片段。两个 locale 块紧邻、且两者之间/之后
 * 不会出现这里搜索的标记字符串(site.ts 的固定模板保证),纯字符串切分足够,不需要 DOMParser。
 * 形状不对(不是这份渲染器产出的文档)返回 null,调用方不开空 dialog。
 */
export function parseTargetDocument(html: string): TargetDocumentContent | null {
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
