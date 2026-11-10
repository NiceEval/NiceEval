import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_FILES,
  compileEnglishReferenceRegions,
  regenerateEnglishReferenceDoc,
  regenerateReferenceDoc,
} from "../../../packages/repo-tools/src/docs/reference-compiler.js";
import { loadEnglishReferenceTranslations, loadReferenceSources } from "../../../packages/repo-tools/src/docs/generators.js";

// Docs 领域从源码(TypeScript compiler API)生成
// 中英文 reference 的 `{/* GENERATED:BEGIN <region-id> */}` 标记区块。
// 复用生成器导出的纯函数,在内存里重新计算每个 region,与已提交的文件逐字节比对。
const ROOT = resolve(import.meta.dirname, "../../..");

describe("参考文档生成漂移守护", () => {
  const sources = loadReferenceSources();
  const englishRegions = compileEnglishReferenceRegions(sources, loadEnglishReferenceTranslations());

  for (const { file } of REFERENCE_FILES) {
    it(`${file} 与源码生成结果一致`, () => {
      const path = join(ROOT, "apps/docs-site/zh/reference", file);
      const committed = readFileSync(path, "utf8");
      const regenerated = regenerateReferenceDoc(file, committed, sources);
      expect(regenerated, `apps/docs-site/zh/reference/${file} 与源码生成结果不一致,请运行 \`pnpm run repo docs reference\` 重新生成后提交。`).toBe(
        committed,
      );
    });
    it(`英文 ${file} 与源码和译文表生成结果一致`, () => {
      const path = join(ROOT, "apps/docs-site/reference", file);
      const committed = readFileSync(path, "utf8");
      expect(regenerateEnglishReferenceDoc(file, committed, englishRegions),
        `apps/docs-site/reference/${file} 与生成结果不一致,请运行 \`pnpm run repo docs reference\` 重新生成后提交。`,
      ).toBe(committed);
    });
  }
});
