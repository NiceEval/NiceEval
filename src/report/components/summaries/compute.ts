/**
 * Closed-data assembly for the report summary components.
 *
 * These helpers deliberately keep all statistical meaning in the published
 * Analysis facade.  They may inspect the fixed Sample snapshot for identity
 * and coverage facts, but never open a Record, construct a MetricValue, or
 * implement a second reducer.
 */

import {
  narrowSample,
  type CostMetricValue,
  type MetricValue,
  type PricingProfile,
  type Sample,
} from "../../../analysis/index.ts";
import type { Verdict } from "../../../shared/types.ts";
import {
  aggregate,
  agent,
  evalId,
  experiment,
  label,
  model,
  type ReportGroup,
} from "../../model/aggregate.ts";
import { toAttemptEvidence } from "../../model/conversions.ts";
import {
  costUSD,
  evidenceRow,
  hasMetricValue,
  passRate,
  totalCostUSD,
  type EvidenceRow,
} from "../../model/metrics.ts";
import {
  dimensionField,
  metricField,
} from "../../model/dataset.ts";
import type { VerdictCounts } from "../../definition/cell.tsx";
import type { Dataset } from "../../model/types.ts";

export interface SampleSummaryData {
  readonly earliestStartedAt: string | null;
  readonly latestStartedAt: string | null;
  readonly experiments: number;
  readonly evals: number;
  readonly attempts: number;
  readonly verdicts: VerdictCounts;
  readonly passRate: MetricValue<number> | null;
  /** 成本投影读数;Report 未声明 PricingProfile 时为 null(不请求 measure)。 */
  readonly totalCostUSD: CostMetricValue | null;
}

export type SummarySeries = "agent" | "model" | "experiment" | ReportGroup;

export interface ExperimentScatterData {
  readonly connect: boolean;
  readonly points: readonly ExperimentScatterPoint[];
}

export interface ExperimentScatterPoint extends EvidenceRow {
  readonly key: string;
  readonly experiment: string;
  readonly series: string;
  /** 成本投影读数;调用方已确认 Report 声明了 PricingProfile。 */
  readonly costUSD: CostMetricValue;
  readonly passRate: MetricValue<number>;
}

export interface StabilityPoint extends EvidenceRow {
  readonly key: string;
  readonly evalId: string;
  readonly condition: string;
  /** Analysis-owned denominator for this exact condition × eval metric. */
  readonly executions: number;
  readonly passRate: MetricValue<number>;
}

export interface StabilityOverviewData {
  readonly executions: number;
  readonly neverPassed: number;
  readonly flaky: number;
  readonly points: readonly StabilityPoint[];
  readonly dataset: Dataset;
}

/**
 * Produces the familiar range/KPI summary from one fixed Sample.  The counts
 * are closed Sample identity facts; the numeric readings are emitted by
 * Analysis unchanged.  The cost projection is requested only when the Report
 * declares a PricingProfile; without one nothing is measured or captured.
 */
export async function sampleSummaryData(
  sample: Sample,
  votes: "eval" | "attempt",
  pricing: PricingProfile | null,
): Promise<SampleSummaryData> {
  const [summary, evidence] = pricing === null
    ? await Promise.all([
      aggregate(sample, { by: {}, values: { passRate } }),
      toAttemptEvidence(sample),
    ])
    : await Promise.all([
      aggregate(sample, {
        by: {},
        values: { passRate, totalCostUSD: totalCostUSD(pricing) },
      }),
      toAttemptEvidence(sample),
    ]);
  const currentSlots = sample.snapshot.slots.filter((slot) => slot.state !== "excluded");
  const first = summary[0];
  const range = runRange(sample);

  return Object.freeze({
    ...range,
    experiments: new Set(currentSlots.map((slot) => String(slot.experimentId))).size,
    evals: new Set(currentSlots.map((slot) => String(slot.evalId))).size,
    attempts: currentSlots.filter((slot) => slot.state === "included").length,
    verdicts: tallyVerdicts(sample, evidence.entries, votes),
    passRate: first?.passRate ?? null,
    totalCostUSD: first === undefined || pricing === null
      ? null
      : (first as unknown as { readonly totalCostUSD: CostMetricValue }).totalCostUSD,
  });
}

/**
 * Uses Analysis rows for every plotted value. Only display-safe dimensions
 * are normalized into strings; MetricValue, issues, and evidence stay intact.
 * The x axis always stays cost × passRate; duration never replaces cost.
 */
export async function experimentScatterData(
  sample: Sample,
  options: { readonly series?: SummarySeries; readonly connect?: boolean },
  pricing: PricingProfile,
): Promise<ExperimentScatterData> {
  const line = label("line");
  const hasLine = sample.snapshot.runs.some((run) => run.context?.labels.line !== undefined);
  const group = groupFor(options.series, hasLine ? line : agent);
  const connect = options.connect ?? (group === line);

  const rows = await aggregate(sample, {
    by: { experiment, series: group },
    values: { costUSD: costUSD(pricing), passRate },
  });
  const points = Object.freeze(rows.map((row): ExperimentScatterPoint => evidenceRow({
    key: row.key,
    experiment: String(row.experiment),
    series: dimensionText(row.series),
    costUSD: (row as unknown as { readonly costUSD: CostMetricValue }).costUSD,
    passRate: row.passRate,
  })));
  return Object.freeze({ connect, points });
}

/**
 * Builds stability display data from per-eval Analysis pass-rate rows.  The
 * `executions` coordinate is the existing metric denominator, not a Report
 * metric.  This retains partial/missing states instead of manufacturing zero
 * values or a second verdict reducer.
 */
