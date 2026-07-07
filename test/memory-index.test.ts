import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// memory/ 的召回全靠 INDEX.md:漏索引的条目等于不存在,所以覆盖率由测试保证,
// 不引入生成脚本——写 memory 的人(通常是 agent)顺手加一行索引即可。
const MEMORY_DIR = join(import.meta.dirname, "..", "memory");

describe("memory/INDEX.md", () => {
  it("每个 memory 条目都有索引行", () => {
    const index = readFileSync(join(MEMORY_DIR, "INDEX.md"), "utf8");
    const entries = readdirSync(MEMORY_DIR).filter(
      (f) => f.endsWith(".md") && f !== "INDEX.md",
    );
    const missing = entries.filter((f) => !index.includes(`](${f})`));
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
