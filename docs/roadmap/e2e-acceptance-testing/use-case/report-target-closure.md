# Use Case：Report target 闭环

## 目标

Report 的静态导出和浏览器宿主必须对最终 page 清单中的所有参数化 target 使用同一条机制。
这条 proof 不依赖模型；真实边界是候选包、CLI、文件、HTTP 与 Chromium。

## Recipe

Recipe 使用 deliberate Eval 生成一个最小 Record，其中包含 attempt、experiment 和自定义参数化页需要的稳定事实。

```ts
// recipes/report-targets.ts
import { defineEvidenceRecipe } from "../support/recipe";

export default defineEvidenceRecipe({
  id: "report-targets-v1",
  version: 1,
  profile: "deterministic",
  capabilities: ["candidate-package", "process", "browser"],
  async prepare(ctx) {
    const project = await ctx.consumerProject("report-targets", {
      fixture: "fixtures/report-targets",
    });

    await project.cli(
      "pnpm exec niceeval exp report-targets --rerun all --json",
    );
    await project.cli(
      "pnpm exec niceeval view --report reports/targets.tsx --out site",
    );

    return ctx.publishReadOnly({
      resultsRoot: project.path(".niceeval"),
      exports: { site: project.path("site") },
      targets: {
        attempt: { pageId: "attempt", key: project.locator("failed") },
        experiment: { pageId: "experiment", key: "candidate" },
        custom: { pageId: "case", key: "checkout-regression" },
      },
    });
  },
});
```

## Behavior

结构 census 先证明全集闭合，Chromium 只跑有区分力的代表。

```ts
// test/behavior/read-report/report-target-closure.test.ts
import { expect } from "vitest";
import { reportBehavior } from "../../support/behavior";
import { expectObserved } from "../../support/observed";
import { siteExport } from "../../support/readback";

reportBehavior({
  id: "reports.target-closure",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/交付报告/导出静态站.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/view.md",
    anchor: "参数化页的-dialog-摆放",
  },
  title: "静态站中的每类参数化页都能独立打开并在宿主中下钻",
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["html", "browser-a11y"],
      boundaries: ["installed-package", "real-cli", "real-browser"],
      verifier: {
        engine: "playwright-chromium",
        javaScript: "enabled",
        network: "local-only",
      },
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-targets-v1",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ w, openSite }) => {
  expectObserved(siteExport(w.exportDir("site")).targetClosure())
    .toEqualValue({ orphanLinks: [], orphanDocuments: [] });

  await using ui = await openSite(w.exportDir("site"), {
    hosting: "clean-url-subpath",
  });

  for (const name of ["attempt", "experiment", "custom"] as const) {
    const target = w.target(name);
    await ui.expectTargetDoc(target);
    await ui.targetLink(target).click();
    await expect(ui.dialog()).toBeVisible();
    await expect(ui.dialog()).toHaveAttribute("data-page-id", target.pageId);
    await ui.closeDialog("escape");
  }

  await ui.targetLink(w.target("experiment")).click();
  await ui.dialog().targetLink(w.target("attempt")).click();
  await expect(ui.dialog()).toHaveAttribute("data-page-id", "attempt");
  expectObserved(ui.networkFailures()).toShowExactRows([]);
  expectObserved(ui.consoleErrors()).toShowExactRows([]);
});
```

## 执行登记

```ts
// execution/report-targets.ts
import { registerExecution } from "../support/execution";

registerExecution({
  behaviorId: "reports.target-closure",
  cadence: "pull-request",
  resourceClass: "ordinary",
  timeoutMs: 120_000,
});
```

## 门禁

`src/view/**`、Report page/target 或 hosting 改动运行：

```sh
pnpm e2e --repo report --behavior reports.target-closure
```

同一 Behavior 还必须在缺失 experiment 文档和错误 clean-url base 两个逆补丁上于 observe 阶段失败。
