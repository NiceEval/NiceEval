import { describe, expect, it } from "vitest";

import {
  formatRegressionHits,
  lintDocsWriting,
  lintSvgTerms,
  parseConcepts,
  proseBlocks,
  proseText,
  serializeBaseline,
  splitSentences,
  svgTexts,
  synonymBans,
  validateRules,
} from "../../scripts/docs-writing-lint.js";

// docs/ 的可读性规矩(句长、段长、行宽、禁用写法)由 docs/writing-rules.json 声明,
// 规矩本身写在 docs/README.md「写给人读」与 docs/concepts.md「禁用写法」。
// 规则与计数住在 scripts/docs-writing-lint.ts,判对错只有这一处入口——
// 契约再准确,读不动的段落等于没写,而「以后再顺手改」在没有守护时等于不改。
describe("docs 可读性守护", () => {
  it("docs/writing-rules.json 的每条禁词都带 use 与 why", () => {
    // 没有理由的禁词会被下一个人当成洁癖绕过,所以三个字段一个都不能空。
    expect(validateRules()).toEqual([]);
  });

  it("超长句、超长段、超宽行与禁用写法不超过 docs/writing-baseline.json 的台账", async () => {
    const report = lintDocsWriting();

    // 棘轮在前:有回归就在这一行终止,下面的台账写回够不着,
    // 于是 `-u` 也放不宽一个数字——「只许变小」在更新模式下同样成立。
    expect(report.regressions.length, formatRegressionHits(report)).toBe(0);

    // 改好了台账就得跟着收紧,否则腾出来的额度会被下一次改动悄悄用掉。
    await expect(serializeBaseline(report.actual)).toMatchFileSnapshot(
      "../../docs/writing-baseline.json",
    );
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

  it("概念表按表头认列,不按位置——表格加一列不会让词条静默错位", () => {
    // 总表是三列、报告组件表是五列,写死列号的解析器在第二张表上会把「含义」当成词。
    const five = parseConcepts(
      ["| 分类 | 中文 | English | API | 主展示单位 |", "|---|---|---|---|---|", "| 汇总 | 样本摘要 | Sample summary | `SampleSummary` | 一批 Sample |"].join("\n"),
    );
    expect(five[0].writings).toEqual(["样本摘要", "Sample summary", "SampleSummary"]);
  });

  it("一格里多个写法:恰好一个加粗才是同义词组,粗体那个是首选", () => {
    // 报告组件表把七个组件挤在一行(行 / 列 / 分节…),它们互不同义;
    // 把「多写法」一律当同义词会把六个正当词条判成该改用第七个。
    const [synonyms, siblings] = [
      "| **首过即停** / 早停 | EarlyExit | 取通过率时先过一次即中止 |",
      "| 行 / 列 / 分节 | Row / Col / Section | 版面组件 |",
    ].map((row) => parseConcepts(["| 中文 | English | 含义 |", "|---|---|---|", row].join("\n"))[0]);

    expect(synonyms.preferred).toBe("首过即停");
    expect(synonyms.deprecated).toEqual(["早停"]);
    expect(siblings.preferred).toBeUndefined();
    expect(siblings.deprecated).toEqual([]);
  });

  it("首选裁决翻译成禁词条目,概念表自己豁免", () => {
    // 术语只在概念表裁决一次,writing-rules.json 不再手抄一份同义词对照。
    const terms = parseConcepts(
      ["| 中文 | English | 含义 |", "|---|---|---|", "| **首过即停** / 早停 | EarlyExit | 取通过率时先过一次即中止 |"].join("\n"),
    );
    const [ban] = synonymBans(terms);
    expect(ban.term).toBe("早停");
    expect(ban.use).toContain("首过即停");
    expect(ban.why).toBeTruthy();
    expect(ban.exempt).toEqual(["docs/concepts.md"]);
  });

  it("英文列括号里的代码标识算一种写法", () => {
    // 表头声明「代码标识与标准术语不同时,英文列把代码标识放在括号里」。
    // 不拆开的话,正文明明在用 ExecutionTree,这一行仍会被判成死词。
    const [term] = parseConcepts(
      ["| 中文 | English | 含义 |", "|---|---|---|", "| Agent 执行树 | Agent execution tree (`ExecutionTree`) | 统一执行记录 |"].join("\n"),
    );
    expect(term.writings).toContain("ExecutionTree");
    expect(term.writings).toContain("Agent execution tree");
  });

  it("长度只算读者要读的字:链接算文本不算 URL,行内代码算内容不算反引号", () => {
    expect(proseText("见 [运行器](feature/runner/README.md) 的 `--concurrency`。")).toBe(
      "见 运行器 的 --concurrency。",
    );
  });
});

// 图和正文各说各话是这么开始的:画的人为了摆得下造个简称,读的人在正文里查不到它。
// 规矩写在 docs/SVG-DESIGN.md「用语:图里不立新词」,没有台账——一次命中都不许有。
describe("docs/ 手绘 SVG 的用语", () => {
  it("盒标题与泳道名用的词在正文里都有出处,禁用写法也不许藏进图里", () => {
    const hits = lintSvgTerms();
    expect(hits, hits.map((h) => `${h.file}:${h.line}  ${h.message}`).join("\n")).toEqual([]);
  });

  it("tspan 拼进父节点,不按 tspan 切词", () => {
    // 一行里用 tspan 分色的「已<tspan>受理</tspan>」是同一个词,拆开两边都不成词,
    // 于是两个半截都在正文里查不到——按节点切会把这种图逐个判红。
    const [node] = svgTexts(`<text class="label">已<tspan class="good">受理</tspan></text>`);
    expect(node.text).toBe("已受理");
    expect(node.classes).toEqual(["label"]);
  });

  it("说明句与图标题不按词判,只有盒标题与泳道名判", () => {
    // 这两格是为这张图现写的句子,拿「正文里出现过」去量,每一句都会红。
    const nodes = svgTexts(
      [
        `<text x="32" y="48" class="title">两条决策轴</text>`,
        `<text x="32" y="88">失败之后如何取舍</text>`,
        `<text x="32" y="120" class="label mono">agent.send</text>`,
      ].join("\n"),
    );
    expect(nodes.map((n) => n.classes)).toEqual([["title"], [], ["label", "mono"]]);
    expect(nodes.map((n) => n.line)).toEqual([1, 2, 3]);
  });
});
