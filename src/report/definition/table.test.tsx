// cases: docs/engineering/testing/unit/reports.md
// 「Table 的 subRows 与 placeholder」「普通 rows props」
// 断言面是 Content 与两面输出字符串，不经浏览器。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  ResolveMemo,
  type WebContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { Table, TableContentView } from "./primitives.tsx";
import type { TableContent } from "./cell.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content: TableContent = {
  columns: [
    { key: "name" },
    { key: "score", better: "higher" },
  ],
  rows: [
    {
      key: "parent",
      cells: {
        name: { kind: "text", text: "parent" },
        score: { kind: "score", earned: 3, possible: 5 },
      },
      subRows: [
        {
          key: "child",
          cells: {
            name: { kind: "text", text: "child" },
            score: { kind: "score", earned: 1, possible: 2 },
          },
        },
      ],
    },
    {
      key: "gap",
      variant: "placeholder",
      cells: {
        name: { kind: "missing", code: "not-run" },
        score: { kind: "notApplicable" },
      },
    },
  ],
};

async function resolve(node: React.ReactNode) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(() => node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "sample" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

describe("Table Content", () => {
  it("公开 Table 直接消费普通 rows", () => {
    const text = renderNodeToText(
      <Table columns={[{ field: "answer", label: "Answer" }]} rows={[{ answer: "x" }]} />,
      createTextContext({ width: 40 }),
    );
    expect(text).toContain("Answer");
    expect(text).toContain("x");
  });

  it("内部富 Cell 适配保留 subRows 与 placeholder，两面读取同一 Content", async () => {
    const resolved = await resolve(<TableContentView data={content} />);
    const text = renderNodeToText(resolved, createTextContext({ width: 60 }));
    expect(text).toContain("parent");
    expect(text).toContain("child");
    const webCtx = {
      locale: "en",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unexpected", "x");
      },
    } as WebContext;
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as never));
    expect(html).toContain("niceeval-row-placeholder");
    expect(html).toContain("child");
  });
});
