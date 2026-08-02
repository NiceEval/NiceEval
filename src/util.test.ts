// cases: docs/engineering/testing/unit/assertions.md
import { describe, expect, it } from "vitest";
import { brief, formatThrown, upsertManagedBlock } from "./util.ts";

describe("brief", () => {
  // JSON.stringify(undefined) 返回值 undefined(不是字符串 "undefined"),不特殊处理会让
  // 下游 `s.length` 抛 TypeError——真实复现见 previewCheckedValue 断言 undefined 字段值时
  // (2026-07-13 codex native plugin e2e,resolvedVersion 缺失时 equals() 的 gate 预览崩溃)。
  it("does not throw on undefined and returns a readable placeholder", () => {
    expect(() => brief(undefined)).not.toThrow();
    expect(brief(undefined)).toBe("undefined");
  });

  it("still handles ordinary values (string passthrough, object JSON-stringified)", () => {
    expect(brief("hello")).toBe("hello");
    expect(brief({ a: 1 })).toBe('{"a":1}');
  });

  it("truncates long output with an ellipsis", () => {
    const long = "x".repeat(300);
    expect(brief(long, 10)).toBe(`${"x".repeat(10)}…`);
  });
});

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
