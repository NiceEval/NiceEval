import type { ExperimentFlags } from "./shared/types.ts";
import {
  assertAdapterFlagsParser,
  type AdapterFlagsParser,
  type AdapterFlagsOutput,
  type AdapterFlagsParserValidation,
  type AdapterFlagsParserValidationArgs,
} from "./adapter-flags.ts";
import type {
  AssertionCheck,
  AssertionSubject,
  AssertionsRuntime,
  BooleanAssertionHandle,
  MeasurementAssertionHandle,
  PolymorphicBooleanAssertionHandle,
  PolymorphicMeasurementAssertionHandle,
} from "./assertions/api.ts";
import type { ScoreMatch } from "./assertions/match.ts";
import { defineEvalForContext } from "./define.ts";
import type { EvalDefinition, EvalInput, ScoreEvalInput } from "./runner/types.ts";
import type { EvaluationKind } from "./shared/evaluation.ts";
import type { JudgePresetMethods } from "./context/assert-first.ts";
import type { DiagnosticInput, ProgressUpdate } from "./shared/types.ts";
import type { AdapterIdentity } from "./record/model/run-context.ts";
export type { AdapterIdentity } from "./record/model/run-context.ts";

const ADAPTER_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.adapterContractToken");
const EVAL_ADAPTER_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.evalAdapterContractToken");

/**
 * Synchronously assembles Attempt-local Assertion methods from the guarded app
 * facade and the shared check registrar. The returned object must contain only
 * ordinary, synchronously returning methods. Generic and overloaded Assertion
 * sugar is intentionally not callable after binding; use ordinary named
 * parameters so argument and native handle types remain exact.
 */
export type AdapterAssertionsFactory<Context extends object, Assertions extends object = object> = (
  context: AdapterAssertionsFactoryContext<Context>,
) => Assertions;

/**
 * Definition inputs for Adapter Assertion sugar. `app` becomes callable after
 * assembly, and `check` may only be called by a returned Assertion method.
 */
export interface AdapterAssertionsFactoryContext<Context extends object> {
  readonly app: Readonly<Context>;
  readonly check: AssertionCheck<"polymorphic">;
}

type BoundAdapterAssertionResult<Kind extends EvaluationKind, Result> =
  Result extends PolymorphicBooleanAssertionHandle<infer Refined, infer HasGate>
    ? BooleanAssertionHandle<Kind, Refined, HasGate>
    : Result extends PolymorphicMeasurementAssertionHandle<infer HasCondition>
      ? MeasurementAssertionHandle<Kind, HasCondition>
      : never;

type BoundAdapterAssertionMethod<Kind extends EvaluationKind, Method> =
  Method extends (...args: infer Args) => infer Result
    ? ((...args: Args) => Result) extends Method
      ? (...args: Args) => BoundAdapterAssertionResult<Kind, Result>
      : never
    : never;

type AdapterAssertionsFor<
  Assertions extends object | undefined,
  Kind extends EvaluationKind,
> = Assertions extends object
  ? { readonly [Key in keyof Assertions]: BoundAdapterAssertionMethod<Kind, Assertions[Key]> }
  : {};

/** Keys owned by the neutral Eval runtime or unsafe on a merged object root. */
const RESERVED_ADAPTER_CONTEXT_KEYS = [
  "evaluationKind",
  "check",
  "judge",
  "factuality",
  "faithfulness",
  "instructionFollowing",
  "pairwisePreference",
  "closeQA",
  "score",
  "group",
  "skip",
  "signal",
  "model",
  "reasoningEffort",
  "flags",
  "progress",
  "diagnostic",
  "log",
  "then",
  "Object",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "hasOwnProperty",
  "__lookupGetter__",
  "__lookupSetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "__proto__",
  "toLocaleString",
] as const;

export type ReservedAdapterContextKey = typeof RESERVED_ADAPTER_CONTEXT_KEYS[number];

type InvalidContextBranch<Context> = Context extends unknown
  ? Context extends object
    ? Context extends readonly unknown[]
      ? Context
      : Context extends (...args: readonly never[]) => unknown
        ? Context
        : string extends keyof Context
          ? Context
          : Extract<keyof Context, ReservedAdapterContextKey> extends never
            ? never
            : Context
    : Context
  : never;

