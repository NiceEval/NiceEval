import type { JudgeConfig } from "../types.ts";

/**
 * Judge 执行配置逐字段解析。Experiment 是一次可签入的运行变化轴，因此排在 Eval 与
 * 项目默认之前；单条 assertion 的 model 覆盖由 scoring/judge.ts 在调用点处理。
 */
export function resolveJudge(
  experimentJudge: JudgeConfig | undefined,
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): JudgeConfig | undefined {
  if (!experimentJudge && !evalJudge) return configJudge;
  if (!experimentJudge && !configJudge) return evalJudge;
  if (!evalJudge && !configJudge) return experimentJudge;
  return {
    ...pick("model", experimentJudge?.model ?? evalJudge?.model ?? configJudge?.model),
    ...pick("baseUrl", experimentJudge?.baseUrl ?? evalJudge?.baseUrl ?? configJudge?.baseUrl),
    ...pick("apiKeyEnv", experimentJudge?.apiKeyEnv ?? evalJudge?.apiKeyEnv ?? configJudge?.apiKeyEnv),
    ...pick("timeoutMs", experimentJudge?.timeoutMs ?? evalJudge?.timeoutMs ?? configJudge?.timeoutMs),
  };
}

/** 没有来源的可选字段不落成显式 undefined，保持配置“有没有写”的语义。 */
function pick<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
