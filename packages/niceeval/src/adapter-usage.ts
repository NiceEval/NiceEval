/** Final observation of one physical external request, scoped to an Adapter Attempt. */
export interface AdapterUsageInput {
  readonly callId: string;
  readonly retryOf?: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly status: "succeeded" | "failed" | "cancelled" | "unknown";
  /** Input tokens excluding the cache read and cache write buckets. */
  readonly inputTokens: number | null;
  /** Independently observed input total including cache buckets; never added to those buckets. */
  readonly inputTotalTokens?: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens?: number | null;
  readonly cacheWriteTokens?: number | null;
}
