import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref } from "effect";
import type * as Scope from "effect/Scope";
import type { ClosedSiteRevision } from "../execution/model.ts";

/** One immutable byte-complete site published by the live transport. */
export interface ReportViewRevision {
  readonly revision: number;
  readonly site: ClosedSiteRevision;
  /** The successful candidate's next recoverable watcher closure. */
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

/** A successful candidate always contains a new SSG-complete revision. */
export interface ReportViewSiteRebuild {
  readonly kind: "site";
  readonly site: ClosedSiteRevision;
  /** Omit to keep the prior recoverable set after a host-only rebuild. */
  readonly watchInputs?: readonly string[];
}

/** Backward-compatible name for the one supported rebuild shape. */
export type ReportViewExecutionRebuild = ReportViewSiteRebuild;
export type ReportViewRebuild = ReportViewSiteRebuild;

export interface ReportViewSession<Requirements = never> {
  readonly url: string;
  readonly snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed>;
  /**
   * Records a new user/watch intent and starts its candidate immediately.
   * A later intent interrupts or abandons any earlier candidate; callers do
   * not wait for author callbacks before the latest intent is registered.
   */
  readonly refresh: Effect.Effect<ReportViewRefreshIntent, ReportViewSessionClosed, Requirements>;
}

export type ReportViewPublicationOutcome =
  | { readonly state: "published"; readonly revision: ReportViewRevision }
  | { readonly state: "failed" }
  | { readonly state: "superseded" }
  | { readonly state: "interrupted" };

/** A registered intent returns promptly; its outcome completes exactly once. */
export interface ReportViewRefreshIntent {
  readonly token: number;
  readonly outcome: Effect.Effect<ReportViewPublicationOutcome>;
}

export interface OpenReportViewSessionInput<Requirements = never> {
  readonly url: string;
  readonly watchInputs?: readonly string[];
  /** The opening revision is already a complete byte map. */
  readonly initial: Effect.Effect<ClosedSiteRevision, ReportViewOpenError, Requirements>;
  /** Each invocation captures one complete Sample/Report/Theme intent. */
  readonly rebuild: () => Effect.Effect<ReportViewRebuild, ReportViewRebuildFailure, Requirements>;
}

type SessionCell =
  | { readonly state: "open"; readonly value: ReportViewState }
  | { readonly state: "closed" };

const closedError: ReportViewSessionClosed = Object.freeze({
  code: "report-view-session-closed",
});

/**
 * Latest-intent-wins state machine. A candidate has no authority to publish
 * until it proves that its intent token is still current while holding the
 * small publication mutex. Failed, superseded, and interrupted candidates
 * retain the last-good revision and its watcher closure.
 */
export function openReportViewSession<Requirements>(
  input: OpenReportViewSessionInput<Requirements>,
): Effect.Effect<ReportViewSession<Requirements>, ReportViewOpenError, Scope.Scope | Requirements> {
  return Effect.gen(function* () {
    const sessionScope = yield* Effect.scope;
    const initial = yield* input.initial;
    const cell = yield* Ref.make<SessionCell>(Object.freeze({
      state: "open",
      value: Object.freeze({
        current: makeRevision(0, initial, freezeWatchInputs(input.watchInputs)),
      }),
    }));
    const intent = yield* Ref.make(0);
    const active = yield* Ref.make<ActiveCandidate | undefined>(undefined);
    const mutex = yield* Effect.makeSemaphore(1);

    const snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed> = Effect.flatMap(
      Ref.get(cell),
      (current) => current.state === "open"
        ? Effect.succeed(current.value)
        : Effect.fail(closedError),
    );

    const refresh: Effect.Effect<ReportViewRefreshIntent, ReportViewSessionClosed, Requirements> = mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(cell);
        if (current.state === "closed") return yield* Effect.fail(closedError);
        const nextIntent = yield* Ref.updateAndGet(intent, (value) => value + 1);
        const prior = yield* Ref.get(active);
        // Do not wait for arbitrary author Promise cleanup. The token below
        // still prevents a late completion from publishing if interruption is
        // not observed by an external callback.
        if (prior !== undefined) {
          yield* Deferred.succeed(prior.outcome, Object.freeze({ state: "superseded" as const }));
          yield* Fiber.interruptFork(prior.fiber);
        }
        const outcome = yield* Deferred.make<ReportViewPublicationOutcome>();
        const candidate = yield* Effect.forkIn(
          closeCandidate({ input, cell, intent, mutex, token: nextIntent, outcome }),
          sessionScope,
        );
        yield* Ref.set(active, Object.freeze({ token: nextIntent, fiber: candidate, outcome }));
        return Object.freeze({ token: nextIntent, outcome });
      }),
    );