type AdapterContextValidation<Context> = unknown extends Context
  ? unknown
  : [InvalidContextBranch<Context>] extends [never]
    ? unknown
    : { readonly invalidAdapterContext: InvalidContextBranch<Context> };

type InvalidAssertionMethodKey<Context extends object, Assertions> = Assertions extends object
  ? {
      [Key in keyof Assertions]: Key extends string
        ? Key extends ReservedAdapterContextKey | keyof Context
          ? Key
          : Assertions[Key] extends (...args: readonly never[]) => infer Result
            ? Result extends
                | PolymorphicBooleanAssertionHandle<unknown, boolean>
                | PolymorphicMeasurementAssertionHandle<boolean>
              ? never
              : Key
            : Key
        : Key;
    }[keyof Assertions]
  : "assertions";

type InvalidAdapterAssertions<
  Context extends object,
  Assertions extends object,
> = InvalidAssertionMethodKey<Context, Assertions>;

type AdapterAssertionsValidation<
  Context extends object,
  Assertions extends object,
> = [InvalidAdapterAssertions<Context, Assertions>] extends [never]
  ? unknown
  : { readonly invalidAdapterAssertions: InvalidAdapterAssertions<Context, Assertions> };

type AdapterAssertionsValidationArgs<
  Context extends object,
  Assertions extends object,
> = [InvalidAdapterAssertions<Context, Assertions>] extends [never]
  ? []
  : [error: { readonly invalidAdapterAssertions: InvalidAdapterAssertions<Context, Assertions> }];

type AdapterFactory<Context extends object, Flags extends AdapterFlagsParser = undefined> = (
  context: AdapterCreateContext<AdapterFlagsOutput<Flags>>,
) => (Context & ThisType<Context>) | Promise<Context & ThisType<Context>>;

export interface AdapterCleanupContext {
  /** 当前 Adapter cleanup 总窗口的取消信号。它独立于 Attempt signal，并在 30 秒总预算结束时取消。 */
  readonly signal: AbortSignal;
}

export interface AdapterCreateContext<Flags = ExperimentFlags> {
  recordUsage(input: import("./adapter-usage.ts").AdapterUsageInput): void;
  attach(input: import("./adapter-attachments.ts").AdapterAttachmentInput): Promise<import("./adapter-attachments.ts").AdapterAttachmentReceipt>;
  /** 当前 Eval 的公开 ID。 */
  readonly evalId: string;
  /** 当前 Experiment 的公开 ID。 */
  readonly experimentId: string;
  /** 当前 Attempt 的零起始序号。 */
  readonly attempt: number;
  /** Attempt 执行信号；取消或超时后会中止，不用于 cleanup 窗口。 */
  readonly signal: AbortSignal;
  /** Experiment 选择的模型。 */
  readonly model?: string;
  /** Experiment 选择的推理强度。 */
  readonly reasoningEffort?: string;
  /** Experiment 传给 Adapter 的只读 flags。 */
  readonly flags: Flags;
  /** 更新当前 Attempt 的人读进度。 */
  progress(update: ProgressUpdate): void;
  /** 为当前 Attempt 追加结构化诊断。 */
  diagnostic(input: DiagnosticInput): void;
  /** 为当前 Attempt 追加日志。 */
  log(message: string): void;
  /**
   * 登记 Attempt-local 资源释放。回调按全局 LIFO 执行；一项失败不会跳过其余项。
   * 零参数回调仍可直接传入。传入的 context 已冻结，同一 cleanup 窗口的回调共享一个 signal。
   */
  onCleanup(cleanup: (context: AdapterCleanupContext) => void | Promise<void>): void;
}

