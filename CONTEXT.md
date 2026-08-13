# NiceEval

NiceEval 保存不可变评估事实，并让分析与报告从同一份事实形成可追溯结果。

## 运行与持久化

**Attempt execution**:
执行一个已经规划好的 gap，并形成一份不可变的 sealed Attempt outcome。它不选择历史事实、不决定
reuse，也不构造任何版本化持久格式。
_Avoid_: Record execution, Attempt writer

**Invocation coordination**:
在一次 Invocation 内组合 frozen Record view、target、reuse plan 与 Attempt execution；它穷尽处理
reference、gap、未派发与已完成 outcome，并在最后请求发布完整 Runs。
_Avoid_: Runner core, Record runtime

**Capture definition**:
第三方用 `MetricDefinition`、`ScoreDefinition` 或 `ArtifactDefinition` 声明事实含义的受限纯数据定义。
它不携带 Record schema、writer、converter、projection 或 host authority。
_Avoid_: Record schema, Generic event

**Producer identity**:
Capture 在运行前固定的 producer ID、behavior version 与 canonical config fingerprint。
它说明事实怎样产生；Metric 或 Score identity 说明事实是什么，两者不能互相替代。
_Avoid_: Source label, Plugin name

**Record migration plan**:
一次只读 preflight 对 exact Record snapshot、平台 converter set 与恢复条件形成的不可伪造迁移计划。它列出将迁移、保留或
无法解释的全部 family，但本身不授权写入。
_Avoid_: Migration config, Dry-run output

**Record migration authorization**:
application maintainer 针对一份 exact Record migration plan 作出显式恢复风险决定后，由 maintenance host mint 的一次性
authority。它不能跨 plan、runtime 或进程复用。
_Avoid_: Yes flag, Migration option

**Record migration receipt**:
Record migration durable 完成后的不可变结果，逐 family 说明 migrated、already current 或 preserved。失败或中断不产出
receipt。
_Avoid_: Migration log, Plan summary

**Capture obligation**:
把一个 Capture definition 与 Producer identity 绑定到实际 Attempt 的预注册义务。
它对每个 actual Attempt 恰好封口一次，不是无声明字符串写入或可选 writer capability。
_Avoid_: RecordAdapter binding, Write grant

**Total producer obligation**:
一个已注册 Capture obligation 对每个实际 Attempt 恰好产出 available、empty、unavailable 或 failed seal 的义务。
未封口、重复、foreign 或 late seal 是 producer contract violation；合法零值不能与 missing 合并。
_Avoid_: Optional write, Best-effort telemetry

**RecordAttachment value**:
一个 Record owner 下某份 RecordAttachment definition 的不可变事实实例。它包含该版本的 payload 与自有材料，
不是整个 Record，也不是 Analysis 派生值。
_Avoid_: Record value, Fact value

**Capture internal grant**:
host 从 Attempt 的 Capture obligations 推导出的内部 exact envelope command 集合。
它不出现在 Eval、Experiment、Plugin callback 或 TestContext，也不授予 migration 或任意 Attachment 写入。
_Avoid_: Public Record API, Owner-wide allowlist

**Record context lease**:
host 在当前 Run 或 Attempt 的开放生命周期内接纳 canonical RecordAttachment command 的内部 authority。它不进入
领域 SDK callback，也不跨 owner、session 或封口边界。
_Avoid_: Record writer, Eval context

**Record access runtime**:
一个 host operation 内为 canonical Record root 管理 snapshot generations、lock authority 与本地 verified
read cache 的 root-affine capability substrate。它不属于 durable Record，也不是自动刷新的 reader。
_Avoid_: Record connection, Record runtime, Live Record reader

## 分析与报告

**Analysis**:
在同一 frozen Record view 上固定分母、解释 owner-local facts、建立关系并形成 metric、coverage 与 evidence
values。它不写 Record，也不渲染页面。
_Avoid_: Query runtime, Report loader

**Analysis scope**:
从同一份 frozen Record view 选择的 Runs、完整 logical slots 与分母。
_Avoid_: Result set, Query context

**Logical slot**:
由 selected Run 与 slot ID 共同标识的一次样本位置；即使多个位置引用同一个 Attempt，它们仍是不同位置。
_Avoid_: Row ID, Attempt occurrence

**Selected Run**:
建立 logical slot universe、题型与分母的 Run。
_Avoid_: Current Run

**Origin Run**:
最初发布某个 Attempt 的 Run；它只说明 Attempt 的出处，不自动决定当前分析分母。
_Avoid_: Source Run

**Execution claim**:
Attempt 执行完成时保存的评定事实。
_Avoid_: Latest grading

**Grading claim**:
后续 grading Run 对一个 sealed subject 产生的 immutable 评定事实。
_Avoid_: Recomputed verdict, Latest claim

**Grading claim selection**:
在同一 frozen Record view 中显式选择产生 grading claims 的 Runs；它不改变 Analysis scope 的 logical
slots 或分母。
_Avoid_: Latest grading, Analysis selection

**Local projection**:
在同一 frozen Record view 中，将一份 owner-local RecordAttachment value 解释为 typed view。它不读取
第二份 Attachment，也不建立跨 Attachment 关系。
_Avoid_: Joined view, Report model

**Fact relation**:
在一个 Analysis scope 内，使用 exact owner 与 durable anchors 把多份 local projections 对齐到 logical slots 的
结构关系。它不根据数值容差判定 agreement 或 authority。
_Avoid_: Heuristic join, Metric result

**Derivation**:
从 Sample-aligned facts 或 relations 计算指标、coverage 与领域模型的可选责任。只有 host 管理其
dependency、去重或局部失败时，它才是独立 runtime layer。
_Avoid_: Projection, Page loader

**Analysis population**:
带 nominal identity、稳定 row identity 与穷尽规则的一组 Analysis members。grain 只是人读说明，不是字符串兼容协议。
_Avoid_: Result table, Grain string

**Analysis dimension**:
属于一个 Analysis population、用于分组或稳定标识的 typed field。它不能跨 population 自动 join。
_Avoid_: Group callback, Report field

**Analysis measure**:
属于一个 Analysis population，并声明 rollup、denominator、数值与 evidence policy 的 typed field。本次 value、coverage 与
refs 只存在于 materialized MetricValue。
_Avoid_: Report calculation, Numeric column

**Report sample**:
Page callback 获得的受限 `ReportSample`。它绑定 frozen Sample identity、选择说明与整体问题摘要，
但不能枚举 raw Run／Attempt、读取 Record、调用 projection 或改变 population。
_Avoid_: AnalysisSampleHandle, Record reader

**Report component**:
Report 中组合 closed Analysis rows 与既有 semantic primitives 的 component。它不读取 Record、不定义业务 measure，
也不改变 denominator。
_Avoid_: Analysis component, Record component
