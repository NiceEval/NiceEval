# Use Case：静态 HTML

## 目标

真实 Chromium 在禁用 JavaScript 时打开导出的固定页和参数化页，证明内容、可访问语义与独立可读性。

## 完整测试

```ts
// test/behavior/export/static-html.test.ts
import { reportBehavior } from "../../support/behavior";
import {
  siteDoc,
  targetDoc,
  expectObserved,
} from "../../support/readback";
import {
  failedAttemptShowsAssertions,
  fixPromptStartsCollapsed,
  brandLinkKeepsAttribution,
} from "../../support/behaviors";

reportBehavior(failedAttemptShowsAssertions, async ({ w }) => {
  const doc = await targetDoc(w, w.target("failed-attempt"), {
    javaScript: "disabled",
    hosting: "file-url",
  });

  expectObserved(doc.region("Assertions").itemIds())
    .toShowExactRows(["equals(3)", "contains(rain)"]);
  expectObserved(doc.assertion("equals(3)").verdict())
    .toEqualValue("failed");
});

reportBehavior(fixPromptStartsCollapsed, async ({ w }) => {
  const doc = await siteDoc(w.exportDir("site"), "index", {
    javaScript: "disabled",
    hosting: "file-url",
  });

  expectObserved(doc.disclosure("Fix prompt").isExpanded())
    .toEqualValue(false);
  expectObserved(doc.disclosure("Fix prompt").itemIds())
    .toShowExactRows(["te-fail/gate", "te-error/boom"]);
});

reportBehavior(brandLinkKeepsAttribution, async ({ w }) => {
  const doc = await siteDoc(w.exportDir("site"), "index", {
    javaScript: "disabled",
    hosting: "file-url",
  });
  const link = doc.brandLink();

  expectObserved(link.href()).toEqualValue(
    "https://niceeval.com/?utm_source=report&utm_medium=powered-by",
  );
  expectObserved(link.rel()).toEqualValue("noopener");
});
```

## 边界

用例不读取原始 HTML 字符串、class 或 DOM 层级。HTML adapter 只通过真实 Chromium 的可访问语义产生领域对象。
需要 JavaScript 的下钻、焦点和 tooltip 归浏览器交互用例。
