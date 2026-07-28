// cases: docs/engineering/testing/unit/reports.md
// 「Conversation / DiffView 的两面投影与维度封闭性」——DiffView 条目。

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
import { defineSource } from "../source.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content: DiffContent = [
  {
    path: "src/b.ts",
    change: "modified",
    added: 2,
    removed: 1,
    patch: "@@ -1,2 +1,3 @@\n context\n-removed\n+added\n",
  },
  {
    path: "src/a.ts",
    change: "generated",
    added: 10,
    removed: 0,
  },
  {
    path: "old.txt",
    change: "deleted",
    added: 0,
    removed: 3,
    patch: "",
  },
];

async function resolve(node: React.ReactNode, page: PageContext = { id: "main", input: "scope" }) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(node as never);
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
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

describe("DiffView", () => {
  it("两面投影:分组摘要、patch 行号与下钻命令", async () => {
    const tree = await resolve(
      <DiffView data={content} />,
      { id: "attempt", input: "attempt", locator: "@loc1" as AttemptLocator, evidence: {} as AttemptEvidence },
    );
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text).toContain("changes: 3 files changed by agent");
    expect(text).toContain("niceeval show @loc1 --diff");
    expect(text).toContain("M src/b.ts (+2/-1)");
    expect(text).toContain("A src/a.ts (+10/-0)");
    expect(text).toContain("D old.txt (+0/-3)");
    expect(text).not.toContain("context");
    expect(text).not.toContain("+added");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-diff-view");
    expect(html).toContain('data-change="generated"');
    expect(html).toContain('data-change="modified"');
    expect(html).toContain("src/a.ts");
    expect(html).toContain("src/b.ts");
    expect(html).toContain("niceeval-diff-patch-line--add");
    expect(html).toContain("niceeval-diff-patch-line--remove");
    expect(html).toContain("Patch unavailable for this file.");
    expect(html).toContain("<details");
  });

  it("摘要行的增删数各自着色,text 面仍是一段纯文本", async () => {
    const tree = await resolve(
      <DiffView data={content} />,
      { id: "attempt", input: "attempt", locator: "@loc1" as AttemptLocator, evidence: {} as AttemptEvidence },
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // 折叠态的两个数字与展开后的增删行同一套颜色,各自成 span 才染得上
    expect(html).toContain('<span class="niceeval-diff-lines-added">+2</span>');
    expect(html).toContain('<span class="niceeval-diff-lines-removed">-1</span>');
    // 着色不改数字本身:text 面照旧是 `+N/-M`
    expect(renderNodeToText(tree, createTextContext({ width: 100 }))).toContain("(+2/-1)");
  });

  it("空数组与 null Content 零输出", async () => {
    const emptyTree = await resolve(<DiffView data={[]} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<DiffView data={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(nullTree as never))).toBe("");
  });

  it("source 与 data 等价", async () => {
    const source = defineSource({
      name: "diff",
      compute: async () => content,
    });
    const fromData = await resolve(<DiffView data={content} />);
    const fromSource = await resolve(<DiffView source={source} />);
    const textData = renderNodeToText(fromData, createTextContext({ width: 100 }));
    const textSource = renderNodeToText(fromSource, createTextContext({ width: 100 }));
    expect(textSource).toBe(textData);
  });
});
