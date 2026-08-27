import type { ReactElement } from "react";

import type { InspectionDocument } from "../../../../inspection/codec.ts";
import {
  ExperimentOverview,
  type AttemptListItem,
  type ExperimentListEvalRow,
  type ExperimentListItem,
  type ExperimentMetrics,
  type MetricState,
  type MetricValue,
  type Verdict,
} from "../report/components/entity-lists/index.tsx";
import type { MetricIssue } from "../report/definition/cell.tsx";
import type { Locale } from "../client/types.ts";
import type { ViewCatalogSelection } from "../client/manifest.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

interface OverviewCell {
  readonly experimentId: string;
  readonly evalId: string;
  readonly evaluationKind: "pass" | "points" | "mixed";
  readonly passRate: MetricValue<number>;
  readonly score: MetricValue<number>;
  readonly tally: Readonly<Record<Verdict, number>>;
  readonly members: readonly OverviewMember[];
}

interface OverviewMember {
  readonly runId: string;
  readonly locator: string | null;
  readonly attemptOrdinal: number;
  readonly score: MetricValue<number>;
  readonly action: string;
  readonly relation: string | null;
}

interface OverviewAggregate {
  readonly evaluationKind: "pass" | "points" | "mixed";
  readonly passRate: MetricValue<number>;
  readonly score: MetricValue<number>;
}

interface OverviewGroup extends OverviewAggregate {
  readonly groupPath: readonly string[];
}

interface OverviewExperiment extends OverviewAggregate {
  readonly experimentId: string;
  readonly groups: readonly OverviewGroup[];
}

export interface ClosedOverview {
  readonly cells: readonly OverviewCell[];
  readonly experiments: readonly OverviewExperiment[];
  readonly catalog: ViewCatalogSelection;
}

export function closeOverview(document: InspectionDocument): ClosedOverview {
  if (document.operation !== "overview.get") {
    throw new Error(`Expected overview.get, received ${document.operation}.`);
  }
  const result = recordField(document, "overview");
  const cells = arrayField(result, "cells").map((value, index) =>
    closeCell(record(value, `overview.cells[${index}]`), index),
  );
  const experiments = arrayField(result, "experiments").map((value, index) =>
    closeExperiment(record(value, `overview.experiments[${index}]`), index));
  const experimentIds = experiments.map(({ experimentId }) => experimentId);
  const runExperiments = uniqueBy(
    cells.flatMap((cell) => cell.members.map((member) => ({
      runId: member.runId,
      experimentId: cell.experimentId,
    }))),
    ({ runId }) => runId,
  );
  const attemptExperiments = uniqueBy(
    cells.flatMap((cell) => cell.members.flatMap((member) => member.locator === null
      ? []
      : [{ locator: member.locator, experimentId: cell.experimentId }])),
    ({ locator }) => locator,
  );
  return Object.freeze({
    cells: Object.freeze(cells),
    experiments: Object.freeze(experiments),
    catalog: Object.freeze({
      experiments: Object.freeze(experimentIds),
      runExperiments: Object.freeze(runExperiments),
      attemptExperiments: Object.freeze(attemptExperiments),
    }),
  });
}

export function overviewData(
  overview: ClosedOverview,
  selectedExperiments: readonly string[],
): readonly ExperimentListItem[] {
  const selected = new Set(selectedExperiments);
  const cells = overview.cells.filter(({ experimentId }) => selected.has(experimentId));
  const allEvalIds = [...new Set(cells.map(({ evalId }) => evalId))];
  return selectedExperiments.flatMap((experimentId) => {
    const experiment = overview.experiments.find((candidate) =>
      candidate.experimentId === experimentId);
    if (experiment === undefined) return [];
    const experimentCells = cells.filter((cell) => cell.experimentId === experimentId);
    if (experimentCells.length === 0) return [];
    const evalRows = experimentCells.map(closeEvalRow);
    const evaluationKind = experiment.evaluationKind;
    const missingEvalIds = allEvalIds.filter((evalId) =>
      !experimentCells.some((cell) => cell.evalId === evalId));
    return [Object.freeze({
      experimentId,
      agent: null,
      model: null,
      flags: null,
      evaluationKind,
      score: experiment.score,
      endToEndPassRate: experiment.passRate,
      missingEvalIds: Object.freeze(missingEvalIds),
      groupMetrics: groupMetrics(experiment.groups),
      evalRows: Object.freeze(evalRows),
      href: `#/experiment/${encodeURIComponent(experimentId)}`,
    } satisfies ExperimentListItem)];
  });
}

