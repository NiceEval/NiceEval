import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { trimConversationMaterial } from "./conversation-material.ts";

/** Shared opening/primitive material admission. The encoder includes rules and
 * protocol framing, but represents image parts by references rather than base64.
 * UTF-8 bytes / 3 is a deterministic estimate, not a provider tokenizer. */
export function fitJudgeContext<T>(input: {
  readonly model: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens: number;
  readonly material: T;
  readonly encodeRequest: (material: T) => string;
}):
  | { readonly state: "available"; readonly material: T; readonly contextWindow?: number; readonly estimatedTokens?: number }
  | { readonly state: "unavailable"; readonly code: "judge-material-exceeds-context"; readonly message: string; readonly contextWindow: number; readonly estimatedTokens: number } {
  const contextWindow = input.contextWindow ?? builtinContextWindow(input.model);
  if (contextWindow === undefined) return { state: "available", material: input.material };
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  const estimate = (material: T) => Math.ceil(bytes(input.encodeRequest(material)) / 3) + input.maxOutputTokens;
  const originalEstimate = estimate(input.material);
  const material = originalEstimate <= contextWindow ? input.material : trimConversationMaterial(
    input.material, Math.max(0, (contextWindow - input.maxOutputTokens) * 3), input.encodeRequest,
  );
  const estimatedTokens = estimate(material);
  if (estimatedTokens > contextWindow) return {
    state: "unavailable", code: "judge-material-exceeds-context", contextWindow, estimatedTokens,
    message: `Judge request estimates ${estimatedTokens} tokens (before trimming: ${originalEstimate}), exceeding context window ${contextWindow} tokens including ${input.maxOutputTokens} output tokens.`,
  };
  return { state: "available", material, contextWindow, estimatedTokens };
}

/** Provider context errors are material unavailability, including unknown models. */
export function isJudgeContextOverflow(body: string): boolean {
  return /context[_ -](?:length[_ -]exceeded|window|overflow)|maximum context length|too many tokens|prompt is too long|input (?:is )?too long|exceeds? (?:the )?(?:model(?:'s)? )?(?:maximum )?(?:context|token)/iu.test(body);
}
