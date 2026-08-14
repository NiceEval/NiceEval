import { Effect, Ref } from "effect";
import type * as Scope from "effect/Scope";
import type { ReportExecution } from "../execution/model.ts";
import { basalt, isThemeDefinition, type ThemeDefinition } from "./theme.ts";

export interface ReportViewRevision {
  readonly revision: number;
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
  | ReportViewExecutionRebuild
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

type SessionCell =
  | { readonly state: "open"; readonly value: ReportViewState }
  | { readonly state: "closed" };

const closedError: ReportViewSessionClosed = Object.freeze({
  code: "report-view-session-closed",
});

/**
 * Builds the immutable-revision state machine used by a Node watcher/server.
 * A successful refresh atomically publishes a new fixed execution and the next
 * recoverable watch set; a typed failed refresh only updates the bounded
 * last-good problem and leaves the prior watch set intact. Defects and
 * interruption intentionally remain in the Effect cause and do not masquerade
 * as a recoverable rebuild result.
 */
export function openReportViewSession<Requirements>(
  input: OpenReportViewSessionInput<Requirements>,
): Effect.Effect<ReportViewSession<Requirements>, ReportViewOpenError, Scope.Scope | Requirements> {
  return Effect.gen(function* () {
    const initial = yield* input.initial;
    const initialState: ReportViewState = Object.freeze({
      current: revision(0, initial, input.theme ?? basalt, freezeWatchInputs(input.watchInputs)),
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
              current: revisionFromRebuild(before.value.current, rebuilt),
            });
            return Ref.set(cell, Object.freeze({ state: "open", value: next }));
          }),
          Effect.catchAll((failure) => {
            // Keep last-good execution, theme, and recoverable watch set.
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

function revision(
  revisionNumber: number,
  execution: ReportExecution,
  theme: ThemeDefinition,
  watchInputs: readonly string[],
): ReportViewRevision {
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

function revisionFromRebuild(
  previous: ReportViewRevision,
  rebuilt: ReportViewRebuild,
): ReportViewRevision {
  if (rebuilt.kind === "execution") {
    return revision(
      previous.revision + 1,
      rebuilt.execution,
      rebuilt.theme ?? previous.theme,
      rebuilt.watchInputs ?? previous.watchInputs,
    );
  }
  return revision(
    previous.revision + 1,
    previous.execution,
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
