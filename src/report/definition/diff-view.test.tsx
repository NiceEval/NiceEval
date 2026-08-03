// cases: docs/engineering/testing/unit/reports.md
// 「DiffView 的两面投影与维度封闭性」「DiffView 的路径树构成」
// 「DiffView 的逐窗口 patch 与内联预算」——DiffView 条目。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AttemptLocator } from "../../record/locator.ts";
import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  ResolveMemo,
  type PageContext,
  type WebContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { DiffView, type DiffContent } from "./primitives/diff-view.tsx";
import { diffFilePatchText } from "./primitives/diff-lines.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content: DiffContent = [
  {
    path: "src/report/model/format.ts",
    change: "modified",
    added: 2,
    removed: 1,
    windows: [
      { window: ["s1", "t1"].join("/"), patch: "@@ -1,2 +1,3 @@\n context\n-removed\n+added" },
      { window: ["s2", "t3"].join("/"), patch: "@@ -5,1 +5,2 @@\n+second window" },
    ],
  },
  {
    path: "src/report/model/notes.md",
    change: "added",
    added: 10,
    removed: 0,
    windows: [{ window: ["s2", "t3"].join("/"), patch: "@@ -1,0 +1,1 @@\n+new file" }],
  },
  {
    path: "old.txt",
    change: "deleted",
    added: 0,
    removed: 3,
    windows: [{ window: ["s1", "t1"].join("/"), patch: "@@ -1,3 +1,0 @@\n-a\n-b\n-c" }],
  },
  {
    path: "assets/logo.png",
    change: "modified",
    added: 0,
    removed: 0,
    elided: { reason: "binary", beforeBytes: 10, afterBytes: 20 },
    windows: [{ window: ["s1", "t1"].join("/") }],
  },
  {
    path: "data/dump.sql",
    change: "modified",
    added: 0,
    removed: 0,
    elided: { reason: "oversized-text", beforeBytes: 2_097_153, afterBytes: 4_194_304 },
    windows: [{ window: ["s1", "t1"].join("/") }],
  },
];

function attemptTarget(target: { page: string; params?: unknown }): string | undefined {
  if (target.page !== "attempt") return undefined;
  const locator = (target.params as { locator?: unknown } | undefined)?.locator;
  return typeof locator === "string" ? locator : undefined;
}

