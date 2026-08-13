import type { ReportExecution } from "../report/execution/model.ts";
import type { LeaderboardShowJson } from "../report/built-in/leaderboard.ts";
import type { SourceShowJson } from "../report/built-in/source.ts";
import type { PublicTimingJson } from "../report/built-in/execution.ts";

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
  readonly resultsRoot: string;
  readonly evalPrefix?: string;
  readonly experiments: readonly string[];
  readonly fresh: boolean;
}

interface ShowJsonBase {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly sample: ShowJsonSample;
}

export type ShowJson =
  | (ShowJsonBase & { readonly view: "leaderboard"; readonly data: LeaderboardShowJson })
  | (ShowJsonBase & { readonly view: "attempt"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "source"; readonly data: SourceShowJson })
  | (ShowJsonBase & { readonly view: "timing"; readonly data: PublicTimingJson })
  | (ShowJsonBase & { readonly view: "execution"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "usage"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "diff"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "history"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "stats"; readonly data: unknown })
  | (ShowJsonBase & { readonly view: "compare"; readonly data: unknown });

export function buildShowSample(input: {
  readonly resultsRoot: string;
  readonly patterns?: readonly string[];
  readonly experiments: readonly string[];
  readonly fresh?: boolean;
}): ShowJsonSample {
  return Object.freeze({
    resultsRoot: input.resultsRoot,
    ...(input.patterns !== undefined && input.patterns.length > 0
      ? { evalPrefix: input.patterns.join(",") }
      : {}),
    experiments: Object.freeze([...input.experiments]),
    fresh: input.fresh === true,
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

/** Internal host/static document. Public `show --json` never emits this format. */
export {
  renderReportExecutionJson as renderReportShowDocument,
  reportExecutionShowDocument as buildReportShowDocument,
} from "../report/host/presentation.ts";
