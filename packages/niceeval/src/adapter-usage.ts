/** Final observation of one physical external request, scoped to an Adapter Attempt. */
export interface AdapterUsageInput {
  readonly callId: string;
  readonly retryOf?: string;
  /** Upstream-proven serving provider. Transport and protocol identities belong in route. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly route?: {
    readonly transportProvider: string | null;
    /** Stable, non-secret endpoint identity. Never include URLs, account identifiers, or credentials. */
    readonly endpointId: string | null;
  };
  readonly status: "succeeded" | "failed" | "cancelled" | "unknown";
  /** Input tokens excluding the cache read and cache write buckets. */
  readonly inputTokens: number | null;
  /** Independently observed input total including cache buckets; never added to those buckets. */
  readonly inputTotalTokens?: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens?: number | null;
  readonly cacheWriteTokens?: number | null;
  /** One provider-reported effective cost. A reported zero remains preferred to estimates. */
  readonly cost?: {
    readonly amount: string;
    readonly currency: string;
    readonly source: { readonly kind: "reported"; readonly id: string };
  };
}
