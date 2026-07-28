// cases: docs/engineering/testing/unit/reports.md
// 「Conversation / DiffView 的两面投影与维度封闭性」——Conversation 条目。

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
import { Conversation, Text, type ConversationContent } from "./primitives.tsx";
import { defineSource } from "../source.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content: ConversationContent = {
  turns: [
    {
      key: "t1",
      label: "turn 1",
      verdict: "passed",
      entries: [
        { kind: "user", preview: "hello\nworld" },
        {
          kind: "assistant",
          preview: "hi",
          detail: <Text>full assistant body</Text>,
        },
        { kind: "error", preview: "boom", failed: true },
      ],
    },
    {
      key: "t2",
      label: "turn 2",
      verdict: "failed",
      entries: [{ kind: "tool", preview: "grep pattern" }],
    },
  ],
  failedCommands: [
    {
      key: "cmd1",
      phase: "eval.setup",
      display: "pnpm test",
      exitCode: 1,
      stderr: "failed",
    },
  ],
};

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

describe("Conversation", () => {
  it("两面投影:轮次摘要、预览收口与下钻命令", async () => {
    const tree = await resolve(
      <Conversation data={content} />,
      { id: "attempt", input: "attempt", locator: "@loc1" as AttemptLocator, evidence: {} as AttemptEvidence },
    );
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text).toContain("conversation: 2 rounds");
    expect(text).toContain("niceeval show @loc1 --execution");
    expect(text).toContain("turn 1 (passed)");
    expect(text).toContain("turn 2 (failed)");
    expect(text).toContain("FAILED COMMAND · eval.setup · exit 1: pnpm test");
    expect(text).not.toContain("hello");
    expect(text).not.toContain("full assistant body");
    expect(text).not.toContain("grep pattern");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-conversation");
    expect(html).toContain("niceeval-conversation-turn--passed");
    expect(html).toContain("niceeval-conversation-turn--failed");
    expect(html).toContain('data-kind="assistant"');
    expect(html).toContain("hello world");
    expect(html).toContain("full assistant body");
    expect(html).toContain("niceeval-conversation-entry--failed");
    expect(html).toContain("FAILED COMMAND");
    expect(html).toContain("<details");
  });

  it("空 turns 且无 failedCommands 时零输出", async () => {
    const emptyTree = await resolve(<Conversation data={{ turns: [] }} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<Conversation data={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(nullTree as never))).toBe("");
  });

  it("source 与 data 等价", async () => {
    const source = defineSource({
      name: "conv",
      compute: async () => content,
    });
    const fromData = await resolve(<Conversation data={content} />);
    const fromSource = await resolve(<Conversation source={source} />);
    const textData = renderNodeToText(fromData, createTextContext({ width: 100 }));
    const textSource = renderNodeToText(fromSource, createTextContext({ width: 100 }));
    expect(textSource).toBe(textData);
  });
});
