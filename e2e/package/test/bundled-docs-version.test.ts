import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

// @feature docs/engineering/agent-docs/README.md
// @issue docs/issues/bundled-docs-main-links.md
test.concurrent("安装包的文档与示例不会跳到仓库 main 的另一个版本", async () => {
  const require = createRequire(import.meta.url);
  let root = dirname(require.resolve("niceeval"));
  while (JSON.parse(await readFile(join(root, "package.json"), "utf8").catch(() => "{}")).name !== "niceeval") {
    const parent = dirname(root);
    if (parent === root) throw new Error("Installed NiceEval package not found");
    root = parent;
  }
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version as string;
  const docsRoot = join(root, "docs-site", "zh");
  const pages = (await readdir(docsRoot, { recursive: true })).filter((path) => /\.mdx?$/u.test(path));
  expect(pages.length).toBeGreaterThan(0);
  let exampleCount = 0;
  for (const path of pages) {
    const text = await readFile(join(docsRoot, path), "utf8");
    expect(text, path).not.toMatch(
      /https:\/\/(?:github\.com\/[^/\s]+\/niceeval\/(?:blob|tree|raw)\/main(?:\/|\b)|raw\.githubusercontent\.com\/[^/\s]+\/niceeval\/main(?:\/|\b))/iu,
    );
    expect(text, path).not.toMatch(
      /https:\/\/github\.com\/NiceEval\/NiceEval\/(?:blob|tree)\/[^/]+\/docs\/feature\//iu,
    );
    for (const match of text.matchAll(/https:\/\/github\.com\/NiceEval\/NiceEval\/tree\/([^/]+)\/examples\//gu)) {
      exampleCount += 1;
      if (version === "0.0.0-development") expect(match[1]).toMatch(/^[a-f0-9]{40}$/u);
      else expect(match[1]).toBe(`v${version}`);
    }
  }
  expect(exampleCount).toBeGreaterThan(0);
});
