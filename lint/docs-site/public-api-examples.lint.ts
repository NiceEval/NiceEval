import { describe, expect, it } from "vitest";

import {
  formatApiExampleLintHits,
  lintApiCodeExample,
  lintPublicApiExamples,
} from "../../scripts/docs-api-example-lint.js";

describe("公开文档的 API 示例", () => {
  it("不展示已拒绝的 CLI flag 或已删除的普通 Fact/Match API", () => {
    const hits = lintPublicApiExamples();
    expect(hits.length, formatApiExampleLintHits(hits)).toBe(0);
  });

  it("只给 Judge 兼容句柄保留 gate、atLeast 与 points 链", () => {
    const hits = lintApiCodeExample(
      "example.ts",
      [
        't.judge.autoevals.closedQA("rubric").atLeast(0.7);',
        't.judge.autoevals.closedQA("rubric").gate();',
        't.judge.autoevals.closedQA("rubric").points(2);',
        't.check(t.reply, similarity(expected).atLeast(0.7));',
        't.sandbox.fileChanged("src/app.ts").points(2);',
      ].join("\n"),
    );

    expect(hits.map((hit) => hit.rule)).toEqual([
      "ordinary-fact.atLeast",
      "ordinary-fact.points",
    ]);
  });
});
