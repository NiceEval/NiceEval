import type {
  AssertionSubject,
  AssertionsRuntime,
  MeasurementAssertionHandle,
} from "./assertions/api.ts";
import type { ScoreMatch } from "./assertions/match.ts";
import { defineEvalForContext } from "./define.ts";
import type { EvalDefinition, EvalInput, ScoreEvalInput } from "./runner/types.ts";
import type { EvaluationKind } from "./shared/evaluation.ts";
import type { JudgePresetMethods } from "./context/assert-first.ts";
import type { DiagnosticInput, JsonValue, ProgressUpdate } from "./shared/types.ts";
import type { AdapterIdentity } from "./record/model/run-context.ts";
export type { AdapterIdentity } from "./record/model/run-context.ts";

const ADAPTER_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.adapterContractToken");
const EVAL_ADAPTER_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.evalAdapterContractToken");

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

type AdapterFactory<Context extends object> = (
  context: AdapterCreateContext,
) => (Context & ThisType<Context>) | Promise<Context & ThisType<Context>>;

export interface AdapterCreateContext {
  readonly evalId: string;
  readonly experimentId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  log(message: string): void;
  onCleanup(cleanup: () => void | Promise<void>): void;
}

type EvalContextBase<Kind extends EvaluationKind> = JudgePresetMethods<Kind> & {
  readonly evaluationKind: Kind;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
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
export type EvalContext<Kind extends EvaluationKind = "pass"> = EvalContextBase<Kind> &
  (Kind extends "score" ? { readonly score: AssertionsRuntime<"score">["t"]["score"] } : {});

type AdapterEvalFields = Omit<EvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

type AdapterScoreEvalFields = Omit<ScoreEvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

export type AdapterEvalInput<Context extends object> = AdapterEvalFields & {
  test(t: EvalContext<"pass"> & Readonly<Context>): void | Promise<void>;
};

export type AdapterScoreEvalInput<Context extends object> = AdapterScoreEvalFields & {
  test(t: EvalContext<"score"> & Readonly<Context>): void | Promise<void>;
};

interface AdapterContractToken<Context extends object> {
  readonly name: string;
  /** Keeps the context parameter invariant without exposing a constructible brand. */
  readonly context: (value: Context) => Context;
}

export interface AdapterEvalDefinition<Kind extends EvaluationKind, Context extends object>
  extends EvalDefinition<Kind, EvalContext<Kind> & Readonly<Context>, undefined> {
  readonly [EVAL_ADAPTER_CONTRACT_TOKEN]: AdapterContractToken<Context>;
}

/** @internal Existential discovery view; concrete bound factories retain their exact Context. */
export interface AdapterRuntimeEvalDefinition<Kind extends EvaluationKind>
  extends EvalDefinition<Kind, never, undefined> {
  readonly [EVAL_ADAPTER_CONTRACT_TOKEN]: object;
}

/** Common public surface for an Adapter definition with bound Eval factories. */
export interface AdapterDefinition<Context extends object> {
  readonly name: string;
  defineEval(input: AdapterEvalInput<Context>): AdapterEvalDefinition<"pass", Context>;
  defineScoreEval(input: AdapterScoreEvalInput<Context>): AdapterEvalDefinition<"score", Context>;
}

/** Existential runtime view used by Experiment without erasing a concrete context to `any`. */
export interface AdapterRuntimeDefinition {
  readonly kind: "custom";
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [ADAPTER_CONTRACT_TOKEN]: object;
  readonly defineEval: (...args: never[]) => unknown;
  readonly defineScoreEval: (...args: never[]) => unknown;
  create(context: AdapterCreateContext): object | Promise<object>;
}

export interface AdapterImplementation<Context extends object> extends AdapterDefinition<Context> {
  readonly kind: "custom";
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [ADAPTER_CONTRACT_TOKEN]: AdapterContractToken<Context>;
  create(context: AdapterCreateContext): Context | Promise<Context>;
}

export type AdapterImplementationInput<
  Context extends object,
  ImplementationContext extends Context = Context,
> = {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<ImplementationContext>;
} & AdapterContextValidation<NoInfer<ImplementationContext>>;

export interface AdapterContract<Context extends object> extends AdapterDefinition<Context> {
  readonly name: string;
  implement<ImplementationContext extends Context>(
    input: AdapterImplementationInput<Context, ImplementationContext>,
  ): AdapterImplementation<Context>;
}

export type Adapter = import("./agents/types.ts").Agent | AdapterRuntimeDefinition;

function assertNonEmptyString(value: unknown, field: string, factory: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${factory} requires a non-empty ${field}.`);
  }
}

function contractToken<Context extends object>(name: string): AdapterContractToken<Context> {
  return Object.freeze({ name, context: (value: Context) => value });
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

function boundEvalFactories<Context extends object>(token: AdapterContractToken<Context>): Pick<
  AdapterDefinition<Context>,
  "defineEval" | "defineScoreEval"
> {
  return {
    defineEval(input) {
      assertAdapterEvalInput(input, "defineEval");
      return defineEvalForContext("pass", input, {
        [EVAL_ADAPTER_CONTRACT_TOKEN]: token,
      }) as AdapterEvalDefinition<"pass", Context>;
    },
    defineScoreEval(input) {
      assertAdapterEvalInput(input, "defineScoreEval");
      return defineEvalForContext("score", input, {
        [EVAL_ADAPTER_CONTRACT_TOKEN]: token,
      }) as AdapterEvalDefinition<"score", Context>;
    },
  };
}

function implementAdapter<Context extends object>(
  token: AdapterContractToken<Context>,
  input: {
    readonly name: string;
    readonly behaviorRevision?: string;
    readonly create: AdapterFactory<Context>;
  },
  factory: "defineAdapter" | "AdapterContract.implement",
): AdapterImplementation<Context> {
  assertNonEmptyString(input.name, "name", factory);
  if (input.behaviorRevision !== undefined) {
    assertNonEmptyString(input.behaviorRevision, "behaviorRevision", factory);
  }
  if (typeof input.create !== "function") {
    throw new TypeError(`${factory} requires create(context).`);
  }
  const authorCreate = input.create;
  const create = (context: AdapterCreateContext): Context | Promise<Context> => {
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
    name: input.name,
    contract: token.name,
    behaviorRevision: input.behaviorRevision ?? null,
    create,
    [ADAPTER_CONTRACT_TOKEN]: token,
    ...boundEvalFactories(token),
  }) as AdapterImplementation<Context>;
}

/** Defines one Adapter implementation with an automatically private contract. */
export function defineAdapter<Context extends object>(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<Context>;
} & AdapterContextValidation<NoInfer<Context>>): AdapterImplementation<Context>;
export function defineAdapter(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: AdapterFactory<object>;
}): AdapterRuntimeDefinition {
  return implementAdapter(contractToken<object>(input.name), input, "defineAdapter");
}

/** Defines a reusable contract whose implementations and Evals share one runtime-only token. */
export function defineAdapterContract<Context extends object>(
  input: { readonly name: string } & AdapterContextValidation<NoInfer<Context>>,
): AdapterContract<Context> {
  assertNonEmptyString(input.name, "name", "defineAdapterContract");
  const token = contractToken<Context>(input.name);
  const factories = boundEvalFactories(token);
  return Object.freeze({
    name: input.name,
    ...factories,
    implement<ImplementationContext extends Context>(
      implementation: AdapterImplementationInput<Context, ImplementationContext>,
    ) {
      return implementAdapter(token, implementation, "AdapterContract.implement");
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
  return (definition as { readonly [EVAL_ADAPTER_CONTRACT_TOKEN]?: AdapterContractToken<object> })[
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

function forwardProperties(target: object, source: object, guardMethods: boolean, assertAuthorOpen: () => void): void {
  for (const key of Reflect.ownKeys(source)) {
    const initial = Reflect.get(source, key, source);
    if (typeof initial === "function") {
      const method = guardMethods
        ? function(this: unknown, ...args: readonly unknown[]) {
            assertAuthorOpen();
            return Reflect.apply(initial, source, args);
          }
        : initial.bind(source);
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
        get: () => Reflect.get(source, key, source),
      });
    }
  }
}

/** @internal Builds the frozen single-t facade after create settles. */
export function bindAdapterEvalContext<Kind extends EvaluationKind, Context>(
  core: EvalContext<Kind>,
  context: Context,
  assertAuthorOpen: () => void,
): EvalContext<Kind> & Readonly<Context> {
  assertPlainAdapterContext(context);
  const target = Object.create(null) as object;
  forwardProperties(target, core, false, assertAuthorOpen);
  forwardProperties(target, context, true, assertAuthorOpen);
  return Object.freeze(target) as EvalContext<Kind> & Readonly<Context>;
}
