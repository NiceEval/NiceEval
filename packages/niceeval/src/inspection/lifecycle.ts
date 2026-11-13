/** Public projections use current lifecycle names while Record keeps its stable encoding. */
type PublicLifecyclePhase<Phase extends string> =
  Phase extends "agent.ensure" ? "agent.install"
    : Phase extends `agent.ensure.${infer Code}` ? `agent.install.${Code}`
    : Phase extends "niceeval.agent-ensure" ? "niceeval.agent-install"
    : Phase extends `${infer Owner}.setup` ? `${Owner}.before`
    : Phase extends `${infer Owner}.teardown` ? `${Owner}.after`
      : Phase;

export function projectLifecyclePhase<Phase extends string>(phase: Phase): PublicLifecyclePhase<Phase> {
  return phase.replace(/^agent\.ensure(?=\.|$)/, "agent.install").replace(/^niceeval\.agent-ensure$/, "niceeval.agent-install").replace(/\.setup$/, ".before").replace(/\.teardown$/, ".after") as PublicLifecyclePhase<Phase>;
}
