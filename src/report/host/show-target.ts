import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import type {
  JsonValue,
  Sample,
} from "../../analysis/contracts.ts";
import type {
  PageContext,
  PageLoadContext,
  ReportDefinition,
} from "../definition/report.ts";
import {
  compareUtf8,
  resolvePage,
  type LiveResolvedPageContext,
  type ResolvedPage,
  type ResolvedPageClosureError,
  type ResolvedPageOutput,
  type ResolvedPageTarget,
} from "../runtime/resolved-page.ts";

/** Metadata supplied to one selected Page callback while the Sample is open. */
export type ShowTargetPageContext = PageContext;

/**
 * The executor consumes normalized author definitions directly. `enumerate`
 * exists on the parameterized declaration but has no call site in this file.
 */
export type ShowTargetPage = ReportDefinition["pages"][number];
export type ShowTargetPlainPage = Extract<ShowTargetPage, { readonly params?: never }>;
export type ShowTargetParameterizedPage = Exclude<ShowTargetPage, ShowTargetPlainPage>;

export interface ShowTargetDefinition {
  readonly pages: readonly ShowTargetPage[];
}

export type ShowTargetRequest =
  | { readonly kind: "default" }
  | { readonly kind: "page"; readonly pageId: string }
  | {
      readonly kind: "parameterized-page";
      readonly pageId: string;
      /** The exact incoming key that must survive decode → encode unchanged. */
      readonly key: string;
      /** The Host-provided concrete route for this one Page instance. */
      readonly route: string;
    };

export interface ShowTargetCloseContext extends LiveResolvedPageContext {
  readonly page: ShowTargetPageContext;
}

/**
 * Optional synchronous capture boundary for the exact start of an author
 * callback. Promise assimilation and Effect execution happen after it returns.
 */
export type ShowTargetRunAuthor = <Value>(callback: () => Value) => Value;

export interface ExecuteShowTargetInput<Error, Requirements> {
  readonly definition: ShowTargetDefinition;
  readonly sample: Sample;
  readonly request: ShowTargetRequest;
  /**
   * This is the PageLoadContext evidence surface for the fixed Sample. A
   * parameterized Page validates any locator/member it dereferences through
   * this public API; the Host does not invent a generic member predicate or
   * enumerate the Page to prove one exists.
   */
  readonly evidence: PageLoadContext["evidence"];
  /**
   * Host-owned synchronous callback-start capture (for example,
   * captureAnalysisIssues(...).run). When absent, callbacks run directly.
   */
  readonly runAuthor?: ShowTargetRunAuthor;
  /**
   * The private Page resolver. It resolves components and creates both text and
   * web projections while the Sample Scope is live, then returns data only.
   */
  readonly close: (
    rendered: unknown,
    context: ShowTargetCloseContext,
  ) => Effect.Effect<ResolvedPageOutput, Error, Requirements>;
}

export type ShowTargetError =
  | {
      readonly code: "report-show-target-default-missing";
    }
  | {
      readonly code: "report-show-target-page-missing";
      readonly pageId: string;
    }
  | {
      readonly code: "report-show-target-parameter-required";
      readonly pageId: string;
    }
  | {
      readonly code: "report-show-target-parameter-unexpected";
      readonly pageId: string;
    }
  | {
      readonly code: "report-show-target-route-invalid";
      readonly pageId: string;
    }
  | {
      readonly code: "report-show-target-parameter-invalid";
      readonly pageId: string;
      readonly key: string;
      readonly reason: "decode-failed" | "decode-not-json" | "encode-failed" | "not-canonical";
    }
  | {
      readonly code: "report-show-target-callback-failed";
      readonly pageId: string;
      readonly phase: "params-decode" | "params-encode" | "load" | "render" | "close";
    };

interface SelectedPlainTarget {
  readonly kind: "plain";
  readonly page: ShowTargetPlainPage;
  readonly context: ShowTargetPageContext;
  readonly target: ResolvedPageTarget;
}

interface SelectedParameterizedTarget {
  readonly kind: "parameterized";
  readonly page: ShowTargetParameterizedPage;
  readonly key: string;
  readonly route: string;
}

type SelectedShowTarget = SelectedPlainTarget | SelectedParameterizedTarget;

/**
 * Executes exactly one target Page. In particular, this function never calls
 * `params.enumerate()` because that would make `show` a hidden site build.
 */
export function executeShowTarget<Error, Requirements>(
  input: ExecuteShowTargetInput<Error, Requirements>,
): Effect.Effect<
  ResolvedPage,
  Error | ShowTargetError | ResolvedPageClosureError,
  Requirements | Scope.Scope