export function OverviewPage({
  overview,
  selectedExperiments,
  selectionTitle,
  locale,
}: {
  readonly overview: ClosedOverview;
  readonly selectedExperiments: readonly string[];
  readonly selectionTitle: string;
  readonly locale: Locale;
}): ReactElement {
  return (
    <>
      <header className="niceeval-report niceeval-hero">
        <h1 className="niceeval-hero-title">
          {locale === "zh-CN" ? "NiceEval 总览" : "NiceEval overview"}
        </h1>
      </header>
      <ExperimentOverview
        data={{
          selectionTitle,
          experiments: overviewData(overview, selectedExperiments),
        }}
        locale={locale}
      />
    </>
  );
}

export function ExperimentPage({
  overview,
  experimentId,
  locale,
}: {
  readonly overview: ClosedOverview;
  readonly experimentId: string;
  readonly locale: Locale;
}): ReactElement {
  return (
    <ExperimentOverview
      data={{
        selectionTitle: experimentId,
        experiments: overviewData(overview, [experimentId]),
      }}
      locale={locale}
    />
  );
}

function closeCell(value: JsonRecord, index: number): OverviewCell {
  const experimentId = stringField(value, "experimentId");
  const evalId = stringField(value, "evalId");
  const kind = value.evaluationKind;
  if (kind !== "pass" && kind !== "points" && kind !== "mixed") {
    throw new Error(`overview.cells[${index}].evaluationKind is invalid.`);
  }
  const verdict = recordField(value, "verdict");
  const tally = recordField(verdict, "tally");
  const members = arrayField(value, "members").map((member, memberIndex) => {
    const row = record(member, `overview.cells[${index}].members[${memberIndex}]`);
    return Object.freeze({
      runId: stringField(row, "runId"),
      locator: nullableStringField(row, "locator"),
      attemptOrdinal: numberField(row, "attemptOrdinal"),
      score: metricValue(recordField(row, "score"), `overview.cells[${index}].members[${memberIndex}].score`),
      action: stringField(row, "action"),
      relation: nullableStringField(row, "relation"),
    });
  });
  return Object.freeze({
    experimentId,
    evalId,
    evaluationKind: kind,
    passRate: metricValue(recordField(verdict, "passRate"), `overview.cells[${index}].verdict.passRate`),
    score: metricValue(recordField(value, "score"), `overview.cells[${index}].score`),
    tally: Object.freeze({
      passed: numberField(tally, "passed"),
      failed: numberField(tally, "failed"),
      errored: numberField(tally, "errored"),
      skipped: numberField(tally, "skipped"),
    }),
    members: Object.freeze(members),
  });
}

function closeExperiment(value: JsonRecord, index: number): OverviewExperiment {
  const aggregate = closeAggregate(value, `overview.experiments[${index}]`);
  const groups = arrayField(value, "groups").map((group, groupIndex) => {
    const row = record(group, `overview.experiments[${index}].groups[${groupIndex}]`);
    return Object.freeze({
      ...closeAggregate(row, `overview.experiments[${index}].groups[${groupIndex}]`),
      groupPath: Object.freeze(stringArray(row.groupPath)),
    } satisfies OverviewGroup);
  });
  return Object.freeze({
    ...aggregate,
    experimentId: stringField(value, "experimentId"),
    groups: Object.freeze(groups),
  });
}

function closeAggregate(value: JsonRecord, path: string): OverviewAggregate {
  const evaluationKind = value.evaluationKind;
  if (evaluationKind !== "pass" && evaluationKind !== "points" && evaluationKind !== "mixed") {
    throw new Error(`${path}.evaluationKind is invalid.`);
  }
  return Object.freeze({
    evaluationKind,
    passRate: metricValue(recordField(recordField(value, "verdict"), "passRate"), `${path}.verdict.passRate`),
    score: metricValue(recordField(value, "score"), `${path}.score`),
  });
}

function closeEvalRow(cell: OverviewCell): ExperimentListEvalRow {
  const attempts = cell.members.flatMap((member): readonly AttemptListItem[] => {
    if (member.locator === null) return [];
    const verdict = cell.members.length === 1 ? onlyVerdict(cell.tally) : null;
    return [Object.freeze({
      locator: member.locator,
      experimentId: cell.experimentId,
      evalId: cell.evalId,
      attemptOrdinal: member.attemptOrdinal,
      verdict,
      failureSummary: null,
      evaluationKind: cell.evaluationKind === "pass" ? "pass" : "points",
      score: member.score,
      startedAt: null,
      href: `#/attempt/${member.locator.startsWith("@") ? member.locator.slice(1) : member.locator}`,
    })];
  });
  return Object.freeze({
    evalId: cell.evalId,
    evaluationKind: cell.evaluationKind === "pass" ? "pass" : "points",
    score: cell.score,
    endToEndPassRate: cell.passRate,
    attempts: Object.freeze(attempts),
  });
}

