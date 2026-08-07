// cases: docs/engineering/testing/unit/reports.md
// 「DiffView 的文本投影」——DiffView 条目。

import { describe, expect, it } from "vitest";

import type { AttemptLocator } from "../../record/locator.ts";
import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type PageContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { DiffView, type DiffContent } from "./primitives/diff-view.tsx";
import { diffFilePatchText } from "./primitives/diff-lines.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";

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

const attemptPage: PageContext = {
  id: "attempt",
  input: { locator: "@loc1" as AttemptLocator, result: {} } as AttemptEvidence,
};

describe("DiffView", () => {
  it("text 投影:摘要行、逐窗口 patch 与下钻命令", async () => {
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

    const patchText = diffFilePatchText(content[0]!);
    expect(patchText).toContain("── window turn1");
    expect(patchText).toContain("── window session2/turn3");
    expect(patchText).not.toContain(["s1", "t1"].join("/"));
    expect(patchText).not.toContain(["s2", "t3"].join("/"));
  });

  it("空数组与 null files 零输出", async () => {
    const emptyTree = await resolve(<DiffView files={[]} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");

    const nullTree = await resolve(<DiffView files={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
  });
});
