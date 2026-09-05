/** Public Node composition edge for the high-level Run lifecycle Host. SQLite and writer capabilities stay internal. */
import { Effect } from "effect";
import { ProjectStateDatabaseLive } from "../../record/sqlite/project-state-database.ts";
import { rawRunHost } from "./runtime.ts";
import type { RunHost } from "./types.ts";

const list: RunHost["list"] = (request) => Effect.suspend(() => rawRunHost.list(request)).pipe(
  Effect.provide(ProjectStateDatabaseLive, { local: true }),
);
const get: RunHost["get"] = (request) => Effect.suspend(() => rawRunHost.get(request)).pipe(
  Effect.provide(ProjectStateDatabaseLive, { local: true }),
);
const deleteRun: RunHost["delete"] = (request) => Effect.suspend(() => rawRunHost.delete(request)).pipe(
  Effect.provide(ProjectStateDatabaseLive, { local: true }),
);
const recover: RunHost["recover"] = (request) => Effect.suspend(() => rawRunHost.recover(request)).pipe(
  Effect.provide(ProjectStateDatabaseLive, { local: true }),
);

export const runHost: RunHost = Object.freeze({
  list,
  get,
  delete: deleteRun,
  recover,
});
export {
  RunDeleteError,
  RunReadError,
  RunRecoverError,
  type RunDeleteReceipt,
  type RunDeleteRequest,
  type RunGetRequest,
  type RunHost,
  type RunDetail,
  type RunListRequest,
  type RunListResult,
  type RunSlot,
  type RunState,
  type RunSummary,
  type RunRecoverReceipt,
  type RunRecoverRequest,
  type RunResult,
} from "./types.ts";
