# ② Analysis（分析层）

Analysis（分析层）是 current Record（当前持久事实集）之上唯一解释事实的层。它固定选择、总体、分母、
归并、缺失、producer（生产者）可比性与 Evidence（证据）引用，再把闭合结果交给 Report（报告）。

Record 保存已经发生且已封口的事实。Report 只把闭合结果组成页面和呈现面。两层都不能重新选择成员、
缩小分母或重算指标。

```text
① Record
  current reader ──▶ RecordSelection（事实选择）
                             │
                             ▼
② Analysis
  Sample（样本） ──▶ Population（总体） / Dimension（维度） / Measure（度量） / Relation（关系） ──▶ query / aggregate
                             │                                           │
                             │                                           ▼
                             └──────────────────── SemanticFrame（语义帧） / ClosedRows（闭合行） / DomainView（领域视图）
                                                                      │
                                                                      ▼
③ Report
  Page / component / terminal / web / static renderer
```

`niceeval/analysis` 是普通 Analysis 与 Report 作者的 API。`niceeval/analysis/host` 是公开、受支持的高级
Host composition SDK：CLI、`reportHost` 与替代 host 在已经由 `recordHost` 形成 selection 后调用
`analysisHost.openSample()`。普通作者不导入这个 Host entry，也不会在 Report callback 中取得 Record reader。

## 心智模型

Analysis 作者声明什么才算同一个总体成员、如何分组、怎样把事实归并为读数，以及读数缺少事实时如何保留
分母和原因。Host 随后把冻结的 RecordSelection（事实选择）打开成 Sample，按每个请求需要惰性读取
current Record 事实。

一次 Selection 固定 Run、logical Slot、预期成员与 Core 问题。它不是执行规划：reuse planning 决定下一次
执行什么；Analysis 只解释已经封口的 Run。`not-recorded` 也是历史事实，不能被解释成待执行工作。

OTel、事件、Evidence、文件差异与 blob 都保持在 Record 中。打开 Sample、查看样本命中范围或编解码
Snapshot 不读取它们。只有某个 `AnalysisInput`（分析输入）或 `DomainView`（领域视图）请求它们时，
Analysis 才在当前 Scope（资源作用域）内读取所需 Attachment（附属事实）。

一次成功读取 `ReadableAttempt` 时，Analysis 会在同一条读取中关闭 immutable Core 的 `outcome`。Attempt
Evidence 再把该 Outcome 与已验证 Assertions 交给 Eval 的权威 fold，得到派生的四态 `verdict`；`outcome`
从不等同于 `verdict`。Core 不可用或不可读时，相关 DomainView entry 以 failed 和带 Evidence 引用的问题明确
呈现，不能伪造 `completed`、空 Assertions 或 Verdict。

例如 `attemptLatencyMs` 请求一个 Attempt 的 Observability input。Sample 只在 Measure 实际评估到该
Attempt 时读取 `niceeval.observability`，把已验证结果以 `{ owner, fixed definition }` 缓存。第二个
需要相同 input 的 Measure 复用该缓存；它不会预读 Assertions、Sources、Artifacts 或其它 Attempt。

如果已发布的 input 或 DomainView 需要较早 reader 不认识的独立 future family，例如 `niceeval.energy`，
Sample 不解释该 family 的 bytes。它把这个请求闭合为 `unsupported` / `not-available`，并继续计算不依赖它的
Measure。未知 family 不把 Core、其它 Attachment 或 Report 的闭合输出变成全局失败。

```text
attemptLatencyMs ──▶ Sample cache ──▶ attempt / niceeval.observability
                                                     │
                                                     ▼
                                      MetricValue（度量值） / ClosedRows（闭合行）
                                                     │
                                                     ▼
                                      Report（没有 reader、Attachment 或 blob）
```

## 谁能定义什么

| 对象 | owner | 作者能做什么 |
|---|---|---|
| `Population`、`Dimension`、`Measure`、`Relation` | Analysis | 用公开的 `define*()` 声明统计语义 |
| `AnalysisInput`、`PopulationMembers`、`DomainViewRequest` | NiceEval Analysis catalog | 选择已发布定义，不能构造或注册 |
| `RecordSelection`、`Sample` | Record / Analysis Host | 高级 Host 选择并签发；作者不能从路径、root 或回调构造 |
| `SampleSnapshot`、coverage、locator | Analysis | 读取、编解码和审计冻结选择；不能借此恢复读取能力 |
| `MetricValue`、`ClosedRows`、`SemanticFrame`、`DomainView` | Analysis operation | 只由 `query()` 或 `aggregate()` 返回，不能手工伪造 |

