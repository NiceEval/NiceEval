# Reports Calculations

Calculation 把已经形成的 Channel typed views 变成跨 owner 读数。它不拥有 Channel、不读取 Record，也不改变 `AnalysisSample` 的选择与分母。

## 声明

作者先定义 typed Channel projector，再用 `RecordProjection` 声明 logical access：

```ts
const checkedChannel = Either.getOrThrow(defineJsonChannel({
  owner: "attempt",
  name: "com.example.commands-checked",
  schemaId: "com.example.commands-checked/v1",
  schema: CommandsCheckedSchema,
}));

const checkedProjector = defineJsonChannelProjector({
  owner: "attempt",
  channel: checkedChannel.name,
  output: checkedViewCodec,
  cases: [{
    schema: checkedChannel,
    project: (payload) => Either.right(payload.value),
  }],
});

const checked = attemptSlotProjection(checkedProjector);

const checkedCount = defineCalculation({
  id: "checked-count",
  inputs: { checked },
  completeness: "allow-partial",
  output: checkedCountCodec,
  calculate({ sample, inputs }) {
    return calculateCheckedCount(sample, inputs.checked);
  },
});
```

Calculation 以显式 `id` 提供安全诊断定位，再以 object identity 注册进 `defineReport`。作者不创建 ID registry、底层 owner request 或宿主去重表。

每个 Calculation 必须明确：

1. 所需 `RecordProjection` declarations；
2. `allow-partial` 或 `require-complete`；
3. 哪些 Sample slots 属 denominator；
4. 如何形成 observed、value 与 issues。

callback 只能读取已经形成的 projected inputs。它不能按某个 payload 字段临时请求另一 Channel。

## 完整度 policy

| policy | 可计算条件 | 输出要求 |
|---|---|---|
| `allow-partial` | Host 已形成穷尽 `ProjectedSample`；recorded data problems 可以存在。 | 调用公式，并保留 partial、observed、denominator 与 issues。 |
| `require-complete` | 每个 required logical entry 的 Core、collection、decoding 与 value limitations 都完整。 | 任一条件不满足时不调用作者公式，形成 `data-unavailable`。 |

`invalid` 是 recorded data problem，不是 callback defect。`allow-partial` 可以用同一 ProjectedSample 中其它成功 entries继续公式；`require-complete`不调用。没有请求它的 Calculation不读取也不受影响。

`unavailable` 与 `unsupported` 必须进入明确 reasons；不能用零、`null` 或空数组代替。

## 分母与 slot 状态

`AnalysisSample.slots` 给出收窄后的完整分母：

| slot 状态 | observed | denominator |
|---|---|---|
| `included` 且 input available | 按公式计入。 | 计入。 |
| `included` 且 input partial | 只有 `allow-partial` 可计成功部分。 | 计入。 |
| `not-recorded` | 不计入。 | 计入。 |
| `core-invalid` | 不计入并保留 issue。 | 计入。 |
| `excluded` | 不计入。 | 不属于收窄后的分母。 |

例如 denominator 100，只有 20 个 owner 形成可用 commands value：

```text
commands.checked
value:       20
observed:    20
denominator: 100
state:       partial
```

页面必须显示 `20 / 100 · partial`。它不能把 20 改写成完整总体。

pairwise Calculation 还要声明 pairing key 与可比较条件。任一侧缺失 required input 时，不能无声丢弃 pair；结果保留未形成 pair 的数量与原因。

## Pass Eval 与 Score Eval

Run-owned `niceeval.evaluations/v1` 使用 `evaluationKind: "pass" | "score"`。所有 Attempt 都有 terminal Verdict；Score Eval 另外有 score。

Report 按 evaluation kind 建立不同聚合：

- pass rate 的 denominator 只包含 Pass Eval slots，并读取 Verdict；
- score summary 的 denominator 只包含 Score Eval slots，并读取 score；
- terminal errored/skipped/gate-failed 状态仍从 Score Eval 的 Verdict 显示；
- 两种 denominator 与数值不能相加。

`points` 是 Assertion 对 Score Eval 的分值贡献，不是第三种 evaluation kind。

缺失或 invalid evaluations manifest 时，依赖分类的 Calculation 按 completeness形成partial或data-unavailable；不能回读当前源码或默认成Pass Eval。

## 三条完整度轴

Calculation 分别保留：

1. envelope 的 collection complete/partial；
2. decoder/projector 的 decoding complete/partial；
3. typed value 自己的 sampled、redacted、truncated 等 limitations。

任一轴 partial 都要求 `allow-partial` 的显式标记，或使 `require-complete` 不执行。unknown event 造成的 decoding partial 不能改写持久 collection state；未采集也不能伪装成 decoder error。

## 报告旁算法

领域特有的质量、成本、趋势、配对差异和成绩单算法属于使用它的 Report module。只有多个 Report 共享相同 inputs、分母、公式与状态语义时，才把算法提升为公开 Calculation。

Page、Chart、terminal text 与 Download 消费同一个 `ReportCalculationResult`。它们不各自重新 projection、重算或按呈现形态调整分母。Author-specific Value只在callback所在进程内存在；最终`ReportExecution`把它exact encode并擦除成host-owned portable data。

## 相关阅读

- [Library](library.md#calculation)：作者 API 与结果类型。
- [Architecture](architecture.md#completeness-与局部隔离)：局部状态。
- [比较质量与成本](use-case/比较质量与成本.md)：比较 Report。
- [核对通道完整度](use-case/核对通道完整度.md)：partial 的完整路径。
