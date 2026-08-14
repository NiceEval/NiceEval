import { Effect, Ref } from "effect";
import type * as Scope from "effect/Scope";
import { isReportExecution, type ReportExecution } from "../execution/model.ts";
import { basalt, isThemeDefinition, type ThemeDefinition } from "./theme.ts";
import {
  isViewRevisionClosure,
  type ViewRevisionClosure,
} from "./view-closure.ts";

/**
 * A fixed view revision. The legacy single-execution session publishes
 * revisions without a closure (`closure` omitted); the bilingual closure
 * session always publishes the validated en + zh-CN pair and keeps the
 * English execution as a read-only alias.
 */
export interface ReportViewRevision {
  readonly revision: number;
  /**
   * The validated bilingual closure this revision atomically owns. Omitted
   * for legacy single-execution revisions, which serve English only.
   */
  readonly closure?: ViewRevisionClosure;
  /**
   * The fixed English execution of this revision. Closure revisions expose
   * it as a read-only alias; production view paths must read the closure.
   */
  readonly execution: ReportExecution;
  /** Theme snapshot for this view revision; it never becomes Report author data. */
  readonly theme: ThemeDefinition;
  /**
   * Recoverable Node watch set published with this revision. `fs.watch` is only
   * a hint; the next rebuild re-reads its own loader closure. Failure keeps the
   * last-good set so the entry (and prior static edges) remain recoverable.
   */
  readonly watchInputs: readonly string[];
}

export interface ReportViewProblem {
  readonly summary: string;
}

export interface ReportViewState {
  readonly current: ReportViewRevision;
  readonly lastProblem?: ReportViewProblem;
}

export interface ReportViewSessionClosed {
  readonly code: "report-view-session-closed";
}

export interface ReportViewOpenError {
  readonly code: "report-view-open-failed";
  readonly reason: string;
}

/** A rebuild failure is deliberately bounded before it becomes visible in a view. */
export interface ReportViewRebuildFailure {
  readonly summary: string;
}

/** A successful rebuild that also replaced the fixed ReportExecution. */
export interface ReportViewExecutionRebuild {
  readonly kind: "execution";
  readonly execution: ReportExecution;
  /** Omit when the previous Theme source snapshot remains current. */
  readonly theme?: ThemeDefinition;
  /**
   * On success, atomically replaces the next-round watch set. Omit to keep the
   * last-good recoverable set (at least the prior entry edges).
   */
  readonly watchInputs?: readonly string[];
}

/** A Theme-only rebuild keeps the exact immutable execution and changes presentation only. */
export interface ReportViewThemeRebuild {
  readonly kind: "theme-only";
  readonly theme: ThemeDefinition;
  /** Same atomic watch-set rule as an execution rebuild. */
  readonly watchInputs?: readonly string[];
}

export type ReportViewRebuild =
  | ReportExecution
  | ReportViewExecutionRebuild
  | ReportViewThemeRebuild;

/** A successful bilingual rebuild that also replaced the fixed closure. */
export interface ReportViewClosureRebuild {
  readonly kind: "execution";
  readonly closure: ViewRevisionClosure;
  /** Omit when the previous Theme source snapshot remains current. */
  readonly theme?: ThemeDefinition;
  /** Same atomic watch-set rule as an execution rebuild. */
  readonly watchInputs?: readonly string[];
}

export type ReportViewClosureRebuildResult =
  | ReportViewClosureRebuild
  | ReportViewThemeRebuild;

export interface ReportViewSession<Requirements = never> {
  readonly url: string;
  readonly snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed>;
  readonly refresh: Effect.Effect<void, ReportViewSessionClosed, Requirements>;
}

export interface OpenReportViewSessionInput<Requirements = never> {
  readonly url: string;
  /** The initial Theme source snapshot; basalt is the host default. */
  readonly theme?: ThemeDefinition;
  /**
   * Initial recoverable watch set for the opening revision. A successful
   * rebuild may replace it atomically with the next loader closure.
   */
  readonly watchInputs?: readonly string[];
  /** The opening execution must be complete; no last-good revision exists yet. */
  readonly initial: Effect.Effect<ReportExecution, ReportViewOpenError, Requirements>;
  /** Each invocation publishes a new execution or a Theme-only revision. */
  readonly rebuild: () => Effect.Effect<ReportViewRebuild, ReportViewRebuildFailure, Requirements>;
}