type EvalContextBase<Kind extends EvaluationKind, Flags> = JudgePresetMethods<Kind> & {
  readonly evaluationKind: Kind;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Flags;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  log(message: string): void;
  skip(reason: string): never;
  group<Value>(title: string, body: () => Value | PromiseLike<Value>): Promise<Awaited<Value>>;
  readonly check: AssertionsRuntime<Kind>["t"]["check"];
  readonly judge: <Value>(
    value: AssertionSubject<Value>,
    definition: ScoreMatch<NoInfer<Value>>,
  ) => MeasurementAssertionHandle<Kind>;
};

/** Agent-neutral author context shared by every Adapter Eval. */
export type EvalContext<Kind extends EvaluationKind = "pass", Flags = ExperimentFlags> = EvalContextBase<Kind, Flags> &
  (Kind extends "score" ? { readonly score: AssertionsRuntime<"score">["t"]["score"] } : {});

type AdapterEvalFields = Omit<EvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

type AdapterScoreEvalFields = Omit<ScoreEvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

export type AdapterEvalInput<
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> = AdapterEvalFields & {
  test(
    t: EvalContext<"pass", AdapterFlagsOutput<Flags>> & Readonly<Context> & AdapterAssertionsFor<Assertions, "pass">,
  ): void | Promise<void>;
};

export type AdapterScoreEvalInput<
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> = AdapterScoreEvalFields & {
  test(
    t: EvalContext<"score", AdapterFlagsOutput<Flags>> & Readonly<Context> & AdapterAssertionsFor<Assertions, "score">,
  ): void | Promise<void>;
};

interface AdapterContractToken<
  Context extends object,
  Assertions extends object | undefined,
  Flags extends AdapterFlagsParser = undefined,
> {
  readonly name: string;
  readonly assertions: AdapterAssertionsFactory<Context> | undefined;
  readonly parseFlags: Flags;
  /** Keeps the Assertion method shape invariant without exposing a constructible brand. */
  readonly assertionTypes: (value: Assertions) => Assertions;
  /** Keeps the context parameter invariant without exposing a constructible brand. */
  readonly context: (value: Context) => Context;
}

export interface AdapterEvalDefinition<
  Kind extends EvaluationKind,
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> extends EvalDefinition<
    Kind,
    EvalContext<Kind, AdapterFlagsOutput<Flags>> & Readonly<Context> & AdapterAssertionsFor<Assertions, Kind>,
    undefined
  > {
  readonly [EVAL_ADAPTER_CONTRACT_TOKEN]: AdapterContractToken<Context, Assertions, Flags>;
}

/** @internal Existential discovery view; concrete bound factories retain their exact Context. */
export interface AdapterRuntimeEvalDefinition<Kind extends EvaluationKind>
  extends EvalDefinition<Kind, never, undefined> {
  readonly [EVAL_ADAPTER_CONTRACT_TOKEN]: object;
}

/** Common public surface for an Adapter definition with bound Eval factories. */
export interface AdapterDefinition<
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> {
  readonly name: string;
  readonly parseFlags: Flags;
  defineEval(input: AdapterEvalInput<Context, Assertions, Flags>): AdapterEvalDefinition<"pass", Context, Assertions, Flags>;
  defineScoreEval(
    input: AdapterScoreEvalInput<Context, Assertions, Flags>,
  ): AdapterEvalDefinition<"score", Context, Assertions, Flags>;
}

/** Existential runtime view used by Experiment without erasing a concrete context to `any`. */
export interface AdapterRuntimeDefinition {
  readonly parseFlags?: Exclude<AdapterFlagsParser, undefined>;
  readonly kind: "custom";
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [ADAPTER_CONTRACT_TOKEN]: object;
  readonly defineEval: (...args: never[]) => unknown;
  readonly defineScoreEval: (...args: never[]) => unknown;
  create(context: AdapterCreateContext<unknown>): object | Promise<object>;
}

export interface AdapterImplementation<
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> extends AdapterDefinition<Context, Assertions, Flags> {
  readonly kind: "custom";
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [ADAPTER_CONTRACT_TOKEN]: AdapterContractToken<Context, Assertions, Flags>;
  create(context: AdapterCreateContext<AdapterFlagsOutput<Flags>>): Context | Promise<Context>;
}

export type AdapterImplementationInput<
  Context extends object,
  ImplementationContext extends Context = Context,
  Flags extends AdapterFlagsParser = undefined,
