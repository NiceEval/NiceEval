# `SourceView`

GitHub diff 式带标注源码：轻量语法高亮，行按状态整行着色，点击行展开该行背后的完整证据。
它是唯一一个渲染形状本身就是契约的原语——没有任何表格、网格或树能表达「哪一行代码
发生了什么」。

```tsx
<SourceView source={attemptSource} />
```

## 形状

```ts
interface SourceLine {
  number: number;
  text: string;
  /** 行状态；决定底色、左缘与行号位图标。省略即普通行。 */
  tone?: "send" | "passed" | "gate-fail" | "soft-fail" | "unavailable";
  /** 右缘标注：soft 的阈值分数，或计分制的挣分。 */
  pill?: LocalizedText;
  /** 前置中止行标记；其后的源码行整体降灰。 */
  aborted?: boolean;
  /** 点击展开的证据；空数组即该行不可展开。 */
  details?: readonly ReportNode[];
  /** 从这一行发出的调用路径，按运行时路径首次出现顺序。 */
  calls?: readonly SourceCallContent[];
}

interface SourceBlockContent {
  path: string;
  lines: readonly SourceLine[];
}

interface SourceCallContent {
  /** 数据源已经格式化好的检查计票与挣分摘要。 */
  summary: LocalizedText;
  tone?: "passed" | "gate-fail" | "soft-fail" | "unavailable";
  /** web 面的初始展开态。 */
  open: boolean;
  target:
    | { kind: "source"; block: SourceBlockContent }
    | { kind: "opaque"; label: LocalizedText; calls?: readonly SourceCallContent[] };
}

interface SourceContent {
  /** eval 入口文件的投影。 */
  spine: SourceBlockContent;
  /** 调用链不经过入口文件的项目源码片段。 */
  detached: readonly SourceBlockContent[];
  /** 真正没有源码位置的证据，列在全部源码块之后。 */
  unmapped?: readonly ReportNode[];
}
```

`SourceContent` 是[完整源码调用树](../../eval-source/architecture.md)的面相关投影。`SourceView` 不读取
源码、不按位置分桶，也不决定上下文半径；数据源已经完成这些领域计算。`opaque` 同时承载第三方包
和正文不可用的项目帧，原语只显示 label 并继续渲染其下可用调用，不解释缺口原因。

## web 面视觉规范

这份规范与产品站首页的 eval 示例卡（`site/components/site-home-setup.tsx` 与
`site/app/globals.css` 的 `.eval-code` 族）是同一套视觉语言的两份实现：示例卡是
「源码即报告」这套叙事的公开形象，报告里的真实源码视图与它同语言，用户从官网到报告
不切换视觉心智。

二者不共享实现。示例卡是需要 hydration 的营销交互（React state 展开、轮播、埋点），
`SourceView` 按报告契约必须在零 JS 的静态 attempt 文档里完整成立；数据上示例卡是策划数据，
`SourceView` 是真实证据（一行多条断言、四种 tone、unmapped 区）。对齐的单位因此是下面这份
规范，不是组件。

- **密度**：等宽 12.5px / 1.65 行高；整块源码统一横向滚动，普通行之间不画分隔线；
  行盒撑到最长行宽度，状态底色与左缘盖满整行，不在横向滚动后断成半截。
- **行状态**：状态 = 整行浅染 + 2px 左缘 + 行号位图标。send 行蓝、passed 绿、gate-fail 红、
  soft-fail 与 unavailable 黄；浅染是 tone 色约 8% 的透明混合，不是饱和色块。有状态的行用内联
  SVG 图标顶替行号（send 对话气泡、passed 圈勾、failed 圈叉、soft-fail 圈叹号、
  unavailable 圈问号；不引第三方图标库），普通行显示行号。前置中止行按 gate-fail 红；
  中止行之后的全部源码行整体降灰——那些行没有任何证据，是因为没跑到，不是因为没写，
  行号照常显示。
- **给分行**：直接给分的调用行不着判定色——给分是分数面事实，不是判定；行号照常，
  右缘挂挣分 pill，展开区显示该条给分记录。
- **右缘 meta**：行右侧只放分数 pill、中止行的 `⤓` 标记与展开 chevron，钉在滚动视口右缘
  （sticky），横向滚动时始终可见；不显示内部轮标签。
- **展开区**：点击行展开的证据直接接在源码行下，dashed 上边线加 tone 色左缘；
  按容器可视宽度排版换行并钉在滚动视口左缘，不跟随代码横向滚动；不套二级卡片，
  不重复轮头与已发送的 prompt。首个失败或警告行默认展开。
- **语法高亮**：零依赖逐行 TypeScript token（comment / string / keyword / number / function
  五类语义 class）；暗色 token 取 VS Code Dark+ 系（与示例卡的 prism vsDark 主题同源），
  浅色为等价可读色。
- **调用片段**：调用行右缘显示汇总 pill，后接原生 `<details>`。源码 block 左缘增加层级线；
  package 与 unavailable 的 opaque 段显示 label，更深的可用 block 继续嵌套。detached block 排在
  主干之后，并显示完整项目相对路径。
- **兜底区**：`unmapped` 接在全部源码块之后、与源码块同宽，只承载没有源码位置的断言和给分记录。
- **交互载体**：展开一律是原生 `<details>`，静态文档零 JS 成立。

这份规范与官方 stylesheet 组合后的实际观感（染色、布局、滚动、展开交互）由
[E2E 报告域](../../../../engineering/testing/e2e/report.md)在真实浏览器里验收，
单元层只覆盖数据投影与 DOM 结构事实。

## text 面

text 面不倾倒整份源码：打印有状态行的位置与 expected / received，含轮次时保留 `--execution`
下钻入口，并给出 `--source` 命令。判定、计数、可用性与引用在两面严格相同，
折叠的只有大块正文。

## 相关阅读

- [组件树](../README.md) —— 三层模型与双面投影边界。
- [`Conversation`](conversation.md) —— 兜底区与展开区共用的回复渲染。
- [源码调用树](../../eval-source/README.md) —— 完整证据、调用片段与降级规则。
- [断言与 Turn 的展示](../../../scoring/library/display.md#计分制points-与给分记录) —— 证据的折叠与分组契约。
