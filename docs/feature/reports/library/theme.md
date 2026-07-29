# 主题：可分发的外观制品

主题回答「这份结果长什么样」，报告回答「这份结果给谁看什么」。两者是分开的制品：一份主题可以套在任何报告上，一份报告也可以换任何主题。团队的品牌只写一次，之后每个 benchmark 站、每份成绩单、每次本地 `view` 都取同一份。

主题内部再分两层，共用同一组公开 CSS 令牌：

- **令牌**是类型化的高频入口——外观分支、强调色、状态色、六色图表色板、中性表面、字体与圆角。
- **`styles`** 是主题自带的完整 CSS 出口，用来改令牌表达不了的东西：组件外观、密度、装饰、字体加载。

主题只作用于 web 面：`view` 宿主 chrome 与页内 `.niceeval-report` 组件读同一份令牌，本地查看与 `view --out` 静态导出使用同一份主题。`show` 是 text 面，不消费主题；主题不改变判定文字、读数口径或任何数值。

## 装载链

`view` 每次运行只生效一份主题，四档，前档缺席才落下一档：

| 档 | 取值 | 用途 |
|---|---|---|
| 1 | `--theme <名字\|文件>` | 单次运行指定；不含路径的名称是内建主题名（`--theme basalt`），带路径形是主题文件 |
| 2 | 报告定义的 [`theme` 外壳字段](shell.md#字段穷尽) | 这份报告自带的外观，随报告文件一起分发 |
| 3 | `niceeval.config.ts` 的 `theme` 字段 | 项目默认外观，团队里每个人不带选项运行 `view` 都看这一份 |
| 4 | 内建 [`basalt`](../themes/basalt.md) | NiceEval 官方主题 |

四档取的都是 `defineTheme` 产物，走同一条 `装载 → 规范化 → 生成令牌块与资产` 管线。

**档只决定用哪一份主题，不跨档合并。** 生效的那一份里没声明的令牌一律取内建默认值，不从下一档借。这条和外壳「每个字段各自声明、没有部分覆盖」是同一条纪律：读一份主题文件就能知道站点最终长什么样，不必再去翻另外三档。要在别人的主题上改，见下面的[复用与分发](#复用与分发)。

`--theme` 是 `view` 的 flag。`niceeval show --theme …` 按完整用户反馈报错，说明主题只作用于 web 面，并指出下一步是改用 `view`。

## 项目默认主题

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";
import { acmeTheme } from "./themes/acme";
import site from "./reports/site";

export default defineConfig({
  report: site,
  theme: acmeTheme,
});
```

字段收 `defineTheme` 产物本身，不是路径字符串：配置文件是 TS，import 自己的主题即可，写错在类型检查时就暴露。填了非 `defineTheme` 产物（普通对象、CSS 字符串、报告定义）按完整用户反馈报错，出处点名配置文件的 `theme` 字段。

`theme` 和 `report` 一样只影响读面：`niceeval exp` 不装载主题，主题不进 Run，换主题不必重跑。

## Library DX

只改品牌强调色时，一个 `accent` 就是一份完整主题：

```tsx
// themes/acme.ts
import { defineTheme } from "niceeval/report";

export default defineTheme({ accent: "#7C3AED" });
```

```sh
niceeval view --theme ./themes/acme.ts
niceeval view --theme ./themes/acme.ts --out site
```

单个颜色在浅色与深色外观下原样使用。品牌色只适合某个背景时，显式给出两套；NiceEval 不从一个颜色猜另一个外观的变体：

```tsx
export default defineTheme({
  appearance: "system",
  accent: { light: "#6D28D9", dark: "#C4B5FD" },
});
```

一份认真的主题会同时动色板、中性面、字体与形状，再用 `styles` 收尾：

```tsx
// themes/acme.ts
import { defineTheme } from "niceeval/report";

export default defineTheme({
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
  page: { light: "#FFFBF5", dark: "#120F0C" },
  surface: { light: "#FFFFFF", dark: "#1C1713" },
  font: { sans: '"IBM Plex Sans", ui-sans-serif, sans-serif' },
  radius: "2px",
  styles: [
    { src: "./acme.css" },
    { inline: `.niceeval-report .niceeval-hero-title { letter-spacing: -0.035em; text-transform: uppercase; }` },
  ],
});
```

主题文件里的 `{ src }` 相对**主题文件自己**解析，不是报告文件。这是主题能独立分发的前提：把主题连同它的 CSS 一起搬到别的项目，路径照旧成立。

## 复用与分发

主题是普通值，因此分发不需要新机制：

- **同项目复用**：`export default defineTheme(…)`，别的报告文件或配置 import 进来填进 `theme` 字段。
- **跨项目分发**：发一个 npm 包，默认导出 `defineTheme` 产物，消费方 `import acme from "@acme/niceeval-theme"` 后填字段。包里的 CSS 与字体随包走，因为 `styles` 的路径相对主题文件。
- **临时试装**：`--theme ./themes/acme.ts` 不改任何文件就换一次外观，用来对着同一份报告比几套配色。

在别人的主题上改一项时，展开普通对象——令牌整字段覆盖，`styles` 是数组，拼接是普通数组操作：

```tsx
import { defineTheme } from "niceeval/report";
import base from "@acme/niceeval-theme";

export default defineTheme({
  ...base,
  accent: { light: "#0F766E", dark: "#5EEAD4" },
  styles: [...(base.styles ?? []), { inline: ".niceeval-report .niceeval-hero { padding-block: 48px; }" }],
});
```

主题没有继承：它是一个扁平的令牌对象，对象展开已经把「拿一份再改两项」表达清楚，再加一层合并语义只会让「这个色到底从哪来」多一个要查的地方。报告外壳同理——两处是同一条纪律。

`defineTheme` 只做类型与运行时校验，不注册全局状态、不写文件。三个去处收的都是它的产物，不收未包装对象——外壳的 `theme`、配置的 `theme` 与 `--theme` 装载的默认导出同一条规则，与[报告定义](shell.md)那边一致：读一行 `theme: acme` 就知道那是一份校验过的主题，而不是一份可能拼错字段名的字面量。

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

/** 一段 CSS 值，原样落进令牌块；src 相对主题文件解析。与外壳 styles 同类型。 */
type ReportAsset =
  | { src: string; inline?: never }
  | { inline: string; src?: never };

interface ReportTheme {
  /** system 跟随浏览器/OS 并给读者一个浅/深切换；light 与 dark 锁定全站外观。默认 system。 */
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

  /** 页面底色。 */
  page?: ThemeColor;
  /** 卡片、表格与面板的表面色。 */
  surface?: ThemeColor;
  /** 表头、斑马行与次级区块的表面色。 */
  surfaceSubtle?: ThemeColor;
  /** 常规分隔线与描边。 */
  border?: ThemeColor;
  /** 需要强调的分隔线，如表格主分区。 */
  borderStrong?: ThemeColor;
  /** 正文色。 */
  text?: ThemeColor;
  /** 次要文字：标签、单位、说明。 */
  textSecondary?: ThemeColor;
  /** 最弱文字：占位、缺失标记、轴刻度。 */
  textTertiary?: ThemeColor;
  /** 键盘 focus 环。默认取 accent 的值。 */
  focus?: ThemeColor;

  /** 字体栈；值是 CSS font-family 片段。 */
  font?: { sans?: string; mono?: string };
  /** 报告根字号，如 "14px" / "0.9375rem"。 */
  fontSize?: string;
  /** 卡片、按钮与表格的圆角，如 "2px" / "0"。 */
  radius?: string;

  /** 主题自带的样式表，在令牌块之后、报告外壳 styles 之前按声明顺序加载。 */
  styles?: readonly ReportAsset[];
}

/**
 * defineTheme 的唯一产物：作主题文件的默认导出、报告外壳的 theme 字段，
 * 或 defineConfig 的 theme 字段。它不是 ReportNode,也不是 ReportDefinition。
 */
interface ThemeDefinition {
  readonly kind: "theme";
}

function defineTheme(theme: ReportTheme): ThemeDefinition;

/** 把一份主题规范化成可直接注入 <style> 的令牌块，给自建 React 页面用。 */
function themeStylesheet(theme: ThemeDefinition): string;
```

主题字段是穷尽集合，未列出的字段即不存在。校验分两类：

- **颜色**只接受 `#RRGGBB`，不接受短 hex、alpha、CSS 颜色名、`var()`、`light-dark()` 或任意 CSS 片段。宿主要把单值展开成两个外观分支、要保证令牌块可解析，所以这一类必须是它能读懂的值。
- **`font` / `fontSize` / `radius`** 的值本身就是 CSS，收非空字符串，宿主不解析语义——写错了浏览器怎么表现是作者义务。它们原样落进令牌块，因此值里出现 `;` 或 `}` 时按完整用户反馈拒绝，并指引改用 `styles`：那是写完整 CSS 规则的地方。

`series` 固定为六色，主题只提供视觉身份的颜色一维。
完整身份是「六色 × 四个形状变体」的 24 个槽，容量与分配序列见
[视觉编码容量](../components/README.md#视觉编码容量24-个身份)。
换 palette 不改变散列、图例顺序或 series 身份。

字段未知、pair 缺任一分支、数组长度不是六、颜色格式非法或资产路径违规时，`defineTheme` / `defineReport` 按完整用户反馈拒绝，并指到具体字段路径，例如 `theme.series[3].dark`。

## 每种颜色表达什么

| 令牌 | 用来表达 | 不表达 |
|---|---|---|
| `accent` | 当前导航、链接 / locator、交互控件 active / focus、页内装饰强调 | passed / failed，或某个图表 series 的身份 |
| `positive` | passed、improved、正向 `Stat` 主值 | “主题色” |
| `negative` | failed、regressed、负向 `Stat` 主值 | errored 或普通提示 |
| `warning` | errored、partial coverage、截断、缺失与不可用状态 | failed |
| `series` | experiment / agent / label 等名义分类身份 | 质量大小或判定好坏 |
| 中性面令牌 | 页面、卡片、分隔与三级文字层次 | 任何状态含义 |

组件根据领域语义选令牌，不读取 hex 值后反推意义。
图表 series 与实体列表的分组值始终走 `series`；
同一报告的稳定分配由外壳 [`dimensionPins`](shell.md#dimensionpins) 声明。
成对差异 Result 的 improved / regressed 走 `positive` / `negative`；
改 `accent` 不会把某条实验线染成品牌色。

未声明的令牌取内建主题 [Basalt](../themes/basalt.md) 的值——它同时是官方样式在每个 `var(--niceeval-*, <default>)` 使用点写下的默认值，因此「不声明任何令牌」与「装 Basalt」看到的是同一个样子（Basalt 锁定暗色，每个令牌一个值）：

| 令牌 | 值 |
|---|---|
| `accent` | `#cbd6dc` |
| `positive` | `#3ddc97` |
| `negative` | `#ff6b6b` |
| `warning` | `#e8b84a` |
| `series` | `#3987e5`, `#199e70`, `#c98500`, `#008300`, `#e66767`, `#d95926` |
| `page` | `#050505` |
| `surface` | `#0b0b0b` |
| `surfaceSubtle` | `#111111` |
| `border` | `#262626` |
| `borderStrong` | `#343434` |
| `text` | `#ededed` |
| `textSecondary` | `#a1a1aa` |
| `textTertiary` | `#74747b` |
| `focus` | 同 `accent` |

非颜色令牌：

| 令牌 | 值 |
|---|---|
| `font.sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif` |
| `font.mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `fontSize` | `13px` |
| `radius` | `0` |

Basalt 自己的视觉主张、分类色的明度阶梯与验收要求写在[它的设计页](../themes/basalt.md)；
官方浅色主题 [Chalk](../themes/chalk.md) 与内建主题一览见[主题目录](../themes/README.md)。

NiceEval 固定字标与 `PoweredBy` 仍表示 NiceEval 产品身份，不从主题的 `accent` 取色。主题不是隐藏或伪装宿主品牌的机制。

## 外观与浅深切换

`appearance` 一个字段同时表达「默认哪一支」和「读者能不能换」：

- **`system`（默认）**：初始跟随浏览器 / OS，`view` 页头渲染一个浅 / 深切换控件。读者的选择按站点作用域记在浏览器本地，下次打开同一个站保持。
- **`light` / `dark`**：全站锁定该分支，不渲染切换控件。主题的 CSS 只为一种背景写过时用这一档。

无 JavaScript 时初始 HTML 就是声明的外观——`color-scheme` 与 `light-dark()` 在样式层完成选色，导出站在直接打开、静态托管与本地 server 中规则相同。切换控件属于增强层，与自定义脚本受同一条不变量约束：只改变浏览的样子，不改变数据、读数口径或初始 HTML 里的任何数值。

## 在 view 中怎样生效

装载期先把 `ReportTheme` 规范化为完整令牌表：未声明的令牌取官方值，单色展开成相同的 light / dark 值，pair 保留两个分支。站点管线再把一个纯 CSS 令牌块挂到 view 文档根；页内 `.niceeval-report` 报告边界继承这些令牌。report 官方样式只在每个 `var(--niceeval-*, <default>)` 使用点保留同源默认值，使它脱离 view 嵌入用户页面时仍零配置可读，而不在 `.niceeval-report` 上重新声明一套会遮住宿主主题的变量。宿主 chrome 与报告组件因此读同一份值，不在 `src/view` 与 `niceeval/report` 各复制一份色板。

主题的 `styles` 与外壳 `styles` 走同一套资产纪律：`{src}` 只收本地路径（允许 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`），本地 `view` 与静态导出都按内容哈希物化为 `assets/<sha256><ext>` 并改写引用，同内容去重。区别只在解析基准——主题的资产相对主题文件，外壳的资产相对报告文件。文件缺失时在启动或导出时报错并给出解析后的路径。

主题不进 `ctx.report`。组件输出稳定的语义 class，再由 CSS 令牌取色；组件不能在 resolve 阶段读主题后改变组件树或数据。因此换主题只改 CSS，不会导致读数重算、HTML 内容分叉或证据链改变——这也是主题可以独立分发的根据：一份主题装到任何报告上都不可能改动那份报告的数字。

样式级联顺序固定为：

1. view、report 官方样式与作者渲染组件的基础样式；
2. 生效主题的令牌块；
3. 生效主题的 `styles`，按声明顺序；
4. 报告外壳 `styles`，按声明顺序；
5. 外壳 `head` 中的 `style`，按声明顺序；
6. 页树里的 `Style`，按树的 resolve / render 顺序。

后一层可以覆盖前一层。主题在下、报告在上：装一份外来主题不会锁死这份报告自己的微调，报告作者的 `styles` 与 `Style` 永远有最终发言权。

## CSS 覆盖与完整重写

公开 CSS 令牌全部使用 `--niceeval-` 前缀，由 view 根节点向 `.niceeval-report` 继承。把 report React 组件嵌进自己的页面时，在包住 `.niceeval-report` 的容器上声明同一组令牌即可；已经有 `defineTheme` 产物时直接注入它的令牌块：

```tsx
import { themeStylesheet } from "niceeval/report";
import acme from "@acme/niceeval-theme";

<style dangerouslySetInnerHTML={{ __html: themeStylesheet(acme) }} />;
```

完整令牌表：

```css
--niceeval-color-accent
--niceeval-color-positive
--niceeval-color-negative
--niceeval-color-warning
--niceeval-color-series-1
--niceeval-color-series-2
--niceeval-color-series-3
--niceeval-color-series-4
--niceeval-color-series-5
--niceeval-color-series-6
--niceeval-color-page
--niceeval-color-surface
--niceeval-color-surface-subtle
--niceeval-color-border
--niceeval-color-border-strong
--niceeval-color-text
--niceeval-color-text-secondary
--niceeval-color-text-tertiary
--niceeval-color-focus
--niceeval-font-sans
--niceeval-font-mono
--niceeval-font-size
--niceeval-radius
```

令牌表不到的地方用 CSS。主题自己的 `styles` 是主题作者的出口，报告外壳 `styles` 是报告作者的出口，单页特例放在页树的 `Style`：

```tsx
export default defineReport({
  pages: [...standard.pages],
  styles: [{
    inline: `
      .niceeval-report .niceeval-hero-title { letter-spacing: -0.035em; }
      .niceeval-report .niceeval-scoreboard td { font-variant-numeric: tabular-nums; }
    `,
  }],
});
```

`.niceeval-report` 是公开主题边界，官方组件在其中提供稳定的 `niceeval-*` 语义 class。
`niceeval-*` 由 NiceEval 保留；自定义组件用自己的 class 前缀建立边界，并读取同一组 CSS 令牌。

CSS 可以重写排版块的视觉结构，但不得改变数据、初始 HTML 中的数值和无 JavaScript 可读性；也不得隐藏 NiceEval 固定品牌位，或用颜色作为 passed / failed、不同 series 的唯一信息载体。

## 质量与归属

NiceEval 官方主题 [Basalt](../themes/basalt.md) 保证官方组件的对比度与分类色可分辨性。自定义主题的可读性由主题作者负责；宿主只校验形状和颜色语法，不自动改色或重排 series。主题验收至少覆盖浅色与深色背景、四种 verdict、六条同图 series、键盘 focus 态与色觉缺陷模拟。

- 主题只影响 web 面；`show` 不消费它。
- 主题是整站的，不能按 page 切换；单页特例用该页树中的 `Style`。
- 主题不进入记录根、Run。它是“怎么看”的配置，改色不需要重跑 eval。

## 相关阅读

- [自己写报告组件](../use-case/构建报告/自定义组件/) —— 自定义组件怎么取色、怎么跟随任何主题。
- [给报告换主题、做自己的主题包](../use-case/交付报告/主题/) —— 从换一次色到发一个主题包的全流程。
- [Basalt](../themes/basalt.md) —— 官方主题的令牌取值与视觉主张。
- [外壳与多页](shell.md) —— `theme` / `dimensionPins` / `styles` 在 `ReportShell` 中的位置。
- [排版原语与自定义组件](layout.md) —— 页内 `Style`、`className` 与组合组件。
- [View](../view.md) —— 本地查看与静态导出怎样消费同一份主题。
