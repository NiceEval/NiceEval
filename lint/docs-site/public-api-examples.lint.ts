import { describe, expect, it } from "vitest";

import {
  formatApiExampleLintHits,
  lintApiCodeExample,
  lintPublicApiExamples,
} from "../docs/public-api-examples.js";

describe("公开文档的 API 示例", () => {
  it("不展示已拒绝的 CLI flag 或已删除的普通 Fact/Match API", () => {
    const hits = lintPublicApiExamples();
    expect(hits.length, formatApiExampleLintHits(hits)).toBe(0);
  });

  it("允许 Judge threshold Match，但拒绝已删除的 Assertion handle 链", () => {
    const hits = lintApiCodeExample(
      "example.ts",
      [
        'const quality = defineJudge({ name: "quality", rubric: "评价回答质量" });',
        "quality.atLeast(0.7);",
        't.check({ answer: "ok" }, quality.atLeast(0.7)).gate();',
        't.check({ answer: "ok" }, quality).points(2);',
        't.check(t.reply, similarity(expected).atLeast(0.7));',
        't.sandbox.fileChanged("src/app.ts").points(2);',
      ].join("\n"),
    );

    expect(hits.map((hit) => hit.rule)).toEqual([
      "ordinary-fact.points",
      "ordinary-fact.points",
    ]);
  });
});
