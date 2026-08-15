import { createHash } from "node:crypto";
import {
  aggregate,
  totalCostUSD,
  type AttemptEvidenceDomainView,
  type ExperimentId,
  type JsonValue,
  type Sample,
} from "../../analysis/index.ts";
import {
  parseAttemptLocator,
  type AttemptLocator,
} from "../../attempt-locator.ts";
import {
  AttemptDetails,
  EvidenceSummary,
  ExperimentDetails,
  IssueSummary,
} from "../classic/components.ts";
import { AttemptTrace } from "../built-in/attempt-trace.ts";
import {
  Table,
  Text,
} from "../classic/primitives.ts";
import {
  durationMs,
  experiment,
  passRate,
} from "../model/calculation.ts";
import type {
  PageLoadContext,
  PageParams,
  ParameterizedPageDefinition,
} from "../definition.ts";

/** Stable library ownership, separate from every business Report's navigation. */
export const ATTEMPT_DETAIL_PAGE_ID = "attempt";
export const ATTEMPT_DETAIL_PAGE_PATH = "/attempt";
export const EXPERIMENT_DETAIL_PAGE_ID = "experiment";
export const EXPERIMENT_DETAIL_PAGE_PATH = "/experiment";

const DETAIL_ROWS_MAX = 200;
const ATTEMPT_DETAIL_KEY_PATTERN = /^a1[0-9a-hjkmnp-tv-z]{12}$/;
const EXPERIMENT_DETAIL_KEY_PATTERN = /^e1[a-f0-9]{24}$/;

/** One immutable Attempt target, obtained only from a fixed Sample. */
export type AttemptDetailTarget = Readonly<Record<string, JsonValue>> & Readonly<{
  readonly kind: "attempt";
  readonly locator: AttemptLocator;
}>;

/**
 * An opaque, typed Experiment target. The durable ExperimentId stays in the
 * fixed Sample rather than becoming an unsafe route segment.
 */
export type ExperimentDetailTarget = Readonly<Record<string, JsonValue>> & Readonly<{
  readonly kind: "experiment";
  readonly key: string;
}>;

/** The one closed-target union accepted by all Report-owned detail links. */
export type LibraryDetailTarget = AttemptDetailTarget | ExperimentDetailTarget;

export interface LibraryDetailPageReservation {
  readonly id: string;
  readonly path: string;
  readonly name: string;
}

/** Build the one canonical Attempt target used by the library Page codec. */
export function attemptDetailTarget(locator: AttemptLocator): AttemptDetailTarget {
  const parsed = parseAttemptLocator(locator);
  if (!parsed.valid) throw new TypeError("Attempt detail targets require a canonical Attempt locator");
  return Object.freeze({ kind: "attempt" as const, locator: parsed.locator });
}

/** Build the opaque Experiment target without exposing a Record or path capability. */
export function experimentDetailTarget(experimentId: ExperimentId): ExperimentDetailTarget {
  return Object.freeze({ kind: "experiment" as const, key: experimentDetailKey(experimentId) });
}

/**
 * The only route helper for library-owned detail links. Classic tables create
 * a typed target from closed values, then call this helper; they never encode
 * a locator or durable identity as a path on their own.
 */
export function libraryDetailRoute(target: LibraryDetailTarget): string {
  switch (target.kind) {
    case "attempt":
      return `${ATTEMPT_DETAIL_PAGE_PATH}/${attemptDetailKey(target)}`;
    case "experiment":
      return `${EXPERIMENT_DETAIL_PAGE_PATH}/${experimentTargetKey(target)}`;
  }
}

/** The stable, safe route for one immutable Attempt detail Page. */
export function attemptDetailRoute(locator: AttemptLocator): string {
  return libraryDetailRoute(attemptDetailTarget(locator));
}

/** The stable, safe route for one closed Experiment detail Page. */
export function experimentDetailRoute(experimentId: ExperimentId): string {
  return libraryDetailRoute(experimentDetailTarget(experimentId));
}

export const attemptDetailParams: PageParams<AttemptDetailTarget> = Object.freeze({
  encode: attemptDetailKey,
  decode: decodeAttemptDetailTarget,
  enumerate: enumerateAttemptDetailTargets,
});

export const experimentDetailParams: PageParams<ExperimentDetailTarget> = Object.freeze({
  encode: experimentTargetKey,
  decode: decodeExperimentDetailTarget,
  enumerate: enumerateExperimentDetailTargets,
});

