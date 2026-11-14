import { defineScoreMatch, type ManagedScoreMatchOptions, type ScoreMatch, type ScoreMatchLlmFailure } from "./match.ts";
import { ordinaryJudgeIdentity } from "../runner/judge-identity.ts";
import { canonicalScoreMatchAuditJson } from "./score-match-audit.ts";
import { InspectionSha256 } from "../inspection/bytes.ts";

/** Built-in recipes derive their identity from actual declarations and library behavior. */
export function defineBuiltinScoreMatch<T, E = ScoreMatchLlmFailure>(
  options: Omit<ManagedScoreMatchOptions<T, E>, "version">,
): ScoreMatch<T> {
  const content = canonicalScoreMatchAuditJson({ name: options.name, config: options.config, judge: ordinaryJudgeIdentity() });
  const version = new InspectionSha256().update(new TextEncoder().encode(content)).digestHex();
  return defineScoreMatch({ ...options, version });
}
