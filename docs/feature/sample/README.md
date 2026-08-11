# Sample：投影既有事实形成分析范围

[Record](../record/README.md) 保存 immutable Run 事实。Sample 功能提供具名 analysis projector，从一个 frozen `RecordReader` 中选择既有 Run，形成 Reports 和脚本可以继续组合的 core-only `AnalysisSample`。

`AnalysisSample` 不写回 Record，也不是持久化文件。再次执行 projector 时，它按同一公开契约重新读取 Record 当时的核心身份、membership 和引用。业务通道等 ReportPlan 形成后才按需读取。

## 分析与执行是两条投影

```text
RecordReader ── explicit-runs / latest analysis projector ──→ AnalysisSample ──→ Reports

RecordWriteSession.view ── project-target execution projector ──→ ExecutionProjection ──→ planner
```

`AnalysisSample` 只表达既有 Run 的分析分母。分析样本状态是 `included | not-recorded | invalid | excluded`。`ExecutionProjection` 属于 [Experiments](../experiments/cache.md)，只表达当前 ExecutionTarget 的 `reuse | gap`。

两者可以在实现内部复用 Attempt 读取，但不共享一个公开 slot 联合。Reports 不能接收 execution gap，planner 也不能把历史 Run 的 `not-recorded` 当作待执行任务。

## 具名 analysis projector

Sample 提供两种内建 analysis projector：

- `explicit-runs/v1`：按调用方给出的 `runIds` 精确选择历史 Run；
- `latest/v1`：按具名 latest policy 为每个目标 Experiment 选择最后完成的 Run。

`latest` 不是 Record 的 currentness，也不是 `AnalysisSample` 自带的隐含语义。它只是可替换、可具名的一种分析算法。调用方还可以实现其它 analysis projector，只要输出同一个公开 `AnalysisSample` 形状和稳定 provenance。

## Frozen 读取

carried 与 accepted Member 保留源 Attempt 引用。reader 沿已选 Member 冻结 dependency closure；origin Run 不进入 latest candidates 或分母。源 Attempt 因外部损坏而缺失时，该 slot 是 `invalid`，不是 `not-recorded`。

一次 projection 不会自动看见并发刚发布的 Run。重新打开 reader 后，新 projection 可以得到新的 candidateSet；已经形成的 `AnalysisSample` 仍是普通内存值。

`AnalysisSample` 不读取业务通道。一个通道 unknown、retired、缺失或损坏，不会让整个 slot 自动变成 `invalid`；slot 的 `invalid` 只描述核心 membership、identity 与引用错误。ReportPlan 形成后，composition adapter 才把被请求通道的 `ChannelRead` 放进 ReportInput。

## 范围

Sample 包含：

- analysis projector 的公开输入、输出和错误；
- expected-slot 完整分母；
- included、not-recorded、invalid、excluded 四态；
- 对既有 `AnalysisSample` 的纯内存收窄；
- projector identity 与安全归一化输入形成的 projection provenance。

Sample 不包含：

- 当前 Project Target 的复用资格或 execution gap；
- planner、scheduler、writer 或补执行策略；
- 可持久化的 Sample 包；
- 业务通道读取或 Report 计算；
- 跨 Record 隐含合并；
- reader、文件句柄、路径或延迟查询。

## 入口

- [Library](library.md) —— analysis projector、`AnalysisSample` 形状和构造入口。
- [局部执行后的分析](use-case/partial-rerun.md) —— executed、carried 与 accepted 怎样作为既有事实进入同一分母。
- [收窄样本](use-case/收窄样本.md) —— 怎样从既有 `AnalysisSample` 排除不需要的成员。
- [Experiments execution projection](../experiments/cache.md) —— 当前目标怎样形成 reuse 与 gap。
- [Reports](../reports/README.md) —— 怎样呈现和导出 `AnalysisSample`。
