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

## Roadmap 领域

**Admission health**:
每条 fresh slot 在 Agent 进入前，对一个 producer occurrence 做一次健康裁决，并把结果写进 Run-owned
receipt。它不是 Assertion、Verdict 或跨 Attempt 缓存。
_Avoid_: Plugin health, Health Assertion

**State cohort**:
由 State Provider 颁发身份的一条持久状态 lineage；它约束 Checkpoint、Region 与 schema 的共同归属。
作者字符串不能构造或冒充 Cohort 身份。
_Avoid_: State label, Shared folder

**State checkpoint**:
State cohort 内由 Provider 发布的 immutable exact 状态点。Comparable 状态必须带内容摘要，恢复和提交
都引用精确 Checkpoint，不选择 head 或当前值。
_Avoid_: Latest state, Mutable snapshot

**Eval trajectory**:
由源码路径确定身份、用显式依赖组成的 Eval DAG。一个执行可以跨多个 immutable Run segment 暂停和恢复，
但只能从同一 execution 的 exact State checkpoint 延续可比性。
_Avoid_: Eval Group, Mutable workflow run

**Workspace access evidence**:
可信 Sandbox producer 归因给 Agent 进程树的逻辑文件操作集合。它不保存 raw syscall 数量，也不等同于
JSON 文本里出现过某个路径。
_Avoid_: Path mention, Agent diff

**Discovery boundary**:
一个显式目录入口拥有的递归 Eval discovery 范围。父级扫描抵达该入口后停止向内发现，并保留 root、
entry 与截止原因供 CLI 解释。
_Avoid_: Ignore glob, Discovery filter

**Reuse explanation**:
一项 frozen execution plan action 自带的同源理由与 exact prior locator。它不重新读取 Record 或再次判断
reuse eligibility。
_Avoid_: Reuse guess, Cache reason

**Pricing profile**:
带内容身份与 coverage 的价格规则集合，只供 Report Calculation 投影成本。它不覆盖 Record 中的 observed
usage 或 cost。
_Avoid_: Record repricing, Mutable price table

**Experiment display name**:
Experiment 的人类可读标签；它与 description、Experiment identity 分离，不参与 reuse、选择或去重。
_Avoid_: Experiment alias, Short ID

**Record inventory**:
一次 frozen Record view 上按 canonical Run ID 枚举的只读库存。它不构造 AnalysisSample、不选最新结果，
也不按时间排序。
_Avoid_: Latest runs, Recovery sample

## 分析与报告

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

**Physical fact package**:
由一个事实权威为一个 Record owner 在同一不可拆 seal transaction 中冻结的 durable facts；它保存
bounded capture algebra、blob closure 与 join anchors，不按某个 Report 想看到的列预先拆分。
_Avoid_: Report table, Logical view, One field per Attachment

**Local projection**:
在同一 frozen Record view 中，将一份 owner-local package 解释为一个或多个 typed views。它不读取
第二份 package，也不建立跨包关系。
_Avoid_: Joined view, Report model

**Fact relation**:
在一个 Analysis scope 内，使用 exact owner 与 durable anchors 把多份 local projections 对齐到
logical slots 的结构关系。它不根据数值容差判定 agreement 或 authority。
_Avoid_: Heuristic join, Metric result

**Derivation**:
从 Sample-aligned facts 或 relations 计算指标、coverage 与领域模型的可选责任。只有 host 管理其
dependency、去重或局部失败时，它才是独立 runtime layer。
_Avoid_: Projection, Page loader