interface AttemptDetailPageInput {
  readonly target: AttemptDetailTarget;
  readonly slots: readonly AttemptDetailSlot[];
  readonly totalSlots: number;
  readonly evidence: AttemptEvidenceDomainView;
}

interface AttemptDetailSlot {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly originRunId: string;
  readonly runId: string;
  readonly slotId: string;
  readonly action: string;
  readonly relation: string;
}

type IncludedAttemptSlot = Extract<Sample["snapshot"]["slots"][number], { readonly state: "included" }>;

async function loadAttemptDetail(
  sample: Sample,
  target: AttemptDetailTarget,
  context: PageLoadContext,
): Promise<AttemptDetailPageInput> {
  const evidence = await context.evidence(target.locator);
  const slots = attemptSlots(sample, target.locator);
  return Object.freeze({
    target,
    slots: slots.rows,
    totalSlots: slots.total,
    evidence,
  });
}

function renderAttemptDetail(input: AttemptDetailPageInput) {
  const entries = input.evidence.entries
    .filter((entry) => entry.attempt.locator === input.target.locator)
    .map((entry) => Object.freeze({
      locator: entry.attempt.locator,
      state: entry.state,
      summary: evidenceSummary(entry),
      tone: evidenceTone(entry),
      issues: input.evidence.issues,
      refs: input.evidence.refs,
    }));
  return AttemptDetails({
    title: `Attempt ${input.target.locator}`,
    sections: [
      {
        title: "Attempt identity",
        children: [
          Table({
            caption: "Selected Sample membership",
            columns: [
              { key: "experimentId", label: "Experiment" },
              { key: "evalId", label: "Eval" },
              { key: "attemptOrdinal", label: "Attempt #", align: "end" },
              { key: "originRunId", label: "Origin Run" },
              { key: "runId", label: "Selected Run" },
              { key: "slotId", label: "Slot" },
              { key: "action", label: "Member action" },
              { key: "relation", label: "Member relation" },
            ],
            rows: input.slots,
          }),
          ...omittedRows(input.slots.length, input.totalSlots, "membership row"),
        ],
      },
      {
        title: "Closed evidence",
        children: [
          EvidenceSummary({
            title: "Assertion evidence",
            entries: entries.length === 0
              ? [{
                locator: input.target.locator,
                state: "missing",
                summary: "No closed Assertion evidence entry matched this Attempt locator.",
                tone: "warning",
                issues: input.evidence.issues,
                refs: input.evidence.refs,
              }]
              : entries,
          }),
          IssueSummary({
            title: "Analysis data status",
            issues: input.evidence.issues,
            refs: input.evidence.refs,
          }),
        ],
      },
      {
        title: "Execution trace",
        children: [AttemptTrace({ locator: input.target.locator, mode: "execution" })],
      },
    ],
  });
}

async function loadExperimentMetrics(sample: Sample) {
  return aggregate(sample, {
    by: { experiment },
    values: { passRate, durationMs, totalCostUSD },
  });
}

type ExperimentMetricRow = Awaited<ReturnType<typeof loadExperimentMetrics>>[number];

interface ExperimentDetailPageInput {
  readonly experimentId: ExperimentId;
  readonly metrics: readonly ExperimentMetricRow[];
  readonly slots: readonly ExperimentDetailSlot[];
  readonly totalSlots: number;
}

interface ExperimentDetailSlot {
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly runId: string;
  readonly slotId: string;
  readonly state: string;
  readonly attempt: string | null;
}

async function loadExperimentDetail(
  sample: Sample,
  target: ExperimentDetailTarget,
): Promise<ExperimentDetailPageInput> {
  const experimentId = experimentIdsByKey(sample).get(target.key);
  if (experimentId === undefined) {
    throw new TypeError("Experiment detail target does not belong to the fixed Sample");
  }
  const [metrics, members] = await Promise.all([
    loadExperimentMetrics(sample),
    Promise.resolve(experimentSlots(sample, experimentId)),
  ]);
  return Object.freeze({
    experimentId,
    metrics: Object.freeze(metrics.filter((row) => row.experiment === experimentId)),
    slots: members.rows,
    totalSlots: members.total,
  });
}

