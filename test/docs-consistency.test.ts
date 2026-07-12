import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// docs 的三条仓库级约定由测试守护,不引入脚本:
// 1. docs/README.md 是唯一索引,docs/ 下每篇文档都要能从它出发被找到;
// 2. 文档里的相对链接和指向本仓库的 GitHub 链接必须指向真实文件/目录
//    (doc-drift 是 memory 里被记录最多的一类事故,链接失效是其中机器可查的部分);
// 3. 代码注释里写下的 docs/….md 也必须真实存在——文档重组会把 docs/ 下的单文件拆进
//    子目录,注释里的旧路径不会跟着动。指错路径比不指更糟:照着找的人会以为文档没了。
const ROOT = resolve(import.meta.dirname, "..");

function walk(dir: string, ext: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, ext);
    return name.endsWith(ext) ? [rel] : [];
  });
}

// 代码侧扫描:注释可能出现在任何源文件里(含 .css / .py / .yml / workflow),
// 因此按后缀白名单收,而不是只看 .ts。锁文件与生成物不看。
const CODE_DIRS = ["src", "scripts", "e2e", "test", "bin", ".github"];
const CODE_EXTS = [
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".py", ".yml", ".yaml", ".json", ".md", ".html",
];
// 依赖与生成物不是本仓库的注释(e2e 下装着 node_modules 与 .venv,里面全是别家的 docs/ 路径)。
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "build"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

function walkCode(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    // 点开头的一律跳过(.venv / .niceeval / .pytest_cache …);顶层 .github 是显式入口,不经这里。
    if (name.startsWith(".") || SKIP_DIRS.has(name) || SKIP_FILES.has(name)) return [];
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walkCode(rel);
    return CODE_EXTS.some((ext) => name.endsWith(ext)) ? [rel] : [];
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

// 树状图里以 `/` 收尾的条目是目录(如 `feature/`、`adapters/`)。索引只画到二级目录,
// 不逐文件列出子目录内容——声明一个目录即视为覆盖它底下的全部文件(含更深的子目录)。
function treeDirEntries(content: string): Set<string> {
  return new Set(
    [...content.matchAll(/(?:├──|└──)\s+([\w.-]+)\//g)].map((m) => m[1]),
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
    const treeDirs = treeDirEntries(index);
    const unindexed = docsFiles.filter((f) => {
      if (f === "docs/README.md" || linked.has(f)) return false;
      const segments = f.slice("docs/".length).split("/");
      const base = segments[segments.length - 1];
      if (treeBasenames.has(base)) return false;
      const dirSegments = segments.slice(0, -1);
      return !dirSegments.some((seg) => treeDirs.has(seg));
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

  it("代码注释里的 docs/….md 路径指向真实文档", () => {
    // 路径按仓库根解析:注释写 `docs/feature/reports/view.md`,markdown 相对链接写
    // `../docs/…`,两种写法抠出来的都是同一个仓库根路径。`docs-site/` 不匹配(docs 后面不是 /)。
    const broken: string[] = [];
    for (const dir of CODE_DIRS) {
      for (const file of walkCode(dir)) {
        const content = readFileSync(join(ROOT, file), "utf8");
        for (const m of content.matchAll(/\bdocs\/[\w./-]+\.mdx?\b/g)) {
          if (!existsSync(join(ROOT, m[0]))) broken.push(`${file} → ${m[0]}`);
        }
      }
    }
    expect(broken, "这些代码注释指向不存在的文档(文档重组后留下的死指针)").toEqual([]);
  });
});
