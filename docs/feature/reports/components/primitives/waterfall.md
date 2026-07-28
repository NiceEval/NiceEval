# `Waterfall`

时间树与瀑布：一批带起止偏移的节点，可逐层展开。runner 阶段树、原始 OTel span 树
与逐 attempt 的执行瀑布都是这一个形状，差别在传进去的[数据源](../sources/README.md)。

```tsx
<Waterfall source={sources.attempt.timeline} />   // runner phases + 关联 spans
<Waterfall source={sources.attempt.trace} />      // 不混入 runner 节点的原始 span 树
<Waterfall source={sources.sample.traces} />         // 一行一个 attempt 的范围级瀑布
```

## 长什么样

以 `sources.sample.traces` 的一行为例：总时长 5m 11s、40 个顶层 span，
显著阈值即 3.1s（总时长的 1%）。web 面渲染成：

```text
@19r4dmi3 · 5m 11s · 40 个节点                ← 行头；有 locator 时链接到 attempt 详情
▉▉▉▉▉▏▏▉▉▉▉▏▏▏▏▏▉▉▉▉▏▏▏▏▉▉▉▉▏▉…              ← 色带分解条：40 个节点全画，按 kind 着色
model run_sampling_request              22.2s
model model_client.stream_responses    15.6s
▸ tool ×3 · 合计 657ms                        ← 连续短节点折成摘要，展开还原逐条
model run_sampling_request              23.1s
model model_client.stream_responses    10.1s
▸ tool ×5 · 合计 239ms
tool  apply_patch ✗                      1.2s ← 失败节点恒列出，再短也不折
other session_flush                  时长缺失 ← durationMs 为 null：如实标缺，恒列出
```

text 面同一行折成带下钻命令的索引，不列节点：

```text
@19r4dmi3  5m 11s · 40 个节点 · 1 失败    niceeval show @19r4dmi3 --timing
```

每条标注对应的规则正文在[渲染](#渲染)与[显著性折叠](#显著性折叠短节点折成摘要)。

## 形状

数据源喂给它的 Content 形状——上面示意里的每一行、每个条段都从这两个接口来：

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

## 显著性折叠：短节点折成摘要

行内清单不逐条平铺全部节点。节点名与层级是被测 agent 的词表，niceeval 判不了
「这个节点相不相关」；能判的只有可测的显著性——失败与时长占比。web 面按这套规则收敛清单：

- 显著节点直接列出，判据满足任一即可：带 `failed`（失败必须可见）；带 `open`
  （数据源标记的主干不能藏）；`durationMs` 为 `null`（缺失折进摘要就看不到了）；
  时长不低于所在行总时长的 1%。
- 时间上连续的非显著节点折成一条摘要：按 `kind` 计数并给出合计时长（如
  `tool ×5 · 合计 218ms`），用原生 `<details>` 展开还原逐条，零 JS 成立。
  摘要留在原来的时间位置，不挪到清单末尾——瀑布的读法依赖时序。
- 折叠按所在层级的兄弟清单判定；被折节点连同 `children` 一起进摘要，展开后原样还原。
- 色带分解条恒绘全部节点：条是事实全集，清单是读法，折叠只作用于清单。
- 行 `durationMs` 为 `null` 时没有占比基准，该行不折叠，逐条列出。
- text 面不受折叠影响：它本就折成行级索引，不列节点；行上的节点计数仍计全部节点。

1% 取「在分解条上肉眼可辨」的量级：低于它的节点在条上没有可见宽度，清单里逐条点名
也读不出信息。折叠是原语的渲染规则，不是数据源的投影选项：三种视角的数据源都不预折节点，
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