export async function stabilityOverviewData(
  sample: Sample,
  options: { readonly columns?: SummarySeries; readonly evals?: string | readonly string[] },
): Promise<StabilityOverviewData> {
  const scoped = sampleForEvals(sample, options.evals);
  const group = groupFor(options.columns, experiment);
  const rows = await aggregate(scoped, {
    by: { evalId, condition: group },
    values: { passRate },
  });
  const points = Object.freeze(rows.map((row): StabilityPoint => evidenceRow({
    key: row.key,
    evalId: String(row.evalId),
    condition: dimensionText(row.condition),
    executions: row.passRate.total,
    passRate: row.passRate,
  })));
  const stability = stabilityCounts(points);

  return Object.freeze({
    ...stability,
    points,
    dataset: Object.freeze({
      fields: Object.freeze([
        dimensionField("evalId", "string"),
        dimensionField("condition", "string"),
        dimensionField("executions", "number"),
        metricField("passRate", passRate),
      ]),
      rows: Object.freeze(points.map((point) => Object.freeze({
        key: point.key,
        values: Object.freeze({
          evalId: point.evalId,
          condition: point.condition,
          executions: point.executions,
          passRate: point.passRate,
        }),
      }))),
    }),
  });
}

function groupFor(value: SummarySeries | undefined, fallback: ReportGroup): ReportGroup {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return value;
  switch (value) {
    case "agent":
      return agent;
    case "model":
      return model;
    case "experiment":
      return experiment;
    default:
      throw new TypeError(
        `Summary series ${JSON.stringify(value)} must be "agent", "model", "experiment", or an Analysis Dimension / GroupFunction.`,
      );
  }
}

function dimensionText(value: string | number | boolean | null): string {
  return value === null ? "(missing)" : String(value);
}

function runRange(sample: Sample): { readonly earliestStartedAt: string | null; readonly latestStartedAt: string | null } {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const run of sample.snapshot.runs) {
    const startedAt = Number(run.startedAt);
    if (!Number.isFinite(startedAt)) continue;
    earliest = earliest === null || startedAt < earliest ? startedAt : earliest;
    latest = latest === null || startedAt > latest ? startedAt : latest;
  }
  return Object.freeze({
    earliestStartedAt: earliest === null ? null : new Date(earliest).toISOString(),
    latestStartedAt: latest === null ? null : new Date(latest).toISOString(),
  });
}

function tallyVerdicts(
  sample: Sample,
  entries: Awaited<ReturnType<typeof toAttemptEvidence>>["entries"],
  votes: "eval" | "attempt",
): VerdictCounts {
  const byLocator = new Map(
    sample.snapshot.slots
      .filter((slot): slot is Extract<typeof slot, { readonly state: "included" }> => slot.state === "included")
      .map((slot) => [slot.attempt.locator, slot] as const),
  );
  const choices = new Map<string, { readonly ordinal: number; readonly locator: string; readonly verdict: Verdict }>();
  for (const entry of entries) {
    if (entry.state !== "available") continue;
    const slot = byLocator.get(entry.attempt.locator);
    if (slot === undefined) continue;
    const key = votes === "attempt"
      ? entry.attempt.locator
      : `${slot.experimentId}\u0000${slot.evalId}`;
    const existing = choices.get(key);
    if (
      existing === undefined ||
      slot.attemptOrdinal > existing.ordinal ||
      (slot.attemptOrdinal === existing.ordinal && entry.attempt.locator > existing.locator)
    ) {
      choices.set(key, {
        ordinal: slot.attemptOrdinal,
        locator: entry.attempt.locator,
        verdict: entry.detail.verdict,
      });
    }
  }
  const counts: { passed: number; failed: number; errored: number; skipped: number } = {
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
  };
  for (const choice of choices.values()) counts[choice.verdict] += 1;
  return Object.freeze(counts);
}

function sampleForEvals(sample: Sample, evals: string | readonly string[] | undefined): Sample {
  if (evals === undefined) return sample;
  const selected = typeof evals === "string" ? [evals] : evals;
  if (!selected.every((value) => typeof value === "string")) {
    throw new TypeError("StabilityOverview.evals must be a string or an array of strings");
  }
  const wanted = new Set(selected);
  return narrowSample(sample, {
    slotIds: sample.snapshot.slots
      .filter((slot) => slot.state !== "excluded" && wanted.has(String(slot.evalId)))
      .map((slot) => slot.slotId),
  });
}

function stabilityCounts(points: readonly StabilityPoint[]): {
  readonly executions: number;
  readonly neverPassed: number;
  readonly flaky: number;
} {
  const byEval = new Map<string, { measured: boolean; passed: boolean; flaky: boolean }>();
  let executions = 0;
  for (const point of points) {
    executions += point.executions;
    let facts = byEval.get(point.evalId);
    if (facts === undefined) {
      facts = { measured: false, passed: false, flaky: false };
      byEval.set(point.evalId, facts);
    }
    if (!hasMetricValue(point.passRate)) continue;
    facts.measured = true;
    facts.passed ||= point.passRate.value > 0;
    facts.flaky ||= point.passRate.value > 0 && point.passRate.value < 1;
  }
  return Object.freeze({
    executions,
    neverPassed: [...byEval.values()].filter((facts) => facts.measured && !facts.passed).length,
    flaky: [...byEval.values()].filter((facts) => facts.flaky).length,
  });
}