> {
  const selected = selectShowTarget(input.definition, input.request);
  if (isShowTargetError(selected)) return Effect.fail(selected);
  return selected.kind === "plain"
    ? executePlainTarget(input, selected)
    : executeParameterizedTarget(input, selected);
}

/** Pure selection only; no page callback, loader, encoder, decoder, or enumeration runs here. */
export function selectShowTarget(
  definition: ShowTargetDefinition,
  request: ShowTargetRequest,
): SelectedShowTarget | ShowTargetError {
  if (request.kind === "default") {
    const page = definition.pages.find((candidate): candidate is ShowTargetPlainPage =>
      candidate.params === undefined && candidate.navigation !== false
    );
    if (page === undefined) return Object.freeze({ code: "report-show-target-default-missing" as const });
    return plainSelection(page);
  }

  const page = definition.pages.find((candidate) => candidate.id === request.pageId);
  if (page === undefined) {
    return Object.freeze({ code: "report-show-target-page-missing" as const, pageId: request.pageId });
  }
  if (request.kind === "page") {
    if (page.params !== undefined) {
      return Object.freeze({ code: "report-show-target-parameter-required" as const, pageId: page.id });
    }
    return plainSelection(page);
  }
  if (page.params === undefined) {
    return Object.freeze({ code: "report-show-target-parameter-unexpected" as const, pageId: page.id });
  }
  if (!isNonEmptyString(request.key) || !isNonEmptyString(request.route)) {
    return Object.freeze({ code: "report-show-target-route-invalid" as const, pageId: page.id });
  }
  return Object.freeze({
    kind: "parameterized" as const,
    page,
    key: request.key,
    route: request.route,
  });
}

function executePlainTarget<Error, Requirements>(
  input: ExecuteShowTargetInput<Error, Requirements>,
  selected: SelectedPlainTarget,
): Effect.Effect<
  ResolvedPage,
  Error | ShowTargetError | ResolvedPageClosureError,
  Requirements | Scope.Scope
> {
  return Effect.gen(function* () {
    const loadContext = createPageLoadContext(selected.context, input.evidence);
    const pageInput = selected.page.load === undefined
      ? input.sample
      : yield* invokeAuthorCallback(
        selected.page.id,
        "load",
        input.runAuthor,
        () => selected.page.load!(input.sample, undefined, loadContext),
      );
    return yield* resolvePage<unknown, Error | ShowTargetError, Requirements>({
      sample: input.sample,
      target: selected.target,
      render: invokeAuthorCallback(
        selected.page.id,
        "render",
        input.runAuthor,
        () => selected.page.render(pageInput, selected.context),
      ),
      close: (rendered, context) => invokeCloseCallback(
        input,
        selected.page.id,
        rendered,
        { ...context, page: selected.context },
      ),
    });
  });
}

function executeParameterizedTarget<Error, Requirements>(
  input: ExecuteShowTargetInput<Error, Requirements>,
  selected: SelectedParameterizedTarget,
): Effect.Effect<
  ResolvedPage,
  Error | ShowTargetError | ResolvedPageClosureError,
  Requirements | Scope.Scope
> {
  return Effect.gen(function* () {
    const decoded = yield* decodeCanonicalParameters(selected.page, selected.key, input.runAuthor);
    const context = pageContext(selected.page, decoded);
    const target: ResolvedPageTarget = Object.freeze({
      pageId: selected.page.id,
      route: selected.route,
      params: decoded,
    });
    const loadContext = createPageLoadContext(context, input.evidence);
    // Do not enumerate or impose a Host-wide parameter-member rule here.
    // PageLoadContext.evidence and any public DomainView API are bound to this
    // Sample and validate the concrete locator/identity a Page actually reads.
    const pageInput = yield* invokeAuthorCallback(
      selected.page.id,
      "load",
      input.runAuthor,
      () => selected.page.load(input.sample, decoded, loadContext),
    );
    return yield* resolvePage<unknown, Error | ShowTargetError, Requirements>({
      sample: input.sample,
      target,
      render: invokeAuthorCallback(
        selected.page.id,
        "render",
        input.runAuthor,
        () => selected.page.render(pageInput, context),
      ),
      close: (rendered, closeContext) => invokeCloseCallback(
        input,
        selected.page.id,
        rendered,
        { ...closeContext, page: context },
      ),
    });
  });
}

