import type { Report } from "../author/index.ts";
import {
  defaultAttemptOverviewReport,
  attemptOverviewReport,
} from "./attempt-overview.ts";
import {
  defaultExecutionEvidenceReport,
  defaultTimingEvidenceReport,
  executionEvidenceReport,
  timingEvidenceReport,
} from "./execution.ts";
import {
  defaultOverviewReport,
  overview,
} from "./overview.ts";
import {
  defaultRunMembershipOverviewReport,
  runMembershipOverviewReport,
} from "./run-membership-overview.ts";
import {
  defaultSandboxHistoryReport,
  sandboxHistoryReport,
} from "./sandbox-history.ts";
import {
  defaultSourceEvidenceReport,
  sourceEvidenceReport,
} from "./source.ts";
import {
  FileChangesTrajectory,
} from "./file-changes.ts";
import type {
  FileChangesTrajectoryProps,
} from "./file-changes.ts";
import {
  attemptDetailRoute,
  attemptDetailTarget,
  experimentDetailRoute,
  experimentDetailTarget,
  libraryDetailRoute,
} from "../library/details.ts";
import type {
  AttemptDetailTarget,
  ExperimentDetailTarget,
  LibraryDetailTarget,
} from "../library/details.ts";
import {
  classicOverviewReport,
  standard,
  standardAttemptPage,
  standardAttemptsPage,
  standardExperimentPage,
  standardOverviewPage,
  standardTracesPage,
} from "./classic.ts";

export {
  defaultAttemptOverviewReport,
  attemptOverviewReport,
  defaultExecutionEvidenceReport,
  defaultOverviewReport,
  defaultRunMembershipOverviewReport,
  defaultSandboxHistoryReport,
  defaultSourceEvidenceReport,
  defaultTimingEvidenceReport,
  executionEvidenceReport,
  classicOverviewReport,
  standard,
  standardAttemptPage,
  standardAttemptsPage,
  standardExperimentPage,
  standardOverviewPage,
  standardTracesPage,
  overview,
  runMembershipOverviewReport,
  sandboxHistoryReport,
  sourceEvidenceReport,
  timingEvidenceReport,
  FileChangesTrajectory,
  attemptDetailRoute,
  attemptDetailTarget,
  experimentDetailRoute,
  experimentDetailTarget,
  libraryDetailRoute,
};

export type {
  AttemptDetailTarget,
  ExperimentDetailTarget,
  FileChangesTrajectoryProps,
  LibraryDetailTarget,
};

export { default } from "./overview.ts";

/** Stable Report tokens accepted by the show/view built-in resolver. */
export type BuiltInReportToken =
  | "default-overview"
  | "overview"
  | "run-membership-overview"
  | "attempt-overview";

/** The three selector shapes whose omitted `--report` value is deterministic. */
export type BuiltInDefaultSelector =
  | "project-current"
  | "explicit-runs"
  | "attempt-locator";

export interface BuiltInReportTarget {
  readonly token: BuiltInReportToken;
  readonly report: Report;
  readonly pageId: string;
  readonly route: "/";
}

/**
 * One public mapping for `show` and `view`: the CLI resolves selector defaults
 * and explicit built-in tokens here, then passes only the resulting Report and
 * route to the Report Host.
 */
export const builtInReportTargets: Readonly<Record<BuiltInReportToken, BuiltInReportTarget>> = Object.freeze({
  "default-overview": Object.freeze({
    token: "default-overview",
    report: defaultOverviewReport,
    pageId: "overview",
    route: "/",
  }),
  overview: Object.freeze({
    token: "overview",
    report: defaultOverviewReport,
    pageId: "overview",
    route: "/",
  }),
  "run-membership-overview": Object.freeze({
    token: "run-membership-overview",
    report: defaultRunMembershipOverviewReport,
    pageId: "run-membership",
    route: "/",
  }),
  "attempt-overview": Object.freeze({
    token: "attempt-overview",
    report: defaultAttemptOverviewReport,
    pageId: "attempt-overview",
    route: "/",
  }),
});

export const builtInDefaultReportTokens: Readonly<Record<BuiltInDefaultSelector, BuiltInReportToken>> = Object.freeze({
  "project-current": "default-overview",
  "explicit-runs": "run-membership-overview",
  "attempt-locator": "attempt-overview",
});

export function builtInReportTarget(token: BuiltInReportToken): BuiltInReportTarget {
  return builtInReportTargets[token];
}

export function builtInDefaultReportTarget(selector: BuiltInDefaultSelector): BuiltInReportTarget {
  return builtInReportTarget(builtInDefaultReportTokens[selector]);
}
