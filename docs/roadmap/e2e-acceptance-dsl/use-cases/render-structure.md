# Use Case · 渲染结构:散点图标题、表格与区块顺序

## 场景

report 仓库对 `niceeval show` 终端输出验收[渲染面契约](../../../engineering/testing/e2e/report.md):区块存在与相对顺序、表格成形、图表标题与图例。这是脆断言最集中的场景——断言对象本来是结构,现行词表却只有整句文本。

## 现行断言

摘自 `e2e/report/scripts/verify-render-structure.ts` 与 `verify-package-consumer.ts`:

```ts
// ① 散点图标题:整句文案正则,方向注解措辞、× 字形、括号风格全部入契约
assert.match(stdout, /Cost\(lower is better\) × Pass rate\(higher is better\)/, "...");

// ② 方向提示:精确短语 + 箭头字形
assert.ok(text.includes("better → upper right"), "...");

// ③ 表格成形:80 列精确 padding,逐行核长度;另配手搓 CJK 宽度表核列对齐
for (const line of experimentTableRows) {
  assert.equal(line.length, 80, "ExperimentList table row should be padded to exactly the 80-column width...");
}

// ④ 折行续行:靠「某行以续行前缀开头」间接证明
assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-error")), "...");
```

①② 在方向注解改措辞、箭头换字形时变红——契约(「散点图存在、标出两个维度、注明方向」)没变。③④ 锁的是排版算法输出,而[单元层已经证明](../../../engineering/testing/README.md#单元层的边界)宽度与折行的确定性语义,E2E 再逐字符锁一遍是重复口径。

## 候选写法

```ts
test("show 渲染散点图与实验表", async () => {
  const { stdout } = await cli(`pnpm exec niceeval show --report scatter`);

  await expect(stdout).toMatchTermSnapshot(`
    - heading /Cost .*× Pass rate/
    - section:
      - line /codex/
      - line /claude/
    - section "Experiments":
      - table:
        - row /main .* \\d+%/
        - row /rag .* \\d+%/
  `);
});
```

- ①② 归并为 `- heading /Cost .*× Pass rate/`:锁「有一张 Cost × Pass rate 的图」,注解措辞与箭头是化妆细节。要单独锁「方向有注明」时加一档正则(`/Cost.*lower/`),仍不锁整句。
- ③ 换成 `- table:` + 行匹配:表格**成形**(列对齐被解析器识别为 table)本身就是断言;80 列与 CJK 口径归单元层,E2E 不再持有第二份宽度实现。
- ④ 折行续行在解析层并回原行,`- row /te-error .*/` 直接命中,不再依赖续行前缀的间接证据。

需要锁「不多不少、顺序固定」的区块(如 attempt 首页 facts 的完整清单)显式升级:

```yaml
- section "Attempts":
  - /children: equal
  - row /tool-call .* passed/
  - row /te-fail .* failed/
  - row /te-error .* errored/
```

## 边界

- **断言了**:结构存在、类别正确、相对顺序(子序列)、关键事实出现在正确的结构位置。
- **不断言**:措辞全文、字形、列宽、padding、折行位置、框线字符——这些由[排版原语](../../../feature/reports/library/layout.md)的单元测试证明确定性语义,E2E 只证明「真实数据上结构成立」。
- 现行脚本里**本来就对**的断言(如双面事实互提对比:text 与 web 各提取主行事实互比,不比常量)不改写——那已经是事实级断言,词表升级不强迫。
