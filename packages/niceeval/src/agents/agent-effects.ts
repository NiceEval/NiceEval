import { Effect } from "effect";

import type { Agent, AgentContext, AgentSendContext, AgentBeforeContext, Turn, TurnInput } from "./types.ts";
import type { Sandbox } from "../sandbox/types.ts";

export type AgentSendEffect = (input: TurnInput, context: AgentSendContext) => Effect.Effect<Turn, unknown, never>;

export interface AgentEffects {
  readonly send: AgentSendEffect;
  readonly before?: (sandbox: Sandbox, context: AgentBeforeContext) => Effect.Effect<void, unknown, never>;
  readonly after?: (sandbox: Sandbox, context: AgentContext) => Effect.Effect<void, unknown, never>;
}

const effects = new WeakMap<Agent, AgentEffects>();

/** Promise facade for built-in adapters; Runner uses the registered Effect directly. */
export function effectAgentCallback<Args extends readonly unknown[], Value>(
  effect: (...args: Args) => Effect.Effect<Value, unknown, never>,
  signal: (...args: Args) => AbortSignal | undefined,
): (...args: Args) => Promise<Value> {
  return (...args) => Effect.runPromise(effect(...args), { signal: signal(...args) });
}

export function attachAgentEffects<AgentType extends Agent>(agent: AgentType, value: AgentEffects): AgentType {
  effects.set(agent, value);
  return agent;
}

/** Adapts the public Promise callback once; legacy Effect values remain an untyped runtime fallback. */
export function authorCallbackEffect<Value>(
  callback: () => Promise<Value> | Value,
): Effect.Effect<Value, unknown, never> {
  return Effect.suspend(() => {
    const result: unknown = callback();
    if (Effect.isEffect(result)) return result as Effect.Effect<Value, unknown, never>;
    return Effect.tryPromise({
      try: () => Promise.resolve(result as Value),
      catch: (cause) => cause,
    });
  });
}

export function agentSendEffect(
  agent: Agent,
  input: TurnInput,
  context: AgentSendContext,
): Effect.Effect<Turn, unknown, never> | undefined {
  return effects.get(agent)?.send(input, context);
}

export function agentBeforeEffect(
  agent: Agent,
  sandbox: Sandbox,
  context: AgentBeforeContext,
): Effect.Effect<void, unknown, never> | undefined {
  return effects.get(agent)?.before?.(sandbox, context);
}

export function agentAfterEffect(
  agent: Agent,
  sandbox: Sandbox,
  context: AgentContext,
): Effect.Effect<void, unknown, never> | undefined {
  return effects.get(agent)?.after?.(sandbox, context);
}

export type InternalSandboxAgentDefinition = AgentEffects;

export type InternalDirectAgentDefinition = {
  readonly send: (input: TurnInput, context: AgentSendContext) => Effect.Effect<Turn, unknown, never>;
  readonly before?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
  readonly after?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
};
