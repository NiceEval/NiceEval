import type { Assertion, Outcome, ViewResult, ViewRow } from "../types.ts";
import type { T } from "../shared.ts";
import { formatScore } from "./format.ts";

// 折叠口径与 server 聚合共用一份实现,见 src/shared/outcome.ts。
import { foldEvalOutcome } from "../../../shared/outcome.ts";

export { foldEvalOutcome };

export interface EvalGroup {
  id: string;
  experimentId?: string;
  outcome: Outcome;
  attempts: ViewResult[];
  passedAttempts: number;
}

/** 把一批 attempt 按 (experimentId, eval id) 折叠成「每个 eval 一行」,内部 attempt 按轮次排序。 */
export function groupByEval(results: ViewResult[]): EvalGroup[] {
  const byEval = new Map<string, ViewResult[]>();
  for (const r of results) {
    const key = `${r.experimentId ?? ""}|||${r.id}`;
    byEval.set(key, [...(byEval.get(key) ?? []), r]);
  }
  return [...byEval.values()].map((attempts) => {
    const sorted = [...attempts].sort((a, b) => a.attempt - b.attempt);
    return {
      id: sorted[0]!.id,
      experimentId: sorted[0]!.experimentId,
      outcome: foldEvalOutcome(sorted),
      attempts: sorted,
      passedAttempts: sorted.filter((a) => a.outcome === "passed").length,
    };
  });
}

/** 成功率按 eval 计票:折叠后通过的 eval 占已跑(非 skipped)eval 的比例。 */
export function evalPassRate(results: ViewResult[]): number {
  const ran = groupByEval(results).filter((g) => g.outcome !== "skipped");
  return ran.length ? ran.filter((g) => g.outcome === "passed").length / ran.length : 0;
}

export function outcomeClass(outcome: Outcome): string {
  return outcome === "passed" ? "good" : outcome === "errored" ? "infra-err" : outcome === "failed" ? "bad" : "warn";
}

export function outcomeLabel(outcome: Outcome, t: T): string {
  if (outcome === "passed") return t("status.pass");
  if (outcome === "failed") return t("status.fail");
  if (outcome === "errored") return t("status.error");
  if (outcome === "skipped") return t("status.skipped");
  return outcome || "—";
}

// Only gate-severity failures are eval "failure reasons"; soft failures show as scores
export function failingAssertions(result: ViewResult): Assertion[] {
  return (result.assertions || []).filter((a: Assertion) => !a.passed && a.severity === "gate");
}

export function reasonFor(result: ViewResult, failedGates: Assertion[]): string {
  if (result.error) return result.error;
  if (result.skipReason) return result.skipReason;
  return failedGates.map((a: Assertion) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}

export function scoresSummary(assertions: Assertion[]): string {
  const scored = (assertions || []).filter((a: Assertion) => a.score !== undefined && a.score !== null);
  if (!scored.length) return "";
  return scored
    .map((a: Assertion) => {
      const s = formatScore(a.score);
      return a.threshold !== undefined ? `${a.name} ${s}/${formatScore(a.threshold)}` : `${a.name} ${s}`;
    })
    .join(" · ");
}

export function outcomeSummary(row: ViewRow, t: T): string {
  // Fold legacy "scored" rows into the passed count.
  const passed = (row.passed || 0) + (row.scored || 0);
  const parts = [`${passed} ${t("outcome.passed")}`, `${row.failed} ${t("outcome.failed")}`];
  if (row.errored) parts.push(`${row.errored} ${t("outcome.errored")}`);
  if (row.skipped) parts.push(`${row.skipped} ${t("outcome.skipped")}`);
  return parts.join(" / ");
}
