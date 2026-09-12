import type { AssertionsRuntime } from "./assertions/api.ts";
import { defineEvalForContext } from "./define.ts";
import type { EvalDefinition, EvalInput, ScoreEvalInput } from "./runner/types.ts";
import type { EvaluationKind } from "./shared/evaluation.ts";
import type { DiagnosticInput, JsonValue, ProgressUpdate } from "./shared/types.ts";
import type { ApplicationIdentity } from "./record/model/run-context.ts";
export type { ApplicationIdentity } from "./record/model/run-context.ts";

const APPLICATION_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.applicationContractToken");
const EVAL_APPLICATION_CONTRACT_TOKEN: unique symbol = Symbol("niceeval.evalApplicationContractToken");

/** Keys owned by the neutral Eval runtime or unsafe on a merged object root. */
const RESERVED_APPLICATION_CONTEXT_KEYS = [
  "evaluationKind",
  "check",
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

export type ReservedApplicationContextKey = typeof RESERVED_APPLICATION_CONTEXT_KEYS[number];

type InvalidContextBranch<Context> = Context extends unknown
  ? Context extends object
    ? Context extends readonly unknown[]
      ? Context
      : Context extends (...args: readonly never[]) => unknown
        ? Context
        : string extends keyof Context
          ? Context
          : Extract<keyof Context, ReservedApplicationContextKey> extends never
            ? never
            : Context
    : Context
  : never;

type ApplicationContextValidation<Context> = unknown extends Context
  ? unknown
  : [InvalidContextBranch<Context>] extends [never]
    ? unknown
    : { readonly invalidApplicationContext: InvalidContextBranch<Context> };

type ApplicationFactory<Context extends object> = (
  context: ApplicationCreateContext,
) => (Context & ThisType<Context>) | Promise<Context & ThisType<Context>>;

export interface ApplicationCreateContext {
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

type EvalContextBase<Kind extends EvaluationKind> = {
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
};

/** Agent-neutral author context shared by every Application Eval. */
export type EvalContext<Kind extends EvaluationKind = "pass"> = EvalContextBase<Kind> &
  (Kind extends "score" ? { readonly score: AssertionsRuntime<"score">["t"]["score"] } : {});

type ApplicationEvalFields = Omit<EvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

type ApplicationScoreEvalFields = Omit<ScoreEvalInput<undefined>, "test" | "sandbox" | "diff"> & {
  readonly sandbox?: never;
  readonly diff?: never;
};

export type ApplicationEvalInput<Context extends object> = ApplicationEvalFields & {
  test(t: EvalContext<"pass"> & Readonly<Context>): void | Promise<void>;
};

export type ApplicationScoreEvalInput<Context extends object> = ApplicationScoreEvalFields & {
  test(t: EvalContext<"score"> & Readonly<Context>): void | Promise<void>;
};

interface ApplicationContractToken<Context extends object> {
  readonly name: string;
  /** Keeps the context parameter invariant without exposing a constructible brand. */
  readonly context: (value: Context) => Context;
}

export interface ApplicationEvalDefinition<Kind extends EvaluationKind, Context extends object>
  extends EvalDefinition<Kind, EvalContext<Kind> & Readonly<Context>, undefined> {
  readonly [EVAL_APPLICATION_CONTRACT_TOKEN]: ApplicationContractToken<Context>;
}

/** @internal Existential discovery view; concrete bound factories retain their exact Context. */
export interface ApplicationRuntimeEvalDefinition<Kind extends EvaluationKind>
  extends EvalDefinition<Kind, never, undefined> {
  readonly [EVAL_APPLICATION_CONTRACT_TOKEN]: object;
}

/** Common public surface for an Application definition with bound Eval factories. */
export interface ApplicationDefinition<Context extends object> {
  readonly name: string;
  defineEval(input: ApplicationEvalInput<Context>): ApplicationEvalDefinition<"pass", Context>;
  defineScoreEval(input: ApplicationScoreEvalInput<Context>): ApplicationEvalDefinition<"score", Context>;
}

/** Existential runtime view used by Experiment without erasing a concrete context to `any`. */
export interface ApplicationRuntimeDefinition {
  readonly kind: "application";
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [APPLICATION_CONTRACT_TOKEN]: object;
  readonly defineEval: (...args: never[]) => unknown;
  readonly defineScoreEval: (...args: never[]) => unknown;
  create(context: ApplicationCreateContext): object | Promise<object>;
}

export interface ApplicationImplementation<Context extends object> extends ApplicationDefinition<Context> {
  readonly kind: "application";
  readonly contract: string;
  readonly behaviorRevision: string | null;
  readonly [APPLICATION_CONTRACT_TOKEN]: ApplicationContractToken<Context>;
  create(context: ApplicationCreateContext): Context | Promise<Context>;
}

export type ApplicationImplementationInput<
  Context extends object,
  ImplementationContext extends Context = Context,
> = {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: ApplicationFactory<ImplementationContext>;
} & ApplicationContextValidation<NoInfer<ImplementationContext>>;

export interface ApplicationContract<Context extends object> extends ApplicationDefinition<Context> {
  readonly name: string;
  implement<ImplementationContext extends Context>(
    input: ApplicationImplementationInput<Context, ImplementationContext>,
  ): ApplicationImplementation<Context>;
}

export type Application = import("./agents/types.ts").Agent | ApplicationRuntimeDefinition;

function assertNonEmptyString(value: unknown, field: string, factory: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${factory} requires a non-empty ${field}.`);
  }
}

function contractToken<Context extends object>(name: string): ApplicationContractToken<Context> {
  return Object.freeze({ name, context: (value: Context) => value });
}

function assertApplicationEvalInput(
  value: { readonly sandbox?: unknown; readonly diff?: unknown },
  factory: "defineEval" | "defineScoreEval",
): void {
  if (Object.hasOwn(value, "sandbox")) {
    throw new TypeError(`${factory} for an Application does not support sandbox.`);
  }
  if (Object.hasOwn(value, "diff")) {
    throw new TypeError(`${factory} for an Application does not support Agent workspace diff configuration.`);
  }
}

function boundEvalFactories<Context extends object>(token: ApplicationContractToken<Context>): Pick<
  ApplicationDefinition<Context>,
  "defineEval" | "defineScoreEval"
> {
  return {
    defineEval(input) {
      assertApplicationEvalInput(input, "defineEval");
      return defineEvalForContext("pass", input, {
        [EVAL_APPLICATION_CONTRACT_TOKEN]: token,
      }) as ApplicationEvalDefinition<"pass", Context>;
    },
    defineScoreEval(input) {
      assertApplicationEvalInput(input, "defineScoreEval");
      return defineEvalForContext("score", input, {
        [EVAL_APPLICATION_CONTRACT_TOKEN]: token,
      }) as ApplicationEvalDefinition<"score", Context>;
    },
  };
}

function implementApplication<Context extends object>(
  token: ApplicationContractToken<Context>,
  input: {
    readonly name: string;
    readonly behaviorRevision?: string;
    readonly create: ApplicationFactory<Context>;
  },
  factory: "defineApplication" | "ApplicationContract.implement",
): ApplicationImplementation<Context> {
  assertNonEmptyString(input.name, "name", factory);
  if (input.behaviorRevision !== undefined) {
    assertNonEmptyString(input.behaviorRevision, "behaviorRevision", factory);
  }
  if (typeof input.create !== "function") {
    throw new TypeError(`${factory} requires create(context).`);
  }
  const authorCreate = input.create;
  const create = (context: ApplicationCreateContext): Context | Promise<Context> => {
    const created = authorCreate(context);
    if (created instanceof Promise) {
      return created.then((value) => {
        assertPlainApplicationContext(value);
        return value;
      });
    }
    // Validate before a caller can pass a synchronous thenable to Promise adaptation.
    assertPlainApplicationContext(created);
    return created;
  };
  return Object.freeze({
    kind: "application" as const,
    name: input.name,
    contract: token.name,
    behaviorRevision: input.behaviorRevision ?? null,
    create,
    [APPLICATION_CONTRACT_TOKEN]: token,
    ...boundEvalFactories(token),
  }) as ApplicationImplementation<Context>;
}

/** Defines one Application implementation with an automatically private contract. */
export function defineApplication<Context extends object>(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: ApplicationFactory<Context>;
} & ApplicationContextValidation<NoInfer<Context>>): ApplicationImplementation<Context>;
export function defineApplication(input: {
  readonly name: string;
  readonly behaviorRevision?: string;
  readonly create: ApplicationFactory<object>;
}): ApplicationRuntimeDefinition {
  return implementApplication(contractToken<object>(input.name), input, "defineApplication");
}

/** Defines a reusable contract whose implementations and Evals share one runtime-only token. */
export function defineApplicationContract<Context extends object>(
  input: { readonly name: string } & ApplicationContextValidation<NoInfer<Context>>,
): ApplicationContract<Context> {
  assertNonEmptyString(input.name, "name", "defineApplicationContract");
  const token = contractToken<Context>(input.name);
  const factories = boundEvalFactories(token);
  return Object.freeze({
    name: input.name,
    ...factories,
    implement<ImplementationContext extends Context>(
      implementation: ApplicationImplementationInput<Context, ImplementationContext>,
    ) {
      return implementApplication(token, implementation, "ApplicationContract.implement");
    },
  });
}

/** The single credential-free persistence projection for an Application. */
export function applicationIdentity(application: Application): ApplicationIdentity {
  return application.kind === "application"
    ? Object.freeze({
        kind: "application" as const,
        name: application.name,
        contract: application.contract,
        behaviorRevision: application.behaviorRevision,
      })
    : Object.freeze({ kind: "agent" as const, name: application.name });
}

/** @internal Runtime contract pairing; the token itself never enters persistence. */
export function applicationAcceptsEval(application: Application, definition: object): boolean {
  const required = (definition as { readonly [EVAL_APPLICATION_CONTRACT_TOKEN]?: unknown })[
    EVAL_APPLICATION_CONTRACT_TOKEN
  ];
  if (application.kind === "application") {
    const provided = application[APPLICATION_CONTRACT_TOKEN];
    return required !== undefined && provided !== undefined && required === provided;
  }
  return required === undefined;
}

/** @internal Returns the readable contract name without revealing the pairing token. */
export function applicationContractRequiredByEval(definition: object): string | undefined {
  return (definition as { readonly [EVAL_APPLICATION_CONTRACT_TOKEN]?: ApplicationContractToken<object> })[
    EVAL_APPLICATION_CONTRACT_TOKEN
  ]?.name;
}

const RESERVED_APPLICATION_CONTEXT_KEY_SET: ReadonlySet<string> = new Set(RESERVED_APPLICATION_CONTEXT_KEYS);

function assertPlainApplicationContext(value: unknown): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Application create(context) must return a plain object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Application create(context) must return an explicit plain object.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string" && RESERVED_APPLICATION_CONTEXT_KEY_SET.has(key)) {
      throw new TypeError(`Application context key ${JSON.stringify(key)} is reserved.`);
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
export function bindApplicationEvalContext<Kind extends EvaluationKind, Context>(
  core: EvalContext<Kind>,
  context: Context,
  assertAuthorOpen: () => void,
): EvalContext<Kind> & Readonly<Context> {
  assertPlainApplicationContext(context);
  const target = Object.create(null) as object;
  forwardProperties(target, core, false, assertAuthorOpen);
  forwardProperties(target, context, true, assertAuthorOpen);
  return Object.freeze(target) as EvalContext<Kind> & Readonly<Context>;
}
