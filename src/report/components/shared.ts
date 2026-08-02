// 官方双面组件的共用装配机制:普通值 props、data 结构校验原语(isObject /
// isLocalizedText / isCell / isTally / cellProblem / tallyProblem / arrayProblem /
// dataShapeError)、`targetOfRefs`/`hrefForLocator` 下钻目标解析、`ChromeProps` 呈现选项
// 基类、`cx` classname 拼接——每个组件族在自己的 index.tsx 里用这些原语递归拼自己的
// validate*Data(字段路径要覆盖到嵌套 MetricCell/Tally,不只顶层哨兵),具体的 validate*Data
// 与组件导出留在各族。

import type { ReportLocale } from "../model/locale.ts";
import type { WebContext } from "../definition/tree.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import type { ReportTarget } from "../definition/report.ts";

/**
 * 标准库 attempt 详情页的 id 约定(library.md「参数化页:attempt 与 experiment 详情」)。
 * 这个字符串字面量只在这里写一次——`targetOfRefs`、宿主 text 面的下钻命令默认实现、
 * `niceeval show @<locator>` 的 page 查找都 import 这个常量,不各自重新拼 `"attempt"`。
 * 核心的 page 分派(`renderTarget`、`report.ts` 的装载规范化)本身仍然不认识这个 id——
 * 只有"标准库约定 attempt 是哪个 id"这一条知识集中在一处。
 */
export const ATTEMPT_PAGE_ID = "attempt";

/** 拼 class 名:过滤空值,末尾接使用者透传的 className。 */
export function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────── 普通值 props ─────────────────────────

/**
 * 官方数据组件的值 props：只接收已经算好的 Content。
 * 取数在 page.render / 公开 to* 转换里完成，组件不绑定 Source。
 */
export type ValueProps<Data, Presentation = object> = { data: Data } & Presentation;

// ───────────────────────── data 结构校验(版本漂移防线)─────────────────────────

export function isObject(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** LocalizedText = string | globalThis.Record<string, string>(src/shared/types.ts)。 */
export function isLocalizedText(value: unknown): boolean {
  if (typeof value === "string") return true;
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * 字段路径前缀的结构校验原语:通过为 `null`,否则给出带完整字段路径的具体问题
 * (如 `"rows[2].cells.costUSD.samples" must be a number`)。每个族的 validate*Data
 * 用这些原语递归拼自己的形状,不重新发明逐字段判断。
 */
export function cellProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a MetricValue { value, samples, total, basis, refs }`;
  if (!(value.value === null || typeof value.value === "number")) return `"${path}.value" must be a number or null`;
  if (typeof value.samples !== "number") return `"${path}.samples" must be a number`;
  if (typeof value.total !== "number") return `"${path}.total" must be a number`;
  if (typeof value.basis !== "string") return `"${path}.basis" must be a MetricBasis string`;
  if (!Array.isArray(value.refs) || !value.refs.every((ref) => typeof ref === "string")) {
    return `"${path}.refs" must be an array of locator strings`;
  }
  return null;
}

export function isCell(value: unknown): boolean {
  return cellProblem(value, "cell") === null;
}

/** 四态 tally { passed, failed, errored, skipped } 的字段路径前缀校验。 */
export function tallyProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a tally { passed, failed, errored, skipped }`;
  for (const key of ["passed", "failed", "errored", "skipped"] as const) {
    if (typeof value[key] !== "number") return `"${path}.${key}" must be a number`;
  }
  return null;
}

export function isTally(value: unknown): boolean {
  return tallyProblem(value, "tally") === null;
}

/** 数组的逐项校验:每项跑 `itemCheck(item, "path[i]")`,第一个非 null 问题即返回。 */
export function arrayProblem(
  value: unknown,
  path: string,
  itemCheck: (item: unknown, itemPath: string) => string | null,
): string | null {
  if (!Array.isArray(value)) return `"${path}" must be an array`;
  for (let i = 0; i < value.length; i++) {
    const problem = itemCheck(value[i], `${path}[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

export type Validator = (data: unknown) => string | null;

export function dataShapeError(component: string, dataFnName: string, shape: string, problem: string): Error {
  return new Error(
    `<${component}> received data that does not match the current ${shape} shape: ${problem}. ` +
      `It may have been computed by a different niceeval version (component data carries no schemaVersion; the support window is same-version write and read). ` +
      `Recompute it with ${dataFnName}() from this niceeval version, then re-render.`,
  );
}

/**
 * 全库唯一的默认下钻目标规则(library.md「目标与下钻」):`refs` 恰好一个 locator 时指向
 * 标准库 attempt 详情目标;零个或多个都返回 `undefined`——多证据压成一个链接必然指错,宁可
 * 不成链(表格格子不受此限,每条 ref 各成一个单 locator 链接,见调用方逐条列出的写法)。
 * 「一个图形点该指向谁」由放点的上层决定,原语在上层没有显式声明目标时才落到这条默认规则。
 */
export function targetOfRefs(refs: readonly AttemptLocator[]): ReportTarget | undefined {
  return refs.length === 1 ? { page: ATTEMPT_PAGE_ID, params: { locator: refs[0] } } : undefined;
}

/** 单个已知 locator 的 href:经 `targetOfRefs` 得到目标,再经 `ctx.href` 换成 URL(同一条唯一通道)。 */
export function hrefForLocator(ctx: WebContext, locator: AttemptLocator): string | undefined {
  const target = targetOfRefs([locator]);
  return target === undefined ? undefined : ctx.href(target);
}

// ───────────────────────── 呈现选项类型 ─────────────────────────

export interface ChromeProps {
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}
