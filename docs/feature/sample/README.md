# Sample：从已发布 Run 形成分析分母

[Record](../record/README.md) 保存 immutable Run。Analysis selection 从 frozen `RecordReader` 选择 Run，形成 Scope-bound `AnalysisSampleHandle`；其中的 `.sample` 是可以离线消费的纯 `AnalysisSample`。

```text
AnalysisSelectionRequest + RecordReader
                  │
                  ▼
           AnalysisSampleHandle
             │             │
             │ live        └─ .sample：关闭 reader 后仍可显示的纯值
             ▼
       Record Projection
```

`AnalysisSample` 不写回 Record。它保存 selected Run、完整 expected SlotId 分母、Member/Attempt 精确引用及 included、not-recorded、core-invalid、excluded 四态。

## Selection 与 reuse planning 分开

Analysis selection 回答“分析哪些已发布 Run”。reuse planning 回答“当前 ExecutionTarget 的哪些 Slot 可以沿用，哪些是 gap”。

```text
RecordReader ── analysis selection ──→ AnalysisSampleHandle

RecordWriteSession.view ── reuse planning ──→ ExecutionReusePlan
```

Report 不接收 execution gap，planner 也不把历史 Sample 的 not-recorded 当成待执行任务。

## 内建 selection

- `explicit-runs/v1`：精确选择调用方给出的 RunId；
- `latest-runs/v1`：使用 Run-owned Evaluation/Provenance Attachment，为目标 Experiment 选择最后完成的 Run。

Core 不保存 ExperimentId，因此 latest 所需业务分组来自 typed Attachment，而不是偷偷扩张 RunDocument。旧 Attachment 需要 migration 时，latest 返回具名 selection error；explicit selection 和其它 Core 读取仍可运行。

复杂自定义策略可以用 Record/Projection API 计算 RunId，再调用 explicit selection。v1 不公开一个可以绕过 Library 分母构造规则的 Sample builder。

## Frozen 读取

reference Member 保留源 Attempt 引用。origin Run 进入 dependency closure，但不因此进入 selected Runs 或分析分母。

一次 selection 不会自动看见并发刚完成的 Run。重新打开 reader 后才能得到新 snapshot。未完成 Run 从未进入 reader candidates，因此不会出现在 Sample。

RecordAttachment missing、migration-required、unsupported、invalid 或 partial 不自动改变 Slot 的 Core state。Projection 使用仍存活的 `AnalysisSampleHandle` 按需读取 Attachment；pure `.sample` 不能重新打开 I/O。

## 范围

Sample 包含：

- explicit/latest selection；
- expected SlotId 完整分母；
- included、not-recorded、core-invalid、excluded 四态；
- pure narrowing；
- pure `AnalysisSample` 与 live `AnalysisSampleHandle` 的能力边界。

Sample 不包含 reuse planning、writer、业务 Calculation、Report 页面或可持久化 Sample 文件。

## 入口

- [Library](library.md) —— selection、handle、Sample shape 与 narrowing。
- [局部执行后的分析](use-case/partial-rerun.md) —— origin/reference 怎样进入同一分母。
- [收窄样本](use-case/收窄样本.md) —— 怎样显式排除成员。
- [Projection](../projection/README.md) —— 怎样读取 selected owner 的 RecordAttachment。
- [Reuse planning](../experiments/cache.md) —— 当前目标怎样形成 reuse 与 gap。
