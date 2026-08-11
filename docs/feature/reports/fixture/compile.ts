// Real compile fixture for docs/feature/reports/library.md.
// Compile with the repo-locked effect@3.22.1:
//   node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2022 \
//     --module esnext --moduleResolution bundler --lib es2023,dom \
//     docs/feature/reports/fixture/compile.ts
//
// Proves: minimal author surface, allow-partial / require-complete,
// PageFamily instance inference, Effect entrypoints with exact R.

import { Context, Effect, Either, Scope } from "effect";

// ---- niceeval/projection (committed contract, see docs/feature/projection/library.md) ----

type RecordAttachmentOwner = "run" | "attempt";

interface RecordAttachmentFamily<
  Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly _owner: Owner;
  readonly _payload: Payload;
}

interface RecordAttachmentCollection {
  readonly state: "complete" | "partial";
}

interface RecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly owner: Owner;
  readonly [recordAttachmentProjectorTypeId]: (value: Value) => Value;
}

declare const defineRecordAttachmentProjector: <
  Owner extends RecordAttachmentOwner,
  Payload,
  Value,
>(input: {
  readonly attachment: RecordAttachmentFamily<Owner, Payload>;
  readonly project: (input: {
    readonly payload: Payload;
    readonly collection: RecordAttachmentCollection;
  }) => Value;
}) => RecordAttachmentProjector<Owner, Value>;

type ProjectionAccess = "attempt-slot" | "attempt-origin-run" | "selected-run";

declare const recordProjectionTypeId: unique symbol;
declare const recordAttachmentProjectorTypeId: unique symbol;

interface RecordProjection<Access extends ProjectionAccess, Value> {
  readonly access: Access;
  readonly [recordProjectionTypeId]: (value: Value) => Value;
}

declare const attemptSlotProjection: <Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
) => RecordProjection<"attempt-slot", Value>;

declare const attemptOriginRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"attempt-origin-run", Value>;

declare const selectedRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"selected-run", Value>;

interface AnalysisSample {
  readonly denominator: number;
}

interface AnalysisSampleHandle {
  readonly sample: AnalysisSample;
}

type ProjectedRecordAttachmentResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly collection: RecordAttachmentCollection;
    }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly from: string;
      readonly to: string;
      readonly command: "niceeval migrate";
    }
  | { readonly state: "unsupported"; readonly schemaId: string }
  | { readonly state: "invalid"; readonly issues: readonly string[] };

type ProjectedEntry<Value> =
  | { readonly state: "excluded" }
  | { readonly state: "not-recorded" }
  | { readonly state: "core-invalid" }
  | {
      readonly state: "attachment-result";
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    };

