import { Schema } from "effect";

export const DEFAULT_ADAPTER_CLEANUP_TIMEOUT_MS = 30_000;
export const AdapterCleanupTimeoutMsSchema = Schema.Finite.check(
  Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 300_000 }),
);
export function resolveAdapterCleanupTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_ADAPTER_CLEANUP_TIMEOUT_MS;
  try { return Schema.decodeUnknownSync(AdapterCleanupTimeoutMsSchema)(value); }
  catch (cause) { throw new TypeError("cleanupTimeoutMs must be an integer between 1 and 300000", { cause }); }
}
