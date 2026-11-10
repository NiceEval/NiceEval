/** Server-side safety bound; never a command timeout or an idle-pause setting. */
export const CLOUD_TIMEOUT_BUFFER_MS = 120_000;
export const DEFAULT_CLOUD_LIFETIME_MS = 900_000;

export function cloudLifetimeMs(explicit: number | undefined, attemptTimeoutMs?: number): number {
  return explicit ?? (attemptTimeoutMs === undefined
    ? DEFAULT_CLOUD_LIFETIME_MS
    : attemptTimeoutMs + CLOUD_TIMEOUT_BUFFER_MS);
}

export function sandboxCreationMetadata(runId: string | undefined, createdAt = new Date().toISOString()): Record<string, string> {
  return {
    ...(runId === undefined ? {} : { "niceeval.run_id": runId }),
    "niceeval.created_at": createdAt,
  };
}
