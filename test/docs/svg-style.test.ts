import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// docs/ 里的手绘 SVG 共用一套配色(docs/SVG-DESIGN.md),但 SVG 被当图片加载时浏览器
// 进 secure static mode:外部样式表、外部字体一律不取,GitHub 还会再清洗一遍。
// 所以那段 <style> 只能逐份复制进每个文件——单一出处靠这条守护成立,不靠人记得:
// 改 docs/assets/_style.css 之后没跟上的图会被逐个点名。
const ROOT = resolve(import.meta.dirname, "../..");
const CANONICAL = "docs/assets/_style.css";

function svgFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return svgFiles(rel);
    return name.endsWith(".svg") ? [rel] : [];
  });
}

/** 取 <style> 与 </style> 之间的正文;没有 style 块返回 null。 */
function styleBlock(svg: string): string | null {
  const match = /<style>\r?\n([\s\S]*?)\r?\n\s*<\/style>/.exec(svg);
  return match ? match[1].replace(/\s+$/, "") : null;
}

describe("docs/ 手绘 SVG 的共用样式", () => {
  const files = svgFiles("docs");
  const canonical = readFileSync(join(ROOT, CANONICAL), "utf8").replace(/\s+$/, "");

  it("每张图都带 <style> 块", () => {
    const missing = files.filter((f) => styleBlock(readFileSync(join(ROOT, f), "utf8")) === null);
    expect(missing, `这些 SVG 没有 <style> 块,整段抄 ${CANONICAL}`).toEqual([]);
  });

  it("每张图的 <style> 与 docs/assets/_style.css 逐字一致", () => {
    const drifted = files.filter((f) => {
      const block = styleBlock(readFileSync(join(ROOT, f), "utf8"));
      return block !== null && block !== canonical;
    });
    expect(
      drifted,
      `这些 SVG 的样式与 ${CANONICAL} 不一致。改配色只改 ${CANONICAL},` +
        `再把它整段贴回每个文件的 <style>(缺哪些 class 也照抄,不许按需裁剪)`,
    ).toEqual([]);
  });
});
