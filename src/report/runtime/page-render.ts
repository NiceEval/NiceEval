// 唯一 page 执行入口:选 page、校验输入分支、执行并 await render、再走 resolve → validate。
// render Promise 按 page 实例与输入身份缓存;text / web / locale 投影不重复执行 render。
// 契约见 docs/feature/reports/architecture.md「执行模型」「多页逐页惰性求值」。

import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import type { Sample } from "../../record/types.ts";
import type { ReportPage } from "../definition/report.ts";
import type { ReportNode } from "../definition/tree.ts";
import { resolvePage, type ResolvedPage, type ResolvedPageHostContext } from "./resolved-page.ts";

export type PageRenderInput = Sample | AttemptEvidence;

/** page 的 input 分支与宿主传入的 render 输入不匹配。 */
export class ReportPageInputMismatchError extends Error {
  readonly pageId: string;
  readonly expected: "sample" | "attempt";
  constructor(pageId: string, expected: "sample" | "attempt") {
    super(
      expected === "sample"
        ? `Page "${pageId}" is a sample-input page and must be rendered with a Sample.`
        : `Page "${pageId}" is an attempt-input page and must be rendered with AttemptEvidence.`,
    );
    this.pageId = pageId;
    this.expected = expected;
  }
}

function isAttemptEvidence(input: PageRenderInput): input is AttemptEvidence {
  return typeof input === "object" && input !== null && "locator" in input && "result" in input;
}

/** 校验 page.input 与宿主传入的 render 输入一致。 */
export function assertPageRenderInput(page: ReportPage, input: PageRenderInput): void {
  // 省略 input 与显式 "sample" 同义(SamplePageDefinition.input 可选)。
  if (page.input === undefined || page.input === "sample") {
    if (isAttemptEvidence(input)) {
      throw new ReportPageInputMismatchError(page.id, "sample");
    }
    return;
  }
  if (!isAttemptEvidence(input)) {
    throw new ReportPageInputMismatchError(page.id, "attempt");
  }
}

/** 单次 render 会话内的缓存键:sample page 用 page id,attempt page 用 locator。 */
export function pageRenderCacheKey(page: ReportPage, input: PageRenderInput): string {
  return page.input === "attempt" ? (input as AttemptEvidence).locator : page.id;
}

/**
 * 执行 page.render 并缓存 Promise。同一 page 实例 + 同一输入身份只执行一次 render;
 * 失败由同一 Promise 广播,不污染其它实例。
 */
export async function executePageRender(
  page: ReportPage,
  input: PageRenderInput,
  cache?: Map<string, Promise<ReportNode>>,
): Promise<ReportNode> {
  assertPageRenderInput(page, input);
  const key = pageRenderCacheKey(page, input);
  let pending = cache?.get(key);
  if (pending === undefined) {
    if (typeof page.render !== "function") {
      throw new Error(
        `Report page "${page.id}" has no render function — pass render: (input) => tree from defineReport.`,
      );
    }
    const render = page.render;
    pending = Promise.resolve(
      page.input === "attempt"
        ? (render as (input: AttemptEvidence) => ReportNode | Promise<ReportNode>)(input as AttemptEvidence)
        : (render as (input: Sample) => ReportNode | Promise<ReportNode>)(input as Sample),
    );
    cache?.set(key, pending);
  }
  return pending;
}

/** 对 sample page 执行 render(类型收窄 helper)。 */
export async function renderSamplePage(page: ReportPage, sample: Sample): Promise<ReportNode> {
  assertPageRenderInput(page, sample);
  return executePageRender(page, sample as PageRenderInput);
}

/** render → resolve → validate,产出可复用的 ResolvedPage。 */
export async function resolveDefinitionPage(
  page: ReportPage,
  context: ResolvedPageHostContext,
  options?: { renderCache?: Map<string, Promise<ReportNode>> },
): Promise<ResolvedPage> {
  const input: PageRenderInput =
    context.page.input === "sample" ? context.scope : context.page.evidence;
  const tree = await executePageRender(page, input, options?.renderCache);
  return resolvePage(tree, context);
}
