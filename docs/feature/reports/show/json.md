# `--json`：任何视图的结构化形态

`--json` 是 show 的第二个输出形态：同一范围、同一切片选出的同一批实体，输出成一个 JSON 文档到 stdout。text 面与 `--json` 消费同一套选择、去重与聚合规则；两面共有的派生字段必须同值——因为绝大多数切片解析为报告组件的一次装配，text 面与 `data` 字段消费的是同一次组件 resolve 的产物（[「show 的切片是组件选择」](../architecture.md#show-的切片是组件选择)），同值是构造保证，不是两套手写投影之间需要人工维持的纪律。JSON 是结构化审计面，可以保留 text 为注意力预算省略的字段、完整字符串与完整树，因此它是 text 的数据超集，不承诺两个形态包含完全相同的字段集合。

脚本消费走这里，不翻 `.niceeval/` 原始文件：读取面的选择、去重、时效口径都在 show 里实现过一遍，脚本自己扫目录必然复刻出第二套不一致的口径。需要比 show 视图更自由的读取时用 [`niceeval/results` 库读取面](../../results/library.md)，仍然不直接碰磁盘布局。

## 信封

```typescript
interface ShowJson {
  format: "niceeval.show";
  /** 破坏性形状变更时递增；新增可选字段不递增，消费方忽略未知字段。 */
  schemaVersion: 1;
  view: "leaderboard" | "compare" | "attempt" | "source" | "execution"
      | "timing" | "usage" | "diff" | "history" | "stats";
  /** 本次调用解析后的范围回显。 */
  scope: {
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
- **范围含多个 attempt 时**，逐 attempt 组件的 `data` 是该组件 `*Data` 产物的数组，排序与 text 面分节同序（experimentId、evalId、attempt 序）；text 面的节头与合计行是渲染面派生，不进 `data`——消费方从数组自行聚合，聚合口径与 text 合计一致（缺失不计入、见各组件声明）。scope 级切片（leaderboard / compare / stats）的 `data` 本身就是聚合视图，恒为单个对象。
- 错误路径与 text 面一致：无匹配、用法冲突、零可读结果按同样的判定非零退出，错误信息走 stderr，不输出半个 JSON。
- 字符串值忠实转发落盘内容：终端形态的列宽截断、卡片预览预算**都不适用**；落盘时已被 [256 KiB 上限](../../results/architecture.md#大值截断)截断的值带原样的 `truncated` 标记，`--json` 不追溯还原也不二次截断。

### 通用 attempt 投影

多个 view 的 `data` 内部仍需要引用具体某次 attempt——不是每个引用点都值得各自重新声明 `AttemptRecord` 与归属身份的组合，因此这份投影收在信封层，供组件自己的 `*Data` 声明复用或收窄：

```typescript
/** attempt 的通用投影：AttemptRecord 全字段 + 归属身份。 */
type AttemptJson = AttemptRecord & {
  experimentId: string;
  /** 所属（或携带来源）快照的 startedAt。 */
  snapshotStartedAt: string;
};
```

字段名复用 [Results 落盘类型](../../results/architecture.md)，不为 JSON 输出发明第二套命名；派生量（通过率、delta 等）是显式命名字段，与落盘事实可区分——这条命名纪律由各组件的 `*Data` 声明履行，本页不重复定义。

## `data`：按 view 找组件声明

`data` 字段不是 show 另起的第二套形状：多数 view 输出对应报告组件 resolve 后的 `*Data`，text 面消费同一份产物（组件如何对应到每个切片见[「show 的切片是组件选择」](../architecture.md#show-的切片是组件选择)）。逐字段形状因此单源在组件自己所在的分篇，本页只维护「view → 声明位置」的指针，不重复声明：

| `view` | `data` 单源 |
|---|---|
| `leaderboard` | `experimentListData`（[Library · 实体列表](../components/entity-lists/README.md)）+ `scopeSummaryData`（[Library · 概览组件](../components/summaries/README.md)） |
| `compare` | `deltaTableData`（[Library · Metric Views](../components/tables/README.md)） |
| `attempt` | `AttemptDetail` 装配的区块 `*Data` 全集（[Library · Attempt 详情](../components/attempt-detail/README.md)「公开组件集」） |
| `source` | `attemptSourceData`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `execution` | `attemptConversationData`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `timing` | `attemptTimelineData`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `usage` | `usageTableData`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `diff` | `attemptDiffData`（[Library · Attempt 详情](../components/attempt-detail/README.md)） |
| `history` | [`--history`](history.md)「分节与行内字段」：这个切片不进入组件模型，直接投影 Results evidence（[切片表](../architecture.md#show-的切片是组件选择)未列出它） |
| `stats` | `stabilityMatrixData`（[Library · Metric Views](../components/tables/README.md)） |

## 边界

- 终端渲染面的注意力预算——卡片预览、`--timing` 80 detail node、列宽截断——不适用于 `--json`：这些是对应组件 text 渲染面的选项，JSON 面恒为完整 resolve 产物（[切片表](../architecture.md#show-的切片是组件选择)）。`--timing` 的 JSON 输出等价 `--timing=full` 的节点集合。
- `--expand` 与 `--json` 组合是用法错误：JSON 形态本来就不截断卡片，没有可展开的东西。
- 与 `--report` 互斥：报告树表达「怎么看」，`--json` 输出「是什么」（[范围契约](../show.md#选择结果范围)）。

## 相关阅读

- [Reports Architecture · show 的切片是组件选择](../architecture.md#show-的切片是组件选择) —— 每个 view 对应哪个组件、为什么两面同值是构造保证。
- [Results Architecture](../../results/architecture.md) —— 被复用的落盘类型形状。
- [Results Lib](../../results/library.md) —— 需要自由组合读取时的库入口。
