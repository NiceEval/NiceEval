// cases: docs/engineering/testing/unit/reports.md
// 「Callouts / Waterfall / SourceView / … 的数据与 text 投影」——SourceView 条目。

import { describe, expect, it } from "vitest";

import type { AttemptLocator } from "../../record/locator.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type PageContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { SourceView, type SourceContent } from "./primitives/source-view.tsx";
import { Text } from "./primitives.tsx";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";

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

describe("SourceView", () => {
  it("text 投影保留状态行摘要与下钻命令；普通行不倾倒", async () => {
    const tree = await resolve(<SourceView data={content} />);
    const text = renderNodeToText(
      tree,
      createTextContext({
        width: 100,
        locale: "en",
        command: (target) =>
          target.page === "attempt" ? `niceeval show @${(target.params as { locator: string }).locator}` : undefined,
      }),
    );
    expect(text).toContain("evals/foo.test.ts:10 [send]");
    expect(text).toContain("evals/foo.test.ts:12 [gate-fail]");
    expect(text).toContain("src/helper.ts:3 [soft-fail] 0.5/1");
    expect(text).toContain("niceeval show @exp/a/q/0");
    expect(text).not.toContain("import { test } from");

  });

  it("null 在 text 面零输出", async () => {
    const tree = await resolve(<SourceView data={null} />);
    expect(
      renderNodeToText(
        tree,
        createTextContext({
          width: 80,
          command: (target) =>
            target.page === "attempt" ? `niceeval show @${(target.params as { locator: string }).locator}` : undefined,
        }),
      ),
    ).toBe("");
  });
});
