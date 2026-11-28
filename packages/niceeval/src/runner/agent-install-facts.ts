import type { AgentInstallFact } from "../record/family/agent-install/schema.ts";
import type { EvalResult } from "./types.ts";

const factsByResult = new WeakMap<EvalResult, readonly AgentInstallFact[]>();

export function retainAgentInstallFacts(result: EvalResult, facts: readonly AgentInstallFact[]): void {
  if (facts.length > 0) factsByResult.set(result, [...facts]);
}

export function agentInstallFactsForResult(result: EvalResult): readonly AgentInstallFact[] | undefined {
  return factsByResult.get(result);
}
