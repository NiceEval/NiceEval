import { sandboxCreationLabels } from "../creation-labels.ts";
import { cloudLifetimeMs } from "../cloud-lifetime.ts";
import { Effect } from "effect";
import { providerBoundaryEffect } from "../backend.ts";
import type { OpenSandboxOptions } from "../opensandbox.ts";
import {
  SandboxRuntimeMaterializationError,
  wrapSingleSandbox,
  type SandboxRuntimeMaterializeContext,
} from "../runtime.ts";
import { OpenSandboxBackend } from "./sandbox.ts";

export function materializeOpenSandbox(
  plan: OpenSandboxOptions,
  context: SandboxRuntimeMaterializeContext,
  snapshotId?: string,
) {
  return Effect.gen(function* () {
    if (context.admission._tag === "Bound") yield* context.admission.value.granted;
    const deadlineAt = context.deadline._tag === "Bounded" ? context.deadline.deadlineAt : undefined;
    if (
      deadlineAt !== undefined &&
      plan.lifetimeMs !== undefined &&
      plan.lifetimeMs < deadlineAt - Date.now() + 30_000
    ) {
      return yield* Effect.fail(
        new Error("OpenSandbox lifetimeMs must cover the remaining Attempt deadline plus 30 seconds"),
      );
    }
    const backend = yield* Effect.acquireRelease(
      providerBoundaryEffect(() =>
        OpenSandboxBackend.create(
          {
            ...plan,
            lifetimeMs: cloudLifetimeMs(
              plan.lifetimeMs,
              context.deadline._tag === "Bounded" ? context.deadline.timeoutMs : undefined,
            ),
          },
          deadlineAt,
          snapshotId,
          context.runId,
          sandboxCreationLabels({ ...context, evalId: context.creationEvalId ?? context.evalId }),
        ),
      ),
      (backend) => providerBoundaryEffect(() => backend.stop()).pipe(Effect.orDie),
    );
    const materialized = wrapSingleSandbox(backend, context, { image: plan.image });
    yield* Effect.addFinalizer(() => providerBoundaryEffect(() => materialized.group.stop()).pipe(Effect.orDie));
    yield* providerBoundaryEffect((signal) => backend.initialize(signal));
    return materialized;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SandboxRuntimeMaterializationError({
          code: "sandbox.materialization-failed",
          provider: "opensandbox",
          message: cause.message,
          cause,
        }),
    ),
  );
}
