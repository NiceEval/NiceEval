import { describe, expect, it } from "vitest";

import {
  lintDocsWriting,
  proseBlocks,
  proseText,
  splitSentences,
  validateRules,
} from "../../scripts/docs-writing-lint.js";

// docs/ 的可读性规矩(句长、段长、行宽、禁用写法)由 docs/writing-rules.json 声明,
// 规矩本身写在 docs/README.md「写给人读」与 docs/concepts.md「禁用写法」。
// 检查逻辑住在 scripts/docs-writing-lint.ts(`pnpm docs:lint` 给作者看详细命中),
// 这里只让 `pnpm test` 拦住回归——契约再准确,读不动的段落等于没写,
// 而「以后再顺手改」在没有守护时等于不改。
describe("docs 可读性守护", () => {
  it("docs/writing-rules.json 的每条禁词都带 use 与 why", () => {
    // 没有理由的禁词会被下一个人当成洁癖绕过,所以三个字段一个都不能空。
    expect(validateRules()).toEqual([]);
  });

  it("超长句、超长段、超宽行与禁用写法不超过 docs/writing-baseline.json 的台账", () => {
    const { regressions } = lintDocsWriting();
    expect(
      regressions,
      "跑 pnpm docs:lint 看具体是哪一行;台账只许变小,不要改台账让它变绿",
    ).toEqual([]);
  });

  it("句子量在软换行拼接之后:在句子中间换行不改变判定", () => {
    // 这条是句长规则存在的理由:按单行量的话,敲个回车就能把长难句拆过检查,
    // 而渲染结果一个字没变。两种排版必须给出同一个句子。
    const long = `${"甲".repeat(200)}。`;
    const oneLine = proseBlocks([long]);
    const wrapped = proseBlocks([long.slice(0, 100), long.slice(100)]);
    expect(splitSentences(proseText(oneLine[0].text))).toHaveLength(1);
    expect(splitSentences(proseText(wrapped[0].text))[0].length).toBeGreaterThan(140);
  });

  it("分号与破折号不算断句,句末标点才算", () => {
    // 分句串联正是长难句的长法。把分号当断句等于放过要治的对象。
    expect(splitSentences("甲;乙——丙。丁。")).toEqual(["甲;乙——丙。", "丁。"]);
  });

  it("表格、代码块与标题不是正文,列表项各算一段", () => {
    const blocks = proseBlocks([
      "# 标题",
      "正文甲。",
      "| 表 | 格 |",
      "```ts",
      "const x = 1;",
      "```",
      "- 列表甲",
      "- 列表乙",
    ]);
    expect(blocks.map((b) => b.text)).toEqual(["正文甲。", "列表甲", "列表乙"]);
  });

  it("长度只算读者要读的字:链接算文本不算 URL,行内代码算内容不算反引号", () => {
    expect(proseText("见 [运行器](feature/runner/README.md) 的 `--concurrency`。")).toBe(
      "见 运行器 的 --concurrency。",
    );
  });

  it("台账没有比实际更宽松的条目", () => {
    // 改好了就把台账收紧,否则腾出来的额度会被下一次改动悄悄用掉。
    const { stale } = lintDocsWriting();
    expect(stale, "跑 pnpm docs:lint --update 收紧台账").toEqual([]);
  });
});