function renderExperimentDetail(input: ExperimentDetailPageInput) {
  return ExperimentDetails({
    title: `Experiment ${input.experimentId}`,
    sections: [
      {
        title: "Closed experiment metrics",
        children: [
          Table({
            caption: "Analysis metrics",
            columns: [
              { key: "experiment", label: "Experiment" },
              { key: "passRate", label: "Pass rate", align: "end" },
              { key: "durationMs", label: "Mean duration", align: "end" },
              { key: "totalCostUSD", label: "Total cost", align: "end" },
            ],
            rows: input.metrics,
          }),
        ],
      },
      {
        title: "Fixed Sample members",
        children: [
          Table({
            caption: "Experiment membership",
            columns: [
              { key: "evalId", label: "Eval" },
              { key: "attemptOrdinal", label: "Attempt #", align: "end" },
              { key: "runId", label: "Run" },
              { key: "slotId", label: "Slot" },
              { key: "state", label: "State" },
              { key: "attempt", label: "Attempt" },
            ],
            rows: input.slots,
          }),
          ...omittedRows(input.slots.length, input.totalSlots, "Sample member"),
        ],
      },
    ],
  });
}

/** Library-owned: business reports never need to repeat these definitions. */
export const libraryAttemptDetailPage = Object.freeze({
  id: ATTEMPT_DETAIL_PAGE_ID,
  path: ATTEMPT_DETAIL_PAGE_PATH,
  title: "Attempt",
  navigation: false as const,
  params: attemptDetailParams,
  load: loadAttemptDetail,
  render: renderAttemptDetail,
} satisfies ParameterizedPageDefinition<AttemptDetailTarget, AttemptDetailPageInput>);

export type LibraryAttemptDetailPage = typeof libraryAttemptDetailPage;

/** Library-owned: one Page per fixed-Sample Experiment target. */
export const libraryExperimentDetailPage = Object.freeze({
  id: EXPERIMENT_DETAIL_PAGE_ID,
  path: EXPERIMENT_DETAIL_PAGE_PATH,
  title: "Experiment",
  navigation: false as const,
  params: experimentDetailParams,
  load: loadExperimentDetail,
  render: renderExperimentDetail,
} satisfies ParameterizedPageDefinition<ExperimentDetailTarget, ExperimentDetailPageInput>);

export type LibraryExperimentDetailPage = typeof libraryExperimentDetailPage;

export const libraryDetailPages = Object.freeze([
  libraryAttemptDetailPage,
  libraryExperimentDetailPage,
] as const);

export const libraryDetailPageReservations = Object.freeze([
  Object.freeze({
    id: ATTEMPT_DETAIL_PAGE_ID,
    path: ATTEMPT_DETAIL_PAGE_PATH,
    name: "Attempt",
  }),
  Object.freeze({
    id: EXPERIMENT_DETAIL_PAGE_ID,
    path: EXPERIMENT_DETAIL_PAGE_PATH,
    name: "Experiment",
  }),
] satisfies readonly LibraryDetailPageReservation[]);

const libraryDetailPageReferences = new WeakSet<object>(libraryDetailPages);

/** Compatibility exports may be passed explicitly once; composition recognizes them. */
export function isLibraryDetailPage(value: unknown): value is object {
  return (typeof value === "object" && value !== null) && libraryDetailPageReferences.has(value);
}

function attemptDetailKey(target: AttemptDetailTarget): string {
  const normalized = attemptDetailTargetFrom(target);
  return `a${normalized.locator.slice(1).toLowerCase()}`;
}

function decodeAttemptDetailTarget(key: string): AttemptDetailTarget {
  if (!ATTEMPT_DETAIL_KEY_PATTERN.test(key)) {
    throw new TypeError("Attempt detail route key is not canonical");
  }
  const parsed = parseAttemptLocator(`@${key.slice(1).toUpperCase()}`);
  if (!parsed.valid) throw new TypeError("Attempt detail route key is not a canonical locator");
  return attemptDetailTarget(parsed.locator);
}

function attemptDetailTargetFrom(value: unknown): AttemptDetailTarget {
  if (!isDirectObject(value) || value.kind !== "attempt" || typeof value.locator !== "string") {
    throw new TypeError("Attempt detail params must be a typed Attempt target");
  }
  const parsed = parseAttemptLocator(value.locator);
  if (!parsed.valid) throw new TypeError("Attempt detail params must use a canonical Attempt locator");
  return attemptDetailTarget(parsed.locator);
}

