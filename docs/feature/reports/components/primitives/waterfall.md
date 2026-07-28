# `Waterfall`

时间树与瀑布：一批带起止偏移的节点，可逐层展开。runner 阶段树、原始 OTel span 树
与逐 attempt 的执行瀑布都是这一个形状，差别在传进去的[数据源](../sources/README.md)。

```tsx
<Waterfall source={sources.attempt.timeline} />   // runner phases + 关联 spans
<Waterfall source={sources.attempt.trace} />      // 不混入 runner 节点的原始 span 树
<Waterfall source={sources.sample.traces} />         // 一行一个 attempt 的范围级瀑布
```

## 长什么样

以 `sources.sample.traces` 的一行为例：总时长 5m 11s、40 个节点，
显著阈值即 3.1s（总时长的 1%）。web 面渲染成：

```text
@19r4dmi3   5m 11s   40 个节点                       ← 行头；有 locator 时链接到 attempt 详情
▉▉▉▉▊▎▏▊▊▊▊▎▏▎▏▊▊▊▊▏▎▏▎▊▊▊▊▏▊▎               ← 色带分解条：全部叶子节点，按 kind 落明度档
   model   run_sampling_request                22.2s ← 三列：类别、名字、时长
   model   model_client.stream_responses       15.6s
▸  tool ×3                                 合计 657ms ← 连续短节点折成摘要，展开还原逐条
   model   run_sampling_request                23.1s
▸  model_client.stream_responses ×24      合计 4m 3s ← 连续同名节点折成一条
▾  tool    apply_patch ✗                     1.2s    ← 失败节点恒列出、恒展开，再短也不折
     tool  retry ✗                             412ms
   other   session_flush                    时长缺失 ← durationMs 为 null：如实标缺，恒列出
```

text 面同一行折成带下钻命令的索引，不列节点：

```text
@19r4dmi3  5m 11s · 40 个节点 · 1 失败    niceeval show @19r4dmi3 --timing
```