/** Parameterized show always accepts only a canonical key. */
function decodeCanonicalParameters(
  page: ShowTargetParameterizedPage,
  key: string,
  runAuthor: ShowTargetRunAuthor | undefined,
): Effect.Effect<JsonValue, ShowTargetError> {
  return Effect.gen(function* () {
    const decoded = yield* invokeAuthorCallback(page.id, "params-decode", runAuthor, () => page.params.decode(key));
    const params = closePageParams(decoded);
    if (params === undefined) {
      return yield* Effect.fail<ShowTargetError>(Object.freeze({
        code: "report-show-target-parameter-invalid" as const,
        pageId: page.id,
        key,
        reason: "decode-not-json" as const,
      }));
    }
    const encoded = yield* invokeAuthorCallback(page.id, "params-encode", runAuthor, () => page.params.encode(params));
    if (encoded !== key) {
      return yield* Effect.fail<ShowTargetError>(Object.freeze({
        code: "report-show-target-parameter-invalid" as const,
        pageId: page.id,
        key,
        reason: "not-canonical" as const,
      }));
    }
    return params;
  }).pipe(
    Effect.catchAll((error): Effect.Effect<JsonValue, ShowTargetError> => {
      if (error.code !== "report-show-target-callback-failed") return Effect.fail(error);
      return Effect.fail(Object.freeze({
        code: "report-show-target-parameter-invalid" as const,
        pageId: page.id,
        key,
        reason: error.phase === "params-decode" ? "decode-failed" as const : "encode-failed" as const,
      }));
    }),
  );
}

function plainSelection(page: ShowTargetPlainPage): SelectedPlainTarget {
  return Object.freeze({
    kind: "plain" as const,
    page,
    context: pageContext(page),
    target: Object.freeze({ pageId: page.id, route: page.path }),
  });
}

function pageContext(page: ShowTargetPage, params?: JsonValue): ShowTargetPageContext {
  return Object.freeze({
    id: page.id,
    path: page.path,
    title: page.title,
    ...(params === undefined ? {} : { params }),
  });
}

function createPageLoadContext(
  page: ShowTargetPageContext,
  evidence: PageLoadContext["evidence"],
): PageLoadContext {
  return Object.freeze({ page, evidence });
}

function invokeCloseCallback<Error, Requirements>(
  input: Pick<ExecuteShowTargetInput<Error, Requirements>, "close" | "runAuthor">,
  pageId: string,
  rendered: unknown,
  context: ShowTargetCloseContext,
): Effect.Effect<ResolvedPageOutput, Error | ShowTargetError, Requirements> {
  return Effect.suspend<ResolvedPageOutput, Error | ShowTargetError, Requirements>(() => {
    try {
      return runAuthorCallback(input.runAuthor, () => input.close(rendered, context));
    } catch {
      return Effect.fail(callbackFailed(pageId, "close"));
    }
  });
}

function invokeAuthorCallback<Value>(
  pageId: string,
  phase: Extract<ShowTargetError, { readonly code: "report-show-target-callback-failed" }> ["phase"],
  runAuthor: ShowTargetRunAuthor | undefined,
  callback: () => Value | PromiseLike<Value>,
): Effect.Effect<Value, ShowTargetError> {
  return Effect.tryPromise({
    try: () => new Promise<Value>((resolve) => resolve(runAuthorCallback(runAuthor, callback))),
    catch: (): ShowTargetError => callbackFailed(pageId, phase),
  });
}

function runAuthorCallback<Value>(runAuthor: ShowTargetRunAuthor | undefined, callback: () => Value): Value {
  return runAuthor === undefined ? callback() : runAuthor(callback);
}

function callbackFailed(
  pageId: string,
  phase: Extract<ShowTargetError, { readonly code: "report-show-target-callback-failed" }> ["phase"],
): ShowTargetError {
  return Object.freeze({
    code: "report-show-target-callback-failed" as const,
    pageId,
    phase,
  });
}

function isShowTargetError(value: SelectedShowTarget | ShowTargetError): value is ShowTargetError {
  return "code" in value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Closes decoded JSON before encode/load/render can observe or mutate it. */
function closePageParams(value: unknown, active = new Set<object>()): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || value === null) return undefined;
  if (active.has(value)) return undefined;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: JsonValue[] = [];
      for (const entry of value) {
        const closed = closePageParams(entry, active);
        if (closed === undefined) return undefined;
        entries.push(closed);
      }
      return Object.freeze(entries);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      const closed = closePageParams(descriptor.value, active);
      if (closed === undefined) return undefined;
      result[key] = closed;
    }
    return Object.freeze(Object.fromEntries(Object.entries(result).sort(([left], [right]) => compareUtf8(left, right))));
  } finally {
    active.delete(value);
  }
}
