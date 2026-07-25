// 官方双面组件的共用装配机制:spec / data 双形态判别(DataProps)、data 结构校验的通用
// 原语(isObject / isLocalizedText / isCell / isTally / cellProblem / tallyProblem /
// arrayProblem / dataShapeError)、`makeDataComponent` 装配器与 `hrefOf` 证据室深链解析、
// `ChromeProps` 呈现选项基类、`cx` classname 拼接——每个组件族在自己的 index.tsx 里用这些
// 原语递归拼自己的 validate*Data(字段路径要覆盖到嵌套 MetricCell/Tally,不只顶层哨兵),
// 具体的 validate*Data 与组件导出留在各族。

import type { ReactNode } from "react";
import {
  defineComponent,
  memoFetchOf,
  type ReportComponent,
  type ResolveContext,
  type TextContext,
  type WebContext,
} from "../definition/tree.ts";
import type { ReportInput } from "../model/types.ts";
import type { ReportLocale } from "../model/locale.ts";
import type { AttemptLocator } from "../../results/locator.ts";

/** 拼 class 名:过滤空值,末尾接使用者透传的 className。 */
export function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────── DataProps 组合规则 ─────────────────────────

type Never<T> = { [K in keyof T]?: never };

/**
 * 官方数据组件的统一 props 组合(docs/feature/reports/components/tables.md):
 * data 形态(接收配套 *Data 的产物)或 spec 形态(Options 平铺 + 可选 input)。
 */
export type DataProps<Data, Options, Presentation> =
  | ({ data: Data; input?: never } & Never<Options> & Presentation)
  | ({ data?: never; input?: ReportInput } & Options & Presentation);

// ───────────────────────── data 结构校验(版本漂移防线)─────────────────────────

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** LocalizedText = string | Record<string, string>(src/shared/types.ts)。 */
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
  if (!isObject(value)) return `"${path}" must be a MetricCell { value, display, samples, total, refs }`;
  if (!(value.value === null || typeof value.value === "number")) return `"${path}.value" must be a number or null`;
  if (!isLocalizedText(value.display)) return `"${path}.display" must be a LocalizedText`;
  if (typeof value.samples !== "number") return `"${path}.samples" must be a number`;
  if (typeof value.total !== "number") return `"${path}.total" must be a number`;
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

// ───────────────────────── spec / data 双形态的通用装配 ─────────────────────────

export interface DataComponentDef<Data, Options, Presentation> {
  name: string;
  dataFnName: string;
  shapeName: string;
  dataFn: (input: ReportInput, options: Options) => Promise<Data>;
  /** spec 形态的计算选项 prop 名(不含 input);未列出的 props 视为呈现选项原样保留。 */
  specKeys: readonly string[];
  validate: Validator;
  web(props: { data: Data } & Presentation, ctx: WebContext): ReactNode;
  text(props: { data: Data } & Presentation, ctx: TextContext): string;
}

export function makeDataComponent<Data, Options, Presentation>(
  def: DataComponentDef<Data, Options, Presentation>,
): ReportComponent<DataProps<Data, Options, Presentation>> {
  type Props = Record<string, unknown>;
  type Resolved = { data: Data } & Presentation;

  const assertData = (data: unknown): Data => {
    const problem = def.validate(data);
    if (problem !== null) throw dataShapeError(def.name, def.dataFnName, def.shapeName, problem);
    return data as Data;
  };

  const resolve = async (props: Props, ctx: ResolveContext): Promise<Resolved> => {
    const givenSpec = def.specKeys.filter((key) => props[key] !== undefined);
    if (props.data !== undefined) {
      if (givenSpec.length > 0 || props.input !== undefined) {
        const extras = [...givenSpec, ...(props.input !== undefined ? ["input"] : [])];
        throw new Error(
          `<${def.name}> got both \`data\` and spec field${extras.length > 1 ? "s" : ""} (${extras.join(", ")}) — the two data sources are exclusive and niceeval will not silently pick one. ` +
            `Keep \`data\` (precomputed with ${def.dataFnName}()) and drop the spec fields, or drop \`data\` and let the pipeline compute from the spec.`,
        );
      }
      assertData(props.data);
      return props as unknown as Resolved;
    }
    const options: Record<string, unknown> = {};
    for (const key of givenSpec) options[key] = props[key];
    const input = (props.input as ReportInput | undefined) ?? ctx.input;
    const data = await memoFetchOf(ctx)(def.dataFn, input, options, () =>
      def.dataFn(input, options as Options),
    );
    const rest: Record<string, unknown> = { ...props };
    delete rest.input;
    for (const key of def.specKeys) delete rest[key];
    return { ...rest, data } as unknown as Resolved;
  };

  const component = defineComponent<Props, Resolved>({
    resolve,
    web: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.web(props, ctx);
    },
    text: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.text(props, ctx);
    },
  }) as unknown as ReportComponent<DataProps<Data, Options, Presentation>>;
  component.displayName = def.name;
  return component;
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
