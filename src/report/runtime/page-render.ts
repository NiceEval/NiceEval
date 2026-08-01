// 唯一 page 执行入口:按目标选一个 page 实例、求它的输入(load 或宿主 Sample)、执行并
// await render、再走 resolve → validate。render Promise 按 page 实例 + 参数身份缓存;
// text / web / locale 投影不重复执行 render。契约见
// docs/feature/reports/architecture.md「执行模型」「多页逐页惰性求值」。
//
// `renderTarget` 是唯一分派路径:attempt、experiment 这些词只出现在标准库的页定义里,不出现
// 在这里——核心只认 `page.id`、`page.params`、`page.load`。旧宿主(show/view 里已经自己算好
// render 输入、不走目标寻址的调用点)继续用 `resolveDefinitionPage`/`executePageRender`,
// 两条路径共用同一个 `runPageRender` 内核与同一个 paramsKey 派生(`encodeTargetKey`/
// `targetKey`),不重复发明第二套缓存键规则。

import type { Record, Sample } from "../../record/types.ts";
import { resolveLocator } from "../../record/open.ts";
import { loadAttemptEvidence } from "../../record/attempt-evidence.ts";
import type {
  PageDefinition,
  PageLoadContext,
  ReportDefinition,
  ReportMeta,
  ReportPage,
  ReportTarget,
} from "../definition/report.ts";
import type { ReportNode } from "../definition/tree.ts";
import { resolvePage, type ResolvedPage, type ResolvedPageHostContext } from "./resolved-page.ts";
import type { DimensionPins } from "../presentation.ts";
import { targetKey } from "./target.ts";

export { encodeTargetKey, targetHref, targetKey } from "./target.ts";

export type PageRenderInput = unknown;

/** `target.page` 在 definition.pages 里没有匹配的 page id。 */
export class UnknownPageError extends Error {
  readonly pageId: string;
  constructor(pageId: string) {
    super(`No page with id "${pageId}" in this report.`);
    this.pageId = pageId;
  }
}

// ───────────────────────── render 内核 ─────────────────────────

async function runPageRender(
  page: Pick<PageDefinition<unknown, unknown>, "id" | "render">,
  input: PageRenderInput,
  key: string,
  cache?: Map<string, Promise<ReportNode>>,
): Promise<ReportNode> {
  let pending = cache?.get(key);
  if (pending === undefined) {
    if (typeof page.render !== "function") {
      throw new Error(
        `Report page "${page.id}" has no render function — pass render: (input) => tree from defineReport.`,
      );
    }
    pending = Promise.resolve(page.render(input as never));
    cache?.set(key, pending);
  }
  return pending;
}

/**
 * 执行 page.render 并缓存 Promise。同一 page 实例 + 同一输入身份只执行一次 render;
 * 失败由同一 Promise 广播,不污染其它实例。宿主已经自己算好 `input`(不经 `load`)时走这条
 * 路径——缓存键退化为 `page.id`,与 `targetKey(page, undefined)` 对没有 `params` 的页给出的
 * 结果一致。
 */
export async function executePageRender(
  page: ReportPage,
  input: PageRenderInput,
  cache?: Map<string, Promise<ReportNode>>,
): Promise<ReportNode> {
  return runPageRender(page, input, page.id, cache);
}

/** 对不带 params 的页执行 render(类型收窄 helper,常用于测试直接拿 Sample 驱动 render)。 */
export async function renderSamplePage(page: ReportPage, sample: Sample): Promise<ReportNode> {
  return executePageRender(page, sample);
}

/** render → resolve → validate,产出可复用的 ResolvedPage(宿主已经自己算好 render 输入)。 */
export async function resolveDefinitionPage(
  page: ReportPage,
  context: ResolvedPageHostContext,
  options?: { renderCache?: Map<string, Promise<ReportNode>> },
): Promise<ResolvedPage> {
  const tree = await executePageRender(page, context.page.input, options?.renderCache);
  return resolvePage(tree, context);
}

// ───────────────────────── PageLoadContext:locator → 证据 ─────────────────────────

/**
 * 参数化页的 `load` 唯一的懒加载来源:按 locator 装配一份完整的 AttemptEvidence
 * (docs/feature/reports/library.md「参数化页:attempt 与 experiment 详情」)。复用既有的
 * locator → AttemptHandle 索引(`resolveLocator`)与 `loadAttemptEvidence` 装配管线,不重新
 * 实现证据聚合的任何一条规则。
 */
export function createPageLoadContext(results: Record): PageLoadContext {
  return {
    evidence: (locator) => loadAttemptEvidence(resolveLocator(results, locator)),
  };
}

// ───────────────────────── renderTarget:唯一分派路径 ─────────────────────────

/** `renderTarget` 求 resolve 所需的宿主上下文(scope 由 `base` 参数单独给出)。 */
export interface RenderTargetHostContext {
  results: Record;
  report: ReportMeta;
  dimensionPins?: DimensionPins;
}

/**
 * 架构文档 architecture.md「执行模型」的字面执行路径:拿目标找 page、按页自己的 `load`
 * 求输入(省略 `load` 时输入就是 `base`)、render、resolve、校验。attempt、experiment 这些
 * 词不出现在这个函数里——它只认 `target.page` 与 `page.load`,新实体注册新页即可,不需要
 * 改这里的任何分支。
 */
export async function renderTarget(
  definition: ReportDefinition,
  target: ReportTarget,
  base: Sample,
  ctx: PageLoadContext,
  host: RenderTargetHostContext,
  options?: { renderCache?: Map<string, Promise<ReportNode>> },
): Promise<ResolvedPage> {
  const page = definition.pages.find((candidate) => candidate.id === target.page);
  if (page === undefined) throw new UnknownPageError(target.page);
  const input =
    page.params !== undefined
      ? await page.load(base, target.params, ctx)
      : page.load !== undefined
        ? await page.load(base, undefined, ctx)
        : base;
  const key = targetKey(page, target.params);
  const tree = await runPageRender(page, input, key, options?.renderCache);
  return resolvePage(tree, {
    scope: base,
    results: host.results,
    report: host.report,
    page: { id: page.id, input },
    dimensionPins: host.dimensionPins,
  });
}
