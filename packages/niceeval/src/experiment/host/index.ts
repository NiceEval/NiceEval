/** Node composition edge. Internal services and their resource scopes stay private. */
import { Effect } from "effect";
import { NodeRecordLive } from "../../record/platform/node.ts";
import { rawExperimentHost } from "./runtime.ts";
import type { ExperimentHostHighLevelSDK } from "./types.ts";
import type { ExperimentHostRequirements } from "./requirements.ts";

const withNode = <Input, Output, Error>(
  operation: (input: Input) => Effect.Effect<Output, Error, ExperimentHostRequirements>,
): ((input: Input) => Effect.Effect<Output, Error>) => (input) =>
  Effect.suspend(() => operation(input)).pipe(Effect.provide(NodeRecordLive, { local: true }));

/** Composes supported Experiment operations plus debug planning; use the Host operations rather than assembling internal Runner state. */
export interface ExperimentHostSDK extends ExperimentHostHighLevelSDK {
  readonly debug: typeof rawExperimentHost.debug;
}

/** Every execution owns its Node resources; interruption retains the caller's Cause. */
export const experimentHost: ExperimentHostSDK = Object.freeze({
  catalog: withNode(rawExperimentHost.catalog),
  check: withNode(rawExperimentHost.check),
  invocation: Object.freeze({ plan: withNode(rawExperimentHost.invocation.plan), run: withNode(rawExperimentHost.invocation.run) }),
  invocationStatus: Object.freeze({ list: withNode(rawExperimentHost.invocationStatus.list), show: withNode(rawExperimentHost.invocationStatus.show) }),
  rename: Object.freeze({ plan: withNode(rawExperimentHost.rename.plan), apply: withNode(rawExperimentHost.rename.apply) }),
  after: Object.freeze({ inspect: withNode(rawExperimentHost.after.inspect), run: withNode(rawExperimentHost.after.run) }),
  debug: rawExperimentHost.debug,
  accept: withNode(rawExperimentHost.accept),
  acceptRun: Object.freeze({ plan: withNode(rawExperimentHost.acceptRun.plan), apply: withNode(rawExperimentHost.acceptRun.apply) }),
});
export type { ExperimentHostDebugPlanRequest, ExperimentHostDebugPlan, ExperimentHostDebugPlanResult } from "./runtime.ts";
export * from "./types.ts";
export {
  decodeDebugPlanDocument,
  DebugPlanDocumentSchema,
  type DebugPlanDocument,
} from "./cli/debug-protocol.ts";
export {
  decodeSessionListDocument,
  decodeSessionShowDocument,
  SessionListDocumentSchema,
  SessionShowDocumentSchema,
} from "./cli/session-protocol.ts";
export { decodeExecutionComparisons, decodeExpPlanDocument, ExpPlanDocumentSchema, type ExpPlanDocument } from "./cli/plan-protocol.ts";
export {
  decodeExpTerminalEvent,
  decodeExpProgressEvent,
  type ExpProgressEvent,
  ExpDiagnosticEventSchema,
  type ExpDiagnosticEvent,
  ExpInvocationReceiptSchema,
  ExpTerminalEventSchema,
  ExpTerminalSummarySchema,
  type ExpInvocationReceipt,
  type ExpTerminalEvent,
  type ExpTerminalSummary,
} from "./cli/output-protocol.ts";
