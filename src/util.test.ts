import { describe, expect, it } from "vitest";
import { formatThrown, upsertManagedBlock } from "./util.ts";

describe("upsertManagedBlock", () => {
  const begin = "<!-- BEGIN:x -->";
  const end = "<!-- END:x -->";

  it("appends the block to existing content, separated by a blank line", () => {
    const out = upsertManagedBlock("# My project\n", begin, end, "rules");
    expect(out).toBe(`# My project\n\n${begin}\nrules\n${end}\n`);
  });

  it("creates just the block when the file is empty", () => {
    expect(upsertManagedBlock("", begin, end, "rules")).toBe(`${begin}\nrules\n${end}\n`);
  });

  it("replaces only the content between existing markers, preserving what surrounds them", () => {
    const before = `above\n\n${begin}\nold rules\n${end}\n\nbelow\n`;
    const out = upsertManagedBlock(before, begin, end, "new rules");
    expect(out).toBe(`above\n\n${begin}\nnew rules\n${end}\n\nbelow\n`);
  });

  it("is idempotent for the same content", () => {
    const once = upsertManagedBlock("# hi\n", begin, end, "rules");
    expect(upsertManagedBlock(once, begin, end, "rules")).toBe(once);
  });
});

describe("formatThrown", () => {
  it("uses the stack trace when available, so the report can locate the throw site", () => {
    function throwsFromHere(): never {
      throw new TypeError("Cannot read properties of undefined (reading 'text')");
    }
    let caught: unknown;
    try {
      throwsFromHere();
    } catch (e) {
      caught = e;
    }
    const formatted = formatThrown(caught);
    expect(formatted).toContain("TypeError: Cannot read properties of undefined (reading 'text')");
    expect(formatted).toContain("throwsFromHere");
    expect(formatted).toContain("util.test.ts");
  });

  it("falls back to name: message when the error has no stack", () => {
    const e = new Error("boom");
    delete (e as { stack?: string }).stack;
    expect(formatThrown(e)).toBe("Error: boom");
  });

  it("stringifies non-Error thrown values", () => {
    expect(formatThrown("just a string")).toBe("just a string");
    expect(formatThrown(42)).toBe("42");
  });
});