export interface OpenReportViewClosureSessionInput<Requirements = never> {
  readonly url: string;
  /** The initial Theme source snapshot; basalt is the host default. */
  readonly theme?: ThemeDefinition;
  /**
   * Initial recoverable watch set for the opening revision. A successful
   * rebuild may replace it atomically with the next loader closure.
   */
  readonly watchInputs?: readonly string[];
  /**
   * The opening closure must already be validated and complete; no last-good
   * revision exists yet. A session never re-opens a Record or re-runs author
   * code for this input, and it never fabricates a closure from one
   * execution.
   */
  readonly initial: Effect.Effect<ViewRevisionClosure, ReportViewOpenError, Requirements>;
  /** Each invocation publishes a new closure or a Theme-only revision. */
  readonly rebuild: () => Effect.Effect<ReportViewClosureRebuildResult, ReportViewRebuildFailure, Requirements>;
}

type SessionCell =
  | { readonly state: "open"; readonly value: ReportViewState }
  | { readonly state: "closed" };

const closedError: ReportViewSessionClosed = Object.freeze({
  code: "report-view-session-closed",
});

/**
 * Builds the immutable-revision state machine used by a Node watcher/server
 * over a single fixed ReportExecution. A successful refresh atomically
 * publishes a new fixed execution and the next recoverable watch set; a typed
 * failed refresh only updates the bounded last-good problem and leaves the
 * prior watch set intact. Defects and interruption intentionally remain in
 * the Effect cause and do not masquerade as a recoverable rebuild result.
 */
export function openReportViewSession<Requirements>(
  input: OpenReportViewSessionInput<Requirements>,
): Effect.Effect<ReportViewSession<Requirements>, ReportViewOpenError, Scope.Scope | Requirements> {
  return openSession({
    url: input.url,
    theme: input.theme,
    watchInputs: input.watchInputs,
    initial: input.initial,
    rebuild: input.rebuild,
    initialState: (execution, theme, watchInputs) =>
      executionRevision(0, execution, theme, watchInputs),
    nextRevision: (previous, rebuilt) =>
      executionRevisionFromRebuild(previous, rebuilt),
  });
}

/**
 * The bilingual session used by `niceeval view`. Each published revision
 * atomically owns the validated en + zh-CN closure produced from one frozen
 * build input set; a failed rebuild keeps the entire last-good revision
 * (closure, theme, and recoverable watch set) and only replaces the bounded
 * problem. Theme-only rebuilds reuse the exact closure.
 */
export function openReportViewClosureSession<Requirements>(
  input: OpenReportViewClosureSessionInput<Requirements>,
): Effect.Effect<ReportViewSession<Requirements>, ReportViewOpenError, Scope.Scope | Requirements> {
  return openSession({
    url: input.url,
    theme: input.theme,
    watchInputs: input.watchInputs,
    initial: input.initial,
    rebuild: input.rebuild,
    initialState: (closure, theme, watchInputs) =>
      closureRevision(0, closure, theme, watchInputs),
    nextRevision: (previous, rebuilt) =>
      closureRevisionFromRebuild(previous, rebuilt),
  });
}

function openSession<Requirements, Seed, Rebuilt>(input: {
  readonly url: string;
  readonly theme?: ThemeDefinition;
  readonly watchInputs?: readonly string[];
  readonly initial: Effect.Effect<Seed, ReportViewOpenError, Requirements>;
  readonly rebuild: () => Effect.Effect<Rebuilt, ReportViewRebuildFailure, Requirements>;
  readonly initialState: (
    seed: Seed,
    theme: ThemeDefinition,
    watchInputs: readonly string[],
  ) => ReportViewRevision;
  readonly nextRevision: (
    previous: ReportViewRevision,
    rebuilt: Rebuilt,
  ) => ReportViewRevision;
}): Effect.Effect<ReportViewSession<Requirements>, ReportViewOpenError, Scope.Scope | Requirements> {
  return Effect.gen(function* () {
    const initial = yield* input.initial;
    const initialState: ReportViewState = Object.freeze({
      current: input.initialState(initial, input.theme ?? basalt, freezeWatchInputs(input.watchInputs)),
    });
    const cell = yield* Ref.make<SessionCell>(Object.freeze({ state: "open", value: initialState }));
    const mutex = yield* Effect.makeSemaphore(1);

    const snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed> = Effect.flatMap(
      Ref.get(cell),
      (current) => current.state === "open"
        ? Effect.succeed(current.value)
        : Effect.fail(closedError),
    );

    const refresh: Effect.Effect<void, ReportViewSessionClosed, Requirements> = mutex.withPermits(1)(
      Effect.flatMap(Ref.get(cell), (before) => {
        if (before.state === "closed") return Effect.fail(closedError);
        return input.rebuild().pipe(
          Effect.flatMap((rebuilt) => {
            const next: ReportViewState = Object.freeze({
              current: input.nextRevision(before.value.current, rebuilt),
            });
            return Ref.set(cell, Object.freeze({ state: "open", value: next }));
          }),
          Effect.catchAll((failure) => {
            // Keep last-good revision (execution/closure, theme, and
            // recoverable watch set) untouched.
            const next: ReportViewState = Object.freeze({
              current: before.value.current,
              lastProblem: boundedProblem(failure),
            });
            return Ref.set(cell, Object.freeze({ state: "open", value: next }));
          }),
        );
      }),
    );

    const session: ReportViewSession<Requirements> = Object.freeze({ url: input.url, snapshot, refresh });
    return yield* Effect.acquireRelease(
      Effect.succeed(session),
      // Closing participates in the same critical section as refresh. Without
      // this, a refresh could observe `open`, the enclosing Scope could close,
      // and the refresh could publish a new open value after the finalizer.
      () => mutex.withPermits(1)(Ref.set(cell, Object.freeze({ state: "closed" }))),
    );
  });
}