    const session: ReportViewSession<Requirements> = Object.freeze({ url: input.url, snapshot, refresh });
    return yield* Effect.acquireRelease(
      Effect.succeed(session),
      () => mutex.withPermits(1)(Effect.gen(function* () {
        const prior = yield* Ref.get(active);
        if (prior !== undefined) {
          yield* Deferred.succeed(prior.outcome, Object.freeze({ state: "interrupted" as const }));
          yield* Fiber.interruptFork(prior.fiber);
        }
        yield* Ref.set(cell, Object.freeze({ state: "closed" }));
      })),
    );
  });
}

function closeCandidate<Requirements>(input: {
  readonly input: OpenReportViewSessionInput<Requirements>;
  readonly cell: Ref.Ref<SessionCell>;
  readonly intent: Ref.Ref<number>;
  readonly mutex: Effect.Semaphore;
  readonly token: number;
  readonly outcome: Deferred.Deferred<ReportViewPublicationOutcome>;
}): Effect.Effect<void, never, Requirements> {
  return Effect.exit(input.input.rebuild()).pipe(
    Effect.flatMap((exit) => input.mutex.withPermits(1)(
      publishCandidate({ ...input, exit }),
    )),
  );
}

function publishCandidate<Requirements>(input: {
  readonly cell: Ref.Ref<SessionCell>;
  readonly intent: Ref.Ref<number>;
  readonly token: number;
  readonly exit: Exit.Exit<ReportViewRebuild, ReportViewRebuildFailure>;
  readonly outcome: Deferred.Deferred<ReportViewPublicationOutcome>;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const currentIntent = yield* Ref.get(input.intent);
    const current = yield* Ref.get(input.cell);
    if (current.state === "closed" || currentIntent !== input.token) {
      return yield* Deferred.succeed(input.outcome, Object.freeze({ state: "superseded" as const }));
    }
    if (Exit.isSuccess(input.exit)) {
      const revision = makeRevision(
          current.value.current.revision + 1,
          input.exit.value.site,
          input.exit.value.watchInputs ?? current.value.current.watchInputs,
        );
      const next: ReportViewState = Object.freeze({ current: revision });
      yield* Ref.set(input.cell, Object.freeze({ state: "open", value: next }));
      return yield* Deferred.succeed(input.outcome, Object.freeze({ state: "published" as const, revision }));
    }
    // Intentional cancellation has no user-visible error. A typed failure or
    // defect merely annotates last-good; neither can replace its bytes/watch set.
    if (Cause.isInterruptedOnly(input.exit.cause)) {
      return yield* Deferred.succeed(input.outcome, Object.freeze({ state: "interrupted" as const }));
    }
    const typed = Option.getOrUndefined(Cause.failureOption(input.exit.cause));
    const next: ReportViewState = Object.freeze({
      current: current.value.current,
      lastProblem: boundedProblem(typed ?? { summary: "Report rebuild failed" }),
    });
    yield* Ref.set(input.cell, Object.freeze({ state: "open", value: next }));
    return yield* Deferred.succeed(input.outcome, Object.freeze({ state: "failed" as const }));
  });
}

interface ActiveCandidate {
  readonly token: number;
  readonly fiber: Fiber.RuntimeFiber<void, never>;
  readonly outcome: Deferred.Deferred<ReportViewPublicationOutcome>;
}

function makeRevision(
  revision: number,
  site: ClosedSiteRevision,
  watchInputs: readonly string[],
): ReportViewRevision {
  return Object.freeze({ revision, site, watchInputs: freezeWatchInputs(watchInputs) });
}

function freezeWatchInputs(inputs: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(inputs ?? [])]);
}

function boundedProblem(failure: ReportViewRebuildFailure): ReportViewProblem {
  const normalized = failure.summary.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 1_024);
  return Object.freeze({ summary: normalized || "Report rebuild failed" });
}