function enumerateAttemptDetailTargets(sample: Sample): readonly AttemptDetailTarget[] {
  const locators = new Set<AttemptLocator>();
  for (const slot of sample.snapshot.slots) {
    if (slot.state === "included") locators.add(slot.attempt.locator);
  }
  return Object.freeze([...locators]
    .sort(compareText)
    .map((locator) => attemptDetailTarget(locator)));
}

function experimentTargetKey(target: ExperimentDetailTarget): string {
  if (!isDirectObject(target) || target.kind !== "experiment" || typeof target.key !== "string" ||
    !EXPERIMENT_DETAIL_KEY_PATTERN.test(target.key)) {
    throw new TypeError("Experiment detail params must be a typed canonical Experiment target");
  }
  return target.key;
}

function decodeExperimentDetailTarget(key: string): ExperimentDetailTarget {
  if (!EXPERIMENT_DETAIL_KEY_PATTERN.test(key)) {
    throw new TypeError("Experiment detail route key is not canonical");
  }
  return Object.freeze({ kind: "experiment" as const, key });
}

function enumerateExperimentDetailTargets(sample: Sample): readonly ExperimentDetailTarget[] {
  return Object.freeze([...experimentIdsByKey(sample).keys()]
    .sort(compareText)
    .map((key) => decodeExperimentDetailTarget(key)));
}

function experimentIdsByKey(sample: Sample): ReadonlyMap<string, ExperimentId> {
  const ids = new Map<string, ExperimentId>();
  for (const slot of sample.snapshot.slots) {
    if (slot.state === "excluded") continue;
    const key = experimentDetailKey(slot.experimentId);
    const existing = ids.get(key);
    if (existing !== undefined && existing !== slot.experimentId) {
      throw new TypeError("two Experiment identities produced the same library detail route key");
    }
    ids.set(key, slot.experimentId);
  }
  return ids;
}

function experimentDetailKey(experimentId: ExperimentId): string {
  // Report definition/build run in Node. This opaque, lowercase SHA-256
  // prefix bounds an arbitrary durable identity without treating it as an
  // AttemptId or exposing it as a route path.
  const digest = createHash("sha256").update(experimentId, "utf8").digest("hex");
  return `e1${digest.slice(0, 24)}`;
}

function attemptSlots(
  sample: Sample,
  locator: AttemptLocator,
): { readonly rows: readonly AttemptDetailSlot[]; readonly total: number } {
  const matching = sample.snapshot.slots
    .filter((slot): slot is IncludedAttemptSlot =>
      slot.state === "included" && slot.attempt.locator === locator
    );
  return Object.freeze({
    rows: Object.freeze(matching.slice(0, DETAIL_ROWS_MAX).map((slot) => Object.freeze({
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      originRunId: slot.attempt.originRunId,
      runId: slot.runId,
      slotId: slot.slotId,
      action: slot.action,
      relation: slot.relation,
    }))),
    total: matching.length,
  });
}

function experimentSlots(
  sample: Sample,
  experimentId: ExperimentId,
): { readonly rows: readonly ExperimentDetailSlot[]; readonly total: number } {
  const matching = sample.snapshot.slots
    .filter((slot) => slot.state !== "excluded" && slot.experimentId === experimentId);
  return Object.freeze({
    rows: Object.freeze(matching.slice(0, DETAIL_ROWS_MAX).map((slot) => Object.freeze({
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      runId: slot.runId,
      slotId: slot.slotId,
      state: slot.state,
      attempt: slot.state === "included" ? slot.attempt.locator : null,
    }))),
    total: matching.length,
  });
}

function evidenceSummary(entry: AttemptEvidenceDomainView["entries"][number]): string {
  if (entry.state === "available") {
    return `Verdict: ${entry.detail.verdict}; closed assertion entries: ${entry.detail.entries.length}.`;
  }
  return entry.state === "failed" ? entry.detail : `Evidence is ${entry.state}.`;
}

function evidenceTone(entry: AttemptEvidenceDomainView["entries"][number]): "positive" | "negative" | "neutral" | "warning" {
  if (entry.state !== "available") return "warning";
  switch (entry.detail.verdict) {
    case "passed":
      return "positive";
    case "failed":
    case "errored":
      return "negative";
    case "skipped":
      return "neutral";
  }
}

function omittedRows(visible: number, total: number, noun: string) {
  return total <= visible
    ? []
    : [Text({ value: `${total - visible} additional ${noun}(s) are omitted by the fixed detail-page limit.` })];
}

function isDirectObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