async function resolve(node: React.ReactNode, page: PageContext = { id: "main", input: "sample" }) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(() => node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page,
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

const webCtx: WebContext = {
  locale: "en",
  href: (target) => {
    const locator = attemptTarget(target);
    return locator === undefined ? undefined : `attempt/${encodeURIComponent(locator)}.html`;
  },
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

const attemptPage: PageContext = {
  id: "attempt",
  input: { locator: "@loc1" as AttemptLocator, result: {} } as AttemptEvidence,
};

describe("DiffView", () => {
  it("两面投影:摘要行、逐窗口 patch 与下钻命令", async () => {
    const tree = await resolve(<DiffView files={content} />, attemptPage);
    const text = renderNodeToText(
      tree,
      createTextContext({
        width: 100,
        command: (target) => {
          const locator = attemptTarget(target);
          return locator === undefined ? undefined : `niceeval show ${locator}`;
        },
      }),
    );
    expect(text).toContain("5 files changed by agent");
    expect(text).toContain("niceeval show @loc1 --diff");
    expect(text).toMatch(/M +src\/report\/model\/format\.ts +\+2 -1 +turn1, session2\/turn3/);
    expect(text).toMatch(/A +src\/report\/model\/notes\.md +\+10 +session2\/turn3/);
    expect(text).toMatch(/D +old\.txt +-3 +turn1/);
    expect(text).not.toContain(["s1", "t1"].join("/"));
    expect(text).not.toContain(["s2", "t3"].join("/"));
    // 内容被省略的两种原因各自在行上标注,共用同一格字节数变化
    expect(text).toContain("binary 10 → 20 bytes");
    expect(text).toContain("oversized text 2097153 → 4194304 bytes");
    // 摘要面不铺 patch 正文
    expect(text).not.toContain("second window");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-diff-view");
    expect(html).toContain('data-change="added"');
    expect(html).toContain('data-change="modified"');
    expect(html).toContain('data-change="deleted"');
    // 一个文件的两个窗口各成一段,不合成跨窗口 patch
    expect(html).toContain("window turn1");
    expect(html).toContain("window session2/turn3");
    expect(html).not.toContain(["s1", "t1"].join("/"));
    expect(html).not.toContain(["s2", "t3"].join("/"));
    expect(html.match(/niceeval-diff-window-title/g)?.length).toBe(4);
    expect(html).toContain("niceeval-diff-patch-line--add");
    expect(html).toContain("niceeval-diff-patch-line--remove");
    // 内容被省略的文件不出 patch,只报原因 + 字节数,也不给下钻命令(下钻同样拿不到内容)
    expect(html).toContain("niceeval-diff-bytes");
    const binaryRow = html.slice(html.indexOf("logo.png"));
    expect(binaryRow).toContain("binary file · content elided from the diff export");
    const oversizedRow = html.slice(html.indexOf("dump.sql"));
    expect(oversizedRow).toContain("oversized text 2097153 → 4194304 bytes");
    expect(oversizedRow).toContain("oversized text file · content elided from the diff export");
    expect(oversizedRow).not.toContain("--diff=data/dump.sql");
    const patchText = diffFilePatchText(content[0]!);
    expect(patchText).toContain("── window turn1");
    expect(patchText).toContain("── window session2/turn3");
    expect(patchText).not.toContain(["s1", "t1"].join("/"));
    expect(patchText).not.toContain(["s2", "t3"].join("/"));
  });

  it("路径树:目录汇总、单子目录链压缩,状态不参与分组", async () => {
    const tree = await resolve(<DiffView files={content} />, attemptPage);
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // src/ 下只有 report/model 这一条链,压成一行
    expect(html).toContain(">src/report/model/<");
    expect(html).not.toContain(">src/<");
    // added 与 modified 的文件进同一棵子树:结构轴是路径而不是状态
    const subtree = html.slice(html.indexOf("src/report/model/"));
    expect(subtree).toContain("format.ts");
    expect(subtree).toContain("notes.md");
    // 目录行给子树文件数与增删汇总
    expect(html).toContain("2 files");
    expect(html).toContain('<span class="niceeval-diff-lines-added">+12</span>');
    expect(html).toContain('<span class="niceeval-diff-lines-removed">-1</span>');
    // 摘要行的两个数字各自成元素才染得上与 patch 增删行同一套颜色
    expect(html).toContain('<span class="niceeval-diff-lines-added">+2</span>');
  });

  it("单文件 patch 超预算时退化成下钻命令,不留空的展开区", async () => {
    const huge: DiffContent = [
      ...content,
      {
        path: "src/report/model/bundle.js",
        change: "modified",
        added: 1,
        removed: 1,
        windows: [{ window: "turn1", patch: `@@ -1,1 +1,1 @@\n${"+x".repeat(40_000)}` }],
      },
    ];
    const tree = await resolve(<DiffView files={huge} />, attemptPage);
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    const row = html.slice(html.indexOf("bundle.js"));
    expect(row).toContain("patch over inline budget");
    expect(row).toContain("niceeval show @loc1 --diff=src/report/model/bundle.js");
    // 同一棵树里没超预算的文件照常内联
    expect(html).toContain('niceeval-diff-patch-text">second window');
    // text 面不受预算约束,摘要仍列这个文件
    expect(renderNodeToText(tree, createTextContext({ width: 100 }))).toContain("bundle.js");
  });

  it("空数组与 null files 零输出", async () => {
    const emptyTree = await resolve(<DiffView files={[]} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<DiffView files={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(nullTree as never))).toBe("");
  });
});
