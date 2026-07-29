// 官方双面组件的共用装配机制:普通值 props、data 结构校验原语(isObject /
// isLocalizedText / isCell / isTally / cellProblem / tallyProblem / arrayProblem /
// dataShapeError)、`hrefOf` 证据室深链解析、`ChromeProps` 呈现选项基类、`cx` classname
// 拼接——每个组件族在自己的 index.tsx 里用这些原语递归拼自己的 validate*Data(字段路径要覆盖到
// 嵌套 MetricCell/Tally,不只顶层哨兵),具体的 validate*Data 与组件导出留在各族。

import type { ReportLocale } from "../model/locale.ts";
import type { WebContext } from "../definition/tree.ts";
import type { AttemptLocator } from "../../record/locator.ts";

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

/** 四态 tally { passed, failed, errored, unreadable } 的字段路径前缀校验。 */
export function tallyProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a tally { passed, failed, errored, unreadable }`;
  for (const key of ["passed", "failed", "errored", "unreadable"] as const) {
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
 * 缺省接证据室,显式 prop 覆盖。`ctx.attemptHref` 本身已经是「有没有」的完整信号——
 * 宿主外直接渲染、或宿主内但当前 definition 没有 attempt-input page 时它就是 undefined,
 * 不需要再判断是否在宿主里。
 */
export function hrefOf(
  props: { attemptHref?: (locator: AttemptLocator) => string },
  ctx: WebContext,
): ((locator: AttemptLocator) => string) | undefined {
  return props.attemptHref ?? ctx.attemptHref;
}

// ───────────────────────── 呈现选项类型 ─────────────────────────

export interface ChromeProps {
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}
