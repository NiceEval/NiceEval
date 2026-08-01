# Use Case · 读面行为:history 行、stats 计数与文案耦合

## 场景

report 仓库对 `show --history` / `--stats` / 多页报告验收[读面契约](../../../engineering/testing/e2e/report.md#4-读面-cli-行为):attempt 行按身份去重升序、判定三态计数、locator 可提取供后续证据切面命令使用。

## 现行断言

摘自 `e2e/report/scripts/verify-readback.ts`:

```ts
// ① 手搓 history 行解析:时间戳正则加 locator 提取,verify-readback 与 cli/verify 各写一份
const rows = sh(`pnpm exec niceeval show ${id} --history`).split("\n")
  .filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\s/.test(l));
const locator = rows.at(-1)!.match(/@\S+/)![0];

// ② stats 计数:字形与空白间距入正则
assert.match(failedStatsLine, /✓0\s+✗[1-9]\d*\s+!0/, "...");

// ③ 分组标题:`·` 分隔文案整句锁定
assert.ok(compare.includes("compare · 2 conditions"), "...");
assert.ok(usage.includes("usage · main · 2 attempts"), "...");

// ④ 判定字形直接当契约
assert.ok(compare.includes("✗ failed") && compare.includes("! errored"), "...");
```

②④ 在判定标记换字形(比如 `✗` 换成 `✘`)时全体变红;③ 在分隔符或措辞调整时变红;① 是重复发明的解析器,两个仓库各自维护。

## 候选写法

身份从 world 来,顺序由声明的身份序列表达,不由观察值自比:

```ts
reportBehavior(historyListsEveryAttemptOfTheEval, async () => {
  const { stdout } = await cli("pnpm exec niceeval show tool-call --history");
  const history = reportView(stdout).history();

  // 顺序即断言:期望的身份序列由测试声明,不拿观察值排序后跟自己比
  expectObserved(history.locatorIds())
    .toShowExactRows([w.locator("tool-call@first"), w.locator("tool-call@latest")]);
  expectObserved(history.row(w.locator("tool-call@latest")).verdict()).toEqualValue("passed");
});

reportBehavior(historyLocatorOpensTheSameAttempt, async () => {
  const historic = w.locator("tool-call@first");      // 更早那次 Run 的 attempt

  const listed = reportView((await cli("pnpm exec niceeval show tool-call --history")).stdout);
  expectObserved(listed.history().locatorIds()).toShowRows([historic]);          // 印得出来

  const opened = reportView((await cli(`pnpm exec niceeval show ${historic} --execution`)).stdout);
  expectObserved(opened.attempt(historic).verdict()).toEqualValue("passed");     // 打得开
});

reportBehavior(statsCountsFailuresOfADeliberatelyFailingExperiment, async () => {
  const stats = reportView((await cli("pnpm exec niceeval show deliberate --stats")).stdout).stats();
  expectObserved(stats).toEqualValue({ passed: 0, failed: 2, errored: 0 });
});
```

- ① 的解析器归 adapter 内部,测试正文只有 `history()` 与身份;两个仓库不再各维护一份行正则。
- ② 断言三态数值,字形与间距由读面消化;`✗` 换字形时改一处映射,断言不动——映射与[文档声明](../../../feature/reports/show/stats.md)的失配是真发现。
- ③ 降格为「分组结构存在、两个条件各成区块」:`report.region("compare").itemIds()` 断出两个条件的身份,`· 2 conditions` 的措辞与分隔符不进契约。
- ④ 判定以枚举值断言,不以字形断言。

第二条 Behavior 的区分力全在 world 上:recipe 必须让同一个 eval 有两次 Run。
只有一次 Run 时,「现刻水位」与「整个记录根」同解,这条断言恒绿也就白写。

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [`@<locator>` 被现刻水位收窄](../../../../memory/show-locator-scoped-to-current-sample.md) | `--history` 印出历史 attempt 的 locator,复制去 `show @…` 报 `outside the selected record scope`;下钻链断在自己印出来的那一步 | outcome 阶段:`historyLocatorOpensTheSameAttempt` 的第二段 `cli()` 非零退出,失败消息带完整可复制命令与 world 身份,一句话说清「印得出来但打不开」 |
| [读回验收改写共享结果根](../../../../memory/verify-readback-mutation-orders-later-e2e-report-domains.md) | 追加两次真实快照后,晚运行的只读验收域在 `--page traces` 里查不到 `evidence.main` 的原始 locator,失败离病因很远 | 不会发生:追加快照的场景声明 `mutationActionId` 并在私有 clone 上执行,共享 world 只读且有前后文件树 digest;执行顺序由绑定关系表达,不靠约定 |

第二条是从「靠脚本头注约定执行顺序」变成结构上不可能的那一类。
现行流程里它只写在 `verifyHistoryAndPages` 的头注里,新增验收域的人读不到就会中招。

## 边界

- **断言了**:排序与去重语义、判定三态数值、locator 可提取且可用于下游命令、分组结构。
- **不断言**:判定字形、分隔符、间距、时间戳展示格式(读面消化后即弃)。
- `--grep` 空结果这类**整句就是契约**的输出(`0 matches in 1 attempt`)不上结构读面,见 [machine-exports](machine-exports.md) 的逐字比对。
</content>
