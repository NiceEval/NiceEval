import { Result, Schema } from "effect";
import type { AdapterUsageInput } from "../adapter-usage.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { AdapterUsageCallSchema, AdapterUsageLimits, validateAdapterUsageAttachment, type AdapterUsageCall, type AdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import type { EvalResult } from "./types.ts";

const captures = new WeakMap<EvalResult, AdapterUsageAttachment>();
export function retainAdapterUsage(result: EvalResult, value: AdapterUsageAttachment): void {
  if (value.calls.length > 0 || value.collection.state === "partial") captures.set(result, value);
}
export function adapterUsageForResult(result: EvalResult): AdapterUsageAttachment | undefined { return captures.get(result); }

/** Snapshot-only capture remains writable during the independent cleanup window. */
export class AdapterUsageCollector {
  private readonly calls = new Map<string, AdapterUsageCall>();
  private closed = false;
  private failed: Error | undefined;
  get failure(): Error | undefined { return this.failed; }
  constructor(private readonly assertOpen: () => void) {}
  record = (input: AdapterUsageInput): void => {
    if (this.closed) throw new Error("Adapter usage capture is closed");
    this.assertOpen();
    try {
      const decoded = Schema.decodeUnknownResult(AdapterUsageCallSchema, RecordExactParseOptions)({
        ...input,
        retryOf: input.retryOf ?? null,
        inputTotalTokens: input.inputTotalTokens ?? null,
        cacheReadTokens: input.cacheReadTokens ?? null,
        cacheWriteTokens: input.cacheWriteTokens ?? null,
      });
      if (Result.isFailure(decoded)) throw new Error("Invalid Adapter usage snapshot");
      const call = Object.freeze(decoded.success);
      const prior = this.calls.get(call.callId);
      if (prior !== undefined) {
        if (JSON.stringify(prior) !== JSON.stringify(call)) throw new Error("Conflicting Adapter usage snapshot for callId");
        return;
      }
      if (call.retryOf !== null && !this.calls.has(call.retryOf)) throw new Error("Adapter usage retryOf must reference an earlier call in this Attempt");
      if (this.calls.size >= AdapterUsageLimits.maximumCalls) throw new Error("Adapter usage exceeds 4000 calls per Attempt");
      if (validateAdapterUsageAttachment({ collection: { state: "complete", limitations: [] }, calls: [...this.calls.values(), call] }).length > 0) {
        throw new Error("Adapter input token observations are inconsistent or exceed safe integer limits");
      }
      this.calls.set(call.callId, call);
    } catch (cause) {
      this.failed ??= cause instanceof Error ? cause : new Error("Adapter usage capture failed");
      throw cause;
    }
  };
  close(): AdapterUsageAttachment {
    this.closed = true;
    return Object.freeze({
      collection: this.failed === undefined
        ? { state: "complete" as const, limitations: [] as const }
        : { state: "partial" as const, limitations: [{ code: "capture-failed" as const, stage: "adapter-usage" }] as const },
      calls: Object.freeze([...this.calls.values()]),
    });
  }
}
