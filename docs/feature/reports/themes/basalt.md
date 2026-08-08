# Basalt —— 官方暗色主题

`basalt` 是 `niceeval view` 不指定 `--theme` 时生效的那一份，也是官方样式在每个 `var(--niceeval-*, <default>)` 使用点写下的默认值。
所以把报告嵌进自己的页面、不声明任何令牌时，看到的就是 Basalt——一份主题两条交付路径，不存在「view 里一个样、嵌进来另一个样」。
这一等式由 `test/unit/report-theme-tokens.test.ts` 守护逐项相等，因此 Basalt 不需要自带 `styles`：官方样式本身就是它的完整表达。

玄武岩是冷却得足够慢的黑色岩浆，凝出笔直的柱状节理。
这份主题按同一个主张做：**黑色系、零圆角、发丝分隔线、去装饰**。
屏幕上不该有一件东西是为了好看而存在的——边框只用来分隔，颜色只用来编码含义，其余交给排版与留白。

Basalt 与 [`docs/SVG-DESIGN.md`](../../../SVG-DESIGN.md) 的图示令牌是同一份色板：内部文档里的手绘图、`niceeval view` 的宿主 chrome 与默认报告因此是同一个观感。

## 视觉主张

- **锁定暗色。**
  `appearance: "dark"`，全站不渲染浅深切换。
  Basalt 的每个值都为近黑背景挑过，不假装同一组数字在白底上也成立；要浅色用 [Chalk](chalk.md) 或自己的主题。
- **零圆角。**
  `radius: "0"`。
  卡片、表格、pill、输入、tooltip 全是直角——玄武岩的柱状节理。
- **发丝分隔，不用阴影。**
  层次靠 1px 边框与两级表面色建立，不用投影、不用渐变。
- **克制的强调色。**
  `accent` 是近乎无彩的冷灰，链接与 locator 靠下划线和 hover 区分，不靠色相跳出来。
  品牌感来自排版秩序，不来自一个饱和色块。
- **判定色是唯一允许饱和的地方。**
  passed / failed / errored 必须一眼可分，状态三色保留足够色度；它们是信息，不是装饰。
- **数字优先。**
  正文基准 13px，数值列一律 tabular numerals，标签用小字号加字距、不用粗体堆叠。
- **文字不用图标装饰。**
  界面文字不用 Emoji、箭头或其他特殊符号充当状态、类别或语气；用本地化文字直接说清事实。
  仅当符号属于数据、代码或已定义的技术记号，且相邻文字已完整表达同一语义时，才可以保留。

## 令牌取值

### 中性面

| 令牌 | 值 | 用在哪 |
|---|---|---|
| `page` | `#050505` | 页面底 |
| `surface` | `#0b0b0b` | 卡片、表格、面板 |
| `surfaceSubtle` | `#111111` | 表头、盒中盒、次级区块 |
| `border` | `#262626` | 所有常规分隔线 |
| `borderStrong` | `#343434` | 需要压过一档的边、坐标轴 |
| `text` | `#ededed` | 正文、标题、读数 |
| `textSecondary` | `#a1a1aa` | 标签、单位、说明 |
| `textTertiary` | `#74747b` | 占位、缺失标记、轴刻度 |

三级文字是刻意的：正文、标签与单位、占位与轴刻度各占一级，把「这行字有多重要」交给明度而不是字重。

### 语义色

| 令牌 | 值 | 表达 |
|---|---|---|
| `accent` | `#cbd6dc` | 导航当前项、链接与 locator、focus 环 |
| `positive` | `#3ddc97` | passed、improved、正向 `Stat` |
| `negative` | `#ff6b6b` | failed、regressed、负向 `Stat` |
| `warning` | `#e8b84a` | errored、partial、截断与不可用 |

`accent` 与正文接近是设计的一部分，不是失误：整页只剩状态三色和分类色带颜色，读者看到色块就知道那是信息。
`focus` 不单独声明，取 `accent`。

### 分类色

| 槽位 | 值 | 色族 |
|---|---|---|
| 1 | `#3987e5` | 蓝 |
| 2 | `#199e70` | 绿 |
| 3 | `#c98500` | 琥珀 |
| 4 | `#008300` | 深绿 |
| 5 | `#e66767` | 红 |
| 6 | `#d95926` | 橙 |

六个槽同时按**色相**和**明度**分开：相邻槽位的明度差保证它们在灰度打印和红绿色觉缺陷下仍然分层，色相差保证正常色觉下一眼可辨。
这是官方主题必须承担的义务——分类色是数据编码，不是配色偏好。

### 排版与形状

| 令牌 | 值 |
|---|---|
| `font.sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif` |
| `font.mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `fontSize` | `13px` |
| `radius` | `0` |

不自带字体文件：报告站要在任何托管场景直接打开，系统字体栈没有网络依赖，也不会因为字体没加载完而抖一次版。
要换字体的人换的是自己的主题。

## 验收

Basalt 是官方主题，可读性由 NiceEval 负责，验收至少检查：

- 正文、`textSecondary`、`textTertiary` 对各表面色达到 WCAG AA（正文 4.5:1，大字与非文本 3:1）。
- 四种 verdict 互不混淆，且不依赖颜色单独表意——判定符号与文字同时在场。
- 同一张图里六条 series 在正常色觉、三种色觉缺陷模拟与灰度四种条件下都可区分。
- 键盘 focus 环在 `surface` 与 `surfaceSubtle` 上都可见。
- 关掉 JavaScript 打开静态导出，初始外观与声明一致，全部数值可读。

## 相关阅读

- [Chalk](chalk.md) —— 官方浅色主题，圆角与浅面的另一极。
- [Library · 主题](../library/theme.md) —— 令牌全集、装载链与 CSS 级联。
- [Library · 内建报告](../library/built-in.md) —— 从 `basalt` 出发做自己的主题。
- [主题目录](README.md) —— 内建主题一览。
