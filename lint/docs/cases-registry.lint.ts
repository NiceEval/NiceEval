import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Feature 测试文档与代码测试的双向挂钩由文档 lint 检查(契约见
// docs/engineering/testing/unit/README.md「矩阵与覆盖登记」与
// docs/engineering/testing/unit/registry.md),不引入脚本:
// 1. src/ 下每个测试文件头部声明所属文档(// cases: docs/engineering/testing/unit/<feature>.md),
//    且声明指向真实存在的测试文档——没有这条,新增测试可以绕开覆盖登记存在,
//    「先声明后写测」的预算闸门静默失效;
// 2. 测试里的 `// bug: memory/<条目>.md` 引用指向真实存在的 memory 条目——修法台账靠
//    这条引用从测试反查现象与根因,memory 重组后的死指针比不写更糟(照着找的人会以为台账没了)。
// test/ 下的代码测试没有 Feature 文档可指,不做 cases 声明(例外已写进上述文档)。
// 测试重置期间允许 Feature 文档先声明 Unit 例外的准入条件、暂时没有实现者；反向强制每篇
// 文档都挂一个测试会逼人保留空测试或假 owner,与 Journey-first 的存在资格冲突。
const ROOT = resolve(import.meta.dirname, "../..");

// 方法论、覆盖登记规则与 harness 契约不是 Feature owner 文档。
const NON_FEATURE_DOCS = new Set(["README.md", "registry.md", "harness.md"]);

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, match);
    return match(name) ? [rel] : [];
  });
}

const isTestFile = (name: string) => name.endsWith(".test.ts") || name.endsWith(".test.tsx");

describe("Feature 测试文档 lint", () => {
  const srcTests = walk("packages/niceeval/src", isTestFile);
  const CASES_LINE = /^\/\/ cases: (docs\/engineering\/testing\/unit\/[a-z-]+\.md)$/;

  it("src/ 下每个测试文件前 20 行内有且仅有一行 cases 声明,且指向真实存在的测试文档", () => {
    const problems: string[] = [];
    for (const file of srcTests) {
      const head = readFileSync(join(ROOT, file), "utf8").split("\n").slice(0, 20);
      const matches = head
        .map((line) => CASES_LINE.exec(line))
        .filter((m): m is RegExpExecArray => m !== null);
      if (matches.length === 0) {
        problems.push(
          `${file}: 前 20 行没有 cases 声明——在文件第一行加 // cases: docs/engineering/testing/unit/<feature>.md`,
        );
        continue;
      }
      if (matches.length > 1) {
        problems.push(`${file}: 有 ${matches.length} 行 cases 声明——只保留一行`);
        continue;
      }
      const target = matches[0][1];
      if (!existsSync(join(ROOT, target))) {
        problems.push(`${file}: 声明的测试文档 ${target} 不存在——核对 feature 名或先建该文档`);
      }
      if (NON_FEATURE_DOCS.has(basename(target))) {
        problems.push(`${file}: 声明指向了 ${target}——cases 只能指向 Feature 测试文档,不能指向方法论/规则页`);
      }
    }
    expect(problems, "这些测试文件的 cases 声明缺失或失效").toEqual([]);
  });

  it("测试里的 // bug: memory/….md 引用指向真实存在的 memory 条目", () => {
    // 没有出现算通过:这是引用格式校验,不强制每条测试都挂台账。
    const allTests = [...srcTests, ...walk("test", isTestFile)];
    const broken: string[] = [];
    for (const file of allTests) {
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const m of content.matchAll(/\/\/ bug: (memory\/[\w.-]+\.md)/g)) {
        if (!existsSync(join(ROOT, m[1]))) {
          broken.push(`${file} → ${m[1]}: memory 条目不存在——核对文件名,或先补台账条目`);
        }
      }
    }
    expect(broken, "这些 bug 引用指向不存在的 memory 条目(台账重组后留下的死指针)").toEqual([]);
  });
});
