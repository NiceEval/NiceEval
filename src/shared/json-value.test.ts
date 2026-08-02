// cases: docs/engineering/testing/unit/adapters.md
import { describe, expect, it } from "vitest";

import { isJsonValue, normalizeJsonValue } from "./json-value.ts";

describe("JSON value boundary", () => {
  it("keeps an already valid JSON tree strongly typed", () => {
    const value = { ok: true, rows: [1, "two", null] };
    expect(isJsonValue(value)).toBe(true);
    expect(normalizeJsonValue(value)).toBe(value);
  });

  it("cleans serializable SDK objects before they enter domain events", () => {
    const value = { createdAt: new Date("2026-08-02T00:00:00.000Z"), omitted: undefined };
    expect(normalizeJsonValue(value)).toEqual({ createdAt: "2026-08-02T00:00:00.000Z" });
  });

  it("uses a typed fallback for values JSON cannot represent", () => {
    const cyclic: { self?: object } = {};
    cyclic.self = cyclic;
    expect(normalizeJsonValue(cyclic, { invalid: true })).toEqual({ invalid: true });
    expect(normalizeJsonValue(1n)).toBeNull();
  });
});