interface ProjectionCoverage {
  readonly sample: {
    readonly denominator: number;
    readonly totalSlots: number;
    readonly included: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
}

interface ProjectedSample<Access extends ProjectionAccess, Value> {
  readonly sample: AnalysisSample;
  readonly access: Access;
  readonly entries: readonly ProjectedEntry<Value>[];
  readonly coverage: ProjectionCoverage;
}

// ---- niceeval/report (this document) ----

type ReportCompleteness = "allow-partial" | "require-complete";

type AnyRecordProjection = RecordProjection<any, any>;

declare const ReportDataPlanTypeId: unique symbol;

interface ReportDataPlan<
  out Shape extends Readonly<Record<string, AnyRecordProjection>> =
    Readonly<Record<string, AnyRecordProjection>>,
> {
  readonly [ReportDataPlanTypeId]: { readonly _Shape: () => Shape };
}

declare const reportInputs: <
  const Shape extends Readonly<Record<string, AnyRecordProjection>>,
>(shape: Shape) => ReportDataPlan<Shape>;

type ReportDataShape<Plan extends ReportDataPlan> =
  Plan extends ReportDataPlan<infer Shape> ? Shape : never;

type ReportProjectedValues<Plan extends ReportDataPlan> = {
  readonly [Key in keyof ReportDataShape<Plan>]:
    ReportDataShape<Plan>[Key] extends RecordProjection<infer Access, infer Value>
      ? ProjectedSample<Access, Value>
      : never;
};

declare const ReportIdTypeId: unique symbol;
declare const ReportComponentIdTypeId: unique symbol;
declare const ReportRouteTypeId: unique symbol;
declare const ReportInstanceKeyTypeId: unique symbol;
declare const ReportDownloadPathTypeId: unique symbol;

type ReportId = string & { readonly [ReportIdTypeId]: true };
type ReportComponentId = string & { readonly [ReportComponentIdTypeId]: true };
type ReportRoute = string & { readonly [ReportRouteTypeId]: true };
type ReportInstanceKey = string & { readonly [ReportInstanceKeyTypeId]: true };
type ReportDownloadPath = string & { readonly [ReportDownloadPathTypeId]: true };

type ReportPathIssue = {
  readonly code: "report-path-invalid";
  readonly kind:
    | "report-id"
    | "component-id"
    | "route"
    | "instance-key"
    | "download";
  readonly reason: string;
};

declare const reportId: (input: string) => Either.Either<ReportId, ReportPathIssue>;
declare const reportComponentId: (
  input: string,
) => Either.Either<ReportComponentId, ReportPathIssue>;
declare const reportRoute: (input: string) => Either.Either<ReportRoute, ReportPathIssue>;
declare const reportInstanceKey: (
  input: string,
) => Either.Either<ReportInstanceKey, ReportPathIssue>;
declare const reportDownloadPath: (
  input: string,
) => Either.Either<ReportDownloadPath, ReportPathIssue>;
declare const reportRouteFromKeys: (
  keys: readonly [ReportInstanceKey, ...ReportInstanceKey[]],
) => Either.Either<ReportRoute, ReportPathIssue>;
declare const reportInstanceKeyFromRecordId: (input: {
  readonly kind: "run" | "attempt" | "slot";
  readonly value: string;
}) => ReportInstanceKey;

declare const ReportProblemIdTypeId: unique symbol;
type ReportProblemId = number & { readonly [ReportProblemIdTypeId]: true };

interface ReportRecordedDataProblem {
  readonly category: "recorded-data";
  readonly code:
    | "unavailable"
    | "migration-required"
    | "unsupported"
    | "invalid"
    | "collection-partial";
  readonly consumerId: ReportComponentId;
  readonly inputKey?: string;
  readonly slotId?: string;
  readonly runId?: string;
}

interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "projection-callback-defect"
    | "calculation-callback-defect"
    | "page-family-instances-defect"
    | "page-family-key-defect"
    | "page-family-key-conflict"
    | "page-execution-failed"
    | "download-execution-failed"
    | "semantic-document-invalid"
    | "route-conflict";
  readonly consumerId: ReportComponentId;
  readonly summary: string;
}

type ReportProblem = ReportRecordedDataProblem | ReportExecutionProblem;

interface ReportInputState {
  readonly state: "complete" | "partial";
}

type ReportCalculationResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly inputState: ReportInputState;
    }
  | {
      readonly state: "data-unavailable";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportCalculation<Inputs extends ReportDataPlan, out Value> {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}

type AnyReportCalculation = ReportCalculation<any, any>;
type ReportCalculationSet = Readonly<Record<string, AnyReportCalculation>>;

type ReportCalculationResults<Set extends ReportCalculationSet> = {
  readonly [Key in keyof Set]:
    Set[Key] extends ReportCalculation<any, infer Value>
      ? ReportCalculationResult<Value>
      : never;
};

declare const defineCalculation: <
  Inputs extends ReportDataPlan,
  Value,
>(definition: {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}) => ReportCalculation<Inputs, Value>;

type ReportComponentContext<
  Inputs extends ReportDataPlan | {} = {},
  Calculations extends ReportCalculationSet = {},
> = {
  readonly sample: AnalysisSample;
  readonly inputs: Inputs extends ReportDataPlan
    ? ReportProjectedValues<Inputs>
    : {};
  readonly calculations: ReportCalculationResults<Calculations>;
};

interface ReportPage {
  readonly id: ReportComponentId;
}

declare const definePage: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<{}, Calculations>,
    ) => ReportDocumentV1;
  }): ReportPage;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => ReportDocumentV1;
  }): ReportPage;
};

interface ReportPageFamily {
  readonly id: ReportComponentId;
}

declare const definePageFamily: {
  <Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<{}, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocumentV1;
  }): ReportPageFamily;

  <Inputs extends ReportDataPlan, Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocumentV1;
  }): ReportPageFamily;
};

interface ReportDownloadFile {
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

interface ReportDownload {
  readonly id: ReportComponentId;
}

declare const defineDownload: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;
};

interface Report {
  readonly id: ReportId;
  readonly calculations: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
}

declare const defineReport: (definition: {
  readonly id: ReportId;
  readonly calculations?: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
}) => Report;

