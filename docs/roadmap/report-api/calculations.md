# 报告作者 API —— 计算边界

本篇定义哪些计算属于公共内核，哪些只是某份报告里的普通函数，
以及组件目录的准入边界。
作者 API 总览见 [README](README.md)，完整调用形状见 [Library](library.md)。

## 结论

公共计算内核只保留五类值：

```ts
mean;
sum;
min;
max;
percentile(0.95);

rollup;
aggregate;
metricValue;
evidenceRow;

agent;
experiment;
evalId;
model;
run;
verdict;

passRate;
costUSD;
durationMs;
// 其它官方与用户 Calculation
```

其中：

- reducer 折叠一组数字；
- `rollup()` 把单 Attempt 取值函数变成 Calculation；
- `aggregate()` 在 Sample 上按分组函数执行多个 Calculation；
- 分组函数和 Calculation 都是普通函数值。
- `metricValue()` / `evidenceRow()` 只负责复杂算法的证据结果终结，
  不替算法定义公式。

公共内核不提供 `history()`、`delta()`、`stability()`、`pivot()` 或 `frontier()`。

## Reducer 是函数，不是字符串

`rollup()` 的两个阶段接收 Reducer 函数值：

```ts
const p95DurationMs = rollup(
  attemptDurationMs,
  {
    withinEval: percentile(0.95),
    acrossEvals: mean,
  },
);
```

首版提供 `mean`、`sum`、`min`、`max` 与 `percentile(p)`。
省略阶段时默认 `mean`；null 在进入 Reducer 前排除，空集合仍为 null。

不提供通用 `count` 与 `countDistinct`：

- count 必须先说明数 Attempt、Eval、Run 还是非空读数；
- distinct 必须说明 identity，以及跨 Eval 是否继续去重；
- 各 Eval 的 distinct count 相加不等于全局 distinct count。

参与聚合的 Attempt 数可以用具名 Calculation
`observedAttemptCount` 表达。
Eval、Run 或 Experiment 数量则从 Sample 对应事实计算；
这样单位、identity 与 coverage 含义都留在定义中。

`percentile(p)` 被保留，是因为耗时尾部读数有稳定需求，
并且两级语义可以显式写出来。
它使用排序后相邻值的线性插值，参数必须位于 `[0, 1]`。

## Sample 不增加 map

Sample 只负责表达比较总体、覆盖和选择问题。
它已有两个不可互换的转换：

```ts
sample.scope({ experiments, evals });
sample.filter(predicate);
```

`scope()` 改变总体，`filter()` 删除观测。
两者同步维护 attempts、historyAttempts、runs、coverage 与 issues。

Sample 不增加：

```ts
sample.map(...);
sample.groupBy(...);
sample.reduce(...);
sample.pipe(...);
```

这些方法会产生一个无法回答“还是不是 Sample”的中间值。
一旦 map 改变 Attempt 形状，coverage 与 issues 不再知道怎样随行；
一旦 groupBy 改变粒度，Sample 层就开始承担 Reports 的聚合职责。

作者需要普通数组时显式取值：

```ts
const attempts = sample.attempts;
const historyAttempts = sample.historyAttempts;
```

从此使用 JavaScript 的 `map`、`filter`、`toSorted` 与 `slice`。
需要保住两级聚合和 refs 时，不对数组手写 reduce，而是把 Sample 交给 `aggregate()`。

## 报告旁算法不退出证据契约

“不进入核心计算目录”只表示没有通用公式，
不表示可以返回没有来源的 number。

非 rollup 算法必须使用：

```ts
metricValue({
  value,
  samples,
  total,
  basis,
  evidence,
});

evidenceRow({
  dimension,
  metric,
});
```

`metricValue()` 强制算法声明分子、分母口径和相关 Attempt；
`evidenceRow()` 产生图表需要的行级 refs。
`aggregate()` 内部也使用同一结果终结规则。

因此保障分成两层：

- `rollup()` / `aggregate()` 保障常见两级标量聚合的公式；
- `metricValue()` / `evidenceRow()` 保障复杂算法不会漏掉
  samples、total、basis 与 refs。

后一层不能证明作者的 delta 或 stability 公式正确，
但能让错误公式仍然可复算、可下钻，并让缺失分母显式出现。

## `history` 不是函数

历史已经是 Sample 上的普通值：

```ts
sample.historyAttempts;
```

因此不提供：

```ts
history(sample, options);
```

需要一幅历史柱状图时，page render 直接从 historyAttempts 计算 points：

```tsx
const points = await historyPoints(sample.historyAttempts);

return (
  <Bars
    points={points}
    x="run"
    y="passRate"
  />
);
```

`historyPoints()` 是这份报告里的普通函数。
它直接读取 AttemptHandle，并用公开 reducer 实现这张图声明的历史口径；
它不需要伪装成一个可供 `aggregate()` 执行的通用 Calculation。
返回的每个历史点仍通过 `metricValue()` / `evidenceRow()` 构造。
如果三个以上独立报告重复同一套正确性规则，再评估它是否值得成为公开工具。
在重复出现之前，不能因为当前产品有一张历史页就先造一个公共概念。

## `scoreboard` 是模式，不是 API

成绩单有固定题集分母，并区分 notRun、unscorable 与真实零分。
这与 `aggregate()` 的空值策略相反：
coverage 缺口在聚合里不冒充零，在成绩单里必须按 0 分占住分母。
因此成绩单不是 `aggregate()` 的别名。

它也不预留一个 `scoreboardRows()` 公开函数。
权重、满分、分组这些评分表意见没有跨报告的统一语义，
一个通用签名只是把分歧藏进 rubric 类型；
这与 `stability()` 被拒绝的理由相同。

具体成绩单在报告旁手写，只依赖公共内核：

