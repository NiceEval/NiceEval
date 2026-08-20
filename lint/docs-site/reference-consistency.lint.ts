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

function generatedRegion(content: string, regionId: string): string {
  const begin = `{/* GENERATED:BEGIN ${regionId} */}`;
  const end = `{/* GENERATED:END ${regionId} */}`;
  const start = content.indexOf(begin);
  const finish = content.indexOf(end, start + begin.length);
  if (start === -1 || finish === -1) {
    throw new Error(`缺少生成区块 ${regionId}`);
  }
  return content.slice(start + begin.length, finish);
}

/** 参考镜像只比较成员名与 TypeScript 签名；两种语言的说明文字由各自的写作规则维护。 */
function generatedMemberSignatures(region: string): string[] {
  return [...region.matchAll(/^#### `([^`]+)`\n\n```ts\n([\s\S]*?)\n```/gm)].map(
    ([, name, signature]) => `${name}\n${signature}`,
  );
}

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

  it("define-agent 的英文 Sandbox 成员镜像中文生成结果", () => {
    const zh = readFileSync(join(ROOT, "docs-site/zh/reference/define-agent.mdx"), "utf8");
    const en = readFileSync(join(ROOT, "docs-site/reference/define-agent.mdx"), "utf8");
    expect(generatedMemberSignatures(generatedRegion(en, "sandbox-methods"))).toEqual(
      generatedMemberSignatures(generatedRegion(zh, "sandbox-methods")),
    );
  });
});
