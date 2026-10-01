/** The Attempt owner fixes the first execution cancellation cause. */
export type AttemptCancellation =
  | { readonly kind: "timeout"; readonly timeoutMs: number;
      readonly source: "flag" | "experiment" | "eval" | "config"; readonly deadlineAt: number }
  | { readonly kind: "cancelled" };

/** Runtime-owned signal: the reason is absent until the Attempt is cancelled. */
export interface AttemptSignal extends AbortSignal {
  readonly reason: AttemptCancellation | undefined;
}
