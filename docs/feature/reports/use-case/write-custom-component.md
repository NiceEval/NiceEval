# 自己写报告组件：规范与取主题色

## 解决什么问题

官方组件覆盖榜单、表格、矩阵、图表和 attempt 证据，但覆盖不了「我们这个项目独有的那一块」——artifact 里的业务字段、一条自定义的验收条、一份团队才看得懂的排队视图。这些要自己写。

自己写的组件不是随便一个 React 函数：它要能进报告树，要在 `view` 和 `show` 两个宿主都给得出东西，要跟随任何一份[主题](../library/theme.md)——包括别人分发给你的、你没见过的那一份。这一篇把这三件事的规范放在一处，从选形态一直走到验收。

## 全流程

### 1. 选形态：只装配写函数，自己落渲染写对象

```
需要的东西官方组件拼得出来  → 组合组件（函数形态）
需要自己画一块官方没有的东西 → 双面组件（对象形态）
```

组合组件是「取数、用普通 JavaScript 加工、摆进现有组件」，它没有自己的渲染面，因此天然两面一致：

```tsx
// reports/components/slowest-evals.tsx
import { AttemptList, Section, attemptListData, defineComponent } from "niceeval/report";

export const SlowestEvals = defineComponent(async ({ limit = 10 }: { limit?: number }, ctx) => {
  const all = await attemptListData(ctx.scope);
  const ranked = [...all].sort((x, y) => y.durationMs - x.durationMs);
  return (
    <Section title={{ en: "Slowest attempts", "zh-CN": "最慢的 attempt" }}>
      <AttemptList data={ranked.slice(0, limit)} total={all.length} />
    </Section>
  );
});
```

自己画一块时写对象形态，`web` 与 `text` 都必须给：

```tsx
// reports/components/coverage-bar.tsx
import { bar, defineComponent, resolveLocalizedText } from "niceeval/report";
import type { LocalizedText } from "niceeval/report";

interface CoverageBarProps {
  label: LocalizedText;
  /** [0, 1]；null 表示零样本，两面都渲染成 —，不补 0。 */
  ratio: number | null;
}

export const CoverageBar = defineComponent<CoverageBarProps>({
  web: ({ label, ratio }, ctx) => (
    <div className="acme-coverage">
      <span className="acme-coverage-label">{resolveLocalizedText(label, ctx.locale)}</span>
      {ratio === null ? (
        <span className="acme-coverage-missing">—</span>
      ) : (
        <span className="acme-coverage-track">
          <span className="acme-coverage-fill" style={{ inlineSize: `${ratio * 100}%` }} />
        </span>
      )}
    </div>
  ),
  text: ({ label, ratio }, ctx) => {
    const name = resolveLocalizedText(label, ctx.locale);
    return ratio === null ? `${name}  —` : `${name}  ${bar(ratio, 20)} ${(ratio * 100).toFixed(1)}%`;
  },
});
```

配套 CSS 用 `Style` 放进树，或写进报告外壳 `styles`：

```tsx
<Style>{`
  .nre .acme-coverage { display: flex; align-items: center; gap: 8px; }
  .nre .acme-coverage-label { color: var(--nre-text-muted); font-size: 12px; }
  .nre .acme-coverage-missing { color: var(--nre-text-soft); }
  .nre .acme-coverage-track { flex: 1; height: 6px; background: var(--nre-surface-subtle); border-radius: var(--nre-radius); }
  .nre .acme-coverage-fill { display: block; height: 100%; background: var(--nre-accent); border-radius: var(--nre-radius); }
`}</Style>
```

### 2. 取数只在一个地方

组合组件在函数体里取数，双面组件在可选的 `resolve` 里取数。两个渲染面都是纯投影——拿到什么画什么，不再读 Scope、不再排序、不再过滤。带 `resolve` 的组件在一次页渲染内按「同引用 `input` + 深相等 spec」记忆化，两面消费同一份渲染 props，所以两面同源是结构保证的，不靠自觉。

### 3. 颜色只有三个来源

这是自定义组件跟随主题的全部内容，没有第四条路：

| 要表达 | 用什么 | 例子 |
|---|---|---|
| 好 / 坏 / 警告 | 内置 `Stat` 的 `tone`，或语义令牌 | `<Stat tone="negative" …/>`、`color: var(--nre-negative)` |
| 某个维度值的分类身份 | `ctx.seriesColor(维度, 值)` | 图例点、series 线、分组行 |
| 其余一切（文字、表面、分隔、圆角、字体） | `var(--nre-*)` 令牌 | `background: var(--nre-surface)` |

分类色必须走 `ctx.seriesColor`，不能自己散列：颜色的分配单位是页，`seriesColor` 返回的是这一页已经消解过撞色的结果，自己算会和同页官方组件对不上。

```tsx
web: ({ rows }, ctx) => (
  <ul className="acme-legend">
    {rows.map((row) => {
      const color = ctx.seriesColor("agent", row.agent);
      return (
        <li key={row.agent} className={color.className}>
          <svg width="8" height="8"><rect className={color.seriesClassName} width="8" height="8" /></svg>
          {row.agent}
        </li>
      );
    })}
  </ul>
);
```

`SeriesColor` 的 `className` 给文字与色点，`seriesClassName` 给 SVG 图形（由 CSS 变量上色，深浅分支自动跟随），`hex` 只留给导不出 CSS 的消费方（例如生成图片）。

