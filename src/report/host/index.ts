import { Effect } from "effect";
import type { AttemptLocator } from "../../attempt-locator.ts";
import type { AnalysisSelectionRequest } from "../../analysis/index.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import { openViewServer } from "../../view/server.ts";
import type { Report } from "../definition.ts";
import type { ClosedSiteRevision, ReportTargetSelection } from "../execution/model.ts";
import {
  executeReportForAttemptFromRecord,
  executeReportFromRecord,
} from "./from-record.ts";
import { showReport } from "./presentation.ts";
import { exportStaticReport } from "./static.ts";
import type { ThemeDefinition } from "./theme.ts";
import {
  openReportViewSession,
} from "./view-session.ts";
import type {
  OpenReportViewSessionInput,
} from "./view-session.ts";

/**
 * Record-backed execution is the public, supported high-level Host entry for
 * the CLI, replacement CLI/Web hosts, and deep integrations. Report authors
 * use `niceeval/report` instead and receive neither readers nor loaders.
 */
export type ReportHostExecuteInput =
  | {
      readonly root: RecordRoot;
      readonly locator: AttemptLocator;
      readonly report?: Report;
      readonly theme?: ThemeDefinition;
      readonly target?: ReportTargetSelection;
    }
  | {
      readonly root: RecordRoot;
      readonly selection: AnalysisSelectionRequest;
      readonly report?: Report;
      readonly theme?: ThemeDefinition;
      readonly target?: ReportTargetSelection;
    };

function execute(input: ReportHostExecuteInput) {
  return "locator" in input
    ? executeReportForAttemptFromRecord(input)
    : executeReportFromRecord(input);
}

const show = (input: {
  readonly revision: ClosedSiteRevision;
  readonly format?: "text" | "json";
  readonly page?: string;
}) => showReport({
  execution: input.revision.execution,
  ...(input.format === undefined ? {} : { format: input.format }),
  ...(input.page === undefined ? {} : { page: input.page }),
});

/** One live Report server owns its scoped execution revision and transport. */
export interface ReportHostServeInput<Requirements = never>
  extends OpenReportViewSessionInput<Requirements> {
  readonly host: string;
  readonly port: number;
}

function serve<Requirements>(
  input: ReportHostServeInput<Requirements>,
) {
  return Effect.gen(function* () {
    const session = yield* openReportViewSession({
      url: input.url,
      watchInputs: input.watchInputs,
      initial: input.initial,
      rebuild: input.rebuild,
    });
    return yield* openViewServer({
      session,
      host: input.host,
      port: input.port,
    });
  });
}

const exportReport = exportStaticReport;

/** The complete public Report Host surface; loaders and renderer internals stay private. */
export interface ReportHostSDK {
  readonly execute: typeof execute;
  readonly show: typeof show;
  readonly serve: typeof serve;
  readonly export: typeof exportReport;
}

export const reportHost: ReportHostSDK = Object.freeze({
  execute,
  show,
  serve,
  export: exportReport,
});