每条标注对应的规则正文在[渲染](#渲染)、[类别与着色](#类别与着色)与[清单收敛](#清单收敛把噪音折起来)。

## 形状

数据源喂给它的 Content 形状——上面示意里的每一行、每个条段都从这两个接口来：

```ts
interface WaterfallNode {
  key: string;
  label: LocalizedText;
  /** 节点类别；清单里占一列，条上决定分类色。词表由数据源给，原语不建注册表。 */
  kind: string;
  /** 相对该行起点的偏移与时长；durationMs 为 null 表示测不了，条不绘、标注缺失。 */
  startOffsetMs: number;
  durationMs: number | null;
  failed?: boolean;
  /** 数据源标记的主干节点：默认展开且不参与显著性折叠（失败节点恒展开）。 */
  open?: boolean;
  children?: readonly WaterfallNode[];
}

interface WaterfallRow {
  key: string;
  label: LocalizedText;
  /** 该行的总时长；缺失为 null，行照常出现，不猜值。 */
  durationMs: number | null;
  nodes: readonly WaterfallNode[];
  locator?: AttemptLocator;
}

type WaterfallContent = readonly WaterfallRow[];

type WaterfallProps<Input extends SourceInput> =
  DataProps<Input, WaterfallContent | null> & {
    /** 区块标题；Content 为 null 或空时整块（含标题）不渲染，不留空标题。 */
    title?: LocalizedText;
    attemptHref?: (locator: AttemptLocator) => string;
    locale?: ReportLocale;
    className?: string;
  };
```

## 渲染

- web 面：一行一个 `WaterfallRow`，行内按 `startOffsetMs` / `durationMs` 静态渲染分解条，
  失败节点带失败标记；有 `children` 的节点用原生 `<details>` 逐层展开，静态文档零 JS 成立。
  `failed` 或 `open` 的节点默认展开。有 `locator` 时行链接到 attempt 详情。
  排序与缩放是渐进增强。
- `title` 在两面都渲染为区块头。同页放两个瀑布（如 attempt 详情的执行时间轴与
  Agent trace）时必须各给 `title`——两种视角在页面上要可辨认。
- 行头由 `locator`（有则成链接）与 `label` 组成；`label` 与 `locator` 同文时只渲染
  locator，不把同一个字符串画两遍。
- text 面：一行一个 `WaterfallRow`——身份、总耗时、节点计数与失败标记。存在 locator 时，renderer
  用 `ctx.attemptCommand(locator)` 生成下钻命令；Source Content 不携带呈现 action。
- `durationMs` 为 `null` 的行与节点如实标注缺失，不折成 0，也不从相邻节点推算。

### 清单是三列

节点清单是表，不是自由排版的文本流。每个节点恒占一行，行内四段固定就位：

| 列 | 内容 | 排版 |
|---|---|---|
| 指示符 | 可展开时 `▸`，展开后 `▾`；叶子留空 | 定宽，同层各行左边缘对齐 |
| 类别 | `kind` 原文 | 定宽，次级文字色 |
| 名字 | `label` 解析后的文本，失败节点尾随 `✗` | 占满剩余宽度，正文色 |
| 时长 | `durationMs`，缺失写「时长缺失」 | 右对齐、定宽、tabular numerals |

`label` 过长时单行省略，完整值进 `title` 属性；节点行不换行——一行一节点是读时长竖列的前提，
折行会让下一行的数字错位。子层靠左内缩与一条 1px 竖线表达层级，三列在同层内仍然对齐。

展开指示符由原语自己画。三列布局下浏览器给 `<summary>` 的默认标记不出现，
可展开与不可展开的行会长得一模一样，读者无从知道哪一行点得开。

### 分解条画哪些节点

条画**叶子节点**——树里没有 `children` 的那些，递归取，不限层数。父节点在时间上包住自己的
子节点，一起画只会盖住子段，一个占满全行的根节点足以让整条变成一块实心。
叶子是时间真正花掉的地方，条要回答的就是这个。

- 每段按 `startOffsetMs` / `durationMs` 相对行总时长定位与定宽，`durationMs` 为 `null`
  的叶子不画段——位置画得出、长度画不出的段是假的。
- 每段至少 1px 宽，短到测不出宽度的叶子也留一道痕。下限是像素不是百分比：
  取百分比时节点一多，几百个下限段叠起来就把整条铺满，条越密反而越没信息。
- 段上带 `title`，写节点名与时长；条是概览，精确读数在清单。
- 行 `durationMs` 为 `null`，或全部叶子都测不出时长时，整条不画，清单照常列。

## 类别与着色

`kind` 的词表由数据源给，原语不认识里面的任何一个词。所以原语不为 `model`、`tool`
这些具体值配色，也不维护「哪个类别是什么颜色」的注册表——数据源换一套词，呈现不能失效。

- **条上的类别用分类色**：由 `kind` 字面稳定散列到分类色板的一个槽，同一个词在同一份报告里
  恒同槽。分类色表示名义身份，不表示好坏——这正是[视觉总纲](../../../../../DESIGN.md)
  给「实验、agent、标签」这类身份留的通道，`kind` 是同一类东西。
- **散列避开与 negative 最近的那一槽**：失败段用 negative，条上除了颜色没有别的载体，
  分类色再落一个相近的红就分不出失败了。剩下的槽照散列用，五槽对开放词表当然会撞——
  条回答「相邻这几段是不是同一类」，精确身份在清单里读，条不是图例。
- **失败恒用 negative**：`failed` 的段覆盖掉它的分类色。同一个节点在清单里也带 `✗`，
  判定不靠颜色单独表意。
- **清单里的类别不带颜色**：它是一列文字，靠定宽列的位置和次级文字色与名字分开。
  给类别文字加背景就成了色块标签，与[视觉总纲](../../../../../DESIGN.md)
  「盒子默认不带颜色、不用装饰性色条」相抵；整列上色则会在一列里堆出五种彩字，
  而类别名本身已经把身份写清楚了。
- 语义色（positive / negative / warning）不借给类别用：`agent` 不是「好」，`model` 不是
  「警告」，借过来读者会把它当判定。

## 清单收敛：把噪音折起来

行内清单不逐条平铺全部节点。节点名与层级是被测 agent 的词表，niceeval 判不了
「这个节点相不相关」；能判的只有可测的两种噪音——太短的和重复的。web 面按下面两条规则
依次收敛清单，两条都作用于所在层级的兄弟清单。

### 短节点折成摘要

- 显著节点直接列出，判据满足任一即可：带 `failed`（失败必须可见）；带 `open`
  （数据源标记的主干不能藏）；`durationMs` 为 `null`（缺失折进摘要就看不到了）；
  时长不低于所在行总时长的 1%。
- 时间上连续的非显著节点折成一条摘要：按 `kind` 计数并给出合计时长（如
  `tool ×5 · 合计 218ms`），用原生 `<details>` 展开还原逐条，零 JS 成立。
  摘要留在原来的时间位置，不挪到清单末尾——瀑布的读法依赖时序。
- 只有一条时不折：摘要与那个节点各占一行，折起来省不下高度，却把名字换成了计数。
- 行 `durationMs` 为 `null` 时没有占比基准，该行不折叠，逐条列出。

1% 取「在分解条上肉眼可辨」的量级：低于它的节点在条上没有可见宽度，清单里逐条点名
也读不出信息。

### 重复节点折成一条

一个 agent 循环里同一个 span 重复几十次是常态，每次都够长、够显著，摊开就是几十行同一句话。
短节点那条规则收不住它们：它们不短。

- 时间上连续、`kind` 相同且 `label` 解析后同文的显著节点，满三条起折成一条摘要：
  `model_client.stream_responses ×24 · 合计 4m 3s`，同样用 `<details>` 展开还原逐条。
- 两条相邻的同名节点不折：摘要行省不下一行，却多要读者点一次。
- 带 `failed`、带 `open`、`durationMs` 为 `null` 的节点不参与，判据与短节点那条一致。
- 两种摘要各自成行，不互相合并：一条说「这里有一批看不见的碎片」，另一条说
  「这里有一件事做了 24 遍」，读法不同。

### 两条规则共同的边界

- 被折节点连同 `children` 一起进摘要，展开后原样还原。
- 色带分解条不受折叠影响：折叠只作用于清单，条上的叶子一段不少。
- text 面不受折叠影响：它本就折成行级索引，不列节点；行上的节点计数仍计全部节点。
- 折叠是原语的渲染规则，不是数据源的投影选项：三种视角的数据源都不预折节点，
  也不按节点名维护黑白名单。

## 一个原语，三种视角

runner 阶段树与原始 span 树是两种视角，不是两种形状：前者把 span 按显式 correlation 挂回
runner 时间树，后者保留采集侧的原始层级。视角差异住在数据源的 `nodes` 怎么组织，
渲染规则同一份。所以同一页可以择一，也可以两个都放。

runner 生命周期节点不进 trace 事实（[Architecture · 事实与看法](../../architecture.md#事实与看法)）。
把 runner 节点混进原始 span 树的是数据源的越界，不是原语的呈现选项。

## 相关阅读

- [组件树](../README.md) —— 四层模型与结构节点规则。
- [数据源目录](../sources/README.md) —— 官方时间树数据源。
- [Observability](../../../../observability.md) —— span 字段与采集边界。
