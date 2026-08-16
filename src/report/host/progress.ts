import { Cause, Clock, Context, Effect, Exit, Option } from "effect";

export type ReportHostPhase =
  | "record-open"
  | "selection"
  | "sample-open"
  | "report-execution";

export type ReportHostPhaseOutcome = "success" | "failure" | "defect" | "interrupted";

export type ReportHostProgressEvent =
  | {
      readonly type: "start";
      readonly phase: ReportHostPhase;
    }
  | {
      readonly type: "end";
      readonly phase: ReportHostPhase;
      readonly outcome: ReportHostPhaseOutcome;
      readonly durationMs: number;
    };

export interface ReportHostProgressObserverService {
  readonly report: (event: ReportHostProgressEvent) => void;
}

const noReportHostProgress: ReportHostProgressObserverService = Object.freeze({ report: () => {} });

/** Package-private observation seam used by the CLI without expanding the public Host SDK. */
export class ReportHostProgressObserver extends Context.Reference<ReportHostProgressObserver>()(
  "@niceeval/report/host/ReportHostProgressObserver",
  { defaultValue: () => noReportHostProgress },
) {}

function reportBestEffort(
  observer: ReportHostProgressObserverService,
  event: ReportHostProgressEvent,
): Effect.Effect<void> {
  return Effect.sync(() => observer.report(event)).pipe(
    Effect.catchAllCause(() => Effect.void),
  );
}

function outcomeOf<E>(exit: Exit.Exit<unknown, E>): ReportHostPhaseOutcome {
  if (Exit.isSuccess(exit)) return "success";
  if (Cause.isInterruptedOnly(exit.cause)) return "interrupted";
  if (Option.isSome(Cause.dieOption(exit.cause))) return "defect";
  return "failure";
}

/** Emits balanced phase events while preserving the original success, typed failure, defect, and interruption. */
export function withReportHostPhase<A, E, R>(
  phase: ReportHostPhase,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const observer = yield* ReportHostProgressObserver;
    const startedAt = yield* Clock.currentTimeNanos;
    yield* reportBestEffort(observer, { type: "start", phase });
    return yield* effect.pipe(
      Effect.onExit((exit) => Effect.gen(function* () {
        const completedAt = yield* Clock.currentTimeNanos;
        const durationMs = Number(completedAt - startedAt) / 1_000_000;
        yield* reportBestEffort(observer, {
          type: "end",
          phase,
          outcome: outcomeOf(exit),
          durationMs: Math.max(0, durationMs),
        });
      })),
    );
  });
}
