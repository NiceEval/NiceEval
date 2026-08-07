import { describe, expect, it } from "vitest";
import { defined, only, pollUntil } from "../src/primitives.js";

describe("only", () => {
  it("returns the single matching element", () => {
    expect(only([1, 2, 3], (n) => n === 2)).toBe(2);
  });

  it("throws when zero matches", () => {
    expect(() => only([1, 2], (n) => n === 9)).toThrow(
      /expected exactly one match, got 0/,
    );
  });

  it("throws when more than one match", () => {
    expect(() => only([1, 1, 2], (n) => n === 1)).toThrow(
      /expected exactly one match, got 2/,
    );
  });

  it("uses a custom diagnostic string", () => {
    expect(() => only([], () => true, "need one item")).toThrow("need one item");
  });

  it("uses a custom diagnostic function", () => {
    expect(() => only([1, 2], () => true, () => `count=${2}`)).toThrow("count=2");
  });
});

describe("defined", () => {
  it("returns defined values", () => {
    expect(defined(0)).toBe(0);
    expect(defined("")).toBe("");
    expect(defined(false)).toBe(false);
  });

  it("throws on null and undefined", () => {
    expect(() => defined(null)).toThrow(/expected a defined value/);
    expect(() => defined(undefined)).toThrow(/expected a defined value/);
  });

  it("uses custom diagnostics", () => {
    expect(() => defined(undefined, "missing")).toThrow("missing");
    expect(() => defined(null, () => "gone")).toThrow("gone");
  });
});

describe("pollUntil", () => {
  it("returns the first defined probe value", async () => {
    let n = 0;
    const value = await pollUntil(
      async () => {
        n += 1;
        return n >= 3 ? "ready" : undefined;
      },
      { timeoutMs: 1000, intervalMs: 5, label: "ready-flag" },
    );
    expect(value).toBe("ready");
    expect(n).toBe(3);
  });

  it("times out with label when probe stays undefined", async () => {
    await expect(
      pollUntil(async () => undefined, {
        timeoutMs: 40,
        intervalMs: 10,
        label: "never-ready",
      }),
    ).rejects.toThrow(/never-ready: timed out after 40ms/);
  });

  it("attaches the last probe error as cause on timeout", async () => {
    try {
      await pollUntil(
        async () => {
          throw new Error("probe-boom");
        },
        { timeoutMs: 40, intervalMs: 10, label: "failing-probe" },
      );
      expect.fail("expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/failing-probe: timed out/);
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(((error as Error).cause as Error).message).toBe("probe-boom");
    }
  });

  it("succeeds after transient probe errors", async () => {
    let n = 0;
    const value = await pollUntil(
      async () => {
        n += 1;
        if (n < 2) {
          throw new Error("transient");
        }
        return 42;
      },
      { timeoutMs: 1000, intervalMs: 5, label: "recover" },
    );
    expect(value).toBe(42);
  });
});