> = {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<ImplementationContext, Flags>;
} & AdapterContextValidation<NoInfer<ImplementationContext>>;

export interface AdapterContract<
  Context extends object,
  Assertions extends object | undefined = undefined,
  Flags extends AdapterFlagsParser = undefined,
> extends AdapterDefinition<Context, Assertions, Flags> {
  readonly name: string;
  implement<ImplementationContext extends Context>(
    input: AdapterImplementationInput<Context, ImplementationContext, Flags>,
  ): AdapterImplementation<Context, Assertions, Flags>;
  /**
   * Returns a contract whose Eval factories and implementations share one flags parser.
   */
  withParseFlags<NextFlags extends Exclude<AdapterFlagsParser, undefined>>(
    parseFlags: NextFlags,
    ...validation: AdapterFlagsParserValidationArgs<NoInfer<NextFlags>>
  ): AdapterContract<Context, Assertions, NextFlags>;
  /** Returns a contract whose implementations share this exact Assertion factory. */
  withAssertions<NextAssertions extends object>(
    factory: AdapterAssertionsFactory<Context, NextAssertions>,
    ...validation: AdapterAssertionsValidationArgs<Context, NoInfer<NextAssertions>>
  ): AdapterContract<Context, NextAssertions, Flags>;
}

export type Adapter = import("./agents/types.ts").Agent | AdapterRuntimeDefinition;

