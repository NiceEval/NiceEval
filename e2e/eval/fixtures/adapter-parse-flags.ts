import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { defineAdapter } from "niceeval";

export type ParsedFlags = { strategy: "safe" | "fast"; limit: number; enabled: boolean };
let parses = 0;
export let parsedOutput: ParsedFlags | undefined;
const mode = process.env.NICEEVAL_E2E_FLAGS_MODE;
function parseFlags(value: unknown): ParsedFlags {
  parses++;
  if (mode === "promise") return Promise.reject(new Error("async parser rejected")) as never;
  if (mode === "thenable") return { then(_resolve: unknown, reject: (error: Error) => void) { reject(new Error("thenable rejected")); } } as never;
  if (mode === "nested") return { nested: { enabled: true } } as never;
  if (mode === "null") return { limit: null } as never;
  if (mode === "date") return { nested: new Date() } as never;
  if (mode === "undefined") return { nested: undefined } as never;
  if (mode === "nan") return { nested: NaN } as never;
  if (mode === "array") return [] as never;
  if (mode === "sparse") return { nested: new Array(1) } as never;
  if (mode === "symbol") return { [Symbol("hidden")]: 1 } as never;
  if (mode === "getter") return { get nested() { throw new Error("getter must not run"); } } as never;
  if (mode === "cycle") {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    return cyclic as never;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("flags must be an object");
  for (const key of Object.keys(value)) {
    if (key !== "strategy" && key !== "limit") throw new TypeError(`unknown flags key: ${key}`);
  }
  const input = value as { strategy?: "safe" | "fast"; limit?: string | number };
  if (input.strategy !== undefined && input.strategy !== "safe" && input.strategy !== "fast") throw new TypeError("flags.strategy is invalid");
  const limit = Number(input.limit ?? 2);
  if (!Number.isFinite(limit)) throw new TypeError("flags.limit is invalid");
  if (limit > (process.env.NICEEVAL_E2E_FLAGS_REVISION === "parser/v2" ? 5 : 10)) throw new TypeError("flags.limit exceeds parser bound");
  parsedOutput = { strategy: input.strategy ?? "safe", limit, enabled: true };
  return parsedOutput;
}

export const flagsAdapter = defineAdapter({
  name: "parsed-flags",
  behaviorRevision: process.env.NICEEVAL_E2E_FLAGS_REVISION || "parser/v1",
  parseFlags,
  create(ctx) {
    assert.equal(parses, 1, "parse exactly once before create");
    assert.notEqual(ctx.flags, parsedOutput);
    assert.deepEqual(ctx.flags, { strategy: "safe", limit: 2, enabled: true });
    assert.equal(Object.isFrozen(ctx.flags), true);
    appendFileSync("flags-lifecycle.txt", "create\n");
    return { readLimit: () => ctx.flags.limit };
  },
});
