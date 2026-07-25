# 主题与 CSS 定制

Reports 把视觉定制分成两层：`theme` 是类型化的高频入口，用语义令牌更换站点强调色、状态色和图表分类色；外壳 `styles` 与页内 `Style` 是完整 CSS 出口，用来改中性表面、字体、密度或组件外观。两层共用同一组公开 CSS 令牌。

`theme` 是 report 外壳属性：它同时作用于 `view` 宿主 chrome 和页内 `.nre` 组件，本地查看与 `view --out` 静态导出使用同一份主题。`show` 忽略这个 web 面属性；主题不改变 text 面内容、判定文字或指标口径。

## Library DX

只改品牌强调色时，从内建报告继承 pages，声明一个 `accent` 即可：

```tsx
// reports/brand.tsx
import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";

export default defineReport({
  extends: standard,
  title: "Acme Evals",
  theme: { accent: "#7C3AED" },
});
```

```sh
niceeval view --report reports/brand.tsx
niceeval view --report reports/brand.tsx --out site
```

单个颜色在浅色与深色外观下原样使用。品牌色只适合某个背景时，显式给出两套；NiceEval 不从一个颜色猜另一个外观的变体：

```tsx
export default defineReport({
  extends: standard,
  theme: {
    appearance: "system",
    accent: { light: "#6D28D9", dark: "#C4B5FD" },
  },
});
```

需要在多份报告复用完整主题时，用 `defineTheme` 独立校验并导出：

```tsx
// reports/acme-theme.ts
import { defineTheme } from "niceeval/report";

export const acmeTheme = defineTheme({
  appearance: "system",
  accent: { light: "#6D28D9", dark: "#C4B5FD" },
  positive: { light: "#047857", dark: "#6EE7B7" },
  negative: { light: "#BE123C", dark: "#FDA4AF" },
  warning: { light: "#A16207", dark: "#FDE047" },
  series: [
    { light: "#2563EB", dark: "#60A5FA" },
    { light: "#059669", dark: "#34D399" },
    { light: "#D97706", dark: "#FBBF24" },
    { light: "#7C3AED", dark: "#C4B5FD" },
    { light: "#DB2777", dark: "#F472B6" },
    { light: "#0891B2", dark: "#22D3EE" },
  ],
});
```

```tsx
// reports/site.tsx
import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";
import { acmeTheme } from "./acme-theme.ts";

export default defineReport({
  extends: standard,
  title: "Acme Evals",
  theme: acmeTheme,
});
```

`defineTheme` 只做类型与运行时校验，不注册全局状态、不写文件。内联的 `theme: { … }` 走同样校验。报告使用 `extends` 时，`theme` 与其它外壳字段一样按整字段覆盖：未声明就继承 base 的主题，声明则整体取代。想在现有主题上改一项，显式展开普通对象：

```tsx
theme: defineTheme({
  ...acmeTheme,
  accent: { light: "#0F766E", dark: "#5EEAD4" },
}),
```

## 公开形状

```ts
/** 大小写不敏感的六位、不透明 sRGB hex；运行时按 /^#[0-9a-f]{6}$/i 校验。 */
type ThemeHex = `#${string}`;

interface ThemeColorPair {
  light: ThemeHex;
  dark: ThemeHex;
}

/** 单值在两种外观下原样使用；对象为两种外观分别指定。 */
type ThemeColor = ThemeHex | ThemeColorPair;

type ThemeSeries = readonly [
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
];

interface ReportTheme {
  /** system 跟随浏览器/OS；light 与 dark 强制全站外观。默认 system。 */
  appearance?: "system" | "light" | "dark";
  /** 站点身份与交互强调，不表示判定好坏。 */
  accent?: ThemeColor;
  /** passed、improved 与 tone="positive" 的语义色。 */
  positive?: ThemeColor;
  /** failed、regressed 与 tone="negative" 的语义色。 */
  negative?: ThemeColor;
  /** errored、partial、截断/不可用提示与 tone="warning" 的语义色。 */
  warning?: ThemeColor;
  /** 六个分类色；稳定散列只选择下标，不用分类色表示好坏。 */
  series?: ThemeSeries;
}

function defineTheme(theme: ReportTheme): Readonly<ReportTheme>;
```

主题字段是穷尽集合。颜色只接受 `#RRGGBB`，不接受短 hex、alpha、CSS 颜色名、`var()`、`light-dark()` 或任意 CSS 片段；任意 CSS 值属于下文的 CSS 出口。`series` 固定为六色，因为官方图表用稳定 key 散列到六个分类槽；换 palette 不改变散列、图例顺序或 series 身份。

字段未知、pair 缺任一分支、数组长度不是六或颜色格式非法时，`defineTheme` / `defineReport` 按完整用户反馈拒绝，并指到具体字段路径，例如 `theme.series[3].dark`。

## 每种颜色表达什么

| 令牌 | 用来表达 | 不表达 |
|---|---|---|
| `accent` | 当前导航、链接 / locator、交互控件 active / focus、页内装饰强调 | passed / failed，或某个图表 series 的身份 |
| `positive` | passed、improved、正向 `Stat` 主值 | “主题色” |
| `negative` | failed、regressed、负向 `Stat` 主值 | errored 或普通提示 |
| `warning` | errored、partial coverage、截断、缺失与不可用状态 | failed |
| `series` | experiment / agent / label 等名义分类身份 | 质量大小或判定好坏 |

未声明时使用以下官方值：