### 4. text 面按显示宽度排版

终端那一面不消费颜色——无 ANSI 时输出仍要自足。对齐用 `niceeval/report` 的[文本排版工具箱](../library/layout.md#文本排版工具箱)，不要用 `padEnd` / `padStart`：它们数 UTF-16 码元，agent 名一带中文整张表就撕歪。

### 5. 文案随语言切换

面向读者的字收 `LocalizedText`，渲染时用 `resolveLocalizedText(text, ctx.locale)`。作者写下几种语言就有几种，组件不翻译。

### 6. 验收

自定义组件至少过这几条，其中前两条是主题相关的：

```sh
niceeval view --report reports/site.tsx                      # 官方主题，浅色与深色各看一遍
niceeval view --report reports/site.tsx --theme ./themes/acme.ts  # 换一份没见过的主题
niceeval show --report reports/site.tsx                      # text 面，窄终端也跑一次
NO_COLOR=1 niceeval show --report reports/site.tsx           # 无 ANSI 仍自足
```

## 规范清单

| 规范 | 为什么 |
|---|---|
| 组件必须经 `defineComponent` | 未包装的 React 组件、普通函数与 HTML intrinsic 不是报告节点，resolve 展开时按完整用户反馈拒绝 |
| 对象形态 `web` 与 `text` 都要给 | 一棵树两个宿主都要判读；缺一面 TypeScript 直接报错 |
| 自由文本经 `Text` 或自己的渲染面携带 | 裸字符串与数字不是节点——text 面要折行、web 面要转义，都需要显式载体 |
| IO 与取数只在函数体 / `resolve` | 渲染面是纯投影，两面同源才成立 |
| 不写死颜色 | 写死的 hex 在深色分支失灵、换主题不跟随，还会把「颜色只编码含义」这条约定破掉 |
| 分类色只从 `ctx.seriesColor` 读 | 页级分配已消解撞色，自己散列会与同页官方组件对不上 |
| 自己的 class 用自己的前缀，不占 `nre-` | `nre-*` 是主题瞄准的公开语义面；占用它等于让别人的主题规则打到你的内部结构上 |
| 数据驱动的几何量可以走 inline style，颜色不行 | 宽度、位置来自数据，颜色来自主题——把两者混在一起就换不了主题了 |
| 组件不读主题、不按外观分支改结构 | 主题不进 `ctx`；换主题只该改 CSS，不该让 HTML 内容分叉 |
| 初始 HTML 无 JavaScript 完整可读 | 与官方增强脚本同一条不变量，静态导出直接打开也要能读 |

## 怎么用主题

一句话：**组件声明语义，主题决定长相。** 组件问自己「这块颜色在说什么」，答案只有四种——状态、分类身份、页面结构、什么都不说；前三种各有对应令牌，第四种不该有颜色。

```tsx
// 跟随主题
<span style={{ color: "var(--nre-negative)" }}>failed</span>
<rect className={ctx.seriesColor("agent", row.agent).seriesClassName} />
<div style={{ borderBottom: "1px solid var(--nre-border)" }} />

// 不跟随主题
<span style={{ color: "#B42318" }}>failed</span>
<rect fill="#2A78D6" />
<div style={{ borderBottom: "1px solid #e5e7eb" }} />
```

令牌全集在[主题](../library/theme.md#css-覆盖与完整重写)。挑令牌看语义不看当前色值：`--nre-warning` 是「errored / 截断 / 不可用」，不是「黄色」；官方主题 [Basalt](../themes/basalt.md) 的 `accent` 是近乎无彩的冷灰，把它当成「品牌蓝」来用，装上别人的主题就会露馅。

需要令牌表达不了的效果时，写自己的 CSS，但把可变的部分挂回令牌：

```css
.nre .acme-panel {
  background: var(--nre-surface);
  border: 1px solid var(--nre-border);
  border-radius: var(--nre-radius);   /* 零圆角主题下自动变直角 */
  font-family: var(--nre-font-sans);
}
```

## 边界

- **只服务自己网页的组件不必进报告树。** 普通 React 组件在自己的页面里想怎么写都行；但它进不了 `defineReport` 的 pages，也不会有 text 面。
- **组件不是改口径的地方。** 要换通过率定义、换分组维度或换分母，改的是[指标与维度](../library/metrics.md)，不是在组件里重算一遍。
- **`Style` 是页级全局的。** 树里的位置只决定声明顺序，不建立作用域——作用域靠你自己的 class 前缀。
- **不要绕开 `MetricCell` 自己拼字符串。** 那样会丢掉 `samples` / `total` / `refs`，证据链断在你的组件里。
- **主题读不到组件的内部结构。** 反过来也成立：别人的主题不会知道 `.acme-coverage` 存在，你的组件在陌生主题下的样子由你负责——所以只挂令牌、不写死值。

## 相关阅读

- [排版原语与自定义组件](../library/layout.md) —— `defineComponent` 两种形态的字段穷尽、ctx 形状与呈现算法。
- [主题](../library/theme.md) —— 令牌全集、语义边界与 CSS 级联。
- [Basalt](../themes/basalt.md) —— 官方主题的取值，用来判断自己的组件在默认外观下什么样。
- [组件树](../components/README.md) —— 结构子节点、双面投影边界与页级色分配。
- [给报告换主题、做自己的主题包](theme-and-distribute.md) —— 组件写好之后，怎么给整站换一身皮。
