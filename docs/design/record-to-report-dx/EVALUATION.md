# Evaluation

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md)

## 失败分类

- Attachment 六态与 slot states 是 recorded-data states，进入穷尽 cells；它们不 throw，也不是 C4b 的
  “派生失败”。官方 metric 对不完整数据返回 partial/unavailable value。
- C4b 只使用 deterministic user compute defect，检验 managed dependency 的传播与 consumer 存活。
- Filesystem、permission、closed reader 与 scope interruption 是 execution-wide Effect failure，不因
  Derivation 层存在而降成 consumer-local problem。

## 可裁决场景

### C3：分母与两级聚合

Fixture 有三个 selected Runs，每个 Run 各有两个 logical slots。Pass Run A 两个 Attempt 都 pass；
Pass Run B 一个 fail、一个 not-recorded；Score Run S 一个 `0.8`、一个 not-recorded。Pass metric 只在
A/B 上计算，per-Run pass rate 是 `2/2` 与 `0/2`，跨 Pass Runs 的宏平均是 `0.5`。Score metric 独立
报告 value `0.8`、observed `1`、denominator `2` 与 partial。Cost 可以跨 `4` 个 executed / `6` 个
logical slots 聚合；Pass 与 Score 不相加，也不能把三个 Pass Attempts 算成 `2/3`。

### C4a：作者显式共享值

用带计数器的 `passRate(rows)` 形成一个 immutable value，再显式交给 Overview 与 JSON Download。期望
计数器是 `1`，两处拿到相同 value identity 或 closed value。此场景不要求 host 理解公式依赖。

### C4b：宿主自动共享依赖并隔离失败

Overview 与 JSON Download 引用同一个 shared query object，Attempt Page 不依赖它。让公式抛出具名 defect。
期望公式由 host 调度一次；Overview 与 Download 报同一个 execution problem；Attempt Page 仍在
`ReportExecution` 中可交付。两个结构相同但分别创建的 query objects 应执行两次；host 不做 structural
dedup，也不比较 callback source。

### C6：六态 cells

六个 slots 对同一 Attachment field 分别产生 available、unavailable、migration-required、
migration-unavailable、unsupported 与 invalid。另有一个未请求的大 Attachment。期望返回六个对齐 cells，
无一冒充 `0` 或被 drop；未请求 Attachment 不参与读取和 problem 列表。

### C10：脚本复用

脚本在同一 frozen Record 与 selection 上计算 C3 指标，但不导入 Page、JSX 或 route 类型。期望候选明确
脚本复用的是 query object、Analysis read 加普通函数，还是 semantic Query，并说明额外 runtime 概念。

### C8：Historical grading

Base Analysis 选择 execution Runs A/B；grading Runs G1/G2 都对其中同一个 sealed Attempt 形成 claims。
调用者只选择 G1。期望只读取 G1 claims，同时保留它们指向的 subject lineage；Analysis 的 logical slots、
base denominator 与 selected execution Runs 不变。省略 grading claim selection 必须是类型错误或明确缺参，
不能默认 latest。

### C11：完整 blob 限制

一个已请求 trace Attachment 含大量 blob chunks，页面只展示其中一条 span。期望所有候选都承认当前 reader
仍 materialize 整个 Attachment snapshot；planner 只能避免未请求 Attachment，不能在该 blob 内 range read。

### C12：同源机器输出

Overview 与 CSV 都展示 C3 的宏平均与 evidence。期望 CSV 直接消费同一 typed value 或 query result，不
从页面文本反推数值，也不执行第二份公式。

### C13：物理 packages 与 relations

同一 Attempt 的 agent-events 与 OTel 都保存 coordinator-minted `send_01`；Assertions 保存
`assertion_01 → send_01`；Verdict evidence 指向 `assertion_01`。另一个 OTel operation 没有 send anchor。
期望前三者形成一条可复核 relation，孤立 operation 保留为 unmatched。系统不得用时间、文本或数组位置
补 join，也不能让 unmatched 反向使任何独立 package invalid。

### C14：单逻辑视图的读取成本

一份 OTel package 含 4,096 observations、2 MiB payload 与 30 MiB closure，Report 只请求 usage
view。期望 planner 不读 Commands/Agent-events packages，但当前 reader 仍完整 materialize OTel
closure。多包的总 raw bytes 超过 256 MiB 时，scheduler 降低并发度，不让同时持有的 raw
snapshot leases 超限，也不假装存在 range read。

## Physical package tradeoff

同一 C13/C14 fixture 必须比较当前 seven-family 与 PLAN-5，不能预设任一胜出：

| 评价轴 | Current seven-family | PLAN-5 physical packages |
|---|---|---|
| producer complexity | 每个逻辑 family 独立 capture/seal，coordinator 联合验证 | 每个事实权威一次 seal，但需要 capture receipt 与 anchor context |
| write-time integrity | 单 family 可独立验证，跨 family refs 由联合 contract 验证 | package 内 event coherence 较强，跨包 anchor 仍由 relation contract 验证 |
| event coherence | 同一 operation 的 usage/timing 可能跨 schemas | 同一 OTel operation 保留在一包；跨 Agent/OTel 仍需 anchor |
| 单 view memory | 只读 usage/timing family，closure 较小 | 只查 usage 仍完整读取 OTel package，峰值更高 |
| migration blast radius | family 独立演进 | OTel/Agent-events 任一子域变化可能推动整包 schema 演进 |
| relation partiality | write-time cross-family validation 可拒绝新 Run | 独立 packages 可用，dangling/ambiguous 在 Relations 显式呈现 |

PLAN-5 只有在真实下游 fixture 中证明 event coherence、producer DX 或未来查询弹性的收益大于内存与迁移
代价，才应进入 Feature。C13/C14 只让假设可证伪，不证明 current seven-family 错误。

## 候选状态

| Case | PLAN-1 opaque graph | PLAN-2 scoped loader | PLAN-3 semantic relations |
|---|---|---|---|
| C3 | 满足；`derive()` 显式实现两级聚合 | 满足；aligned rows 交给官方纯函数 | 满足；Measure 固定 grain 与两级聚合 |
| C4a | 满足；同一 query value | 满足；loader 保存一个 model value | 满足；同一 semantic Query result |
| C4b | 满足；host 按 query identity 去重并隔离 | 不满足；loader 是 report-level failure boundary | 满足；planner 按 Query identity 去重并隔离 |
| C6 | 满足；Field cells 保留六态 | 满足；aligned rows 保留六态 | 满足；Field cells 保留六态 |
| C8 | 满足；独立 claims query | 满足；`analysis.gradingClaims()` | 满足；claims base Relation query |
| C10 | 有代价地满足；脚本学习 `runQuery()` | 满足；脚本复用 Analysis reads 与纯函数 | 有代价地满足；脚本学习 semantic executor |
| C11 | 共同受限；完整 blob snapshot | 共同受限；完整 blob snapshot | 共同受限；完整 blob snapshot |
| C12 | 满足；Page 与 Download 共享 query | 满足；共享 loader model value | 满足；共享 semantic Query result |

其它 Cases 仍是候选必须逐步展开的设计问题，不能因为本矩阵未列出就宣称自动满足。定案前至少还要用
一个真实下游 Report 验证 C2、C3、C4a、C4b 与 C10 的作者代码和可观察失败结果。
