# `Waterfall`

时间树与瀑布：一批带起止偏移的节点，可逐层展开。runner 阶段树、原始 OTel span 树
与逐 attempt 的执行瀑布都是这一个形状，差别在传进去的[数据源](../sources/README.md)。

```tsx
<Waterfall source={attemptTimeline} />   // runner phases + 关联 spans
<Waterfall source={attemptTrace} />      // 不混入 runner 节点的原始 span 树
<Waterfall source={traceRows} />         // 一行一个 attempt 的范围级瀑布
```

## 形状

```ts
interface WaterfallNode {
  key: string;
  label: LocalizedText;
  /** 节点类别；决定色带与图标，词表由数据源给，原语不建注册表。 */
  kind: string;
  /** 相对该行起点的偏移与时长；durationMs 为 null 表示测不了，条不绘、标注缺失。 */
  startOffsetMs: number;
  durationMs: number | null;
  failed?: boolean;
  children?: readonly WaterfallNode[];
}

interface WaterfallRow {
  key: string;
  label: LocalizedText;
  /** 该行的总时长；缺失为 null，行照常出现，不猜值。 */
  durationMs: number | null;
  nodes: readonly WaterfallNode[];
  locator?: AttemptLocator;
  /** text 面折叠成摘要时给出的下钻命令。 */
  command?: string;
}

interface WaterfallProps {
  source?: WaterfallSource;
  input?: ReportInput;
  data?: readonly WaterfallRow[];
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}
```

## 渲染

- web 面：一行一个 `WaterfallRow`，行内按 `startOffsetMs` / `durationMs` 静态渲染分解条，
  失败节点带失败标记；有 `children` 的节点用原生 `<details>` 逐层展开，静态文档零 JS 成立。
  有 `locator` 时行链接到 attempt 详情。排序与缩放是渐进增强。
- text 面：一行一个 `WaterfallRow`——身份、总耗时、节点计数与失败标记，行尾给出 `command`。
  有稳定 CLI 选择器的大块内容折成带命令的索引，不倾倒逐节点明细；折不折由数据源给
  `command` 决定，原语不自行判断。
- `durationMs` 为 `null` 的行与节点如实标注缺失，不折成 0，也不从相邻节点推算。

## 一个原语，三种视角

runner 阶段树与原始 span 树是两种视角，不是两种形状：前者把 span 按显式 correlation 挂回
runner 时间树，后者保留采集侧的原始层级。视角差异住在数据源的 `nodes` 怎么组织，
渲染规则同一份。所以同一页可以择一，也可以两个都放。

runner 生命周期节点不进 trace 事实（[Architecture · 事实与看法](../../architecture.md#事实与看法)）。
把 runner 节点混进原始 span 树的是数据源的越界，不是原语的呈现选项。

## 相关阅读

- [组件树](../README.md) —— 三层模型与结构节点规则。
- [数据源目录](../sources/README.md) —— 官方时间树数据源。
- [Observability](../../../../observability.md) —— span 字段与采集边界。
