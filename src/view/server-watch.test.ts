// cases: docs/engineering/testing/unit/reports.md
// view 本地模式「持续重建」的 watch 输入闭集(见 unit/reports.md 覆盖规范「持续重建(view
// 本地模式)」):项目侧盯的是报告 / 主题 / 项目配置及它们的项目内静态 import 图,不是项目根
// 整棵目录。区分力都落在「同一个被监听目录里,闭集内外的两个文件」——目录级监听下两者一样会
// 触发重建,收窄后只有闭集内的那个会。
//
// 记录侧的整根递归监听与去抖合成不在本文件断言(前者是本次收窄之外的既有行为,后者由
// ViewRebuildScheduler 自己的语义承担)。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectFileWatcher, projectWatchEntries, projectWatchTargets } from "./server.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * 一个带自定义报告的项目:报告 import 组件与读数模块(组件再 import 一个工具模块),
 * 同时 import 一个外部包与一份 node_modules 里的文件;主题 import 令牌模块;
 * 配置 import 一个 eval 模块。reports/unused.tsx 与报告同目录但没人 import。
 */
async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-viewwatch-"));
  roots.push(root);
  const write = async (rel: string, body: string): Promise<void> => {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), body);
  };
  await write("niceeval.config.ts", `import { evals } from "./evals/setup.ts";\nexport default { evals };\n`);
  await write("evals/setup.ts", `export const evals = [];\n`);
  await write(
    "reports/site.tsx",
    `import { defineReport } from "niceeval/report";\n` +
      `import { Panel } from "./components/panel.tsx";\n` +
      `import { rows } from "../shared/measures.ts";\n` +
      `import vendor from "../node_modules/pkg/index.js";\n` +
      `export default defineReport(() => <Panel rows={rows} vendor={vendor} />);\n`,
  );
  await write("reports/components/panel.tsx", `import { helper } from "./helper.ts";\nexport const Panel = helper;\n`);
  await write("reports/components/helper.ts", `export const helper = () => null;\n`);
  await write("shared/measures.ts", `export const rows = [];\n`);
  await write("reports/unused.tsx", `export default null;\n`);
  await write("node_modules/pkg/index.js", `export default 1;\n`);
  await write("themes/acme.ts", `import { tokens } from "./tokens.ts";\nexport default tokens;\n`);
  await write("themes/tokens.ts", `export const tokens = {};\n`);
  await write(".niceeval/exp/run/result.json", `{}\n`);
  return root;
}

function sorted(paths: Iterable<string>, root: string): string[] {
  return [...paths].map((p) => p.slice(root.length + 1)).sort();
}

describe("项目侧 watch 闭集", () => {
  it("闭集是入口加它们的项目内 import 图:外部包、node_modules 里的文件、同目录未被 import 的文件与记录都不在列", async () => {
    const root = await makeProject();
    const entries = await projectWatchEntries(
      { report: { path: "reports/site.tsx", cwd: root }, theme: { value: "./themes/acme.ts", cwd: root } },
      root,
    );
    expect(sorted(await projectWatchTargets(entries), root)).toEqual([
      "evals/setup.ts",
      "niceeval.config.ts",
      "reports/components/helper.ts",
      "reports/components/panel.tsx",
      "reports/site.tsx",
      "shared/measures.ts",
      "themes/acme.ts",
      "themes/tokens.ts",
    ]);
  });

  it("内建名(--report standard / --theme basalt)没有项目文件可盯,入口只剩项目配置;配置文件还不存在时仍在列", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-viewwatch-"));
    roots.push(root);
    const entries = await projectWatchEntries(
      { report: { path: "standard", cwd: root }, theme: { value: "basalt", cwd: root } },
      root,
    );
    expect(entries).toEqual([join(root, "niceeval.config.ts")]);
    expect([...(await projectWatchTargets(entries))]).toEqual([join(root, "niceeval.config.ts")]);
  });

  it("改闭集内的报告文件通知重建,改同一目录里没被 import 的文件不通知", async () => {
    const root = await makeProject();
    let notified = 0;
    const watcher = new ProjectFileWatcher(() => { notified++; });
    await watcher.sync(await projectWatchEntries({ report: { path: "reports/site.tsx", cwd: root } }, root));
    try {
      await writeFile(join(root, "reports/unused.tsx"), `export default 2;\n`);
      await new Promise((r) => setTimeout(r, 300));
      expect(notified).toBe(0);

      await writeFile(join(root, "reports/site.tsx"), `export default null;\n`);
      const deadline = Date.now() + 3000;
      while (notified === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(notified).toBeGreaterThan(0);
    } finally {
      watcher.close();
    }
  });
});
