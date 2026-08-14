import type { ReportExecution } from "../report/execution/model.ts";
import type { LeaderboardShowJson } from "../report/built-in/leaderboard.ts";
import type { SourceShowJson } from "../report/built-in/source.ts";
import type { PublicTimingJson } from "../report/built-in/execution.ts";
import type {
  PublicAttemptEvidenceJson,
  PublicExecutionEvidenceJson,
} from "../report/built-in/attempt-evidence-json.ts";

export type ShowJsonView =
  | "leaderboard"
  | "compare"
  | "attempt"
  | "source"
  | "execution"
  | "timing"
  | "usage"
  | "diff"
  | "history"
  | "stats";

export interface ShowJsonSample {
  readonly evalPrefix?: string;
  readonly experiments: readonly string[];
  readonly fresh: boolean;
  /** Additive bridge for consumers that already read ReportExecution sample facts. */
  readonly selection: ReportExecution["sample"]["selection"];
  readonly runCount: number;
  readonly slotCount: number;
  readonly denominator: number;
}

interface ShowJsonBase {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly sample: ShowJsonSample;
  /** Canonical execution problems remain visible without exposing the Report tree. */
  readonly problemTable: ReadonlyArray<ReportExecution["problemTable"][number]>;
}

export type ShowJsonCalculationData<Value> =
  | {
      readonly state: "available";
      readonly inputState: "complete" | "partial";
      readonly problemIds: readonly number[];
      readonly value: Value;
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly problemIds: readonly number[];
    };

export type ShowJson =
  | (ShowJsonBase & { readonly view: "leaderboard"; readonly data: LeaderboardShowJson })
  | (ShowJsonBase & {
      readonly view: "attempt";
      readonly data: ShowJsonCalculationData<PublicAttemptEvidenceJson>;
    })
  | (ShowJsonBase & { readonly view: "source"; readonly data: SourceShowJson })
  | (ShowJsonBase & {
      readonly view: "timing";
      readonly data: ShowJsonCalculationData<PublicTimingJson>;
    })
  | (ShowJsonBase & {
      readonly view: "execution";
      readonly data: ShowJsonCalculationData<PublicExecutionEvidenceJson>;
    })
  | (ShowJsonBase & { readonly view: "usage"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "diff"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "history"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "stats"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "compare"; readonly data: unknown });

export function buildShowSample(input: {
  readonly patterns?: readonly string[];
  readonly experiments: readonly string[];
  readonly fresh?: boolean;
  readonly executionSample: ReportExecution["sample"];
}): ShowJsonSample {
  return Object.freeze({
    ...(input.patterns !== undefined && input.patterns.length > 0
      ? { evalPrefix: input.patterns.join(",") }
      : {}),
    experiments: Object.freeze([...input.experiments]),
    fresh: input.fresh === true,
    selection: input.executionSample.selection,
    runCount: input.executionSample.runs.length,
    slotCount: input.executionSample.slots.length,
    denominator: input.executionSample.denominator,
  });
}

export function renderShowJson(doc: ShowJson): string {
  return `${JSON.stringify(doc)}\n`;
}

export function calculationValue<Value>(
  execution: ReportExecution,
  calculationId: string,
): Value | undefined {
  const result = execution.calculations.find((candidate) => candidate.calculationId === calculationId);
  return result?.state === "available" ? result.value as Value : undefined;
}

export function requireCalculationValue<Value>(
  execution: ReportExecution,
  calculationId: string,
): Value {
  const result = execution.calculations.find(
    (candidate) => candidate.calculationId === calculationId,
  );
  if (result === undefined) {
    throw new Error(`Report execution did not produce Calculation ${calculationId}`);
  }
  if (result.state !== "available") {
    throw new Error(
      `Report Calculation ${calculationId} completed as ${result.state}; inspect problemTable`,
    );
  }
  return result.value as Value;
}

export function calculationData<Value>(
  execution: ReportExecution,
  calculationId: string,
): ShowJsonCalculationData<Value> {
  const result = execution.calculations.find(
    (candidate) => candidate.calculationId === calculationId,
  );
  if (result === undefined) {
    throw new Error(`Report execution did not produce Calculation ${calculationId}`);
  }
  if (result.state === "available") {
    return Object.freeze({
      state: "available" as const,
      inputState: result.inputState.state,
      problemIds: Object.freeze([...result.problemIds]),
      value: result.value as Value,
    });
  }
  return Object.freeze({
    state: result.state,
    problemIds: Object.freeze([...result.problemIds]),
  });
}

/** Internal host/static document. Public `show --json` never emits this format. */
export {
  renderReportExecutionJson as renderReportShowDocument,
  reportExecutionShowDocument as buildReportShowDocument,
} from "../report/host/presentation.ts";
