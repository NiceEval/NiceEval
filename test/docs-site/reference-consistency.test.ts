import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_FILES,
  loadSources,
  regenerateReferenceDoc,
} from "../../scripts/generate-reference.ts";

// scripts/generate-reference.ts 从源码(TypeScript compiler API)生成
// docs-site/zh/reference/*.mdx 里的 `{/* GENERATED:BEGIN <region-id> */}` 标记区块。
// 这个测试复用生成器导出的纯函数,在内存里重新计算每个 region,与已提交的文件逐字节
// 比对——源码改了但忘记跑 `pnpm docs:reference` 时,这里会失败并提示怎么修。
const ROOT = resolve(import.meta.dirname, "../..");

describe("参考文档生成漂移守护", () => {
  const sources = loadSources(ROOT);

  for (const { file } of REFERENCE_FILES) {
    it(`${file} 与源码生成结果一致`, () => {
      const path = join(ROOT, "docs-site/zh/reference", file);
      const committed = readFileSync(path, "utf8");
      const regenerated = regenerateReferenceDoc(file, committed, sources);
      expect(regenerated, `docs-site/zh/reference/${file} 与源码生成结果不一致,请运行 \`pnpm docs:reference\` 重新生成后提交。`).toBe(
        committed,
      );
    });
  }
});
