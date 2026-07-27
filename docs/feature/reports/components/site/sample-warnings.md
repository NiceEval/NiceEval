# `sampleWarnings`

`sampleWarnings` 把 Sample 携带的
[`SampleWarning[]`](../../../sample/library.md#警告-kind-全集) 按「下一步动作」折成
[`Callouts`](../primitives/callouts.md) 可消费的内容。它是数据源，不是警告的另一套渲染组件。

警告只承载定位不到任何一行的完整性事实（Run 未收尾、落盘不可读）；能落到行上的事实不走这里——
覆盖缺口是 [`experimentRows` 的占位行](../entity-lists/experiment-rows.md)，携带与跨 Run 拼接是
实体行上的[时效标注](../entity-lists/README.md#时效标注)。

```ts
declare const sampleWarnings: DataSource<CalloutsContent, Sample>;
```

## 聚合轴是动作，不是发生顺序

实验作用域的警告天然指向同一条推进命令（重跑该实验），非实验作用域的警告按 kind 天然同类。逐条平铺会把一件事写成几条长句加重复命令，组件按「用户要做什么」组织：

- 带 `experimentId` 的警告按实验聚合成组：组头 = 实验 id + 每条警告一枚徽标（文案取 kind 表登记的徽标模板，按渲染 locale 取词）+ 组内去重后的可复制 `command`。
- 非实验作用域的警告按 kind 聚合成组：组头 = kind 表登记的组头文案（含条数）+ 去重后的命令。
- 组内命令去重后仍多于一条时，组头不放命令、命令随明细逐条走——组头命令的含义永远是「复制即推进整组」，不摆一排让用户猜。
- kind 表未登记模板的 kind（前向兼容）各自单独成组、逐条渲染 `message` 原样，行为不劣于平铺。
- 组排序：实验作用域组在前（按实验 id 字典序），非实验作用域组在后（按 kind）。

## 摘要恒可见，其余默认折叠

信任模型要求的是「警告的存在与分类和数字同框」，不是「警告全文永远展开」——警告是数字的可信度脚注，不是页面的主角，不与数字争版面：

- web 面整个警告区是一个默认折叠的原生 `<details>`，`<summary>` 是计数汇总行（如「2 个实验的数字带警告 · 1 个 Run 被跳过」），恒可见；组头与明细都在折叠层里，下一步命令一次展开可达。汇总行任何组数下都渲染，单组时就是该组的计数（如「1 个实验的数字带警告」）。
- 展开后每组的逐条原始 `message`（[三段式](../../../../error-feedback.md#消息三段式)，已含下一步）是第二层 `<details>`——无 JS 可展开，满足增强层「初始静态 HTML 无 JS 完整可读」的不变量；警告总条数 ≤ 3 时这层默认展开，展开外层即见全文。`message` 是完整叙述的单源，组件只组织、不改写。
- 视觉上警告区不占框：无边框、无底色、不缩进，警示色只落在汇总行文字与徽标上。
- 折叠层级与阈值是行为契约，不设 props 开关（与 [`PoweredBy`](powered-by.md)「提供组件、不给开关」同一哲学）。

## 两面与输入

- text 面同构但不折叠：多组时首行汇总，每组一行组头（标题、徽标、命令），其下缩进逐条原样打印 `message`、不截断掉尾段——终端天然可滚动，截断只会害调试。
- web 面把组头与明细中带 `command` 的警告渲染为可复制命令；无 `command` 的只显示 message，不硬造动作。
- source 形态 `<Callouts source={sampleWarnings} />` 取宿主注入 Sample 的 `warnings`。
- 空警告集两面零输出，不渲染空容器。
- 嵌入自有 React 页面时先 `await sampleWarnings.compute(sample)`，再把结果交给
  `niceeval/report/react` 的 `<Callouts data={warnings} />`。

```tsx
<Callouts source={sampleWarnings} />
```

## 相关阅读

- [`Callouts`](../primitives/callouts.md) —— 警告与诊断共用的纯呈现形状。
- [`runDiagnostics`](run-diagnostics.md) —— 版面相邻的 Run 诊断区。
