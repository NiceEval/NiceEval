import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadZhPages, regenerateBundledIndex } from "../../scripts/generate-reference.ts";

// 包根 INDEX.md 是 coding agent 读随包文档的单点入口(机制见 docs/engineering/agent-docs/)。
// 它是构建产物:`prepare`(build:index)在安装/发版打包前从 INDEX.template.md + 各页 frontmatter
// 生成,不签入 git——所以没有漂移可守;这里守护的是「发版时一定能生成、生成一定不漏页」提前红灯,
// 以及入口路径与打包链全仓库只有一套。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_ROOT = join(ROOT, "packages/niceeval");

describe("随包 AI 文档索引", () => {
  it("模板 + 全部 zh 页面能生成完整文档树,非入口页一页不漏", async () => {
    const template = await readFile(join(PACKAGE_ROOT, "INDEX.template.md"), "utf-8");
    const pages = loadZhPages(ROOT);
    expect(pages.length).toBeGreaterThan(0);

    // 缺 title/description 或模板缺区块标记时,这里抛错——与发版 CI 的 prepare 同一条失败路径,提前到 pnpm test。
    const generated = regenerateBundledIndex(template, pages);

    for (const page of pages) {
      const base = page.path.split("/").pop()!;
      if (base === "index.mdx" || base === "introduction.mdx") continue; // 站点导航入口不进树
      expect(generated, `${page.path} 应出现在生成的文档树里`).toContain(`\`${page.path}\``);
    }
  });

  it("npm 包、安装向导、init 托管指引和 prepare 打包链都使用包根 INDEX.md", async () => {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf-8")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };
    const init = await readFile(join(ROOT, "INIT.zh.md"), "utf-8");
    const initEn = await readFile(join(ROOT, "INIT.md"), "utf-8");
    const cli = await readFile(join(PACKAGE_ROOT, "src/cli/node-application.ts"), "utf-8");

    expect(pkg.files).toContain("INDEX.md");
    expect(pkg.scripts?.prepack, "prepack 链必须包含 build:index,否则发出去的包缺 INDEX.md").toContain("build:index");
    expect(init).toContain("node_modules/niceeval/INDEX.md");
    expect(initEn).toContain("node_modules/niceeval/INDEX.md");
    expect(cli).toContain("node_modules/niceeval/INDEX.md");
    expect(init).not.toContain("node_modules/niceeval/docs-site/zh/INDEX.md");
    expect(cli).not.toContain("node_modules/niceeval/docs-site/zh/INDEX.md");
  });

  it("安装向导是自举文件,不依赖线上文档链接", async () => {
    // 线上 URL 无守护(页面改名即静默断链)、版本也与将要装到的包无关;
    // 接入流程正文住在随包页面(docs-site/zh/tutorials/agent-onboarding.mdx),向导只做心智模型、前置与安装。
    for (const name of ["INIT.zh.md", "INIT.md"]) {
      const text = await readFile(join(ROOT, name), "utf-8");
      expect(text, `${name} 不得引用线上文档页面`).not.toMatch(/niceeval\.com\/docs/);
      expect(text, `${name} 不得引用 GitHub raw 文档`).not.toContain("raw.githubusercontent.com");
    }
  });
});
