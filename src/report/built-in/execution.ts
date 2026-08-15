import type { Sample, SampleSnapshot } from "../../analysis/index.ts";
import {
  defineReport,
  Stack,
  Stat,
  type Report,
} from "../author/index.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import { AttemptTrace } from "./attempt-trace.ts";
import {
  captureExecutionShowResult,
  captureTimingShowResult,
} from "./attempt-evidence-json.ts";
import { registerBuiltInShowResult } from "../execution/results.ts";

export interface ExecutionEvidenceReportOptions {
  /** Match retained Conversation items and Commands with one JavaScript regular expression. */
  readonly grep?: string;
}

export interface TimingEvidenceReportOptions {
  /** Summary hides interval identity and offsets; full retains them. */
  readonly mode?: "summary" | "full";
}

/**
 * Closed execution evidence belongs to the public Attempt Observability
 * DomainView. The renderer receives only the semantic tree composed by
 * AttemptTrace and never reopens Record.
 */
export function executionEvidenceReport(
  input: ExecutionEvidenceReportOptions = {},
): Report {
  if (input.grep !== undefined) new RegExp(input.grep);
  const options: ExecutionEvidenceReportOptions = Object.freeze({
    ...(input.grep === undefined ? {} : { grep: input.grep }),
  });
  return registerBuiltInShowResult(defineReport({
    title: "Attempt execution",
    pages: [executionEvidencePage(options)],
  }), Object.freeze({ produce: captureExecutionShowResult }));
}

/** The built-in execution report token target. */
export const defaultExecutionEvidenceReport = executionEvidenceReport();

/** A focused timing page over the same closed Attempt trace. */
export function timingEvidenceReport(
  input: TimingEvidenceReportOptions = {},
): Report {
  const options: Required<TimingEvidenceReportOptions> = Object.freeze({
    mode: input.mode ?? "summary",
  });
  return registerBuiltInShowResult(defineReport({
    title: "Attempt timing",
    pages: [timingEvidencePage(options)],
  }), Object.freeze({ produce: captureTimingShowResult }));
}

export const defaultTimingEvidenceReport = timingEvidenceReport();

function executionEvidencePage(options: ExecutionEvidenceReportOptions) {
  return Object.freeze({
    id: "execution-evidence",
    path: "/",
    title: "Attempt execution",
    load: async (sample: Sample) => Object.freeze({
      snapshot: sample.snapshot,
      metrics: await loadBuiltInSummaryRows(sample),
    }),
    render: (input: {
      readonly snapshot: SampleSnapshot;
      readonly metrics: BuiltInSummaryRows;
    }) => executionNode(input, options),
  });
}

function timingEvidencePage(options: Required<TimingEvidenceReportOptions>) {
  return Object.freeze({
    id: "timing-evidence",
    path: "/",
    title: "Attempt timing",
    load: async (sample: Sample) => Object.freeze({
      snapshot: sample.snapshot,
      metrics: await loadBuiltInSummaryRows(sample),
    }),
    render: (input: {
      readonly snapshot: SampleSnapshot;
      readonly metrics: BuiltInSummaryRows;
    }) => timingNode(input, options),
  });
}

function executionNode(input: {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
}, options: ExecutionEvidenceReportOptions) {
  const metrics = input.metrics[0];
  return Stack({
    children: [
      ...(metrics === undefined
        ? []
        : [
          Stat({ label: "Mean latency", value: metrics.meanLatencyMs }),
          Stat({ label: "Tool failure rate", value: metrics.toolFailureRate }),
        ]),
      traceForSnapshot(input.snapshot, {
        mode: "execution",
        ...(options.grep === undefined ? {} : { grep: options.grep }),
      }),
    ],
  });
}

function timingNode(input: {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
}, options: Required<TimingEvidenceReportOptions>) {
  const metrics = input.metrics[0];
  return Stack({
    children: [
      ...(metrics === undefined
        ? []
        : [Stat({ label: "Mean latency", value: metrics.meanLatencyMs })]),
      traceForSnapshot(input.snapshot, {
        mode: "timing",
        timingMode: options.mode,
      }),
    ],
  });
}

function traceForSnapshot(
  snapshot: SampleSnapshot,
  options: {
    readonly mode: "execution" | "timing";
    readonly grep?: string;
    readonly timingMode?: "summary" | "full";
  },
) {
  const included = snapshot.slots.filter((slot) => slot.state === "included");
  const locator = included.length === 1 ? included[0]!.attempt.locator : undefined;
  return AttemptTrace({
    ...options,
    ...(locator === undefined ? {} : { locator }),
  });
}
