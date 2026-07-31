// ReportTarget 的唯一 paramsKey 派生(docs/feature/reports/library.md「目标与下钻」)。
// 页实例的 (page, params) → key 只在这里算一次;render Promise 缓存、`WebContext.href`
// 默认实现与静态导出文件名三处全部导入这一份,不各自重新拼字符串——这样三处对同一个目标
// 永远得到同一个 key。独立成文件是为了打破 page-render.ts(渲染内核)与 resolved-page.ts
// (resolve 制品)之间原本会出现的循环 import:两边都需要这份纯函数,谁也不拥有它。

import type { PageDefinition, ReportTarget } from "../definition/report.ts";

/**
 * `page.params.encode(params)` 的安全求值:page 没有声明 `params`,或 `encode` 抛错,统一
 * 返回 `undefined`——目标不可编码时组件退化成纯文本,不是抛出异常打断整页渲染。
 */
export function encodeTargetKey(
  page: Pick<PageDefinition<unknown, unknown>, "params">,
  params: unknown,
): string | undefined {
  if (page.params === undefined) return undefined;
  try {
    return page.params.encode(params);
  } catch {
    return undefined;
  }
}

/**
 * 一个 page 实例的稳定 key:无 `params` 声明时就是 `page.id`(所有调用方都退化到同一个身份,
 * 与旧版 sample page 的缓存键一致);有 `params` 且编码成功时是 `<id>/<encoded>`,与静态导出
 * 目录布局(`<pageId>/<key>.html`)同形。
 */
export function targetKey(page: Pick<PageDefinition<unknown, unknown>, "id" | "params">, params?: unknown): string {
  const encoded = encodeTargetKey(page, params);
  return encoded === undefined ? page.id : `${page.id}/${encoded}`;
}

/**
 * 下钻目标 → 静态 web 输出的相对路径(`<pageId>/<key>.html`,view.md「静态导出」)。目标页
 * 不存在、页没有声明 `params`,或参数编码失败,统一返回 `undefined`——这是 `WebContext.href`
 * 默认实现的核心,也是静态导出决定要不要为一个目标生成文件的依据。
 */
export function targetHref(
  pages: readonly Pick<PageDefinition<unknown, unknown>, "id" | "params">[],
  target: ReportTarget,
): string | undefined {
  const page = pages.find((candidate) => candidate.id === target.page);
  if (page === undefined || page.params === undefined) return undefined;
  const encoded = encodeTargetKey(page, target.params);
  if (encoded === undefined) return undefined;
  return `${page.id}/${encodeURIComponent(encoded)}.html`;
}
