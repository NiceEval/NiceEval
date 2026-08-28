import { Effect } from "effect";

import type {
  Agent,
  AgentContext,
  AgentSendContext,
  SandboxAgentSetupContext,
  SandboxAgentSendContext,
  Turn,
  TurnInput,
} from "./types.ts";
import type { Sandbox } from "../sandbox/types.ts";

export type AgentSendEffect = (
  input: TurnInput,
  context: AgentSendContext,
) => Effect.Effect<Turn, unknown, never>;

export interface AgentEffectRuntime {
  readonly send: AgentSendEffect;
  readonly sandboxSetup?: (
    sandbox: Sandbox,
    context: SandboxAgentSetupContext,
  ) => Effect.Effect<void, unknown, never>;
  readonly directSetup?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
  readonly sandboxTeardown?: (
    sandbox: Sandbox,
    context: AgentContext,
  ) => Effect.Effect<void, unknown, never>;
  readonly directTeardown?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
}

const runtimes = new WeakMap<Agent, AgentEffectRuntime>();

/** Promise facade for built-in adapters; Runner uses the registered Effect directly. */
export function effectAgentCallback<Args extends readonly unknown[], Value>(
  effect: (...args: Args) => Effect.Effect<Value, unknown, never>,
  signal: (...args: Args) => AbortSignal | undefined,
): (...args: Args) => Promise<Value> {
  return (...args) => Effect.runPromise(effect(...args), { signal: signal(...args) });
}

export function registerAgentEffectRuntime<AgentType extends Agent>(
  agent: AgentType,
  runtime: AgentEffectRuntime,
): AgentType {
  runtimes.set(agent, runtime);
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
  return runtimes.get(agent)?.send(input, context);
}

export function agentSetupEffect(
  agent: Agent,
  sandbox: Sandbox,
  context: SandboxAgentSetupContext | AgentContext,
): Effect.Effect<void, unknown, never> | undefined {
  const runtime = runtimes.get(agent);
  return agent.kind === "sandbox"
    ? runtime?.sandboxSetup?.(sandbox, context as SandboxAgentSetupContext)
    : runtime?.directSetup?.(context);
}

export function agentTeardownEffect(
  agent: Agent,
  sandbox: Sandbox,
  context: AgentContext,
): Effect.Effect<void, unknown, never> | undefined {
  const runtime = runtimes.get(agent);
  return agent.kind === "sandbox"
    ? runtime?.sandboxTeardown?.(sandbox, context)
    : runtime?.directTeardown?.(context);
}

export type InternalSandboxAgentDefinition = {
  readonly send: (input: TurnInput, context: SandboxAgentSendContext) => Effect.Effect<Turn, unknown, never>;
  readonly setup?: (sandbox: Sandbox, context: SandboxAgentSetupContext) => Effect.Effect<void, unknown, never>;
  readonly teardown?: (sandbox: Sandbox, context: AgentContext) => Effect.Effect<void, unknown, never>;
};

export type InternalDirectAgentDefinition = {
  readonly send: (input: TurnInput, context: AgentSendContext) => Effect.Effect<Turn, unknown, never>;
  readonly setup?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
  readonly teardown?: (context: AgentContext) => Effect.Effect<void, unknown, never>;
};
