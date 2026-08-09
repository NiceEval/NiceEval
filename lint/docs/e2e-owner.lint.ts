import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const E2E_ROOT = join(ROOT, "e2e");
const ASCII_ANCHOR = "[a-z0-9]+(?:-[a-z0-9]+)*";
const DOCUMENT_PATH = "docs/(?:[A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*\\.md";
const STRICT_OWNER_LINE = new RegExp(`^// owner: (${DOCUMENT_PATH})#(${ASCII_ANCHOR})$`);
const ANY_OWNER_LINE = /^\/\/ owner: (.+)$/;

function walkE2e(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name === ".git") return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walkE2e(path);
      return entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts") ? [path] : [];
    });
}

function asciiHeadingAnchor(heading: string): string {
  return heading
    .replace(/[ \t]+#+[ \t]*$/, "")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

function matchingHeadings(documentPath: string, anchor: string): number {
  return readFileSync(documentPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => {
      const heading = /^(?:#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line)?.[1];
      return heading !== undefined && asciiHeadingAnchor(heading) === anchor;
    }).length;
}

describe("E2E owner 文档 lint", () => {
  it("每个 e2e 测试文件第一行都有唯一且可解析的 owner", () => {
    const problems: string[] = [];
    const owners = new Map<string, string[]>();

    for (const file of walkE2e(E2E_ROOT)) {
      const relativeFile = relative(ROOT, file);
      const firstLine = readFileSync(file, "utf8").split(/\r?\n/, 1)[0] ?? "";
      const rawOwner = ANY_OWNER_LINE.exec(firstLine)?.[1];
      if (rawOwner !== undefined) {
        owners.set(rawOwner, [...(owners.get(rawOwner) ?? []), relativeFile]);
      }

      const owner = STRICT_OWNER_LINE.exec(firstLine);
      if (owner === null) {
        problems.push(
          `${relativeFile}: 第一行必须严格为 // owner: docs/path.md#ascii-stable-anchor`,
        );
        continue;
      }

      const [, documentPath, anchor] = owner;
      const document = resolve(ROOT, documentPath);
      const documentRelative = relative(ROOT, document);
      if (documentRelative === "" || documentRelative === ".." || documentRelative.startsWith("../")) {
        problems.push(`${relativeFile}: owner 文档 ${documentPath} 超出仓库根目录`);
        continue;
      }
      if (!existsSync(document)) {
        problems.push(`${relativeFile}: owner 文档 ${documentPath} 不存在`);
        continue;
      }

      const headings = matchingHeadings(document, anchor);
      if (headings === 0) {
        problems.push(`${relativeFile}: ${documentPath} 没有对应 #${anchor} 的 Markdown heading`);
      } else if (headings > 1) {
        problems.push(`${relativeFile}: ${documentPath} 有 ${headings} 个对应 #${anchor} 的 Markdown heading`);
      }
    }

    for (const [owner, files] of owners) {
      if (files.length < 2) continue;
      for (const file of files) {
        const others = files.filter((other) => other !== file);
        problems.push(`${file}: owner ${owner} 与 ${others.join(", ")} 重复，owner 必须全局唯一`);
      }
    }

    expect(problems, "这些 E2E owner 缺失、失效或重复").toEqual([]);
  });
});
