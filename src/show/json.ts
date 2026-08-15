import {
  builtInShowData,
  builtInShowProblemTable,
} from "../report/built-in/attempt-evidence-json.ts";
import type { ClosedSiteRevision } from "../report/execution/model.ts";
import { builtInShowResult } from "../report/execution/results.ts";
import { canonicalJson, jsonValue } from "../report/host/presentation.ts";

export type ShowJsonView = "leaderboard" | "attempt" | "source" | "execution" | "timing";

export interface ShowJsonDocument {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly view: ShowJsonView;
  readonly sample: Readonly<Record<string, unknown>>;
  readonly problemTable: readonly unknown[];
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Builds the public domain document solely from a fully closed execution.
 * Undefined is intentional: custom Reports remain on the generic Report
 * presentation contract instead of being guessed from their title or tree.
 */
export function buildShowDocument(
  revision: ClosedSiteRevision,
): ShowJsonDocument | undefined {
  const { execution } = revision;
  const result = builtInShowResult(execution.results);
  if (result === undefined) return undefined;
  const problemTable = builtInShowProblemTable({ result, problemTable: execution.problemTable });
  return Object.freeze({
    format: "niceeval.show" as const,
    schemaVersion: 1 as const,
    view: result.kind,
    sample: Object.freeze({
      identity: jsonValue(execution.sample.identity),
      selection: jsonValue(execution.sample.selection),
      coverage: jsonValue(execution.sample.coverage),
      runCount: execution.sample.runCount,
      slotCount: execution.sample.slotCount,
      denominator: execution.sample.denominator,
    }),
    problemTable: Object.freeze(problemTable.map((problem) => jsonValue(problem))),
    data: builtInShowData({ result, problemTable }),
  });
}

/** Deterministic terminal bytes for an already-selected built-in domain view. */
export function renderShowJson(revision: ClosedSiteRevision): string | undefined {
  const document = buildShowDocument(revision);
  return document === undefined ? undefined : `${canonicalJson(document)}\n`;
}
