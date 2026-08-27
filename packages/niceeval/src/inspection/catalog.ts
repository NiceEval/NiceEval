import type { InspectionOperationId, InspectionJson } from "./codec.ts";

export interface InspectionOperationDescriptor {
  readonly id: InspectionOperationId;
  readonly behaviorVersion: string;
  readonly request: InspectionJson;
  readonly result: InspectionJson;
  readonly selectors: readonly string[];
  readonly errors: readonly string[];
  readonly followUp: InspectionJson;
}

const BEHAVIOR_VERSION = "1";

const descriptor = (
  id: InspectionOperationId,
  selectors: readonly string[],
  operation: InspectionJson,
  resultField: string,
): InspectionOperationDescriptor => Object.freeze({
  id,
  behaviorVersion: BEHAVIOR_VERSION,
  request: Object.freeze({
    protocol: "niceeval.query/v1",
    operation,
  }),
  result: Object.freeze({
    protocol: "niceeval.query/v1",
    operation: id,
    behaviorVersion: BEHAVIOR_VERSION,
    source: "closed source provenance",
    sealedCutoff: "closed selection identity",
    selection: "selection audit",
    issues: Object.freeze([]),
    evidence: "closed Attempt locator references",
    [resultField]: "operation result",
  }),
  selectors: Object.freeze([...selectors]),
  errors: Object.freeze([
    "inspection-request-invalid",
    "inspection-selection-missing",
    "inspection-source-invalid",
    "inspection-operation-failed",
  ]),
  followUp: Object.freeze({ protocol: "niceeval.query/v1", operation }),
});

export const inspectionOperationCatalog = Object.freeze([
  descriptor("overview.get", [], Object.freeze({ kind: "overview.get" }), "overview"),
  descriptor("experiment.get", ["experimentId"], Object.freeze({
    kind: "experiment.get",
    experimentId: "<experiment-id>",
  }), "experiment"),
  descriptor("runs.list", ["continuation"], Object.freeze({ kind: "runs.list" }), "runs"),
  descriptor("run.get", ["runId"], Object.freeze({ kind: "run.get", runId: "<run-id>" }), "run"),
  descriptor("run.summary", ["runId"], Object.freeze({ kind: "run.summary", runId: "<run-id>" }), "summary"),
  descriptor("run.overview", ["runId"], Object.freeze({ kind: "run.overview", runId: "<run-id>" }), "runOverview"),
  descriptor("attempt.get", ["locator"], Object.freeze({ kind: "attempt.get", locator: "@<locator>" }), "attempt"),
  descriptor("attempt.assertion.detail", ["locator", "entryId"], Object.freeze({
    kind: "attempt.assertion.detail",
    locator: "@<locator>",
    entryId: "<assertion-entry-id>",
  }), "assertion"),
  descriptor("attempt.trace", ["locator"], Object.freeze({ kind: "attempt.trace", locator: "@<locator>" }), "trace"),
  descriptor("attempt.trace.detail", ["locator", "selector"], Object.freeze({
    kind: "attempt.trace.detail",
    locator: "@<locator>",
    selector: Object.freeze({
      kind: "tool-occurrence",
      toolOccurrenceId: "<tool-occurrence-id>",
    }),
  }), "detail"),
  descriptor("attempt.timing", ["locator"], Object.freeze({
    kind: "attempt.timing",
    locator: "@<locator>",
  }), "timing"),
  descriptor("attempt.usage", ["locator"], Object.freeze({
    kind: "attempt.usage",
    locator: "@<locator>",
  }), "usage"),
  descriptor("attempt.diff", ["locator"], Object.freeze({ kind: "attempt.diff", locator: "@<locator>" }), "diff"),
  descriptor("attempt.sources", ["locator"], Object.freeze({ kind: "attempt.sources", locator: "@<locator>" }), "sources"),
  descriptor("attempt.artifacts", ["locator"], Object.freeze({ kind: "attempt.artifacts", locator: "@<locator>" }), "artifacts"),
  descriptor("runs.compare", ["leftRunIds", "rightRunIds", "mode"], Object.freeze({
    kind: "runs.compare",
    mode: "side-by-side",
    leftRunIds: Object.freeze(["<run-id>"]),
    rightRunIds: Object.freeze(["<run-id>"]),
  }), "comparison"),
] satisfies readonly InspectionOperationDescriptor[]);

export function inspectionBehaviorVersion(id: InspectionOperationId): string {
  return inspectionOperationCatalog.find((entry) => entry.id === id)!.behaviorVersion;
}
