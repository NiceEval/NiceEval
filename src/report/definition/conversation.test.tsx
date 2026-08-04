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
import { CommandEvidence, Conversation, Text, type CommandEvidenceContent, type ConversationContent } from "./primitives.tsx";
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

function attemptTarget(target: { page: string; params?: unknown }): string | undefined {
  if (target.page !== "attempt") return undefined;
  const locator = (target.params as { locator?: unknown } | undefined)?.locator;
  return typeof locator === "string" ? locator : undefined;
}

const webCtx: WebContext = {
  locale: "en",
  href: () => undefined,
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

describe("Conversation", () => {
  it("两面投影只包含轮次,生命周期命令不进入 Conversation", async () => {
    const tree = await resolve(
      <Conversation data={content} />,
      { id: "attempt", input: { locator: "@loc1" as AttemptLocator, result: {} } as AttemptEvidence },
    );
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
    expect(text).toContain("conversation: 2 rounds");
    expect(text).toContain("niceeval show @loc1 --execution");
    expect(text).toContain("turn 1 (passed)");
    expect(text).toContain("turn 2 (failed)");
    expect(text).not.toContain("FAILED COMMAND");
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
    expect(html).not.toContain("FAILED COMMAND");
    expect(html).toContain("<details");
  });

  it("空 turns 时零输出", async () => {
    const emptyTree = await resolve(<Conversation data={{ turns: [] }} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<Conversation data={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(nullTree as never))).toBe("");
  });
});

describe("CommandEvidence", () => {
  const commands: CommandEvidenceContent = {
    commands: [
      { key: "cmd0", timingNodeId: "n0", phase: "sandbox.prepare.eval", display: "apt-get update", exitCode: 0, classification: "succeeded", stdout: "Reading package lists..." },
      { key: "cmd1", timingNodeId: "n1", phase: "sandbox.prepare.eval", display: "npm ci", exitCode: 2, classification: "observed", stderr: "EACCES" },
      { key: "cmd2", timingNodeId: "n2", phase: "eval.run", display: "npm test", exitCode: 1, classification: "failed", stderr: "test failed" },
    ],
  };

  it("succeeded 使用中性成功文案/样式,observed 使用中性非零文案/样式,failed 才使用失败文案/样式", async () => {
    const tree = await resolve(<CommandEvidence data={commands} />);
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text).toContain("COMMAND · sandbox.prepare.eval · exit 0");
    expect(text).not.toContain("NON-ZERO COMMAND · observed · sandbox.prepare.eval · exit 0");
    expect(text).toContain("NON-ZERO COMMAND · observed · sandbox.prepare.eval · exit 2");
    expect(text).toContain("FAILED COMMAND · eval.run · exit 1");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-command-evidence");
    expect(html).toContain("niceeval-command-evidence--succeeded");
    expect(html).toContain("niceeval-command-evidence--observed");
    expect(html).toContain("niceeval-command-evidence--failed");
    expect(html).not.toContain("niceeval-conversation-failed-command");
  });
});
