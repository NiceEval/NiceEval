import type { AgentContext, AttemptResourceRegistry } from "../types.ts";

const ATTEMPT_RESOURCES = new WeakMap<AgentContext, AttemptResourceRegistry>();

export function bindAttemptResources<T extends AgentContext>(ctx: T, resources: AttemptResourceRegistry): T {
  ATTEMPT_RESOURCES.set(ctx, resources);
  return ctx;
}

export function attemptResources(ctx: AgentContext): AttemptResourceRegistry | undefined {
  return ATTEMPT_RESOURCES.get(ctx);
}
