import type { JudgeDeclaration, JudgeConfig, ResolvedJudgeConfig } from "../types.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_API_KEY_ENV = "NICEEVAL_JUDGE_KEY";
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Resolve Judge once for a declared Eval capability. `true` inherits the
 * Experiment and project configuration; an Eval object both declares the
 * capability and overrides those layers. The frozen result is the sole input
 * to fingerprinting, precheck, and evaluator execution.
 */
export function resolveJudge(
  experimentJudge: JudgeConfig | undefined,
  declaration: JudgeDeclaration | undefined,
  configJudge: JudgeConfig | undefined,
): ResolvedJudgeConfig | undefined {
  if (declaration === undefined) return undefined;
  const evalJudge = declaration === true ? undefined : declaration;
  return Object.freeze({
    ...(evalJudge?.model ?? experimentJudge?.model ?? configJudge?.model) === undefined
      ? {}
      : { model: evalJudge?.model ?? experimentJudge?.model ?? configJudge?.model },
    baseUrl: evalJudge?.baseUrl ?? experimentJudge?.baseUrl ?? configJudge?.baseUrl ?? DEFAULT_BASE_URL,
    apiKeyEnv: evalJudge?.apiKeyEnv ?? experimentJudge?.apiKeyEnv ?? configJudge?.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    timeoutMs: evalJudge?.timeoutMs ?? experimentJudge?.timeoutMs ?? configJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
