import type { AttemptEvidence } from "../record/attempt-evidence.ts";
import type { Sample } from "../record/types.ts";

/**
 * 报告事实的唯一查询协议。Source 只接收 NiceEval 已选择好的输入；
 * 外部业务数据必须在 report resolve 前冻结，再由 Composition 的 ctx.data 消费。
 */
export type SourceInput = Sample | AttemptEvidence;

export interface Source<Input extends SourceInput, Content> {
  readonly name: string;
  compute(input: Input): Promise<Content>;
}

/** 定义期检查，不注册也不包装，因而对象身份就是 page 缓存身份。 */
export function defineSource<Input extends SourceInput, Content>(
  definition: Source<Input, Content>,
): Source<Input, Content> {
  if (!definition || typeof definition.name !== "string" || definition.name.length === 0) {
    throw new Error("defineSource requires a non-empty source name.");
  }
  if (typeof definition.compute !== "function") {
    throw new Error(`defineSource("${definition.name}") requires compute(input).`);
  }
  return definition;
}

export interface CompositionContext<Input extends SourceInput> {
  readonly input: Input;
  readonly data: Readonly<Record<string, unknown>>;
  readonly page: unknown;
  readonly signal: AbortSignal;
  resolve<Content>(source: Source<Input, Content>): Promise<Content>;
}

/** resolve 管线识别 Composition 的私有品牌。 */
export const COMPOSITION_EXPAND: unique symbol = Symbol.for("niceeval.report.composition");

export interface Composition<Props, Input extends SourceInput = Sample> {
  (props: Props): never;
  readonly expand: (
    props: Readonly<Props>,
    ctx: CompositionContext<Input>,
  ) => unknown | Promise<unknown>;
  [COMPOSITION_EXPAND]: Composition<Props, Input>["expand"];
}

/**
 * Composition 是报告树中的编排节点；它不缓存自身。定义函数保留该品牌，
 * 由 tree resolver 在页级展开。
 */
export function defineComposition<Props, Input extends SourceInput = Sample>(
  expand: Composition<Props, Input>["expand"],
): Composition<Props, Input> {
  if (typeof expand !== "function") throw new Error("defineComposition requires an expand(props, ctx) function.");
  const composition = ((_: Props): never => {
    throw new Error("A Composition can only render inside the NiceEval report resolve pipeline.");
  }) as Composition<Props, Input>;
  Object.defineProperty(composition, "expand", { value: expand });
  composition[COMPOSITION_EXPAND] = expand;
  return composition;
}
