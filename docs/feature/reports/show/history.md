# `--history`：一个 Eval 的固定执行时间轴

`niceeval show <eval 前缀> --history` 选择一个明确的历史 Sample 集合，并由 History target 的 ReportPlan 显示执行时间轴。
它不是 render 时扫描 Record 的便利通道。

## 计划与显示

history target 在 plan 中列出每个要显示的完整 AttemptRef、相应 membership provenance 与所需 Projector。
executor 生成开始时间、verdict、摘要、耗时、成本、verification 和 refs；text/web 只显示同一份结果。

每个 `experiment × eval` 组合形成一节，行按计划中稳定的历史顺序显示。
每行的 locator、record 和 adopted revision 一起构成下钻 identity，不能把 locator 当作唯一键。

## 与当前比较的分工

标准概览消费一份固定的输入 Sample。
历史 target 消费调用方明确列出的历史 Sample 或 `unionSamples()` 结果；它不依据 model、flags、时间或文件布局自动决定哪些旧成员仍可比。

因此读者可区分：同一明确成员集合中的执行变化，以及由选择策略本身造成的范围变化。

## 边界

- `--history` 与显式 `--report` 互斥，因为两者选择不同主 target。
- 无匹配、未知历史 instance 或无法生成计划时，show 非零退出并指出 Sample identity。
- 一行的 unavailable evidence 保留原始 causes 与 basedOn，不合成 verification，也不以空摘要代替。

## 相关阅读

- [Show](../show.md) —— target 和完整 AttemptRef。
- [Sample Library](../../sample/library.md) —— 历史选择与 unionSamples。
- [用例 · Experiment 历史](../use-case/分析/跟踪实验历史.md) —— 跨 Run 趋势的计划方式。