| 令牌 | light | dark |
|---|---|---|
| `accent` | `#1D63D8` | `#6EA8FE` |
| `positive` | `#087F5B` | `#3DDC97` |
| `negative` | `#B42318` | `#FF6B6B` |
| `warning` | `#9A6700` | `#E8B84A` |
| `series` | `#2A78D6`, `#1BAF7A`, `#EDA100`, `#008300`, `#E34948`, `#EB6834` | `#3987E5`, `#199E70`, `#C98500`, `#008300`, `#E66767`, `#D95926` |

组件根据领域语义选 token，不读取 hex 值后反推意义。例如图表 series 与实体列表的维度键始终走 `series`（同一页内的分配规则见[页级色分配](../components/README.md#系列色分配单位是页)），`DeltaTable` 的 improved / regressed 走 `positive` / `negative`；改 `accent` 不会把某条实验线染成品牌色。

NiceEval 固定字标与 `PoweredBy` 仍表示 NiceEval 产品身份，不从报告的 `accent` 取色。报告主题不是隐藏或伪装宿主品牌的机制。

## 在 view 中怎样生效

装载期先把 `ReportTheme` 规范化为完整令牌表：未声明的 token 取 NiceEval 默认值，单色展开成相同的 light / dark 值，pair 保留两个分支。站点管线再把一个纯 CSS 令牌块挂到 view 文档根；页内 `.nre` 报告边界继承这些 token。report 官方样式只在每个 `var(--nre-*, <default>)` 使用点保留同源默认值，使它脱离 view 嵌入用户页面时仍零配置可读，而不在 `.nre` 上重新声明一套会遮住宿主主题的变量。宿主 chrome 与报告组件因此读同一份值，不在 `src/view` 与 `niceeval/report` 各复制一份色板。

`appearance: "system"` 输出支持 light / dark 的 `color-scheme`，由浏览器环境选分支；`light` / `dark` 把全站锁到对应分支。基线 HTML 不依赖 JavaScript 选色，导出站在直接打开、静态托管与本地 server 中保持相同规则。

主题不进 `ctx.report`。组件输出稳定的语义 class，再由 CSS token 取色；组件不能在 resolve 阶段读主题后改变组件树或数据。因此换主题只改 CSS，不会导致指标重算、HTML 内容分叉或证据链改变。

样式级联顺序固定为：

1. view 与 report 官方样式及默认 token；
2. 由 `theme` 生成的 token；
3. 外壳 `styles`，按声明顺序；
4. 外壳 `head` 中的 `style`，按声明顺序；
5. 页树里的 `Style`，按树的 resolve / render 顺序。

后一层可以覆盖前一层。这让主题承担常用配置，CSS 仍是最终视觉出口。

## CSS 覆盖与完整重写

公开 CSS token 全部使用 `--nre-` 前缀，由 view 根节点向 `.nre` 继承；把 report React 组件嵌进自己的页面时，也可在包住 `.nre` 的应用容器上直接声明同一组 token。主题控制的高频 token 是：

```css
--nre-accent
--nre-positive
--nre-negative
--nre-warning
--nre-series-1
--nre-series-2
--nre-series-3
--nre-series-4
--nre-series-5
--nre-series-6
```

中性基础 token 不进入 `ReportTheme`，但属于受支持的 CSS 覆盖面：

```css
--nre-page
--nre-surface
--nre-surface-subtle
--nre-border
--nre-border-strong
--nre-text
--nre-text-muted
--nre-text-soft
--nre-focus
--nre-font-sans
--nre-radius
```

需要非 hex 色值、自定义中性表面、字体或形状时，用外壳 `styles`：

```tsx
export default defineReport({
  extends: standard,
  theme: {
    accent: { light: "#6D28D9", dark: "#C4B5FD" },
  },
  styles: [{
    inline: `
      :root {
        --nre-page: light-dark(#fffbf5, #120f0c);
        --nre-surface: light-dark(#ffffff, #1c1713);
        --nre-font-sans: "IBM Plex Sans", ui-sans-serif, sans-serif;
        --nre-radius: 2px;
      }
      .nre .nre-hero-title {
        letter-spacing: -0.035em;
        text-transform: uppercase;
      }
    `,
  }],
});
```

`styles: [{ src: "./theme.css" }]` 适合大型覆盖，本地 view 与静态导出按既有资产规则物化。单页特例放在页树的 `Style`。官方组件继续提供稳定 `nre-*` 语义 class；自定义组件用自己的 `className` 建立边界。

CSS 可以重写排版块的视觉结构，但不得改变数据、初始 HTML 中的数值和无 JavaScript 可读性；也不得隐藏 NiceEval 固定品牌位，或用颜色作为 passed / failed、不同 series 的唯一信息载体。

## 质量与归属

NiceEval 默认主题保证官方组件的对比度与分类色可分辨性。自定义颜色的可读性由报告作者负责；宿主只校验形状和颜色语法，不自动改色或重排 series。主题验收至少覆盖浅色与深色背景、四种 verdict、六条同图 series、键盘 focus 态与色觉缺陷模拟。

- `theme`、`styles` 与 `Style` 都只影响 web 面。
- `theme` 是整站字段，不能按 page 切换；单页特例用该页树中的 `Style`。
- 主题不进入结果根、snapshot 或 `niceeval.config.ts`。它是“怎么看”的报告配置，改色不需要重跑 eval。

## 相关阅读

- [外壳与多页](shell.md) —— `theme` / `styles` 在 `ReportShell` 中的位置与 `extends` 规则。
- [排版原语与自定义组件](layout.md) —— 页内 `Style`、`className` 与双面组件。
- [View](../view.md) —— 本地查看与静态导出怎样消费同一份报告。
