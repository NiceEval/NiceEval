// cases: docs/engineering/testing/unit/reports.md
// 「Callouts / ... CopyBlock 的两面投影与维度封闭性」
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
import { CopyBlock } from "./primitives/copy-block.tsx";
import { defineSource } from "../source.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content = {
  title: { en: "Fix prompt (3 failures)" },
  text: "Please fix the failing evals.\nStep 1: read logs.",
};

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

describe("CopyBlock", () => {
  it("web 面折叠块含标题、全文与复制按钮;text 面零输出", async () => {
    const tree = await resolve(<CopyBlock data={content} />);
    expect(renderNodeToText(tree, createTextContext({ width: 80, locale: "en" }))).toBe("");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("nre-copy-block");
    expect(html).toContain("Fix prompt (3 failures)");
    expect(html).toContain("Please fix the failing evals.");
    expect(html).toContain('data-nre-copy="Please fix the failing evals.\nStep 1: read logs."');
    expect(html).toContain("<details");
  });

  it("data null 两面零输出", async () => {
    const tree = await resolve(<CopyBlock data={null} />);
    expect(renderNodeToText(tree, createTextContext({ width: 80 }))).toBe("");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toBe("");
  });

  it("source 与 data 等价", async () => {
    const source = defineSource({
      name: "copy-block-fixture",
      compute: async () => content,
    });
    const fromSource = await resolve(<CopyBlock source={source} />);
    const fromData = await resolve(<CopyBlock data={content} />);
    const htmlSource = runWithWebContext(webCtx, () => renderToStaticMarkup(fromSource as never));
    const htmlData = runWithWebContext(webCtx, () => renderToStaticMarkup(fromData as never));
    expect(htmlSource).toContain("Fix prompt (3 failures)");
    expect(htmlData).toContain("Fix prompt (3 failures)");
    expect(renderNodeToText(fromSource, createTextContext({ width: 80 }))).toBe("");
    expect(renderNodeToText(fromData, createTextContext({ width: 80 }))).toBe("");
  });
});