function groupMetrics(groups: readonly OverviewGroup[]): ReadonlyMap<string, ExperimentMetrics> {
  return new Map(groups.map((group) => [group.groupPath.join("/"), Object.freeze({
    passRate: group.passRate,
    score: group.score,
  })] as const));
}

function metricValue(value: JsonRecord, path: string): MetricValue<number> {
  const state = metricState(value.state, `${path}.state`);
  const rawValue = value.value;
  if (rawValue !== null && (typeof rawValue !== "number" || !Number.isFinite(rawValue))) {
    throw new Error(`${path}.value must be a finite number or null.`);
  }
  const refs = arrayField(value, "refs").map((entry, index) => metricRef(entry, `${path}.refs[${index}]`));
  // InspectionDocument has already established that these are JSON. Keep every entry opaque.
  const issues = arrayField(value, "issues") as readonly MetricIssue[];
  const bounds = value.bounds === undefined ? undefined : metricBounds(value.bounds, `${path}.bounds`);
  const unit = value.unit;
  if (unit !== undefined && unit !== "points") throw new Error(`${path}.unit is invalid.`);
  return Object.freeze({
    value: rawValue,
    state,
    samples: metricCount(value.samples, `${path}.samples`),
    total: metricCount(value.total, `${path}.total`),
    basis: metricBasis(value.basis, `${path}.basis`),
    issues: Object.freeze([...issues]),
    refs: Object.freeze(refs),
    ...(unit === undefined ? {} : { unit }),
    ...(bounds === undefined ? {} : { bounds }),
  });
}

function onlyVerdict(tally: Readonly<Record<Verdict, number>>): Verdict | null {
  if (tally.passed === 1 && tally.failed === 0 && tally.errored === 0 && tally.skipped === 0) {
    return "passed";
  }
  if (tally.passed === 0 && tally.failed === 1 && tally.errored === 0 && tally.skipped === 0) {
    return "failed";
  }
  if (tally.passed === 0 && tally.failed === 0 && tally.errored === 1 && tally.skipped === 0) {
    return "errored";
  }
  if (tally.passed === 0 && tally.failed === 0 && tally.errored === 0 && tally.skipped === 1) {
    return "skipped";
  }
  return null;
}

function metricState(value: unknown, path: string): MetricState {
  return value === "available" || value === "partial" || value === "failed" ||
      value === "unavailable" || value === "empty" || value === "unsupported"
    ? value
    : invalidMetricField(path);
}

function metricBasis(value: unknown, path: string): "eval" | "slot" {
  return value === "eval" || value === "slot"
    ? value
    : invalidMetricField(path);
}

function metricCount(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function metricRef(value: unknown, path: string): { readonly identity: { readonly kind: "attempt"; readonly locator: string } } {
  const identity = recordField(record(value, path), "identity");
  if (identity.kind !== "attempt") throw new Error(`${path}.identity.kind must be attempt.`);
  return Object.freeze({
    identity: Object.freeze({ kind: "attempt" as const, locator: stringField(identity, "locator") }),
  });
}

function metricBounds(value: unknown, path: string): { readonly min: number; readonly max: number } {
  const bounds = record(value, path);
  return Object.freeze({ min: numberField(bounds, "min"), max: numberField(bounds, "max") });
}

function invalidMetricField(path: string): never {
  throw new Error(`${path} is invalid.`);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected a string array.");
  }
  return value;
}

function recordField(value: object, key: string): JsonRecord {
  return record(Reflect.get(value, key), key);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function arrayField(value: JsonRecord, key: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${key} must be an array.`);
  return field;
}

function stringField(value: JsonRecord, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${key} must be a string.`);
  return field;
}

function nullableStringField(value: JsonRecord, key: string): string | null {
  const field = value[key];
  if (field !== null && typeof field !== "string") {
    throw new Error(`${key} must be a string or null.`);
  }
  return field;
}

function numberField(value: JsonRecord, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`${key} must be a number.`);
  }
  return field;
}

function uniqueBy<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
): readonly Value[] {
  const output = new Map<string, Value>();
  for (const value of values) output.set(keyOf(value), value);
  return Object.freeze([...output.values()]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
