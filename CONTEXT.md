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

**Record adaptation**:
把某个领域已经封口的事实转换成该领域拥有的版本化 RecordAttachment。schema 版本与 migration
停在这里；事实生产者和消费者都不构造版本化 document。
_Avoid_: Runner serialization, Generic metadata

**RecordAttachment definition**:
一个事实 family 对 owner、name、全部 schema 版本、current 版本与相邻 migration policy 的完整声明。
它不表示某个应用已经信任它，也不授予事实生产者写入权。
_Avoid_: Attachment registration, Writable family

**RecordAttachment value**:
一个 Record owner 下某份 RecordAttachment definition 的不可变事实实例。它包含该版本的 payload 与自有材料，
不是整个 Record，也不是 Analysis 派生值。
_Avoid_: Record value, Fact value

**RecordAttachment installation**:
一个应用明确选择并信任哪些 RecordAttachment definitions 来解释和迁移事实。它不授权任何 producer
写入，也不从 producer 声明或历史 bytes 隐式推导。
_Avoid_: Attachment write registration, Plugin discovery

**RecordAttachment write grant**:
一个 linked producer occurrence 被允许提交的 exact RecordAttachment definitions 集合。它不安装 migration，
不跨 occurrence 共享，也不包含当前 owner 的实际生命周期能力。
_Avoid_: Application registry, Owner-wide allowlist

**Record context lease**:
当前 Run 或 Attempt 在开放生命周期内实际接纳 RecordAttachment command 的 owner-local authority。它不跨
owner、session 或封口边界。
_Avoid_: Record writer, Global attachment context

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
