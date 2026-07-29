// cases: docs/engineering/testing/unit/reports.md
// 「Callouts / Waterfall / SourceView / … 的两面投影与维度封闭性」——SourceView 条目。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AttemptLocator } from "../../record/locator.ts";
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
import { SourceView, type SourceContent } from "./primitives/source-view.tsx";
import { Text } from "./primitives.tsx";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const locator = (s: string): AttemptLocator => s as AttemptLocator;

const content: SourceContent = {
  spine: {
    path: "evals/foo.test.ts",
    lines: [
      { number: 1, text: "import { test } from 'niceeval';" },
      { number: 10, text: 'await agent.send("hi");', tone: "send" },
      {
        number: 12,
        text: "expect(x).toBe(1);",
        tone: "gate-fail",
        details: [<Text key="d">expected: 1 · received: 2</Text>],
      },
      { number: 13, text: "t.score('bonus', 1);", pill: { en: "+1 pt" } },
      { number: 14, text: "throw new Error('abort');", tone: "gate-fail", aborted: true },
      { number: 15, text: "// never reached" },
    ],
  },
  detached: [
    {
      path: "src/helper.ts",
      lines: [{ number: 3, text: "export function helper() {}", tone: "soft-fail", pill: { en: "0.5/1" } }],
    },
  ],
  locator: locator("exp/a/q/0"),
};

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
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

describe("SourceView", () => {
  it("两面投影:状态行摘要与下钻命令；普通行不倾倒", async () => {
    const tree = await resolve(<SourceView data={content} />);
    const text = renderNodeToText(
      tree,
      createTextContext({
        width: 100,
        locale: "en",
        attemptCommand: (loc) => `niceeval show @${loc}`,
      }),
    );
    expect(text).toContain("evals/foo.test.ts:10 [send]");
    expect(text).toContain("evals/foo.test.ts:12 [gate-fail]");
    expect(text).toContain("src/helper.ts:3 [soft-fail] 0.5/1");
    expect(text).toContain("niceeval show @exp/a/q/0");
    expect(text).not.toContain("import { test } from");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-source-view");
    expect(html).toContain("evals/foo.test.ts");
    expect(html).toContain("src/helper.ts");
    expect(html).toContain("niceeval-source-line--send");
    expect(html).toContain("niceeval-source-line--gate-fail");
    expect(html).toContain("+1 pt");
    expect(html).toContain('class="tok-kw"');
    expect(html).toContain("<details");
  });

  it("null 两面零输出", async () => {
    const tree = await resolve(<SourceView data={null} />);
    expect(
      renderNodeToText(tree, createTextContext({ width: 80, attemptCommand: (loc) => `niceeval show @${loc}` })),
    ).toBe("");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toBe("");
  });
});
