# Use Case：Show 读回与 locator 往返

## 目标

从 `show --history` 读取公开 locator，再把同一个 locator 交回真实 CLI 打开详情。
测试按 attempt 身份和字段寻址，不解析分隔符或状态字形。

## 完整测试

```ts
// test/behavior/debug/history-locator-roundtrip.test.ts
import { reportBehavior } from "../../support/behavior";
import {
  cli,
  reportView,
  shellArg,
  expectObserved,
} from "../../support/readback";
import {
  historyListsEveryAttempt,
  historyLocatorRoundTrips,
  statsCountFailures,
} from "../../support/behaviors";

reportBehavior(historyListsEveryAttempt, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval show tool-call --history",
    { cwd: w.consumerDir("report") },
  );
  const history = reportView(run.stdout).history("tool-call");

  expectObserved(history.attemptNumbers()).toShowExactRows([1, 2]);
  expectObserved(history.attempt(2).verdict()).toEqualValue("passed");
});

reportBehavior(historyLocatorRoundTrips, async ({ w }) => {
  const historyRun = await cli(
    "pnpm exec niceeval show tool-call --history",
    { cwd: w.consumerDir("report") },
  );
  const locator = reportView(historyRun.stdout)
    .history("tool-call")
    .attempt(1)
    .locator();
  const locatorArg = shellArg(locator);

  const detailRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --execution`,
    { cwd: w.consumerDir("report") },
  );
  const detail = reportView(detailRun.stdout).attempt(locatorArg);

  expectObserved(detail.locator()).toEqualObserved(locator);
  expectObserved(detail.executionNodes()).toShowRows(["get_weather"]);
});

reportBehavior(statsCountFailures, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval show deliberate-fail --stats",
    { cwd: w.consumerDir("report") },
  );
  expectObserved(reportView(run.stdout).stat("failed")).toEqualValue(1);
});
```

## 边界

`Observed` 的值由关系 matcher 或命令参数桥接器读取；实现不能让普通测试任意解包后丢失证据。
找不到 eval、attempt 或 locator 时，错误列出实际候选并停在 observe 阶段。
