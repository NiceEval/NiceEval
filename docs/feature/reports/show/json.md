# `--json`：任何视图的结构化形态

`--json` 是 show 的第二个输出形态：同一范围、同一切片选出的同一批实体，输出成一个 JSON 文档到 stdout。text 面与 `--json` 消费同一套选择、去重与聚合规则；两面共有的派生字段必须同值——因为绝大多数切片解析为报告组件的一次装配，text 面与 `data` 字段消费的是同一次组件 resolve 的产物（[「show 的切片是组件选择」](../architecture.md#show-的切片是组件选择)），同值是构造保证，不是两套手写投影之间需要人工维持的纪律。JSON 是结构化审计面，可以保留 text 为注意力预算省略的字段、完整字符串与完整树，因此它是 text 的数据超集，不承诺两个形态包含完全相同的字段集合。

脚本消费走这里，不翻 `.niceeval/` 原始文件：读取面的选择、去重、时效口径都在 show 里实现过一遍，脚本自己扫目录必然复刻出第二套不一致的口径。需要比 show 视图更自由的读取时用 [`niceeval/record` 库读取面](../../record/library.md)，仍然不直接碰磁盘布局。

## 信封

```typescript
interface ShowJson {
  format: "niceeval.show";
  /** 破坏性形状变更时递增；新增可选字段不递增，消费方忽略未知字段。 */
  schemaVersion: 1;
  view: "leaderboard" | "compare" | "attempt" | "source" | "execution"
      | "timing" | "usage" | "diff" | "history" | "stats";
  /** 本次调用解析后的范围回显。 */
  sample: {
    resultsRoot: string;
    evalPrefix?: string;
    /** 解析后的 experiment id 全集；对照视图下顺序即条件顺序，首个是基准。 */
    experiments: string[];
    fresh: boolean;
  };
  data: unknown; // 单源指针见下「`data`：按 view 找组件声明」
}
```

- 输出是**一个**顶层 JSON 文档，不是 NDJSON；stdout 只有这个文档，人读的进度与警告走 stderr。
- **范围含多个 attempt 时**，逐 attempt 视图的 `data` 是对应数据源 Content 的数组，排序与 text 面分节同序（experimentId、evalId、attempt 序）；text 面的节头与合计行是渲染面派生，不进 `data`。
- 错误路径与 text 面一致：无匹配、用法冲突、零可读结果按同样的判定非零退出，错误信息走 stderr，不输出半个 JSON。
- 字符串值忠实转发落盘内容：终端形态的列宽截断、卡片预览预算**都不适用**；落盘时已被 [256 KiB 上限](../../record/architecture.md#大值截断)截断的值带原样的 `truncated` 标记，`--json` 不追溯还原也不二次截断。

### 通用 attempt 投影

多个 view 的 `data` 内部仍需要引用具体某次 attempt——不是每个引用点都值得各自重新声明
`AttemptRecord` 与归属身份的组合，因此这份投影收在信封层，供各数据源 Content 复用或收窄：

```typescript
/** attempt 的通用投影：AttemptRecord 全字段 + 归属身份。 */
type AttemptJson = AttemptRecord & {
  experimentId: string;
  /** 所属（或携带来源）Run 的 startedAt。 */
  runStartedAt: string;
};
```

字段名复用 [Record 落盘类型](../../record/architecture.md)，不为 JSON 输出发明第二套命名；派生量
由对应 Content 类型声明，本页不重复定义。

## `data`：按 view 找组件声明

`data` 字段不是 show 另起的第二套形状：它只输出 Source 计算后的事实 Content，不序列化
`SampleSummary` / `AttemptDetail` 这类产品组合树。text 面消费同一批 Content，再由 Component 决定
摘要、Notice 与排版。本页只维护「view → Content 声明位置」的指针：

| `view` | `data` 单源 |
|---|---|
| `leaderboard` | `sources.sample.snapshot` + 默认选择的 Measure Dataset + `sources.entity.experiments`；`SampleSummary` 只消费前两者，不进入 JSON |
| `compare` | `sources.measure.delta`（[Measure 数据源](../components/sources/measure.md)） |
| `attempt` | `sources.attempt.snapshot` 与当前详情所需的 evidence Content 集合（[Attempt 详情](../components/attempt-detail/README.md)）；不包含组合树 |
| `source` | `sources.attempt.source`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `execution` | `sources.attempt.conversation`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `timing` | `sources.attempt.timeline`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `usage` | `sources.attempt.snapshot` 的数组；`AttemptUsage` 只是它的阅读组件 |
| `diff` | `sources.attempt.diff`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `history` | [`--history`](history.md)「分节与行内字段」：这个切片不进入组件模型，直接投影 Record evidence（[切片表](../architecture.md#show-的切片是组件选择)未列出它） |
| `stats` | `sources.measure.stability`（[Measure 数据源](../components/sources/measure.md)） |

## 边界

- 终端渲染面的注意力预算——卡片预览、`--timing` 80 detail node、列宽截断——不适用于 `--json`：这些是对应组件 text 渲染面的选项，JSON 面恒为完整 resolve 产物（[切片表](../architecture.md#show-的切片是组件选择)）。`--timing` 的 JSON 输出等价 `--timing=full` 的节点集合。
- `--expand` 与 `--json` 组合是用法错误：JSON 形态本来就不截断卡片，没有可展开的东西。
- 与 `--report` 互斥：报告树表达「怎么看」，`--json` 输出「是什么」（[范围契约](../show.md#选择结果范围)）。

## 相关阅读

- [Reports Architecture · show 的切片是组件选择](../architecture.md#show-的切片是组件选择) —— 每个 view 对应哪个组件、为什么两面同值是构造保证。
- [Record Architecture](../../record/architecture.md) —— 被复用的落盘类型形状。
- [Record Lib](../../record/library.md) —— 需要自由组合读取时的库入口。
