# Use Case · 渲染结构:散点图、实验表与折行

## 场景

report 仓库对 `niceeval show` 终端输出验收[渲染面契约](../../../engineering/testing/e2e/report.md):区块存在与相对顺序、表格成形、图表标题与图例。
这是脆断言最集中的场景——断言对象本来是结构,现行词表却只有整句文本。

## 现行断言

摘自 `e2e/report/scripts/verify-render-structure.ts` 与 `verify-package-consumer.ts`:

```ts
// ① 散点图标题:整句文案正则,方向注解措辞、× 字形、括号风格全部入契约
assert.match(stdout, /Cost\(lower is better\) × Pass rate\(higher is better\)/, "...");

// ② 方向提示:精确短语加箭头字形
assert.ok(text.includes("better → upper right"), "...");

// ③ 表格成形:80 列精确 padding,逐行核长度;另配手搓 CJK 宽度表核列对齐
for (const line of experimentTableRows) {
  assert.equal(line.length, 80, "ExperimentList table row should be padded to exactly the 80-column width...");
}

// ④ 折行续行:靠「某行以续行前缀开头」间接证明
assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-error")), "...");
```

①② 在方向注解改措辞、箭头换字形时变红——契约(「散点图存在、标出两个维度、注明方向」)没变。
③④ 锁的是排版算法输出,而[单元层已经证明](../../../engineering/testing/README.md#单元层的边界)宽度与折行的确定性语义,E2E 再逐字符锁一遍是重复口径。

## 候选写法

结构事实按领域身份断言,stdout 读面负责语义,PTY 读面负责排版:

```ts
reportBehavior(showsScatterAndExperimentTable, async () => {
  const { stdout } = await cli("pnpm exec niceeval show --report scatter.tsx");
  const report = reportView(stdout);

  const chart = report.chart({ x: "Cost", y: "Pass rate" });
  expectObserved(chart.seriesIds()).toHaveSeries(["codex", "claude"]);

  const table = report.table("Experiments");
  expectObserved(table.rowIds()).toShowRows(["main", "rag"]);
  expectObserved(table.row("main").cell("Pass rate")).toEqualValue("100%");
});

reportBehavior(wrapsLongExperimentIdsAtNarrowWidth, async () => {
  const screen = await ptyScreen(w, "pnpm exec niceeval show", { columns: 80 });
  expectObserved(screen.rowsOccupiedBy("deliberate-error")).toEqualValue(2);
});
```

- ①② 归并为按两轴维度名寻址一张图:锁「有一张 Cost × Pass rate 的图、图上有这两个系列」,注解措辞与箭头是化妆细节。
  要单独锁「方向有注明」时,给轴立一个 `chart.axisHint("x")` 领域词,仍不锁整句。
- ③ 换成表的身份与格子:表能被解析成表、行身份齐全、某一格的值正确。
  80 列 padding 与 CJK 口径归 PTY 读面与单元层,stdout 读面不再持有第二份宽度实现。
- ④ 折行是排版事实,搬进 PTY 读面按屏幕行数断言,不再依赖续行前缀的间接证据。

需要锁「不多不少、顺序固定」的清单显式升级:

```ts
expectObserved(report.table("Attempts").rowIds())
  .toShowExactRows(["tool-call", "te-fail", "te-error"]);
```

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [text 面列顺序与折行不稳](../../../../memory/experimentlist-text-column-order-and-wrap-instability.md) | 真实列顺序把 Results 排在 Tokens 之前,与文档范例不符;哪一格折行随当次真实数值漂移 | 不红,这正是要的:`row.cell("Pass rate")` 按列名寻址,列的左右位置不进契约。列顺序本身要立契约时单写一条 `table.columnNames()`,doc 与 code 的分歧因此有唯一一条断言承接 |
| [极小量程下刻度标签折叠](../../../../memory/axis-tick-labels-collapse-at-tiny-ranges.md) | 成本轴五个刻度全部显示 `$0.0001`,「刻度值随位置递减」的断言解析后拿到五个相等值 | outcome 阶段:`chart.axisTicks("x")` 加 `toShowExactRows` 报出实际刻度身份是五个相同字符串,直接对上契约「标签始终显示真实值」 |
| [视觉迁移静默改了公式](../../../../memory/visual-migration-silently-changed-computed-formulas.md) | 通过率从两级聚合换成朴素比例,失败原因只剩第一条断言;结构与身份全都没变,页面照常渲染 | **抓不到**,按设计如此 |

第三条要说清楚。
结构读面能断「这一格显示 67%」,不能断「67% 是不是对的口径」——正确值只有计算层知道。
按[渲染边界裁决](../../../design/user-readable-testing/DECISION.md#渲染边界裁决),聚合与单位这类无媒介数据语义归单元层,E2E 重复一遍只会得到同一个错答案的第二份确认。

## 边界

- **断言了**:结构存在、身份正确、相对顺序、关键事实出现在正确的结构位置。
- **不断言**:措辞全文、字形、列宽、padding、折行位置、框线字符——排版事实归 PTY 读面与[排版原语](../../../feature/reports/library/layout.md)的单元测试,stdout 读面只证明「真实数据上结构成立」。
- 现行脚本里**本来就对**的断言(如双面事实互提对比:text 与 web 各提取主行事实互比,不比常量)不改写——它已经是事实级断言,只把两侧的提取换成领域词,比较由 `toEqualObserved` 承接。
</content>
