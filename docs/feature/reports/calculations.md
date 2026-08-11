# Reports Calculations

Calculation 把 ReportInput 中已计划并读取的 facts 变成读数。它不拥有事实，不读取 Record，也不改变 `AnalysisSample` 的选择和分母。完整公开形状见 [Library](library.md#calculation)。

## 每项计算的声明

每个 Calculation 必须给出四项：

1. `id`；
2. `inputs` 中所有 required facts；
3. `completeness` policy；
4. 使用哪些 `AnalysisSample` slot，以及如何形成 observed 与 denominator。

页面直接读取通道时同样列出 `inputs`。不允许先在 render 中取到一个对象，再按对象字段决定临时读取另一个通道。

```ts
const checked = defineJsonFact({
  id: "commands-checked",
  owner: "attempt",
  name: "com.example.commands-checked",
  parse(document) {
    if (typeof document.value !== "number") {
      throw new Error("commands checked must be a number");
    }
    return document.value;
  },
});
```

```ts
const checkedCount = defineCalculation({
  id: "checked-count",
  inputs: [checked],
  completeness: "allowPartial",
  evaluate(input) {
    // 只读取 input.report 与 input.readRun/readAttempt(...)
    return {
      state: "available",
      value: 20,
      completeness: {
        state: "partial",
        observed: 20,
        denominator: 100,
        issues: [],
      },
    };
  },
});
```

上述值在页面写作 `20 / 100 · partial`。`20` 是 observed，`100` 是 `AnalysisSample` 分母；两者不可互换。

## 完整度 policy

| policy | 可计算条件 | 输出要求 |
|---|---|---|
| `allowPartial` | 已成功解码的 facts 足以执行公式。 | 保留 `partial`、observed、denominator 和 issues。 |
| `requireComplete` | 每个 required fact 的持久采集与本次解码均完整。 | 任一输入不完整、unavailable 或 unsupported 时返回 unavailable。 |

invalid 不是可选的不足数据。已请求 invalid 通道使该 Calculation 的输入失败，并显示 Record 给出的具名 issue。没有请求它的 Calculation 不读取也不受影响。

`allowPartial` 不允许把已解码子集伪装成完整总体。`requireComplete` 不允许用零、`null` 或空数组代替 unavailable。

## 分母与 slot 状态

`AnalysisSample.slots` 是每项 Calculation 的完整候选集合。

| slot 状态 | 对 observed 的影响 | 对 denominator 的影响 |
|---|---|---|
| `included` 且输入可用 | 可按公式计入。 | 计入。 |
| `included` 且输入 partial | 仅 `allowPartial` 可把成功部分计入。 | 计入。 |
| `not-recorded` | 不计入 observed。 | 计入。 |
| `invalid` | 不计入 observed，并保留 issue。 | 计入。 |
| `excluded` | 不计入。 | 不属于收窄后的分母。 |

pairwise Calculation 还要声明配对键与同时可比较的 slot 条件。任一侧缺少 required fact 时，pair 不能被无声丢弃；结果说明未形成 pair 的数量和原因。

## 采集完整度与解码完整度

`ChannelRead` 里的两条完整度轴表达不同事实：

- 持久采集完整度说明 Record 写入的集合是 complete、partial 还是 unavailable。
- 解码完整度说明本次 decoder 成功读取了多少既有内容。

Calculation 不合并这两条状态。任一轴 partial 都要求 `allowPartial` 的显式标记，或使 `requireComplete` unavailable。unknown event 造成的解码 partial 不能改写持久采集完整度；未采集也不能伪装成 decoder 错误。

## 报告旁算法

领域特有的质量、成本、趋势、配对差异和成绩单算法属于使用它的 Report 模块。它们仍要声明 inputs、policy、公式与页面文字。

只有当多个 Report 共享同一 facts、相同分母、相同 formula 与相同状态语义时，才把算法提升为公开 Calculation。通用组件只呈现 CalculationValue，不拥有公式，也不改变可用性。

## 页面呈现

数字、图表和下载文件都带相同的 CalculationValue。partial 值显示 observed、denominator 和 partial；unavailable 显示 reasons；unsupported 显示通道名称；输入失败显示 issues。

文字页面与网页页面使用同一 CalculationValue。它们不各自再次读取 facts，也不按展示形态调整分母。

## 相关阅读

- [Library](library.md#calculation)：Calculation、MetricCompleteness 与错误类型。
- [Architecture](architecture.md#通道状态只在请求处生效)：局部通道状态。
- [比较质量与成本](use-case/比较质量与成本.md)：比较 Report 的声明方式。
- [核对通道完整度](use-case/核对通道完整度.md)：20 / 100 partial 的完整路径。
