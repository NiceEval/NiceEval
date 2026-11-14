import { sandboxCreationLabels } from "../creation-labels.ts";
import { cloudLifetimeMs } from "../cloud-lifetime.ts";
import { Effect } from "effect";
import { providerBoundaryEffect } from "../backend.ts";
import type { InstaboxSandboxOptions } from "../instabox.ts";
import { SandboxRuntimeMaterializationError, wrapSingleSandbox, type SandboxRuntimeMaterializeContext } from "../runtime.ts";
import { InstaboxBackend } from "./sandbox.ts";

export const materializeInstabox = Effect.fn("materializeInstabox")(function*(plan: InstaboxSandboxOptions, context: SandboxRuntimeMaterializeContext) {
  if (context.admission._tag === "Bound") yield* context.admission.value.granted;
  const deadlineAt = context.deadline._tag === "Bounded" ? context.deadline.deadlineAt : undefined;
  if (deadlineAt !== undefined && plan.lifetimeMs !== undefined && plan.lifetimeMs < deadlineAt - Date.now() + 30_000) {
    return yield* Effect.fail(new Error("Instabox lifetimeMs must cover the remaining Attempt deadline plus 30 seconds"));
  }
  const backend = yield* Effect.acquireRelease(
    providerBoundaryEffect(() => InstaboxBackend.create({ ...plan, lifetimeMs: cloudLifetimeMs(plan.lifetimeMs, context.deadline._tag === "Bounded" ? context.deadline.timeoutMs : undefined) }, deadlineAt, context.runId, context.feedback.diagnostic, sandboxCreationLabels({ ...context, evalId: context.creationEvalId ?? context.evalId }))),
    (backend) => providerBoundaryEffect(() => backend.stop()).pipe(Effect.orDie),
  );
  const materialized = wrapSingleSandbox(backend, context, plan.snapshotId !== undefined
    ? { snapshotId: plan.snapshotId }
    : { templateId: plan.templateId ?? plan.template ?? "universal" });
  yield* Effect.addFinalizer(() => providerBoundaryEffect(() => materialized.group.stop()).pipe(Effect.orDie));
  yield* providerBoundaryEffect((signal) => backend.initialize(signal));
  return materialized;
}, Effect.mapError((cause) => new SandboxRuntimeMaterializationError({
  code: "sandbox.materialization-failed", provider: "instabox", message: cause.message, cause,
})));
