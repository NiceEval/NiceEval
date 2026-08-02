# Use Case：适配器事实读回

## 目标

适配器仓库通过真实 CLI 读回调用身份、入参与 tracing 事实。这里证明协议事实穿过归一、落盘和 Show，不验收 Report 布局。

## 完整测试

```ts
// test/behavior/inspect-adapter/mcp-readback.test.ts
import { adapterBehavior } from "../../support/behavior";
import { cli, reportView, expectObserved } from "../../support/readback";
import { mcpCallReachesExecutionView } from "../../support/behaviors";

adapterBehavior(mcpCallReachesExecutionView, async ({ w }) => {
  const locator = w.locator("weather/brooklyn");
  const run = await cli(
    `pnpm exec niceeval show ${locator} --execution`,
    { cwd: w.consumerDir("adapter") },
  );
  const attempt = reportView(run.stdout).attempt(locator);

  expectObserved(attempt.executionNodes())
    .toShowRows(["shell", "get_weather"]);
  expectObserved(attempt.node("get_weather").input())
    .toEqualValue({ city: "Brooklyn" });
  expectObserved(attempt.timingGaps()).toShowExactRows([]);
});
```

未声明 tracing 的适配器使用相反预期：

```ts
expectObserved(attempt.timingGaps()).toShowRows(["get_weather"]);
```

## 边界

默认身份是 NiceEval 的 canonical operation name。厂商原始名只有在协议本身是待测契约时通过显式 `originalName()` 观察。
适配器仓库拥有自己的 reader 和 parser，不 import report E2E 仓库的运行时代码。
