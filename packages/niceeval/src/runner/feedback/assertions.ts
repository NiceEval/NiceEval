import { assertionRoleLabel, assertionRoleCounts, assertionVerdictLine, summaryText } from "../../assertions/display.ts";
import type { SealedAttemptAssertions } from "../../assertions/api.ts";
import type { EvalResult } from "../types.ts";

// Human feedback retains only its small presentation, not source/evidence material.
const linesByResult = new WeakMap<EvalResult, readonly string[]>();

export function captureAssertionFeedback(result: EvalResult, sealed: SealedAttemptAssertions | undefined): void {
  if (sealed === undefined || sealed.entries.length === 0) return;
  const entries = sealed.entries.map(entry => ({ gate: entry.result.gate, result: entry.result.state, contribution: entry.result.score }));
  const earned = entries.reduce((sum, entry) => sum + (entry.contribution.state === "earned" ? entry.contribution.earned : 0), 0);
  const possible = entries.reduce((sum, entry) => sum + (entry.contribution.state === "not-scored" ? 0 : entry.contribution.points), 0);
  linesByResult.set(result, [
    assertionVerdictLine(result.verdict, result.evaluationKind === "score" ? { state: sealed.score?.state ?? "unavailable", earned, possible } : undefined),
    assertionRoleCounts(entries),
    ...sealed.entries.map((entry, index) => `${assertionRoleLabel(entries[index]!)}  ${summaryText(entry.display.label ?? entry.display.key ?? "Assertion")}`),
  ]);
}

export function assertionFeedbackLines(result: EvalResult): readonly string[] {
  return linesByResult.get(result) ?? [];
}
