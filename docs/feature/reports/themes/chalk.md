# Chalk —— 官方浅色主题

`chalk` 是与 [Basalt](basalt.md) 成对的另一极：白垩对玄武岩，浅面对黑面，圆角对直角。
它同时是「官方样式没写死任何观感」的活证明——Basalt 与 Chalk 之间的每一处差异
都住在主题令牌里，官方 stylesheet 一行不改。

```sh
niceeval view --theme chalk
niceeval view --theme chalk --out site
```

## 视觉主张

- **锁定浅色。** `appearance: "light"`，全站不渲染浅深切换。每个值都为白纸似的底色挑过。
- **圆角。** `radius: "8px"`。卡片、表格、pill 都是软角——白垩是软的。
- **有色的 accent。** 链接、locator 与 focus 环用蓝色 `#2a78d6`，在浅底上这一点色相不喧宾夺主，还把「可点」标得更清楚。
- **同一套结构关系。** 层次仍然靠 1px 边框与两级表面色，判定三色仍然是页面上唯一的
  饱和色；Chalk 改的是外观，不是信息编码。
- **正文基准 14px。** 浅底上同字号的视觉密度更高，回一档换阅读舒适。

## 令牌取值

### 中性面

| 令牌 | 值 |
|---|---|
| `page` | `#fafafa` |
| `surface` | `#ffffff` |
| `surfaceSubtle` | `#f4f4f5` |
| `border` | `#dedee2` |
| `borderStrong` | `#c9c9cf` |
| `text` | `#111113` |
| `textSecondary` | `#62636a` |
| `textTertiary` | `#8b8d98` |

### 语义色

| 令牌 | 值 | 表达 |
|---|---|---|
| `accent` | `#2a78d6` | 导航当前项、链接与 locator、focus 环 |
| `positive` | `#087f5b` | passed、improved、正向 `Stat` |
| `negative` | `#b42318` | failed、regressed、负向 `Stat` |
| `warning` | `#9a6700` | errored、partial、截断与不可用 |

### 分类色

| 槽位 | 值 | 色族 |
|---|---|---|
| 1 | `#2a78d6` | 蓝 |
| 2 | `#1baf7a` | 绿 |
| 3 | `#eda100` | 琥珀 |
| 4 | `#008300` | 深绿 |
| 5 | `#e34948` | 红 |
| 6 | `#eb6834` | 橙 |

与 Basalt 的六槽同一色相序，逐槽换成浅底可读的明度；散列与图例顺序不变，同一个 agent 在两套主题下落在同一个槽位。

### 排版与形状

| 令牌 | 值 |
|---|---|
| `font.sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif` |
| `font.mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `fontSize` | `14px` |
| `radius` | `8px` |

## 验收

与 [Basalt 的验收](basalt.md#验收)同一张清单，对象换成浅色背景：对比度 AA、
四 verdict 互不混淆、六 series 四种条件可分、focus 环可见、无 JavaScript 可读。

## 相关阅读

- [Basalt](basalt.md) —— 官方暗色主题与默认观感。
- [Library · 主题](../library/theme.md) —— 令牌全集、装载链与 CSS 级联。
- [主题目录](README.md) —— 内建主题一览。
