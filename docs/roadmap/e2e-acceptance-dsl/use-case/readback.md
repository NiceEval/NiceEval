# Use Case · 读面行为:history 行、stats 计数与文案耦合

## 场景

report 仓库对 `show --history` / `--stats` / 多页报告验收[读面契约](../../../engineering/testing/e2e/report.md#4-读面-cli-行为):attempt 行按身份去重升序、verdict 三态计数、locator 可提取供后续证据切面命令使用。

## 现行断言

摘自 `e2e/report/scripts/verify-readback.ts`:

```ts
// ① 手搓 history 行解析:时间戳正则 + locator 提取,verify-readback 与 cli/verify 各写一份
const rows = sh(`pnpm exec niceeval show ${id} --history`).split("\n")
  .filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\s/.test(l));
const locator = rows.at(-1)!.match(/@\S+/)![0];

// ② stats 计数:字形 + 空白间距入正则
assert.match(failedStatsLine, /✓0\s+✗[1-9]\d*\s+!0/, "...");

// ③ 分组标题:`·` 分隔文案整句锁死
assert.ok(compare.includes("compare · 2 conditions"), "...");
assert.ok(usage.includes("usage · main · 2 attempts"), "...");

// ④ verdict 字形直接当契约
assert.ok(compare.includes("✗ failed") && compare.includes("! errored"), "...");
```

②④ 在 verdict 标记换字形(比如 `✗` → `✘`)时全体变红;③ 在分隔符或措辞调整时变红;① 是重复发明的解析器,两个仓库各自维护。

## 候选写法

```ts
test("history 逐 attempt 升序,verdict 与 locator 可提取", async () => {
  const { stdout } = await cli(`pnpm exec niceeval show tool-call --history`);
  const rows = term(stdout).historyRows();          // { timestamp, verdict, locator, text }[]

  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.timestamp)).toEqual([...rows.map((r) => r.timestamp)].sort());
  expect(rows.at(-1)!.verdict).toBe("passed");

  const locator = rows.at(-1)!.locator;             // 交给后续 show @<locator> --execution
});

test("失败实验的 stats 计数", async () => {
  const { stdout } = await cli(`pnpm exec niceeval show deliberate --stats`);
  expect(term(stdout).stats()).toMatchObject({ passed: 0, errored: 0 });
  expect(term(stdout).stats().failed).toBeGreaterThan(0);
});

test("compare 页按条件分组", async () => {
  const { stdout } = await cli(`pnpm exec niceeval show --page compare`);
  await expect(stdout).toMatchTermSnapshot(`
    - heading /compare/
    - section /with-memory/
    - section /baseline/
  `);
});
```

- ① 的解析器升格为 `historyRows()` / `stats()`——niceeval 惯用形提取器,以 [Show](../../../feature/reports/show.md) 文档声明为规范,一处实现、各仓库共用。
- ② 断言数值(`failed > 0`),字形与间距归提取器消化;`✗` 换字形时改提取器一处,断言不动——且提取器与文档声明的失配是真发现。
- ③ 降格为「分组结构存在、两个条件各成区块」;`· 2 conditions` 的计数要单独锁时用 `/2 conditions/` 一档正则,不锁分隔符。
- ④ verdict 以 `historyRows()[i].verdict` 的枚举值断言,不以字形断言。

## 边界

- **断言了**:排序与去重语义、verdict 三态数值、locator 可提取且可用于下游命令、分组结构。
- **不断言**:verdict 字形、分隔符、间距、时间戳展示格式(解析后即弃)。
- `--grep` 空结果这类**整句就是契约**的输出(`0 matches in 1 attempt`)不上语义树,见 [machine-exports](machine-exports.md) 的 golden 层。