`AnalysisInput.id` 标识一个统计投影，不是 Record property token id、TS field 或 durableKey。一个 input
可以读取多个固定 property；一个 property 也可以被多个 input 以不同的 missing 或 reduction 语义使用。
因此 JSON key 与内部 property token 都不能冒充 `AnalysisInput.id`。

Calculation（计算）是 Measure 所表达的统计口径，不是另一种公开 descriptor。没有 `Calculation`、
`defineCalculation()`、plan 或 facade。普通 Report 只把已经定义好的 Measure 传给 `aggregate()`；需要
完整帧或诊断视图时使用 `query()`。

## 两种操作，单一口径

`aggregate(sample, { by, values })` 是 Report 的简洁路径。它推断共同 Population，返回可直接交给
`Table`、`Bars` 或 `Stat` 的 `ClosedRows`。`query(sample, request)` 是 Analysis 的完整路径：表格请求返回
`SemanticFrame`，领域请求返回 `DomainView`。

两种操作使用同一份 Measure、分母、缺失和 Evidence 规则。`aggregate()` 等价于同一表格查询的 `rows`，
不是另一套聚合实现。Report 可以排序、限制或过滤已闭合行的显示，却不能把所得数组再次聚合，或以它改变
`MetricValue.total`。

## Sample、选择、Scope 与 lazy cache

Sample 同时代表两件事：可审计的冻结选择，以及只在其 Scope 内可用的惰性读取能力。`SampleSnapshot`
是前者的纯值；它能安全地保留、编解码和收窄审计信息。它不是 Sample，不能打开 Record 或执行查询。

Analysis Host 以 current `RecordReadSession` 与 `RecordSelection` 建立 Sample。每个 Sample 只分析当前选择
中的 sealed Run；新封口的 Run 不会进入它。缓存只服务这个 Sample 和它的 Scope，不能成为新 selection、
absence 或 latest 的权威依据。

`explicit-runs` 保留具名 Run 的完整 expected Slot 框架。`project-current` 使用 CLI 已加载的当前 target
identity：只保留 experiment/eval/Slot execution identity digest 仍匹配的 Slot。不匹配的 Slot 进入
`excluded` / `identity-mismatch`，不会静默留在 selected 分母里。

CLI 的 `--run` 与精确 locator 只决定选择哪个历史事实。它们审计该 Run 的完整 expected membership，
不走当前 identity 收窄，也不把 Record root 交给普通作者代码。

`narrowSample()` 用 RunId 或 SlotId 做单调交集。未匹配成员变成 `excluded`，但仍留在 Snapshot 状态统计中，
因而“范围外”“没有 Member”与“Core 损坏”不会混成同一个空值。它不能重新纳入已排除成员，也不能读取
修改后的 Record。

Scope 关闭后，`query()`、`aggregate()` 与 `narrowSample()` 以 `analysis-sample-closed` 失败，并且不再发起
I/O。Snapshot 与已经得到的 SemanticFrame、ClosedRows 和 DomainView 不依赖该能力，关闭后仍可呈现或序列化。

## 闭合输出

每个 Measure 单元都是 `MetricValue`，而不是未包装的 number。它同时携带 value、state、samples、total、
basis、issues 与 refs。合法零值仍是 value；没有值、输入不支持与读取失败保持不同 state。

`ClosedRows` 是带稳定 identity 和 frame-level issues 的只读行数组。它以及 `SemanticFrame` 与
`DomainView` 只含值、稳定身份、问题与 Evidence 引用；不含 reader、Scope、Promise、callback、文件路径、
Attachment、blob capability 或未解释的 Record payload。Report 只消费这些闭合值。

例如 Attempt Evidence 的闭合 detail 可以同时携带 `outcome`、派生的 `verdict` 和逐项 Assertions；这些都是
显示安全的值，不携带 `ReadableAttempt`、owner、reader 或任何 Scope capability。

## 入口

- [Library](library.md) —— 作者 API、公开 Host composition SDK、Sample、lazy input、query、aggregate 与闭合输出。
- [Use cases](use-case/README.md) —— 比较多个运行，以及选择和收窄一个分析范围。
