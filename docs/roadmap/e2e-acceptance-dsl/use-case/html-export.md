# Use Case · 导出 HTML:领域词替换字符串刮取

## 场景

report 仓库对 `view --out` 导出站验收[渲染结构契约](../../../engineering/testing/e2e/report.md#5-渲染面):语义块存在、断言明细的展开折叠、badge 与名称成对出现。
现行写法一半是对 HTML 文件的字符串刮取,一半是浏览器里的行为断言——前者要替换,后者保留。

## 现行断言

摘自 `e2e/report/scripts/verify-render-structure.ts`:

```ts
// ① 原始 HTML 字符串:class 名、标签结构、文案、实体转义全部入契约
assert.ok(failHtml.includes('<span class="niceeval-assertion-badge">failed</span>'), "...");
assert.ok(failHtml.includes('<span class="niceeval-assertion-name">equals(3)</span>'), "...");

// ② 整段 <summary> 字面量:文案、`·` 字形与计数一起锁定
assert.ok(reportTpl.includes('<summary class="niceeval-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'), "...");

// ③ 品牌链接:含 HTML 实体转义的整段正则
const brandLinkRe = /<a href="https:\/\/niceeval\.com\/\?utm_source=report&amp;utm_medium=powered-by" target="_blank" rel="noopener">Powered by NiceEval<\/a>/;
```

①② 把内部 class 名与标签选择写进了预期——[report 域边界](../../../engineering/testing/e2e/report.md)明说「class/tag selector 只是找到元素的手段……不能把具体 class/tag 本身写进预期」,现行写法违反自己的规则,renderer 换一个 span 结构就红。
③ 的字段确实是契约(utm 参数与 `rel` 是文档声明的固定值),但它把 `&amp;` 这种序列化细节也一起锁进了正则。

## 候选写法

导出 HTML 由 Playwright 加真实 Chromium 打开,禁用 JS、只准本地网络;测试正文只写领域词:

```ts
reportBehavior(failedAttemptDocShowsAssertionVerdicts, async () => {
  const doc = await attemptDoc(w, w.locator("te-fail"));

  expectObserved(doc.region("Assertions").itemIds()).toShowExactRows(["equals(3)", "contains(rain)"]);
  expectObserved(doc.assertion("equals(3)").verdict()).toEqualValue("failed");
});

reportBehavior(fixPromptStartsCollapsed, async () => {
  const doc = await attemptDoc(w, "index");
  expectObserved(doc.disclosure("Fix prompt").isExpanded()).toEqualValue(false);
  expectObserved(doc.disclosure("Fix prompt").itemIds()).toShowExactRows(["te-fail/gate", "te-error/boom"]);
});

reportBehavior(brandLinkCarriesDeclaredAttribution, async () => {
  const link = (await attemptDoc(w, "index")).brandLink();
  expectObserved(link.href()).toEqualValue("https://niceeval.com/?utm_source=report&utm_medium=powered-by");
  expectObserved(link.rel()).toEqualValue("noopener");
});
```

- ①② 换成按可访问名寻址的领域词:断言「这条断言的判定是 failed」「折叠块默认收起、里面是这两条失败」,不再点名 `niceeval-*` class 与 span 结构。
  展开状态从真实 Chromium 的可访问性树读,与浏览器读面同源。
- ② 的计数从措辞里剥出来:锁的是折叠块里有哪两条失败的身份,`Fix prompt · 2 failures` 的分隔符与措辞不进契约。
- ③ 逐字承诺仍然逐字断言,但断的是浏览器解析后的 `href` 与 `rel` 字段。
  `&amp;` 是序列化细节,浏览器读到的属性值才是公开承诺。

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [格子写在没有这一列的 key 上](../../../../memory/cell-key-must-match-column-set.md) | 网页层级表里 passed / failed / errored 三种 attempt 行长得一样,状态列恒为 `—`,失败摘要不见了;终端同一份数据看得见 | outcome 阶段:`row.verdict()` 报「期望 failed,观察到缺失」,提取路径直指 `table[name=Experiments] > row[@1ck8mbkn] > cell[Results]`,`—` 不再被当成合法值 |
| [组件发布时没带样式](../../../../memory/attempt-detail-components-shipped-without-styles.md) | stylesheet 与组件类名两侧各写一套,CSS 规则打不到任何元素;数据级单测与 typecheck 全绿,症状只在真实产物上露出 | **这一层抓不到**:结构与身份都对,坏的是计算样式与几何。归浏览器读面的样式事实断言,见下面的边界 |

第一条还说明了为什么寻址失败不能回落。
`—` 是渲染面对「取不到格子」的合法呈现,子串断言看到它无话可说;领域词把「这一格没有判定」直接判成 outcome 失败。

## 边界

- **导出 HTML 读面负责**:语义结构、可见文本事实、层级与展开状态——静态文档层面,零交互。
- **浏览器读面保留**:计算样式结构事实(`font-family` 含 mono、sticky 定位)、几何(同行判定)、真点击交互、跨组件颜色一致性(rendered-to-rendered 对比)——这些断在行为层,本来就不脆,可访问性树也表达不了。
- **样式脱对齐类缺陷归浏览器读面**:stylesheet 与组件类名两侧各写一套,CSS 规则打不到任何元素时 typecheck 与数据级单测全绿,症状只在真实产物上露出。
  症状形态是整块失去密度、横滚与状态染色,先例见[样式缺失先例](../../../../memory/attempt-detail-components-shipped-without-styles.md)。
  验收断的是「样式确实作用到了元素」的计算样式与几何事实:代表性区块的 overflow 横滚可用、状态行相对基线行有染色差异、等宽字体与 sticky 生效。
  不 grep 源码类名、不锁 class 列表——类名只是找到元素的手段,不是契约本身。
- 两个读面共用同一批领域词,差别只在启用 JS 与否,以及各自独有的能力(展开状态与计算样式)。
</content>
