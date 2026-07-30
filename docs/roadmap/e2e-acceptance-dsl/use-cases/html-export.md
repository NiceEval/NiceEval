# Use Case · 导出 HTML:aria Run 替换字符串刮取

## 场景

report 仓库对 `view --out` 导出站验收[渲染结构契约](../../../engineering/testing/e2e/report.md#5-渲染面):语义块存在、断言明细的展开折叠、badge 与名称成对出现。现行写法一半是对 HTML 文件的未包装字符串刮取,一半是 Playwright 真浏览器断言——前者要替换,后者保留。

## 现行断言

摘自 `e2e/report/scripts/verify-render-structure.ts`:

```ts
// ① 原始 HTML 字符串:class 名、标签结构、文案、实体转义全部入契约
assert.ok(failHtml.includes('<span class="niceeval-assertion-badge">failed</span>'), "...");
assert.ok(failHtml.includes('<span class="niceeval-assertion-name">equals(3)</span>'), "...");

// ② 整段 <summary> 字面量:文案 + `·` 字形 + 计数一锅锁死
assert.ok(reportTpl.includes('<summary class="niceeval-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'), "...");

// ③ 品牌链接:含 HTML 实体转义的整段正则
const brandLinkRe = /<a href="https:\/\/niceeval\.com\/\?utm_source=report&amp;utm_medium=powered-by" target="_blank" rel="noopener">Powered by NiceEval<\/a>/;
```

①② 把内部 class 名与标签选择写进了预期——[report 域边界](../../../engineering/testing/e2e/report.md)明说「class/tag selector 只是找到元素的手段……不能把具体 class/tag 本身写进预期」,现行写法违反自己的规则,renderer 换一个 span 结构就红。③ 是少数**整段就是契约**的例外(utm 参数与 rel 是文档声明的固定值),不在替换之列。

## 候选写法

```ts
test("失败 attempt 文档的断言明细结构", async () => {
  const doc = await loadExportedHtml(ev.exportDir("branded"), `attempt/${ev.locator("te-fail")}.html`);

  await expect(doc.body).toMatchAriaSnapshot(`
    - region /Assertions/:
      - group:
        - text /equals\\(3\\)/
        - text /failed/
  `);
});

test("Fix prompt 折叠块默认收起,计数可见", async () => {
  const doc = await loadExportedHtml(ev.exportDir("branded"), "index.html");
  await expect(doc.body).toMatchAriaSnapshot(`
    - group:
      - text /Fix prompt/
      - text /2 failures/
  `);
});
```

- ①② 换成可访问性树匹配:断言「badge 与名称同处一个语义块、文案事实出现」,不再点名 `niceeval-*` class 与 span 结构。展开折叠状态经 a11y 树的 `[expanded]` 属性断言,与现行 Playwright 的 `<details open>` 检查同源。
- ③ 品牌链接保留精确断言(可收进 golden 层),因为公开文档把 URL 参数与 rel 声明为契约——判据依旧是「这些字符是不是契约」,不是「断言长得脆不脆」。

## 边界

- **aria Run 负责**:语义结构、可见文本事实、层级与展开状态——纯文档层面,零浏览器交互。
- **Playwright 保留**:计算样式结构事实(`font-family` 含 mono、sticky 定位)、几何(同行判定)、真点击交互、跨组件颜色一致性(rendered-to-rendered 对比)——这些断在行为层,本来就不脆,aria 树也表达不了。
- **样式脱对齐类缺陷归 Playwright 这一层**:stylesheet 与组件类名两侧各写一套,CSS 规则打不到任何元素时 typecheck 与数据级单测全绿,症状只在真实产物上露出。
  症状形态是整块失去密度、横滚与状态染色,先例见 [样式缺失先例](../../../../memory/attempt-detail-components-shipped-without-styles.md)。
  验收断的是「样式确实作用到了元素」的计算样式与几何事实:代表性区块的 overflow 横滚可用、状态行相对基线行有染色差异、等宽字体与 sticky 生效。不 grep 源码类名、不锁 class 列表——类名只是找到元素的手段,不是契约本身。
- 前提是[待裁决分歧 2](../README.md#待裁决分歧):ivya 对 happy-dom 文档的可用性 spike;不通则本层断言也进 browser mode 执行,写法不变。
