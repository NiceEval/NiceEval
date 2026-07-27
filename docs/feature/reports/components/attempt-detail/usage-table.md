# `AttemptUsage`

把一个 attempt 的用量摊成一行：判定、轮数、工具调用数、token 拆分与成本。没有 usage 时零输出。区块在整体装配里的位置见[公开区块集](README.md#公开区块集)。

## 组装口径（单源）

它是 show 与 view 里凡出现 usage 数字的地方——attempt 详情首页的单行 `usage:` 摘要、`--usage` 表的每一行、对照矩阵的用量列、`--execution` turn 头行——共同的组装口径与数据来源，事实来自两处、不混淆：

- **行为计数来自标准事件流**：轮数（`turns`）与工具调用数（`toolCalls`）从 `events.json` 派生，与 [`o11y.json` 行为摘要](../../../record/architecture.md#o11yjson)同源。
- **token 与请求计数来自落盘 `Usage`**：字段契约见 [Record · Usage](../../../record/architecture.md#usage)。每个字段只在协议真实提供时存在；`requests` 是真实发生的模型请求数，协议不提供就整个不显示——绝不显示一个凑数的 1。
- **`inputTokens` 就是未缓存输入**（token 桶恒互斥，契约见 [Record · Usage](../../../record/architecture.md#usage)）：`cacheReadTokens` 在场时 token 片段显示为 `X uncached in + Y cache read`，把拆分摆在明面；`cacheReadTokens` 缺席时显示 `X in`，不给没有拆分事实的数字贴 "uncached" 标注。缓存命中的输入同样计费，效率对比必须能看到这层拆分。

text 面的单行装配形态——attempt 详情首页的 `usage:` 行就是这一形态本身，不是它的近似摘要：

```text
usage: 6 turns · 21 tool calls · 62.3k uncached in + 942.6k cache read / 6.7k out · 24 requests · $1.14
```

某段事实缺失时对应片段整段省略，剩余片段保持顺序；全部缺失时整行不出现，与组件表「没有 usage 时零输出」同一条规则。

`AttemptUsage` 消费 `AttemptSnapshot`，字段名与落盘 `Usage`、事件派生量、attempt 身份字段保持一致，
不为展示发明第二套命名：

```ts
interface AttemptSnapshot {
  locator: AttemptLocator;        // 内含 experimentId / evalId / attempt 身份
  verdict: Verdict;
  points?: number;
  possiblePoints?: number;
  durationMs?: number;
  turns?: number;                // 事件流派生；无 events 时省略
  toolCalls?: number;
  usage?: Usage;                 // 落盘原样，字段契约见 Record · Usage
  costUSD?: number;
  error?: AttemptError;
}
```

`show --usage` 的多行用量表是同一事实投影按 attempt 逐条映射后的宿主装配：范围内每个 attempt
各贡献一份 `AttemptSnapshot`，分节、排序、合计行与占位规则属于宿主机器，装配细节见
[`--usage`](../../show/usage.md)。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
