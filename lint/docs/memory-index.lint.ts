import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { MemorySchema, decode } from "concord-sdlc/model";

const MEMORY_DIR = join(import.meta.dirname, "../..", "memory");
describe("memory owners", () => {
  it("every Memory uses the current strict schema", () => {
    const entries = readdirSync(MEMORY_DIR).filter(f => f.endsWith(".md") && f !== "INDEX.md");
    for (const entry of entries) {
      const source = readFileSync(join(MEMORY_DIR, entry), "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
      expect(frontmatter, entry).not.toBeNull();
      const yaml = parseDocument(frontmatter![1]!, { uniqueKeys: true, merge: false });
      expect(yaml.errors, entry).toEqual([]);
      const metadata = decode(MemorySchema, yaml.toJS({ maxAliasCount: 0 }) as unknown, entry);
      expect(metadata.id + ".md", entry).toBe(entry);
    }
  });
  it("the human index has no dangling file links", () => {
    const index = readFileSync(join(MEMORY_DIR, "INDEX.md"), "utf8");
    const files = new Set(readdirSync(MEMORY_DIR));
    const linked = [...index.matchAll(/\]\(([\w-]+\.md)\)/g)].map(m => m[1]);
    expect(linked.filter(path => !files.has(path!))).toEqual([]);
  });
});
