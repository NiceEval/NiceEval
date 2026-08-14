/**
 * Public Record and Host-composition surface. `recordHost` is also exported
 * from `niceeval/record/host`; fixed definitions, generic attachment
 * capabilities, and migration factories remain package-private.
 */
export { recordHost } from "./host/index.ts";
export type { RecordHostSDK } from "./host/index.ts";

export {
  cleanIncompleteRuns,
  incompleteRunWarnings,
  inspectIncompleteRuns,
  inspectIncompleteRunWarnings,
} from "./maintenance/index.ts";
export type {
  RecordCleanReceipt,
  RecordIncompleteRun,
} from "./maintenance/index.ts";

export { RunIdSchema } from "./codec/identifiers.ts";
export type { AttemptId } from "./model/identifiers.ts";

export { NodeRecordLive } from "./platform/node.ts";
export { makeRecordRoot } from "./platform/root.ts";
export type {
  RecordRoot,
  RecordRootConstructionError,
  RecordRootInput,
} from "./platform/root.ts";