interface ReportDocumentV1 {
  readonly schema: "niceeval.report-document/v1";
  readonly title: string;
  readonly children: readonly ReportBlockV1[];
}

type ReportBlockV1 =
  | {
      readonly type: "paragraph";
      readonly children: readonly {
        readonly type: "text";
        readonly value: string;
      }[];
    }
  | {
      readonly type: "metric";
      readonly label: string;
      readonly value: null | boolean | number | string;
    };

interface ReportExecution {
  readonly reportId: ReportId;
  readonly sample: AnalysisSample;
  readonly problemTable: readonly {
    readonly id: ReportProblemId;
    readonly problem: ReportProblem;
  }[];
}

type ReportExecutionError =
  | { readonly code: "report-definition-invalid"; readonly issues: readonly string[] }
  | { readonly code: "report-limit-exceeded" };

declare const executeReport: (input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}) => Effect.Effect<ReportExecution, ReportExecutionError, never>;

interface ReportConsoleService {
  readonly write: (text: string) => Effect.Effect<void, ReportConsoleError>;
}

type ReportConsoleError = {
  readonly code: "report-console-write-failed";
  readonly operation: string;
};

class ReportConsole extends Context.Tag(
  "@niceeval/report/ReportConsole",
)<ReportConsole, ReportConsoleService>() {}

type ReportShowError = ReportConsoleError;

declare const showReport: (input: {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}) => Effect.Effect<void, ReportShowError, ReportConsole>;

interface ReportFileSystemService {
  readonly writeFile: (input: {
    readonly out: string;
    readonly path: string;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<void, ReportFileSystemError>;
  readonly writeCompleteMarker: (
    out: string,
  ) => Effect.Effect<void, ReportFileSystemError>;
  readonly syncDirectory: (
    out: string,
  ) => Effect.Effect<void, ReportFileSystemError>;
}

type ReportFileSystemError = {
  readonly code: "report-fs-write-failed";
  readonly operation: string;
};

class ReportFileSystem extends Context.Tag(
  "@niceeval/report/ReportFileSystem",
)<ReportFileSystem, ReportFileSystemService>() {}

type ReportExportError =
  | { readonly code: "report-export-execution-problem" }
  | { readonly code: "report-export-target-exists" }
  | { readonly code: "report-export-write-failed" };

interface ReportStaticExportReceipt {
  readonly out: string;
}

declare const exportStaticReport: (input: {
  readonly execution: ReportExecution;
  readonly out: string;
}) => Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
>;

// ---- niceeval/report/host/node ----

interface ReportViewState {
  readonly current: { readonly execution: ReportExecution };
  readonly lastProblem?: { readonly summary: string };
}

interface ReportViewSession {
  readonly url: string;
  readonly snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed>;
  readonly refresh: Effect.Effect<void, ReportViewSessionClosed>;
}

type ReportViewSessionClosed = { readonly code: "report-view-session-closed" };
type ReportViewOpenError = { readonly code: "report-view-open-failed"; readonly reason: string };

interface ReportViewRequest {
  readonly root: string;
  readonly report: Report;
}

class NodeReportViewHost extends Context.Tag(
  "@niceeval/report/NodeReportViewHost",
)<
  NodeReportViewHost,
  {
    readonly open: (
      request: ReportViewRequest,
    ) => Effect.Effect<ReportViewSession, ReportViewOpenError, Scope.Scope>;
  }
>() {}

declare const openNodeReportView: (
  request: ReportViewRequest,
) => Effect.Effect<
  ReportViewSession,
  ReportViewOpenError,
  Scope.Scope | NodeReportViewHost
>;

// ---- author code: minimal surface ----

interface CommandsCheckedPayload {
  readonly commands: readonly string[];
}

interface CommandsCheckedView {
  readonly count: number;
  readonly observed: number;
  readonly denominator: number;
}

declare const commandsCheckedAttachment: RecordAttachmentFamily<
  "attempt",
  CommandsCheckedPayload
>;

const commandsCheckedProjector = defineRecordAttachmentProjector({
  attachment: commandsCheckedAttachment,
  project: ({ payload }): CommandsCheckedView => ({
    count: payload.commands.length,
    observed: payload.commands.length,
    denominator: 100,
  }),
});

const commandsChecked = attemptSlotProjection(commandsCheckedProjector);

// @ts-expect-error attempt-slot cannot become selected-run
const badAccess: RecordProjection<"selected-run", CommandsCheckedView> =
  commandsChecked;

// @ts-expect-error Value must match the projection
const badValue: RecordProjection<"attempt-slot", { readonly nope: number }> =
  commandsChecked;

// @ts-expect-error shape keys must be RecordProjection values
const badPlan = reportInputs({ notAProjection: 42 });

// allow-partial: callback runs on exhaustive entries, author derives domain value
const passRate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("pass-rate")),
  inputs: reportInputs({ commandsChecked }),
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) => {
    let count = 0;
    for (const entry of inputs.commandsChecked.entries) {
      if (
        entry.state === "attachment-result" &&
        entry.attachment.state === "available"
      ) {
        count += entry.attachment.value.count;
      }
    }
    return {
      observed: count,
      denominator: sample.denominator,
      rate: sample.denominator === 0 ? 0 : count / sample.denominator,
    };
  },
});

