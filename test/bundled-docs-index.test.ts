import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("随包 AI 文档索引", () => {
  it("由包根 INDEX.md 单点路由，且索引中的随包文档都存在", async () => {
    const index = await readFile(join(ROOT, "INDEX.md"), "utf-8");
    const paths = [...index.matchAll(/`(docs-site\/zh\/[^`]+\.mdx)`/g)].map((match) => match[1]!);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      await expect(readFile(join(ROOT, path), "utf-8"), path).resolves.not.toHaveLength(0);
    }
  });

  it("npm 包、安装向导和 init 托管指引都使用包根 INDEX.md", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8")) as { files?: string[] };
    const init = await readFile(join(ROOT, "INIT.zh.md"), "utf-8");
    const cli = await readFile(join(ROOT, "src/cli.ts"), "utf-8");

    expect(pkg.files).toContain("INDEX.md");
    expect(init).toContain("node_modules/niceeval/INDEX.md");
    expect(cli).toContain("node_modules/niceeval/INDEX.md");
    expect(init).not.toContain("node_modules/niceeval/docs-site/zh/INDEX.md");
    expect(cli).not.toContain("node_modules/niceeval/docs-site/zh/INDEX.md");
  });
});
