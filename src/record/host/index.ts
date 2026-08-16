/**
 * Public, supported high-level Host composition boundary for scoped Record
 * I/O. `niceeval/record` re-exports this same Host; durable definitions,
 * fixed-family registration, and migration factories remain package-private.
 */
export { recordHost } from "./runtime.ts";
export type { RecordHostSDK } from "./types.ts";