function assertNonEmptyString(value: unknown, field: string, factory: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${factory} requires a non-empty ${field}.`);
  }
}

function contractToken<
  Context extends object,
  Assertions extends object | undefined,
  Flags extends AdapterFlagsParser,
>(
  name: string,
  assertions: AdapterAssertionsFactory<Context> | undefined,
  parseFlags: Flags,
): AdapterContractToken<Context, Assertions, Flags> {
  return Object.freeze({
    name,
    assertions,
    parseFlags,
    assertionTypes: (value: Assertions) => value,
    context: (value: Context) => value,
  });
}

function assertAdapterEvalInput(
  value: { readonly sandbox?: unknown; readonly diff?: unknown },
  factory: "defineEval" | "defineScoreEval",
): void {
  if (Object.hasOwn(value, "sandbox")) {
    throw new TypeError(`${factory} for an Adapter does not support sandbox.`);
  }
  if (Object.hasOwn(value, "diff")) {
    throw new TypeError(`${factory} for an Adapter does not support Agent workspace diff configuration.`);
  }
}

function boundEvalFactories<
  Context extends object,
  Assertions extends object | undefined,
  Flags extends AdapterFlagsParser,
>(token: AdapterContractToken<Context, Assertions, Flags>): Pick<
  AdapterDefinition<Context, Assertions, Flags>,
  "defineEval" | "defineScoreEval"
> {
  return {
    defineEval(input) {
      assertAdapterEvalInput(input, "defineEval");
      return defineEvalForContext("pass", input, {
        [EVAL_ADAPTER_CONTRACT_TOKEN]: token,
      }) as AdapterEvalDefinition<"pass", Context, Assertions, Flags>;
    },
    defineScoreEval(input) {
      assertAdapterEvalInput(input, "defineScoreEval");
      return defineEvalForContext("score", input, {
        [EVAL_ADAPTER_CONTRACT_TOKEN]: token,
      }) as AdapterEvalDefinition<"score", Context, Assertions, Flags>;
    },
  };
}

function implementAdapter<
  Context extends object,
  Assertions extends object | undefined,
  Flags extends AdapterFlagsParser,
>(
  token: AdapterContractToken<Context, Assertions, Flags>,
  input: {
    readonly name: string;
    readonly behaviorRevision?: string;
    readonly create: AdapterFactory<Context, Flags>;
  },
  factory: "defineAdapter" | "AdapterContract.implement",
): AdapterImplementation<Context, Assertions, Flags> {
  assertNonEmptyString(input.name, "name", factory);
  if (input.behaviorRevision !== undefined) {
    assertNonEmptyString(input.behaviorRevision, "behaviorRevision", factory);
  }
  if (typeof input.create !== "function") {
    throw new TypeError(`${factory} requires create(context).`);
  }
  const authorCreate = input.create;
  const create = (context: AdapterCreateContext<AdapterFlagsOutput<Flags>>): Context | Promise<Context> => {
    const created = authorCreate(context);
    if (created instanceof Promise) {
      return created.then((value) => {
        assertPlainAdapterContext(value);
        return value;
      });
    }
    // Validate before a caller can pass a synchronous thenable to Promise adaptation.
    assertPlainAdapterContext(created);
    return created;
  };
  return Object.freeze({
    kind: "custom" as const,
    parseFlags: token.parseFlags,
    name: input.name,
    contract: token.name,
    behaviorRevision: input.behaviorRevision ?? null,
    create,
    [ADAPTER_CONTRACT_TOKEN]: token,
    ...boundEvalFactories(token),
  }) as AdapterImplementation<Context, Assertions, Flags>;
}

/** Defines one Adapter implementation with an automatically private contract. */
export function defineAdapter<Context extends object, Flags extends AdapterFlagsParser = undefined>(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<Context, Flags>;
  readonly parseFlags?: Flags;
  readonly assertions?: undefined;
} & AdapterContextValidation<NoInfer<Context>> & AdapterFlagsParserValidation<NoInfer<Flags>>): AdapterImplementation<Context, undefined, Flags>;
export function defineAdapter<
  Context extends object,
  Assertions extends object,
  Flags extends AdapterFlagsParser = undefined,
>(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<Context, Flags>;
  readonly parseFlags?: Flags;
  /** Attempt-local Assertion sugar, assembled once after create() succeeds. */
  readonly assertions: AdapterAssertionsFactory<Context, Assertions>;
} & AdapterContextValidation<NoInfer<Context>> & AdapterFlagsParserValidation<NoInfer<Flags>> &
  AdapterAssertionsValidation<Context, NoInfer<Assertions>>): AdapterImplementation<Context, Assertions, Flags>;
export function defineAdapter(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<object, AdapterFlagsParser>;
  readonly parseFlags?: Exclude<AdapterFlagsParser, undefined>;
  readonly assertions?: AdapterAssertionsFactory<object>;
}): AdapterRuntimeDefinition {
  if (input.parseFlags !== undefined) assertAdapterFlagsParser(input.parseFlags);
  const assertions = input.assertions;
  if (assertions !== undefined && typeof assertions !== "function") {
    throw new TypeError("defineAdapter assertions must be a function.");
  }
  return implementAdapter(
    contractToken<object, object | undefined, AdapterFlagsParser>(input.name, assertions, input.parseFlags),
    input,
    "defineAdapter",
  );
}

/** Defines a reusable contract whose implementations and Evals share one runtime-only token. */
export function defineAdapterContract<Context extends object>(
  input: { readonly name: string } & AdapterContextValidation<NoInfer<Context>>,
): AdapterContract<Context> {
  assertNonEmptyString(input.name, "name", "defineAdapterContract");
  return makeAdapterContract(contractToken<Context, undefined, undefined>(input.name, undefined, undefined));
}

function makeAdapterContract<
  Context extends object,
  Assertions extends object | undefined,
  Flags extends AdapterFlagsParser,
>(token: AdapterContractToken<Context, Assertions, Flags>): AdapterContract<Context, Assertions, Flags> {
  const factories = boundEvalFactories(token);
  return Object.freeze({
    name: token.name,
    parseFlags: token.parseFlags,
    ...factories,
    implement<ImplementationContext extends Context>(
      implementation: AdapterImplementationInput<Context, ImplementationContext, Flags>,
    ) {
      return implementAdapter(token, implementation, "AdapterContract.implement");
    },
    withParseFlags<NextFlags extends Exclude<AdapterFlagsParser, undefined>>(
      parseFlags: NextFlags,
      ..._validation: AdapterFlagsParserValidationArgs<NoInfer<NextFlags>>
    ) {
      assertAdapterFlagsParser(parseFlags);
      return makeAdapterContract(contractToken<Context, Assertions, NextFlags>(token.name, token.assertions, parseFlags));
    },
    withAssertions<NextAssertions extends object>(
      factory: AdapterAssertionsFactory<Context, NextAssertions>,
      ..._validation: AdapterAssertionsValidationArgs<Context, NoInfer<NextAssertions>>
    ) {
      if (typeof factory !== "function") {
        throw new TypeError("AdapterContract.withAssertions requires a function.");
      }
      return makeAdapterContract(contractToken<Context, NextAssertions, Flags>(token.name, factory, token.parseFlags));
    },
  });
}

/** The single credential-free persistence projection for an Adapter. */
export function adapterIdentity(adapter: Adapter): AdapterIdentity {
  return adapter.kind === "custom"
    ? Object.freeze({
        name: adapter.name,
        contract: adapter.contract,
        behaviorRevision: adapter.behaviorRevision,
      })
    : Object.freeze({
        name: adapter.name,
        contract: "niceeval.agent/v1",
        behaviorRevision: null,
      });
}

/** @internal Runtime contract pairing; the token itself never enters persistence. */
export function adapterAcceptsEval(adapter: Adapter, definition: object): boolean {
  const required = (definition as { readonly [EVAL_ADAPTER_CONTRACT_TOKEN]?: unknown })[
    EVAL_ADAPTER_CONTRACT_TOKEN
  ];
  if (adapter.kind === "custom") {
    const provided = adapter[ADAPTER_CONTRACT_TOKEN];
    return required !== undefined && provided !== undefined && required === provided;
  }
  return required === undefined;
}

/** @internal Returns the readable contract name without revealing the pairing token. */
export function adapterContractRequiredByEval(definition: object): string | undefined {
  return (definition as { readonly [EVAL_ADAPTER_CONTRACT_TOKEN]?: { readonly name: string } })[
    EVAL_ADAPTER_CONTRACT_TOKEN
  ]?.name;
}

const RESERVED_ADAPTER_CONTEXT_KEY_SET: ReadonlySet<string> = new Set(RESERVED_ADAPTER_CONTEXT_KEYS);

function assertPlainAdapterContext(value: unknown): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Adapter create(context) must return a plain object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Adapter create(context) must return an explicit plain object.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string" && RESERVED_ADAPTER_CONTEXT_KEY_SET.has(key)) {
      throw new TypeError(`Adapter context key ${JSON.stringify(key)} is reserved.`);
    }
  }
}

function forwardProperties(target: object, source: object, guardAccess: boolean, assertAuthorOpen: () => void): void {
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined) continue;
    if ("value" in descriptor && typeof descriptor.value === "function") {
      const method = guardAccess
        ? function(this: unknown, ...args: readonly unknown[]) {
            assertAuthorOpen();
            return Reflect.apply(descriptor.value, source, args);
          }
        : descriptor.value.bind(source);
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: method,
      });
    } else {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: false,
        get: () => {
          if (guardAccess) assertAuthorOpen();
          const value = Reflect.get(source, key, source);
          if (typeof value !== "function") return value;
          return guardAccess
            ? (...args: readonly unknown[]) => {
                assertAuthorOpen();
                return Reflect.apply(value, source, args);
              }
            : value.bind(source);
        },
      });
    }
  }
}

/** Observes only branded native Promises without reading an arbitrary `.then` property. */
function observeNativePromiseRejection(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  try {
    void Reflect.apply(Promise.prototype.then, value, [
      undefined,
      () => undefined,
    ]);
    return true;
  } catch {
    return false;
  }
}

function assertPlainAdapterAssertions(value: unknown, context: object): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Adapter assertions factory must return a plain object of methods.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    observeNativePromiseRejection(value);
    throw new TypeError("Adapter assertions factory must return an explicit plain object.");
  }
  const contextKeys = new Set(Reflect.ownKeys(context));
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError("Adapter assertion method names must be strings.");
    }
    if (RESERVED_ADAPTER_CONTEXT_KEY_SET.has(key)) {
      throw new TypeError(`Adapter assertion method name ${JSON.stringify(key)} is reserved.`);
    }
    if (contextKeys.has(key)) {
      throw new TypeError(`Adapter assertion method name ${JSON.stringify(key)} conflicts with an app member.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Adapter assertion ${JSON.stringify(key)} must be an own data method.`);
    }
  }
}

function bindAdapterAppContext<Context>(
  context: Context,
  assertAppOpen: () => void,
): Readonly<Context> {
  const target = Object.create(null) as object;
  forwardProperties(target, context as object, true, assertAppOpen);
  return Object.freeze(target) as Readonly<Context>;
}

function bindAdapterAssertions<Kind extends EvaluationKind, Context extends object>(
  core: EvalContext<Kind>,
  context: Context,
  factory: AdapterAssertionsFactory<Context>,
  assertAuthorOpen: () => void,
): { readonly app: Readonly<Context>; readonly assertions: object } {
  let assembled = false;
  const assertAppOpen = (): void => {
    assertAuthorOpen();
    if (!assembled) {
      throw new TypeError("Adapter assertions factory may only assemble methods; app access starts afterward.");
    }
  };
  const app = bindAdapterAppContext(context, assertAppOpen);
  const handleFrames: Array<WeakSet<object>> = [];
  const check = (...args: readonly unknown[]): unknown => {
    assertAuthorOpen();
    const frame = handleFrames.at(-1);
    if (frame === undefined) {
      throw new TypeError("Adapter assertions factory may call check only from an assertion method.");
    }
    const handle = Reflect.apply(core.check, undefined, args);
    if ((typeof handle !== "object" && typeof handle !== "function") || handle === null) {
      throw new TypeError("Adapter assertion check did not return an AssertionHandle.");
    }
    frame.add(handle);
    return handle;
  };

  const authored = factory({
    app,
    check: check as AssertionCheck<"polymorphic">,
  });
  assertPlainAdapterAssertions(authored, context);
  Object.freeze(authored);
  assembled = true;

  const assertions = Object.create(null) as object;
  for (const key of Reflect.ownKeys(authored)) {
    const descriptor = Object.getOwnPropertyDescriptor(authored, key)!;
    const method = descriptor.value as (...args: readonly unknown[]) => unknown;
    Object.defineProperty(assertions, key, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (...args: readonly unknown[]) => {
        assertAuthorOpen();
        const frame = new WeakSet<object>();
        handleFrames.push(frame);
        try {
          const handle = Reflect.apply(method, authored, args);
          if ((typeof handle !== "object" && typeof handle !== "function") || handle === null || !frame.has(handle)) {
            observeNativePromiseRejection(handle);
            throw new TypeError(
              `Adapter assertion ${JSON.stringify(key)} must synchronously return its own check() handle.`,
            );
          }
          return handle;
        } finally {
          handleFrames.pop();
        }
      },
    });
  }
  return Object.freeze({ app, assertions: Object.freeze(assertions) });
}

/** @internal Builds the frozen single-t facade after create settles. */
export function bindAdapterEvalContext<Kind extends EvaluationKind, Context>(
  core: EvalContext<Kind>,
  context: Context,
  adapter: AdapterRuntimeDefinition,
  assertAuthorOpen: () => void,
): EvalContext<Kind> & Readonly<Context> {
  assertPlainAdapterContext(context);
  const token = adapter[ADAPTER_CONTRACT_TOKEN] as AdapterContractToken<
    Context & object,
    object | undefined
  >;
  let app: Readonly<Context>;
  let assertions: object | undefined;
  if (token.assertions === undefined) {
    app = bindAdapterAppContext(context, assertAuthorOpen);
  } else {
    const bound = bindAdapterAssertions(
      core,
      context,
      token.assertions,
      assertAuthorOpen,
    );
    app = bound.app;
    assertions = bound.assertions;
  }
  const target = Object.create(null) as object;
  forwardProperties(target, core, false, assertAuthorOpen);
  forwardProperties(target, app, false, assertAuthorOpen);
  if (assertions !== undefined) forwardProperties(target, assertions, false, assertAuthorOpen);
  return Object.freeze(target) as EvalContext<Kind> & Readonly<Context>;
}
