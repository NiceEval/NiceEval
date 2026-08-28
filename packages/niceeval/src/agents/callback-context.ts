import { Effect } from "effect";

import { attemptResources, bindAttemptResources } from "../context/attempt-resources.ts";
import type { AgentContext } from "./types.ts";

/** Projects the current callback fiber and Attempt cancellation into SDK leaves. */
export function withAgentCallbackContext<Context extends AgentContext, Value, Error>(
  context: Context,
  callback: (context: Context) => Effect.Effect<Value, Error, never>,
  options?: { readonly inheritAttemptSignal?: boolean },
): Effect.Effect<Value, Error, never> {
  return Effect.scoped(Effect.gen(function* () {
    const fiberSignal = yield* Effect.abortSignal;
    const signal = options?.inheritAttemptSignal === false || context.signal === fiberSignal
      ? fiberSignal
      : AbortSignal.any([context.signal, fiberSignal]);
    const callbackContext = { ...context, signal };
    const resources = attemptResources(context);
    if (resources !== undefined) bindAttemptResources(callbackContext, resources);
    return yield* Effect.suspend(() => callback(callbackContext));
  }));
}