```ts
const perQuestion = await aggregate(sample, {
  by: { evalId, agent },
  values: { passRate },
});

// 报告旁代码对 rubric 补零、加权，
// 每格与总分经 metricValue() 交出 basis: "eval" 的固定 total，
// 总分 evidence 直接复用各题格 MetricValue 的 refs。
```

缺题仍占 total，已有 Attempt 全部进入 refs；
不能先删除 notRun 行再对剩余结果求平均。
三个以上独立报告重复同一套 rubric 语义时，
再按下方计算准入判据评估升格。

## `delta` 不是内核

成对差异必须先按 Experiment × Eval 对齐，再计算差值，最后跨 Eval 聚合。
两个总平均数直接相减不等价。

这条正确性值得由一个普通函数封装：

```ts
async function pairedDelta(
  sample: Sample,
  options: DeltaOptions,
): Promise<readonly DeltaPoint[]> {
  // 显式配对，并用 metricValue / evidenceRow 交出结果。
}
```

但它不进入顶层计算内核：

- 只有成对实验比较使用；
- 输出形状由具体报告决定；
- baseline / candidate 的选择语义尚未证明能跨报告稳定复用；
- `aggregate()` 不需要理解“候选”和“基线”。

内建差异报告与用户报告必须能调用同一份 `pairedDelta()` 实现。
它可以与该内建报告一起具名导出，或先作为公开示例存在；
不能拥有绕过公共 reducer 和证据结果构造器的私有计算路径。
配对不完整时仍以 `basis: "pair"` 保留固定 total，
已有一侧 Attempt 进入 refs，不能静默删行。

## `stability` 不是内核

“稳定性”可能指方差、跨 Run verdict 翻转、置信区间、
连续失败次数或某个产品阈值。
一个叫 `stability()` 的函数会把尚未统一的问题伪装成统一概念。

具体报告直接写普通函数：

```ts
async function stabilityPoints(
  attempts: readonly AttemptHandle[],
): Promise<readonly StabilityPoint[]> {
  // 明确公式与阈值，并返回 EvidenceRow。
}
```

函数可以具名导出、单独测试和被用户 import。
只有公式、输入与输出在多个报告之间真正相同后，才考虑升为公共工具。

## `pivot` 没有必要

`pivot()` 只是把长数组换成矩阵形状。
它不读取 Sample，不保护聚合正确性，也不产生新的领域事实。

报告可以使用普通 JavaScript：

```ts
const columns = [...new Set(points.map((point) => point.agent))];
const rows = Object.entries(
  Object.groupBy(points, (point) => point.eval),
).map(([evalId, values]) => ({
  eval: evalId,
  values: Object.fromEntries(
    values.map((point) => [point.agent, point.passRate]),
  ),
}));
```

如果矩阵组件需要固定输入形状，转换函数属于该组件 package，
例如 `toMatrixRows(points)`，不属于 Sample 或计算内核。

## `frontier` 没有必要

Pareto frontier 是默认质量—成本散点的一种呈现选择。
散点本身只需要全部 points：

```tsx
<Scatter
  points={performance}
  x="costUSD"
  y="passRate"
/>
```

需要强调前沿时，默认报告可以局部计算：

```ts
const highlighted = paretoFrontier(performance, {
  minimize: "costUSD",
  maximize: "passRate",
});
```

`paretoFrontier()` 是普通数组算法。
它不进入 `niceeval/report` 顶层入口，也不改变 Scatter 的输入协议。

## 报告组件不认识计算名

`Col`、`Table`、`Bars`、`Scatter` 与 `Stat` 只认识传入值：

```tsx
<Col>
  <Bars points={historyPoints} x="run" y="passRate" />
  <Scatter points={performance} x="costUSD" y="passRate" />
  <Table rows={performance} />
</Col>
```

组件不知道 Sample 派生 points 来自 `aggregate()` 还是局部函数，
只要求它们满足 EvidenceRow 契约。
完全不含 NiceEval 读数的外部标量序列使用 ExternalPoint 分支。
它们不认识 history、delta、stability、pivot 或 frontier。

这条边界保证新增一个分析问题时，先增加普通计算函数，
而不是扩张组件目录、Sample API 或框架查询语言。

## 计算的准入判据

一个新函数进入公共计算内核前必须同时满足：

1. 至少三个独立报告需要相同输入、公式与输出语义。
2. 普通 JavaScript 写法容易产生看起来正确但实际错误的结果。
3. 函数能用 Sample、AttemptHandle、Calculation 和普通结果值表达，
   不要求新的运行时注册协议。
4. 官方报告与用户报告调用同一个公开实现。

不满足四条时，函数留在使用它的报告旁边。

## 组件的准入判据

组件目录按渲染形状增长，不按领域问题增长。
一个候选组件只有三种合法出身，按顺序判定：

1. **原语。** 它的 text / web renderer 里有
   现有原语组合写不出的渲染逻辑。
   名字必须是形状词：`Waterfall`、`Conversation` 过，
   `Scoreboard` 不过——它渲染出来就是 `Table`。
   原语承担双面义务；
   web 能力找不到诚实的 text 降级时，
   它是宿主机器而不是组件。
2. **糖组件。** 恰好等价于
   「一个同步无 IO 的官方投影 + 一个原语」，
   展开式一行、公开可照抄，
   且 props 不含任何改变数值的选项。
   带 limit、阈值或排序缺省的候选是报告片段，写成普通函数。
3. **其余一切不是组件。**
   领域计算是函数，先留在报告旁，
   过上面四条判据才进公共内核；
   成品装配是具名 PageDefinition 或内建报告；
   呈现偏好是现有原语的显示属性。

一句话判据：领域名词只能命名函数或内建报告，不能命名组件。
