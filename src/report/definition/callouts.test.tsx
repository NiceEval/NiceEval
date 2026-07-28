// cases: docs/engineering/testing/unit/reports.md
// 「Callouts / ... 两面投影与维度封闭性」
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
import { Callouts } from "./primitives/callouts.tsx";
import type { CalloutGroup } from "./primitives/callouts-logic.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const fixture: readonly CalloutGroup[] = [
  {
    title: { en: "2 experiments with warnings" },
    badges: [{ en: "stale" }],
    items: [
      {
        level: "warning",
        message: { en: "Numbers may be stale. Cause: unfinished run. Next: resume." },
        command: "niceeval exp a",
      },
      {
        level: "error",
        message: { en: "Numbers unusable. Cause: corrupt artifact. Next: re-run." },
        command: "niceeval run a",
        count: 2,
      },
    ],
  },
  {
    title: { en: "1 skipped run" },
    items: [
      {
        level: "info",
        message: { en: "Run skipped. Cause: filter. Next: widen scope." },
      },
    ],
  },
];

async function resolve(node: React.ReactNode) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "scope" },
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

describe("Callouts", () => {
  it("两面投影:汇总、组头、徽标、命令与逐条 message", async () => {
    const tree = await resolve(<Callouts data={fixture} />);
    const text = renderNodeToText(tree, createTextContext({ width: 80, locale: "en" }));
    expect(text).toContain("2 groups · 3 errors");
    expect(text).toContain("! 2 experiments with warnings — stale");
    expect(text).not.toMatch(/stale → niceeval/);
    expect(text).toContain("Numbers may be stale");
    expect(text).toContain("×2 → niceeval run a");
    expect(text).toContain("! 1 skipped run");
    expect(text).toContain("Run skipped");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("nre-callouts");
    expect(html).toContain("2 groups · 3 errors");
    expect(html).toContain("2 experiments with warnings");
    expect(html).toContain("stale");
    expect(html).toContain("niceeval exp a");
    expect(html).toContain("×2");
    expect(html).toContain('data-nre-copy="niceeval run a"');
    expect(html).toContain("<details");
  });

  it("空集两面零输出", async () => {
    const tree = await resolve(<Callouts data={[]} />);
    expect(renderNodeToText(tree, createTextContext({ width: 80 }))).toBe("");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toBe("");
  });

  it("组内多条命令时组头不放命令、命令随明细走", async () => {
    const groups: CalloutGroup[] = [
      {
        title: { en: "Mixed commands" },
        command: "niceeval group",
        items: [
          { level: "warning", message: { en: "First" }, command: "niceeval a" },
          { level: "warning", message: { en: "Second" }, command: "niceeval b" },
        ],
      },
    ];
    const tree = await resolve(<Callouts data={groups} />);
    const text = renderNodeToText(tree, createTextContext({ width: 80, locale: "en" }));
    expect(text).not.toContain("→ niceeval group");
    expect(text).toContain("→ niceeval a");
    expect(text).toContain("→ niceeval b");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval group");
    expect(html).toContain('data-nre-copy="niceeval a"');
    expect(html).toContain('data-nre-copy="niceeval b"');
  });

  it("嵌套组只有一个孩子时不渲染空壳层级", async () => {
    const groups: CalloutGroup[] = [
      {
        title: { en: "Shell" },
        items: [],
        groups: [
          {
            title: { en: "Inner run" },
            items: [{ level: "warning", message: { en: "Inner message" } }],
          },
        ],
      },
    ];
    const tree = await resolve(<Callouts data={groups} />);
    const text = renderNodeToText(tree, createTextContext({ width: 80, locale: "en" }));
    expect(text).not.toContain("Shell");
    expect(text).toContain("Inner run");
    expect(text).toContain("Inner message");
  });
});
