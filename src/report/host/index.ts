// This is the current-process host boundary. A future ./node host may own
// loaders, watchers, and filesystem services, but it must consume the fixed
// ReportExecution produced here instead of reopening a Sample or Record.
export { executeReport } from "./execute.ts";
export type {
  ReportDefinitionInvalid,
  ReportExecutionError,
} from "./execute.ts";
export type { ReportExecution } from "../execution/model.ts";
