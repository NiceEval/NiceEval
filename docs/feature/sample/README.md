# Sample：Report 消费的冻结分析分母

[Record](../record/README.md) 保存 immutable Run。CLI 的内部 host 从 opaque Record 选择 Run，
形成一份纯 `AnalysisSample`，再交给 Report 作者 callback。应用代码不能取得 Record reader、
selection handle，或用 Sample 重新打开持久化 I/O。

```text
opaque Record
    │ internal selection
    ▼
AnalysisSample（纯值）
    │ official projection declarations
    ▼
Report Calculation / Page
```

`AnalysisSample` 保存 selection 已建立的 Run / Slot 分母、Member / Attempt 精确引用，
以及 `included`、`not-recorded`、`core-invalid`、`excluded` 四态。`explicit-runs` 保留具名
Run 的完整 expected SlotId；`project-current` 的框架只包含身份仍匹配当前目标的 slot。
Sample 不写回 Record，也不包含路径、文件句柄或延迟读取能力。

## Selection 与 reuse planning 分开

内部 analysis selection 回答“这次 Report 分析哪些已发布 Run”。reuse planning 回答
“当前 ExecutionTarget 的哪些 Slot 可以沿用，哪些是 gap”。Report 不接收 execution gap，
planner 也不把历史 Sample 的 `not-recorded` 当成待执行任务。

CLI 内建 `explicit-runs` 与 `project-current` 两种 selection。前者读取具名历史 Run；
后者把当前项目目标与既有 Evaluation、Eligibility 事实比较，并保留全部仍匹配的 Run slot。
输入或配置身份已经变化的普通结果不进入当前 Sample，但仍能通过 `--run` 审计。

Run-owned Membership Provenance 写明的 `accepted` Member，是操作者对当时 current target
的人工采用。`project-current` 按该 action 纳入对应 reference，不再要求源 Attempt 的旧
Eligibility 与当前身份相等。selection 只读 Record，不迁移或改写历史事实。

## 公开值边界

`niceeval/report` 与 `niceeval/analysis` 只公开 immutable Sample 值、稳定 identity、codec、
纯 narrowing 与 selection summary 类型。作者可以在 callback 中读取或收窄已有 Sample，
但不能自行选择 Record、读取 raw Attachment，或构造一个带 I/O 能力的 handle。

RecordAttachment 的 unavailable、migration-required、migration-unavailable、unsupported 或
invalid 不自动改变 Slot 的 Core state。内部 projection runtime 把这些状态投影为
Report 可穷尽处理的纯结果。

## 入口

- [Library](library.md) —— 公开纯值、codec 与 narrowing。
- [局部执行后的分析](use-case/partial-rerun.md) —— origin / reference 怎样进入同一分母。
- [收窄样本](use-case/收窄样本.md) —— 怎样显式排除已有 Sample 的成员。
- [Projection](../projection/README.md) —— Report 怎样声明官方 typed projection。
- [Reuse planning](../experiments/cache.md) —— 当前目标怎样形成 reuse 与 gap。