function executionRevision(
  revisionNumber: number,
  execution: ReportExecution,
  theme: ThemeDefinition,
  watchInputs: readonly string[],
): ReportViewRevision {
  if (!isReportExecution(execution)) {
    throw new TypeError("a Report view revision requires a completed ReportExecution");
  }
  if (!isThemeDefinition(theme)) {
    throw new TypeError("a Report view revision requires a ThemeDefinition from defineTheme");
  }
  return Object.freeze({
    revision: revisionNumber,
    execution,
    theme,
    watchInputs: freezeWatchInputs(watchInputs),
  });
}

function executionRevisionFromRebuild(
  previous: ReportViewRevision,
  rebuilt: ReportViewRebuild,
): ReportViewRevision {
  if (isReportExecution(rebuilt)) {
    // Legacy bare execution rebuilds keep the prior recoverable watch set.
    return executionRevision(previous.revision + 1, rebuilt, previous.theme, previous.watchInputs);
  }
  if (rebuilt.kind === "execution") {
    return executionRevision(
      previous.revision + 1,
      rebuilt.execution,
      rebuilt.theme ?? previous.theme,
      rebuilt.watchInputs ?? previous.watchInputs,
    );
  }
  return executionRevision(
    previous.revision + 1,
    previous.execution,
    rebuilt.theme,
    rebuilt.watchInputs ?? previous.watchInputs,
  );
}

function closureRevision(
  revisionNumber: number,
  closure: ViewRevisionClosure,
  theme: ThemeDefinition,
  watchInputs: readonly string[],
): ReportViewRevision {
  if (!isViewRevisionClosure(closure)) {
    throw new TypeError("a Report view revision requires a validated ViewRevisionClosure");
  }
  if (!isThemeDefinition(theme)) {
    throw new TypeError("a Report view revision requires a ThemeDefinition from defineTheme");
  }
  return Object.freeze({
    revision: revisionNumber,
    closure,
    execution: closure.en,
    theme,
    watchInputs: freezeWatchInputs(watchInputs),
  });
}

function closureRevisionFromRebuild(
  previous: ReportViewRevision,
  rebuilt: ReportViewClosureRebuildResult,
): ReportViewRevision {
  const previousClosure = previous.closure;
  if (previousClosure === undefined) {
    throw new TypeError("a closure session lost the last-good closure");
  }
  if (rebuilt.kind === "execution") {
    return closureRevision(
      previous.revision + 1,
      rebuilt.closure,
      rebuilt.theme ?? previous.theme,
      rebuilt.watchInputs ?? previous.watchInputs,
    );
  }
  // Theme-only: the exact validated closure (both locale executions) is
  // reused untouched; only presentation and the optional watch set change.
  return closureRevision(
    previous.revision + 1,
    previousClosure,
    rebuilt.theme,
    rebuilt.watchInputs ?? previous.watchInputs,
  );
}

function freezeWatchInputs(inputs: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(inputs ?? [])]);
}

function boundedProblem(failure: ReportViewRebuildFailure): ReportViewProblem {
  const normalized = failure.summary.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 1_024);
  return Object.freeze({ summary: normalized || "Report rebuild failed" });
}
