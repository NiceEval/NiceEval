# Use Case：可变 view 与资源收尾

## 目标

验证长驻 `niceeval view` 能观察 Report import 图变化，并且 Behavior 结束后关闭浏览器、进程和端口。
共享 world 保持只读，修改发生在登记过的私有 clone 中。

## Mutation action

```ts
// actions/change-report-metric.ts
import { defineMutationAction } from "../support/actions";

export default defineMutationAction({
  id: "change-report-metric",
  entry: "browser",
  async execute(clone) {
    await clone.replaceText(
      "reports/lib/metric.ts",
      "export const label = 'Baseline';",
      "export const label = 'Candidate';",
    );
  },
});
```

## Behavior

```ts
// test/behavior/read-report/view-reloads-import.test.ts
import { expect } from "vitest";
import { reportBehavior } from "../../support/behavior";
import {
  reportReloadTask,
  reportReloadContract,
} from "../../support/behaviors";

reportBehavior({
  id: "reports.view-reloads-import-graph",
  task: reportReloadTask,
  contract: reportReloadContract,
  title: "修改 Report 依赖后长驻 view 显示新结果",
  risk: "high",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["browser-a11y"],
      boundaries: ["installed-package", "real-cli", "real-browser"],
    },
    execution: {
      mode: "mutable-clone",
      evidenceRecipeId: "mutable-view-v1",
      cloneId: "report-import",
      mutationActionId: "change-report-metric",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ w, service, openBrowser }) => {
  const clone = await w.clone("report-import");
  await using view = await service(
    "pnpm exec niceeval view --no-open --port 0 --report reports/main.tsx",
    { cwd: clone.root },
  );
  await view.ready({ event: "listening" });

  await using ui = await openBrowser(view.url);
  await expect(ui.getByText("Baseline")).toBeVisible();

  await clone.run("change-report-metric");
  await expect(ui.getByText("Candidate")).toBeVisible();
  await expect(ui.getByText("Baseline")).not.toBeVisible();
});
```

执行登记把这个 mutable-clone Behavior 标成 service 资源：

```ts
import { registerExecution } from "../support/execution";

registerExecution({
  behaviorId: "reports.view-reloads-import-graph",
  cadence: "pull-request",
  resourceClass: "service",
  timeoutMs: 90_000,
});
```

`await using` 的 disposer 无论断言成功、失败或超时都会运行。cleanup outcome 还核对进程组退出、动态端口释放和 clone 写集；任一残留使本 Behavior 在 cleanup 阶段失败。
