import type { JudgeDeclaration, JudgeConfig, ResolvedJudgeConfig } from "../types.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_API_KEY_ENV = "NICEEVAL_JUDGE_KEY";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;

/**
 * Resolve Judge Runtime once for a declared Eval capability. The Eval owns
 * only its sealed recipe/material definition; Experiment and project layers
 * own execution configuration. The frozen result is the sole input to
 * precheck, reuse identity, and evaluator execution.
 */
export function resolveJudge(
  experimentJudge: JudgeConfig | undefined,
  declaration: JudgeDeclaration | undefined,
  configJudge: JudgeConfig | undefined,
): ResolvedJudgeConfig | undefined {
  if (declaration === undefined) return undefined;
  // The Eval declaration is capability-only. Runtime connection settings are
  // deliberately resolved only from Experiment/project judgeRuntime layers.
  const maxOutputTokens = experimentJudge?.maxOutputTokens ?? configJudge?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new TypeError("judgeRuntime.maxOutputTokens must be a positive integer");
  return Object.freeze({
    ...(experimentJudge?.model ?? configJudge?.model) === undefined
      ? {}
      : { model: experimentJudge?.model ?? configJudge?.model },
    baseUrl: experimentJudge?.baseUrl ?? configJudge?.baseUrl ?? DEFAULT_BASE_URL,
    apiKeyEnv: experimentJudge?.apiKeyEnv ?? configJudge?.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    timeoutMs: experimentJudge?.timeoutMs ?? configJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputTokens,
  });
}
