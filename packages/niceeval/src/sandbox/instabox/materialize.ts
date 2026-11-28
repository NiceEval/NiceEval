import { sandboxCreationLabels } from "../creation-labels.ts";
import { cloudLifetimeMs } from "../cloud-lifetime.ts";
import { Clock, Effect, Exit, Scope } from "effect";
import { providerBoundaryEffect } from "../backend.ts";
import type { InstaboxProviderPlan } from "../instabox.ts";
import {
  SandboxRuntimeMaterializationError,
  wrapSingleSandbox,
  type SandboxRuntimeMaterializeContext,
} from "../runtime.ts";
import { withProvisionRetry } from "../retry.ts";
import { InstaboxApi, Snapshot } from "./api.ts";
import { InstaboxPreparationError, preparationRequest } from "./provisioning.ts";
import { InstaboxBackend } from "./sandbox.ts";
import { instaboxSnapshotSourceExpirations } from "./snapshot-driver.ts";

export const materializeInstabox = Effect.fn("materializeInstabox")(
  function* (plan: InstaboxProviderPlan, context: SandboxRuntimeMaterializeContext) {
    if (context.admission._tag === "Bound") yield* context.admission.value.granted;
    const deadlineAt = context.deadline._tag === "Bounded" ? context.deadline.deadlineAt : undefined;
    if (
      deadlineAt !== undefined &&
      plan.lifetimeMs !== undefined &&
      plan.lifetimeMs < deadlineAt - Date.now() + 30_000
    ) {
      return yield* Effect.fail(
        new Error("Instabox lifetimeMs must cover the remaining Attempt deadline plus 30 seconds"),
      );
    }
    const lifetimeMs = cloudLifetimeMs(
      plan.lifetimeMs,
      context.deadline._tag === "Bounded" ? context.deadline.timeoutMs : undefined,
    );
    if (lifetimeMs < 60_000 || lifetimeMs > 86_400_000)
      return yield* Effect.fail(new Error("Instabox lifetimeMs must be between 60 seconds and 24 hours"));
    const key = process.env.INSTABOX_API_KEY;
    if (!key) return yield* Effect.fail(new Error("INSTABOX_API_KEY is required for Instabox"));
    const api = new InstaboxApi(key);
    const owner = yield* Effect.scope;
    const facts = plan.source._tag === "Snapshot" ? { snapshotId: plan.source.id } : { templateId: plan.source.id };
    const labels = sandboxCreationLabels({ ...context, evalId: context.creationEvalId ?? context.evalId });
    let cleanupUnconfirmed = false;
    const create = Effect.gen(function* () {
      if (plan.source._tag === "Snapshot") {
        const id = plan.source.id;
        const snapshot = yield* preparationRequest("snapshot lookup", (signal) =>
          api.json(Snapshot, `/snapshots/${encodeURIComponent(id)}`, { signal }),
        );
        if (snapshot.id !== id || snapshot.status !== "ready")
          return yield* Effect.fail(new Error("Instabox snapshot must match the configured ID and be ready"));
      }
      // Use the allocation start so the budget includes provisioning and inherited staging time.
      const expiresAt = (yield* Clock.currentTimeMillis) + lifetimeMs;
      return yield* Effect.acquireUseRelease(
        providerBoundaryEffect(() =>
          InstaboxBackend.create(
            api,
            { ...plan, lifetimeMs },
            deadlineAt,
            context.runId,
            context.feedback.diagnostic,
            labels,
          ),
        ),
        (backend) =>
          Effect.gen(function* () {
            yield* backend.initialize();
            return yield* Effect.acquireRelease(
              Effect.sync(() => {
                const sandbox = wrapSingleSandbox(backend, context, facts);
                instaboxSnapshotSourceExpirations.set(sandbox.group, expiresAt);
                return sandbox;
              }),
              (materialized) => providerBoundaryEffect(() => materialized.group.stop()).pipe(Effect.orDie),
            ).pipe(Scope.provide(owner));
          }),
        (backend, exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : providerBoundaryEffect(() => backend.stop()).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    cleanupUnconfirmed = true;
                    context.feedback.diagnostic({
                      code: "sandbox-provision-reconcile-failed",
                      level: "warning",
                      message: `Instabox Machine cleanup could not be confirmed: ${error.message}; the declared deletion deadline bounds the Machine`,
                    });
                  }),
                ),
              ),
      );
    });
    const provision = withProvisionRetry(
      create,
      (cause) => (!cleanupUnconfirmed && cause instanceof InstaboxPreparationError ? cause.kind : "unknown"),
      context.provisionSlot._tag === "Bound" ? context.provisionSlot.value : undefined,
      context.feedback,
      // Failed initialization has already awaited deletion. An unresolved allocation
      // has no retryable preparation error and cannot acquire a second Machine.
      Effect.void,
    );
    const limit = Math.min(lifetimeMs, (deadlineAt ?? Infinity) - Date.now());
    if (limit <= 0) return yield* Effect.fail(new DOMException("Instabox creation timed out", "TimeoutError"));
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(limit)]);
    const aborted = Effect.callback<never, Error>((resume) => {
      const stop = () =>
        resume(Effect.fail(signal.reason instanceof Error ? signal.reason : new Error("Instabox creation cancelled")));
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
      return Effect.sync(() => signal.removeEventListener("abort", stop));
    });
    if (signal.aborted) return yield* aborted;
    return yield* Effect.raceFirst(Effect.interruptible(provision), aborted);
  },
  Effect.mapError((failure) => {
    const cause = failure instanceof Error ? failure : new Error(String(failure));
    return new SandboxRuntimeMaterializationError({
      code: "sandbox.materialization-failed",
      provider: "instabox",
      message: cause.message,
      cause,
    });
  }),
);
