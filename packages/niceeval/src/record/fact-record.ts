import type { ScoreFactAttemptOutcome } from "../assertions/types.ts";
import type { EvalResult } from "../runner/types.ts";
import type { Verdict } from "../shared/types.ts";
import {
  attemptTerminalOf as sharedAttemptTerminalOf,
  verdictForTerminal as sharedVerdictForTerminal,
} from "../shared/verdict.ts";

type AttemptTerminal = Verdict | ScoreFactAttemptOutcome["status"];

export function attemptTerminalOf(result: EvalResult): AttemptTerminal {
  return sharedAttemptTerminalOf({
    verdict: result.verdict,
    ...(result.evaluationKind === "score" && result.scoreResult !== undefined
      ? { evaluationKind: "score", scoreResult: result.scoreResult }
      : {}),
  });
}

export function verdictForTerminal(result: EvalResult): Verdict {
  return sharedVerdictForTerminal(attemptTerminalOf(result));
}

export function scoreOutcomeOf(result: EvalResult): ScoreFactAttemptOutcome | undefined {
  return result.evaluationKind === "score" ? result.scoreResult : undefined;
}
