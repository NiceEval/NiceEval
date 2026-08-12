import { Either } from "effect";
import type { ProjectionCoverage } from "../../projection/coverage.ts";
import type {
  ReportComponentId,
  ReportDownloadPath,
  ReportRoute,
} from "../author/identity.ts";
import type {
  ReportDataState,
  ReportDownloadFile,
} from "../author/model.ts";
import type { ReportDocument } from "../semantic/document.ts";
import type { ReportProblemId } from "./problems.ts";

const reportProjectionIdTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportProjectionId",
);

export type ReportProjectionId = number & {
  readonly [reportProjectionIdTypeId]: true;
};

export interface ReportExecutionIdentifierIssue {
  readonly code: "report-execution-identifier-invalid";
  readonly kind: "projection-id";
  readonly reason: string;
}

export function reportProjectionId(
  value: number,
): Either.Either<ReportProjectionId, ReportExecutionIdentifierIssue> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  ) {
    return Either.left(
      Object.freeze({
        code: "report-execution-identifier-invalid" as const,
        kind: "projection-id" as const,
        reason: "a Report projection ID must be a bounded uint32",
      }),
    );
  }
  return Either.right(value as ReportProjectionId);
}

export function isReportProjectionId(value: unknown): value is ReportProjectionId {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff;
}

export type ReportCalculationResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly inputState: ReportDataState;
    }
  | {
      readonly state: "data-unavailable";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

export interface ReportProjectionSummary {
  readonly projectionId: ReportProjectionId;
  readonly inputKey: string;
  readonly coverage: ProjectionCoverage;
  readonly problemIds: readonly ReportProblemId[];
}

export type ReportCalculationExecutionResult =
  | {
      readonly state: "available";
      readonly calculationId: ReportComponentId;
      readonly value: unknown;
      readonly inputState: ReportDataState;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable";
      readonly calculationId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly calculationId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

export type ReportPageFamilyResult =
  | {
      readonly state: "expanded";
      readonly familyId: ReportComponentId;
      readonly instanceCount: number;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable";
      readonly familyId: ReportComponentId;
      readonly instanceCount: number;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly familyId: ReportComponentId;
      readonly instanceCount: number;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

export type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly pageId: ReportComponentId;
      readonly route: ReportRoute;
      readonly document: ReportDocument;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable";
      readonly pageId: ReportComponentId;
      readonly route?: ReportRoute;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly pageId: ReportComponentId;
      readonly route?: ReportRoute;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

export type ReportDownloadResult =
  | {
      readonly state: "built";
      readonly downloadId: ReportComponentId;
      readonly files: readonly ReportDownloadFile[];
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable";
      readonly downloadId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly downloadId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

/** A semantic closure derived from one fixed execution, before output mapping. */
export interface ReportExecutionLinks {
  readonly routes: ReadonlySet<ReportRoute>;
  readonly downloads: ReadonlySet<ReportDownloadPath>;
}
