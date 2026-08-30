import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Structured Memory is discovered through the managed CLI. INDEX.md remains the
// recall owner only for legacy Markdown entries that predate niceeval.memory/v1.
const MEMORY_DIR = join(import.meta.dirname, "../..", "memory");

const isStructuredMemory = (filename: string): boolean =>
  readFileSync(join(MEMORY_DIR, filename), "utf8").startsWith(
    "---\nformat: niceeval.memory/v1\n",
  );

describe("memory/INDEX.md", () => {
  it("每个 legacy memory 条目都有索引行", () => {
    const index = readFileSync(join(MEMORY_DIR, "INDEX.md"), "utf8");
    const entries = readdirSync(MEMORY_DIR).filter(
      (f) => f.endsWith(".md") && f !== "INDEX.md",
    );
    const missing = entries.filter(
      (f) => !isStructuredMemory(f) && !index.includes(`](${f})`),
    );
    expect(missing, "这些条目没有出现在 memory/INDEX.md 里").toEqual([]);
  });

  it("索引行不指向不存在的文件", () => {
    const index = readFileSync(join(MEMORY_DIR, "INDEX.md"), "utf8");
    const files = new Set(readdirSync(MEMORY_DIR));
    const linked = [...index.matchAll(/\]\(([\w-]+\.md)\)/g)].map((m) => m[1]);
    const dangling = linked.filter((f) => !files.has(f));
    expect(dangling, "这些索引行指向的文件不存在").toEqual([]);
  });
});
