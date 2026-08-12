# Reports Calculations

Calculation 把已经形成的 `ProjectedSample` 变成跨 owner 读数。它不拥有 Attachment、不读取 Record，也不改变 `AnalysisSample` 的选择与分母。

## 声明

作者先定义 typed `RecordAttachmentProjector`，再用 `RecordProjection` 声明 logical access：

```ts
const checkedProjector = defineRecordAttachmentProjector({
  attachment: commandsCheckedAttachment,
  project: ({ payload }) => checkedViewFrom(payload),
});

const checked = attemptSlotProjection(checkedProjector);

const checkedCount = defineCalculation({
  id: Either.getOrThrow(reportComponentId("checked-count")),
  inputs: reportInputs({ checked }),
  completeness: "allow-partial",
  calculate({ sample, inputs }) {
    return calculateCheckedCount(sample, inputs.checked);
  },
});
```

Calculation 以显式 `id` 提供安全诊断定位，再以 object identity 注册进 `defineReport`。作者不创建 ID registry、底层 owner request 或宿主去重表。

每个 Calculation 必须明确：

1. 所需 `RecordProjection` declarations；
2. `allow-partial` 或 `require-complete`；
3. 公式怎样从 `AnalysisSample` 与 projected inputs 形成 `observed`、`denominator` 与 issues。

callback 只能读取已经形成的 projected inputs。它不能按某个 payload 字段临时请求另一份 Attachment。

## 完整度 policy

| policy | 可计算条件 | 输出要求 |
|---|---|---|
| `allow-partial` | Host 已形成穷尽 `ProjectedSample`；Attachment data problems 可以存在。 | 调用公式，并保留 partial、observed、denominator 与 issues。 |
| `require-complete` | 每个 required logical entry 的 Core、decoding 与 value limitations 都完整。 | 任一条件不满足时不调用作者公式，形成 `data-unavailable`。 |

`invalid` 是 Attachment data problem，不是 callback defect。`allow-partial` 可以用同一 ProjectedSample 中其它成功 entries 继续公式；`require-complete` 不调用。没有请求它的 Calculation 不读取也不受影响。

`unavailable` 与 `unsupported` 必须进入明确 reasons；不能用零、`null` 或空数组代替。

## 分母由 Calculation value 返回

`AnalysisSample.denominator` 与 `ProjectionCoverage.sample.denominator` 都是 Sample-wide 的 slot denominator，不因 Attachment 状态改变。它们不是 Calculation 的业务 denominator；host 不从 coverage、entry 数或 access count 推导 `observed` / `denominator`。

例如 denominator 100，只有 20 个 owner 形成可用 commands value：

```text
commands.checked
value:       20
observed:    20
denominator: 100
state:       partial
```

页面必须显示 `20 / 100 · partial`。它不能把 20 改写成完整总体。`observed`、`denominator` 与 `state` 都由 Calculation value 自己返回，host 只把它原样呈现。

pairwise Calculation 还要声明 pairing key 与可比较条件。任一侧缺失 required input 时，不能无声丢弃 pair；结果保留未形成 pair 的数量与原因。

## 报告旁算法

领域特有的质量、成本、趋势、配对差异和成绩单算法属于使用它的 Report module。只有多个 Report 共享相同 inputs、公式与状态语义时，才把算法提升为公开 Calculation。

Page、Chart、terminal text 与 Download 消费同一个 `ReportCalculationResult`。它们不各自重新 projection、重算或按呈现形态调整分母。Calculation 不依赖另一个 Calculation；共享公式使用普通纯函数。

## 相关阅读

- [Library](library.md#calculation)：作者 API 与结果类型。
- [Architecture](architecture.md#completeness-与局部隔离)：局部状态。
- [比较质量与成本](use-case/比较质量与成本.md)：比较 Report。
- [核对 RecordAttachment 完整度](use-case/核对RecordAttachment完整度.md)：partial 的完整路径。
