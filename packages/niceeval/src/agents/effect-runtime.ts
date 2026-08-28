import { Effect } from "effect";

import type { Agent, AgentContext, AgentSendContext, SandboxAgentSetupContext, SandboxAgentSendContext, Turn, TurnInput } from "./types.ts";
import type { Sandbox } from "../sandbox/types.ts";

type AgentSendEffect = (
  input: TurnInput,
  context: AgentSendContext,
) => Effect.Effect<Turn, unknown>;

const sendEffects = new WeakMap<Agent, AgentSendEffect>();
type AgentSetupEffect = (sandbox: Sandbox, context: SandboxAgentSetupContext) => Effect.Effect<void, unknown>;
type DirectAgentSetupEffect = (context: AgentContext) => Effect.Effect<void, unknown>;
type AgentTeardownEffect = (sandbox: Sandbox, context: AgentContext) => Effect.Effect<void, unknown>;
type DirectAgentTeardownEffect = (context: AgentContext) => Effect.Effect<void, unknown>;

interface AgentEffectRuntime {
  readonly send?: AgentSendEffect;
  readonly sandboxSetup?: AgentSetupEffect;
  readonly directSetup?: DirectAgentSetupEffect;
  readonly sandboxTeardown?: AgentTeardownEffect;
  readonly directTeardown?: DirectAgentTeardownEffect;
}

const runtimes = new WeakMap<Agent, AgentEffectRuntime>();
const callbackEffects = new WeakMap<Function, Function>();

/**
 * Builds a public Promise callback from an Effect implementation. Built-in
 * adapters use this only to preserve their documented ABI; Runner lookup uses
 * the registered Effect directly in its owning fiber.
 */
export function effectAgentCallback<Args extends readonly unknown[], Value>(
  effect: (...args: Args) => Effect.Effect<Value, unknown>,
  signal: (...args: Args) => AbortSignal | undefined,
): (...args: Args) => Promise<Value> {
  const callback = (...args: Args) => Effect.runPromise(effect(...args), { signal: signal(...args) });
  callbackEffects.set(callback, effect);
  return callback;
}

function callbackEffect<Args extends readonly unknown[], Value>(
  callback: ((...args: Args) => unknown) | undefined,
  ...args: Args
): Effect.Effect<Value, unknown> | undefined {
  const effect = callback === undefined ? undefined : callbackEffects.get(callback) as
    | ((...values: Args) => Effect.Effect<Value, unknown>)
    | undefined;
  return effect?.(...args);
}

/** Registers an internal Effect implementation while retaining the public Promise Agent ABI. */
export function registerAgentEffectRuntime<AgentType extends Agent>(
  agent: AgentType,
  runtime: AgentEffectRuntime,
): AgentType {
  runtimes.set(agent, runtime);
  if (runtime.send !== undefined) sendEffects.set(agent, runtime.send);
  return agent;
}

export function agentSetupEffect(agent: Agent, sandbox: Sandbox, context: SandboxAgentSetupContext | AgentContext) {
  const runtime = runtimes.get(agent);
  return agent.kind === "sandbox"
    ? runtime?.sandboxSetup?.(sandbox, context as SandboxAgentSetupContext) ?? callbackEffect(agent.setup, sandbox, context as SandboxAgentSetupContext)
    : runtime?.directSetup?.(context) ?? callbackEffect(agent.setup, context);
}

export function agentTeardownEffect(agent: Agent, sandbox: Sandbox, context: AgentContext) {
  const runtime = runtimes.get(agent);
  return agent.kind === "sandbox"
    ? runtime?.sandboxTeardown?.(sandbox, context) ?? callbackEffect(agent.teardown, sandbox, context as AgentContext & { readonly sandbox: Sandbox })
    : runtime?.directTeardown?.(context) ?? callbackEffect(agent.teardown, context);
}

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
  return sendEffects.get(agent)?.(input, context) ?? (agent.kind === "sandbox"
    ? callbackEffect(agent.send, input, context as SandboxAgentSendContext)
    : callbackEffect(agent.send, input, context));
}
