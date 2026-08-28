import type { Effect } from "effect";

import type { Agent, AgentSendContext, Turn, TurnInput } from "./types.ts";

type AgentSendEffect = (
  input: TurnInput,
  context: AgentSendContext,
) => Effect.Effect<Turn, unknown>;

const sendEffects = new WeakMap<Agent, AgentSendEffect>();

/** Register an Effect-native implementation for a built-in Agent without widening the public Promise ABI. */
export function registerAgentSendEffect<AgentType extends Agent>(
  agent: AgentType,
  send: AgentSendEffect,
): AgentType {
  sendEffects.set(agent, send);
  return agent;
}

/** Internal Runner lookup; third-party Agents continue through their declared Promise boundary. */
export function agentSendEffect(
  agent: Agent,
  input: TurnInput,
  context: AgentSendContext,
): Effect.Effect<Turn, unknown> | undefined {
  return sendEffects.get(agent)?.(input, context);
}