// require-complete: data-unavailable when required inputs are incomplete
const releaseGate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("release-gate")),
  inputs: reportInputs({ commandsChecked }),
  completeness: "require-complete",
  calculate: ({ sample }) => sample.denominator > 0,
});

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { passRate },
  render: ({ calculations }) => ({
    schema: "niceeval.report-document/v1",
    title: "Overview",
    children: [
      {
        type: "metric",
        label: "Pass rate",
        value:
          calculations.passRate.state === "available"
            ? calculations.passRate.value.rate
            : null,
      },
    ],
  }),
});

// PageFamily: Instance inferred from instances callback; route from Assertions entryId
interface AssertionInstance {
  readonly entryId: string;
  readonly label: string;
}

interface AssertionsPayload {
  readonly entries: readonly AssertionInstance[];
}

declare const assertionsAttachment: RecordAttachmentFamily<
  "attempt",
  AssertionsPayload
>;

const assertionsProjector = defineRecordAttachmentProjector({
  attachment: assertionsAttachment,
  project: ({ payload }): AssertionsPayload => payload,
});

const assertions = attemptSlotProjection(assertionsProjector);

const assertionPages = definePageFamily({
  id: Either.getOrThrow(reportComponentId("assertions")),
  inputs: reportInputs({ assertions }),
  completeness: "allow-partial",
  instances: ({ inputs }) => {
    const instances: AssertionInstance[] = [];
    for (const entry of inputs.assertions.entries) {
      if (
        entry.state === "attachment-result" &&
        entry.attachment.state === "available"
      ) {
        instances.push(...entry.attachment.value.entries);
      }
    }
    return instances;
  },
  key: (instance) =>
    Either.getOrThrow(reportInstanceKey(instance.entryId)),
  route: (instance) =>
    Either.getOrThrow(reportRoute(`/assertions/${instance.entryId}`)),
  render: ({ instance }) => ({
    schema: "niceeval.report-document/v1",
    title: instance.label,
    children: [],
  }),
});

const reportDownload = defineDownload({
  id: Either.getOrThrow(reportComponentId("pass-rate-csv")),
  calculations: { passRate },
  build: ({ calculations }) => {
    if (calculations.passRate.state !== "available") return [];
    const csv = `observed,denominator\n${calculations.passRate.value.observed},${calculations.passRate.value.denominator}\n`;
    return [
      {
        path: Either.getOrThrow(reportDownloadPath("downloads/pass-rate.csv")),
        mediaType: "text/csv",
        bytes: new TextEncoder().encode(csv),
      },
    ];
  },
});

const report = defineReport({
  id: Either.getOrThrow(reportId("summary")),
  calculations: { passRate, releaseGate },
  pages: [overview, assertionPages],
  downloads: [reportDownload],
});

// ---- Effect entrypoints: exact R per consumer ----

declare const sampleHandle: AnalysisSampleHandle;
declare const someExecution: ReportExecution;

const _executeR: Effect.Effect<ReportExecution, ReportExecutionError, never> =
  executeReport({ sampleHandle, report });

const _showR: Effect.Effect<void, ReportShowError, ReportConsole> = showReport({
  execution: someExecution,
});

const _exportR: Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
> = exportStaticReport({ execution: someExecution, out: "/tmp/site" });

const _viewR: Effect.Effect<
  ReportViewSession,
  ReportViewOpenError,
  Scope.Scope | NodeReportViewHost
> = openNodeReportView({ root: ".niceeval/record", report });

const program = Effect.gen(function* () {
  const execution = yield* executeReport({ sampleHandle, report });
  yield* showReport({ execution });
  yield* exportStaticReport({ execution, out: "/tmp/site" });
  return execution;
});

export { report, program, passRate, releaseGate, assertionPages };
