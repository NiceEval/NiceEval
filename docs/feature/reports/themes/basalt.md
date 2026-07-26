# Basalt —— NiceEval 官方主题

`basalt` 是 `niceeval view` 不指定 `--theme` 时生效的那一份，也是官方样式在每个 `var(--nre-*, <default>)` 使用点写下的兜底值。所以把报告嵌进自己的页面、不声明任何令牌时，看到的就是 Basalt——一份主题两条交付路径，不存在「view 里一个样、嵌进来另一个样」。

玄武岩是冷却得足够慢的黑色岩浆，凝出笔直的柱状节理。这份主题按同一个主张做：**黑色系、零圆角、发丝分隔线、去装饰**。屏幕上不该有一件东西是为了好看而存在的——边框只用来分隔，颜色只用来编码含义，其余交给排版与留白。

## 视觉主张

- **暗色是身份，亮色是同一份主题的另一支。** 深色分支是 Basalt 的样子；浅色分支按同一套结构关系重算，不是「把颜色反过来」。`appearance` 默认 `system`，读者可以在页头切换。
- **零圆角。** `radius: "0"`。卡片、表格、按钮、输入、色块、tooltip 全是直角。
- **发丝分隔，不用阴影。** 层次靠 1px 边框与两级表面色建立，不用投影、不用渐变。
- **克制的强调色。** `accent` 是近乎无彩的冷灰，链接靠下划线和 hover 反白区分，不靠色相跳出来。品牌感来自排版秩序，不来自一个饱和色块。
- **判定色是唯一允许饱和的地方。** passed / failed / errored 必须一眼可分，所以状态三色保留足够色度；它们是信息，不是装饰。
- **数字优先。** 正文基准 13px，数值列一律 tabular numerals，标签用小字号加字距、不用粗体堆叠。

## 令牌取值

### 中性面

| 令牌 | light | dark |
|---|---|---|
| `page` | `#FAFAFA` | `#0A0B0C` |
| `surface` | `#FFFFFF` | `#101214` |
| `surfaceSubtle` | `#F2F3F4` | `#16191B` |
| `border` | `#E1E3E5` | `#22262A` |
| `borderStrong` | `#C4C8CC` | `#333A40` |
| `text` | `#16191B` | `#E6E9EB` |
| `textMuted` | `#5C6469` | `#9AA2A8` |
| `textSoft` | `#8A9298` | `#6A7278` |

三级文字是刻意的：正文、标签与单位、占位与轴刻度各占一级，把「这行字有多重要」交给明度而不是字重。

### 语义色

| 令牌 | light | dark | 表达 |
|---|---|---|---|
| `accent` | `#26323A` | `#CBD6DC` | 导航当前项、链接与 locator、focus 环 |
| `positive` | `#2F6B4F` | `#7FBFA0` | passed、improved、正向 `Stat` |
| `negative` | `#A33A30` | `#E58F86` | failed、regressed、负向 `Stat` |
| `warning` | `#7A6428` | `#D6BC78` | errored、partial、截断与不可用 |

`accent` 与正文接近是设计的一部分，不是失误：Basalt 里链接是带下划线的正文，hover 时反相，focus 是 1px 实线外框。这让整页只剩状态三色和分类色带颜色，读者看到色块就知道那是信息。`focus` 不单独声明，取 `accent`。

### 分类色

| 槽位 | light | dark | 色族 |
|---|---|---|---|
| 1 | `#3F6B87` | `#A8C8DC` | 冷蓝 |
| 2 | `#587046` | `#7E9B6E` | 苔绿 |
| 3 | `#8A6B2E` | `#E0C894` | 砂黄 |
| 4 | `#5A4E7C` | `#9A8DBA` | 石紫 |
| 5 | `#9E4E44` | `#C4837B` | 砖红 |
| 6 | `#2E6F6A` | `#6FAAA4` | 青灰 |

六个槽同时按**色相**和**明度**分开：相邻槽位的明度差保证它们在灰度打印和红绿色觉缺陷下仍然分层，色相差保证正常色觉下一眼可辨。这是官方主题必须承担的义务——分类色是数据编码，不是配色偏好。

### 排版与形状

| 令牌 | 值 |
|---|---|
| `font.sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif` |
| `font.mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `fontSize` | `13px` |
| `radius` | `0` |

不自带字体文件：报告站要在任何托管环境直接打开，系统字体栈没有网络依赖，也不会因为字体没加载完而抖一次版。要换字体的人换的是自己的主题。

## 主题自带的样式

令牌表达不了「没有阴影」「标签带字距」这类主张，它们写在 Basalt 的 `styles` 里：

```tsx
// niceeval/report/built-in 的 basalt 主题
import { defineTheme } from "niceeval/report";

export const basalt = defineTheme({
  appearance: "system",
  // …上面的令牌…
  radius: "0",
  styles: [{
    inline: `
      .nre, .nre * { box-shadow: none; }
      .nre .nre-section-title,
      .nre thead th {
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--nre-text-muted);
      }
      .nre td, .nre .nre-stat-value { font-variant-numeric: tabular-nums; }
      .nre a { text-decoration: underline; text-underline-offset: 2px; }
      .nre :focus-visible { outline: 1px solid var(--nre-focus); outline-offset: 0; }
    `,
  }],
});
```

这段 CSS 只碰官方语义 class 与令牌，不碰任何组件的内部结构，所以自定义组件按[组件取色纪律](../use-case/构建报告/自定义组件/)写出来就自动跟随。

## 验收

Basalt 是官方主题，可读性由 NiceEval 负责，验收至少覆盖：

- 两个分支各自的正文、`textMuted`、`textSoft` 对各自表面色达到 WCAG AA（正文 4.5:1，大字与非文本 3:1）。
- 四种 verdict 在两个分支上互不混淆，且不依赖颜色单独表意——判定符号与文字同时在场。
- 同一张图里六条 series 在正常色觉、三种色觉缺陷模拟与灰度四种条件下都可区分。
- 键盘 focus 环在两个分支、在 `surface` 与 `surfaceSubtle` 上都可见。
- 关掉 JavaScript 打开静态导出，初始外观与声明一致，全部数值可读。

## 相关阅读

- [Library · 主题](../library/theme.md) —— 令牌全集、装载链与 CSS 级联。
- [Library · 内建报告](../library/built-in.md) —— 从 `basalt` 出发做自己的主题。
- [主题目录](README.md) —— 内建主题一览。
