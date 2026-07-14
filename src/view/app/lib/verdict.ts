import type { Assertion, Verdict, ViewResult } from "../types.ts";
import type { T } from "../shared.ts";

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
  if (result.error) return result.error.message;
  if (result.skipReason) return result.skipReason;
  return failedGates.map((a: Assertion) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}
