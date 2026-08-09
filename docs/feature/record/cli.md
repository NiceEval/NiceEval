# Record CLI

bundled CLI 的默认 Record root 是 <code>&lt;project&gt;/.niceeval/record/</code>。传入 <code>--record</code> 时，参数就是实际 Record root；CLI 不补接任何子目录。

所有会打开 Record 的命令都要求目录停稳。reader 从选择 Sample 到 <code>buildReportInput()</code> 完成占用独占 lease；它不与 writer 或人工编辑并发。lease 释放后的 Report execute、server 与静态站写入不再访问 Record，也不阻止下一项 root 操作。

## 选择 Run

<code>show</code> 和 <code>view</code> 只从明确的 Run selection 形成 Sample。它们不接受独立 Attempt selector。

```text
niceeval show --run <runId> [--run <runId> ...]
niceeval show --latest
niceeval view --run <runId> [--run <runId> ...]
niceeval view --latest
```

<code>--run</code> 可重复，每次增加一个显式 Run；重复 identity 去重。

选择 latest 时，CLI 对每个目标 Experiment 只考虑有 <code>completedAt</code> 的 Run，并在组内按 <code>completedAt</code>、<code>runId</code> 升序排列后取最后一项。<code>--latest --experiment &lt;id&gt;</code> 把具名 Experiment 放入 latest 目标集合；省略 <code>--experiment</code> 时，目标来自可读 Run 核心。

目标集合为空或任一目标没有完成 Run，都返回 <code>sample-latest-unavailable</code>。未完成 Run 必须通过 <code>--run</code> 显式指定。

latest 必须证明候选集合穷尽。任一 Run 无法可靠读取排序核心时，CLI 返回 <code>sample-latest-indeterminate</code>，不静默跳过后选择较旧 Run。显式 <code>--run</code> 不读取未选择 Run 的内容；此时 <code>--experiment</code> 只在形成 Sample 后收窄。

Run identity、slot identity 和路径都先经 reader 验证。Attempt 详情是已选 Sample 中的参数化 Report page，例如 <code>--run &lt;runId&gt; --page attempt-&lt;attemptId&gt;</code>；它不能越过 Sample 直接打开任意 Attempt。CLI 不从目录名称、显示文本或时间猜测目标。

## show 与 view 的接线

<code>show</code> 与 <code>view</code> 共用同一条数据路径。

```text
RecordReader
    ↓
core-only Sample → ReportPlan
    ↓
composition adapter → ReportInput
    ↓
ReportExecution
    ↓
terminal output or web page
```

<code>show</code> 选择适用的 detail，并将 unavailable 与 unsupported 原样展示。<code>view</code> 消费相同的 ReportExecution。只有 composition adapter 接收 reader；Report runtime 从不打开 Record 路径。

页面遇到被请求的 invalid 通道时失败，并显示具名 issue。被请求的 unavailable 或 unsupported 通道保留为可见状态；它们不被渲染成零、空数组或失败 Verdict。

未请求的未知或 invalid 通道不会阻止无关 detail、Sample 或静态 Report export。未知 event 造成的 partial decoding 也必须作为局部信息呈现。

## root 与格式反馈

CLI 将以下问题分开反馈：

| code | 含义 | 下一步 |
|---|---|---|
| <code>record-root-missing</code> | 指定 root 不存在 | 检查项目或 <code>--record</code> |
| <code>record-root-busy</code> | 同一 root 正被另一项操作使用 | 等它结束，或指定其它 Record root |
| <code>record-format-invalid</code> | 根文件不是 <code>niceeval.record</code> | 指向正确的 Record root |
| <code>record-core-invalid</code> | 根级 <code>record.json</code> 或保留布局无效 | 修复根文件与具名 issue |
| <code>sample-latest-indeterminate</code> | 某个 Run 损坏，无法穷尽 latest 候选 | 修复具名 Run 或显式选择 |
| <code>sample-run-membership-invalid</code> | 已选 Run 有 expected slots 之外的 Member | 修复该 Run 的 members 目录 |
| <code>CoreRead.invalid</code> | Run、Member 或 Attempt 核心无效 | 按 Sample/slot 中的具名 issue 修复 |
| <code>ChannelRead.invalid</code> | 页面需要的通道无效 | 按其中的 issue 修复具名 descriptor 或文件 |

历史 Results 系列的格式不属于 <code>niceeval.record</code>。CLI 只报告格式不符，不显示迁移引导。

## owner-aware clean

<code>clean</code> 只删除明确指定 writer 的临时目录。

```text
niceeval clean --record <record-root> --writer <writerId>
```

命令先确认目录已停稳，再只检查和删除 <code>.tmp/&lt;writerId&gt;</code>。它不会扫描并删除其它 writer 的目录，不删除正式 Run 或 Attempt，也不认领 <code>.niceeval</code> 的 sibling。

无法确认 owner、目录仍被使用、路径不合法或目标不是 orphan 时，命令失败并保留现场。正常 writer 退出应自行删除其临时目录；clean 只处理崩溃遗留。

## Invocation 收尾

Runner 建立 Invocation 后，通过 <code>InvocationReceipt</code> 返回 invocation identity、Run identity、起止时间和 completion。CLI 不把 locator、Verdict、usage、cost 或计数复制进 receipt。

用户需要运行细节时，使用 <code>show</code> 或 <code>view</code> 重新读取停稳 Record。静态分享使用 Reports 的自包含 export，而不是从一个 Record 向另一个 Record 传输目录。
