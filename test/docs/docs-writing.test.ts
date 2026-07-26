import { describe, expect, it } from "vitest";

import { lintDocsWriting, validateRules } from "../../scripts/docs-writing-lint.js";

// docs/ 的可读性规矩(行宽、禁用写法)由 docs/writing-rules.json 声明,
// 规矩本身写在 docs/README.md「写给人读」与 docs/concepts.md「禁用写法」。
// 检查逻辑住在 scripts/docs-writing-lint.ts(`pnpm docs:lint` 给作者看详细命中),
// 这里只让 `pnpm test` 拦住回归——契约再准确,读不动的段落等于没写,
// 而「以后再顺手改」在没有守护时等于不改。
describe("docs 可读性守护", () => {
  it("docs/writing-rules.json 的每条禁词都带 use 与 why", () => {
    // 没有理由的禁词会被下一个人当成洁癖绕过,所以三个字段一个都不能空。
    expect(validateRules()).toEqual([]);
  });

  it("超宽行与禁用写法不超过 docs/writing-baseline.json 的台账", () => {
    const { regressions } = lintDocsWriting();
    expect(
      regressions,
      "跑 pnpm docs:lint 看具体是哪一行;台账只许变小,不要改台账让它变绿",
    ).toEqual([]);
  });

  it("台账没有比实际更宽松的条目", () => {
    // 改好了就把台账收紧,否则腾出来的额度会被下一次改动悄悄用掉。
    const { stale } = lintDocsWriting();
    expect(stale, "跑 pnpm docs:lint --update 收紧台账").toEqual([]);
  });
});
