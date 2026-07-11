import type { Assertion, Verdict, ViewResult, ViewRow } from "../types.ts";
import type { T } from "../shared.ts";
import { formatScore } from "./format.ts";

// 折叠口径与 server 聚合共用一份实现,见 src/shared/verdict.ts。
import { foldEvalVerdict } from "../../../shared/verdict.ts";

export { foldEvalVerdict };

export interface EvalGroup {
  id: string;
  experimentId?: string;
  verdict: Verdict;
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
      verdict: foldEvalVerdict(sorted),
      attempts: sorted,
      passedAttempts: sorted.filter((a) => a.verdict === "passed").length,
    };
  });
}

/** 成功率按 eval 计票:折叠后通过的 eval 占已跑(非 skipped)eval 的比例。 */
export function evalPassRate(results: ViewResult[]): number {
  const ran = groupByEval(results).filter((g) => g.verdict !== "skipped");
  return ran.length ? ran.filter((g) => g.verdict === "passed").length / ran.length : 0;
}

export function verdictClass(verdict: Verdict): string {
  return verdict === "passed" ? "good" : verdict === "errored" ? "infra-err" : verdict === "failed" ? "bad" : "warn";
}

export function verdictLabel(verdict: Verdict, t: T): string {
  if (verdict === "passed") return t("status.pass");
  if (verdict === "failed") return t("status.fail");
  if (verdict === "errored") return t("status.error");
  if (verdict === "skipped") return t("status.skipped");
  return verdict || "—";
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

export function verdictSummary(row: ViewRow, t: T): string {
  const parts = [`${row.passed} ${t("verdict.passed")}`, `${row.failed} ${t("verdict.failed")}`];
  if (row.errored) parts.push(`${row.errored} ${t("verdict.errored")}`);
  if (row.skipped) parts.push(`${row.skipped} ${t("verdict.skipped")}`);
  return parts.join(" / ");
}
