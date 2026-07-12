import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// docs 的两条仓库级约定由测试守护,不引入脚本:
// 1. docs/README.md 是唯一索引,docs/ 下每篇文档都要能从它出发被找到;
// 2. 文档里的相对链接和指向本仓库的 GitHub 链接必须指向真实文件/目录
//    (doc-drift 是 memory 里被记录最多的一类事故,链接失效是其中机器可查的部分)。
const ROOT = resolve(import.meta.dirname, "..");

function walk(dir: string, ext: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, ext);
    return name.endsWith(ext) ? [rel] : [];
  });
}

// 提取 markdown 链接目标,忽略外部 URL 和纯锚点
function relativeLinks(content: string): string[] {
  return [...content.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1].replace(/#.*$/, ""))
    .filter((t) => t && !/^(https?:|mailto:|#)/.test(t));
}

// docs/README.md 的导航是一张 ASCII 树状图(```text 代码块),条目是 ├── / └── 前缀
// 后跟裸文件名,不是 markdown 链接——单独识别这类条目的 basename 用于索引覆盖检查
function treeEntryBasenames(content: string): Set<string> {
  return new Set(
    [...content.matchAll(/(?:├──|└──)\s+([\w.-]+\.mdx?)\b/g)].map((m) => m[1]),
  );
}

describe("docs 一致性", () => {
  const docsFiles = walk("docs", ".md");

  it("docs/ 下每篇文档都被 docs/README.md 索引", () => {
    const index = readFileSync(join(ROOT, "docs/README.md"), "utf8");
    const linked = new Set(
      relativeLinks(index).map((t) => join("docs", t)),
    );
    const treeBasenames = treeEntryBasenames(index);
    const unindexed = docsFiles.filter((f) => {
      if (f === "docs/README.md" || linked.has(f)) return false;
      const base = f.slice("docs/".length).split("/").pop() as string;
      return !treeBasenames.has(base);
    });
    expect(unindexed, "这些文档没有被 docs/README.md 索引").toEqual([]);
  });

  it("docs/ 与根 README 里的相对链接指向真实文件", () => {
    const sources = [...docsFiles, "README.md", "README.zh.md"];
    const broken: string[] = [];
    for (const file of sources) {
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const target of relativeLinks(content)) {
        if (!existsSync(resolve(ROOT, dirname(file), target))) {
          broken.push(`${file} → ${target}`);
        }
      }
    }
    expect(broken, "这些相对链接指向不存在的文件").toEqual([]);
  });

  it("指向本仓库的 GitHub 链接对应的路径真实存在", () => {
    const sources = [
      ...docsFiles,
      ...walk("docs-site", ".mdx"),
      "README.md",
      "README.zh.md",
    ];
    const broken: string[] = [];
    for (const file of sources) {
      const content = readFileSync(join(ROOT, file), "utf8");
      const refs = content.matchAll(
        /github\.com\/CorrectRoadH\/niceeval\/(?:tree|blob)\/main\/([^)\]"'\s#]+)/g,
      );
      for (const m of refs) {
        if (!existsSync(join(ROOT, decodeURIComponent(m[1])))) {
          broken.push(`${file} → ${m[1]}`);
        }
      }
    }
    expect(broken, "这些 GitHub 链接指向仓库里不存在的路径").toEqual([]);
  });
});
