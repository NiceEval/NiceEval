# Record → Analysis → Report → Delivery

NiceEval 把运行事实、结果解释、报告组织与用户交付分成四层。普通用户只通过 CLI 运行、查看和比较，不需要理解 Record schema、执行 backend 或 `.niceeval` 目录。

```text
┌──────────────────────────────────────────────────────────────┐
│ ④ Delivery                                                  │
│ niceeval show / view / view --out                           │
│ 同一份闭合报告的 terminal、Web 与 static 出口                │
└──────────────────────────────▲───────────────────────────────┘
                               │ Closed Report Tree
┌──────────────────────────────┴───────────────────────────────┐
│ ③ Report                                                    │
│ Table / Bars / Scatter │ Trace / Attempt / Evidence         │
│ Page / PageFamily / Official Experiment Report              │
└──────────────────────────────▲───────────────────────────────┘
                               │ SemanticFrame / DomainView
┌──────────────────────────────┴───────────────────────────────┐
│ ② Analysis                                                  │
│ Population / Dimension / Measure / Relation                 │
│ 内部 QueryPlan / executor │ 闭合结果合同                     │
└──────────────────────────────▲───────────────────────────────┘
                               │ Current Record
┌──────────────────────────────┴───────────────────────────────┐
│ ① Record                                                    │
│ 当前唯一 Schema / Capture / Storage / Validation / Migrate  │
└──────────────────────────────────────────────────────────────┘
```

## 四层心智模型

```text
┌────────────────┐    ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ Record         │ →  │ Analysis       │ →  │ Report         │ →  │ Delivery       │
│ 发生了什么     │    │ 应该怎样解释   │    │ 怎样让人看懂   │    │ 用户从哪里看   │
└────────────────┘    └────────────────┘    └────────────────┘    └────────────────┘
```

| 层 | 心智模型 | 只回答的问题 | 契约入口 |
|---|---|---|---|
| ① Record | 事实账本 | 实际发生了什么，旧格式怎样升级为当前格式 | [Record](record.md) |
| ② Analysis | 统计口径合同 | 事实怎样进入总体、分母、归并和闭合结果 | [Analysis](analysis.md) |
| ③ Report | 可执行报告配方 | Query、组件与页面怎样组成查看工作流 | [Report](report.md) |
| ④ Delivery | 同一报告的出口 | 用户怎样在终端、Web 与静态站查看 | [Delivery](delivery.md) |

四层是产品边界。Query 编译、执行 backend、`SemanticFrame` 和 `DomainView` 仍有独立内部合同，但不是用户需要学习的平级产品层。

## Analysis 的内部结构

Analysis 同时拥有语义、执行和输出合同：

```text
typed Analysis query
        ↓
语义合同
Population / Dimension / Measure / Relation / Reduction
        ↓
内部执行
QueryPlan → TypeScript executor → 可选 DuckDB executor
        ↓
闭合输出
SemanticFrame / DomainView
```

语义合同决定“什么结果才正确”。executor 只决定“怎样完成计算”。闭合输出决定“Report 能拿到什么”，三者不形成三个作者层。

`SemanticFrame` 保存 typed rows、`MetricValue`、population、问题与 Evidence refs。`DomainView` 保存 Trace、Attempt 或 Evidence 的树、时序、身份与问题。

## Report 的内部结构

Report 同时拥有组件词汇和完整页面工作流：

```text
SemanticFrame
   └─ Summary / Table / Bars / Scatter

DomainView
   └─ TraceViewer / AttemptTimeline / EvidenceDrilldown

components + Page + route
   └─ Official Experiment Report / custom Report
```

已完成 Experiment 不是专用 component。它由 Analysis 形成共同分母与对齐结果，再由官方 Report 组合 Table、Chart 和诊断组件。

## Migration 边界

平台只维护一个当前 Record schema。Analysis 不接收历史版本联合，也不在每次读取时执行历史兼容。

```text
Old Record ── niceeval migrate ──→ Current Record ──→ Analysis
```

旧版本格式、相邻 converter、staging 验证与原子发布全部属于 Record。`show`、`view` 与 Report execution 遇到旧版本时返回 `migration-required`，不静默改盘。

新增 Query、Measure、组件、Page 或 renderer 不能推动 Record schema 升版。只有无法从已有事实恢复的新事实，或已有持久语义无法正确表达时，Record 才能增加 migration。

## SQL 边界

SQL 不是 Record 与 Report 之间的公共层。Report 作者只能提交 typed Analysis query，不能查询 Record 物理表。

```text
Typed Query → QueryPlan → TypeScript executor
                         └→ 可选内部 DuckDB executor
```

DuckDB 只有在真实 workload 证明 Analysis 执行成为瓶颈，并通过完整结果差分验证后，才能成为内部 executor。差分必须逐项比较 value、state、observed、denominator、issues、refs 与 producer compatibility。

探索性 SQL 若以后出现，只查询版本化逻辑 catalog，并返回与 `MetricValue` 不兼容的 `ExploratoryRows`。它不能进入官方 Metric、Comparison 或可复核 Report 路径。

## API 面

| 面向对象 | 入口 | 能力 |
|---|---|---|
| 普通 Eval 作者 | `niceeval`、领域 Plugin | 运行 Eval 并产生 typed facts |
| Analysis 作者 | `niceeval/analysis` | 定义 Population、Dimension、Measure、Relation，调用 `analyze()` |
| Report 作者 | `niceeval/report` | 使用 `ReportSample`、`aggregate()`、Page 与组件 |
| 普通用户 | `niceeval show`、`niceeval view` | 查找、查看、比较与导出结果 |
| 平台 host | 内部 capability | Record 写入、migration、Analysis executor、领域投影与 renderer |

Record schema、migration converter、执行 backend 和 renderer capability 都不属于 application API。

## 依赖规则

```text
Delivery → Report → Analysis → Record
```

- Record 不知道 Analysis field、组件或页面。
- Analysis 不知道 Page、Table、TraceViewer 或 renderer。
- Report 不读取 Record，也不改变 nominal population。
- Delivery 不执行 Query，只消费同一次 execution 产生的闭合语义树。
- migration authority 不进入 Analysis、Report 或 application package。

## 全局不变量

1. Analysis 只接收当前 Record schema，不接收历史版本联合。
2. Record 只保存不可重新计算的事实，不保存 Report 派生结果。
3. Analysis 独占 population、denominator、missing 与 reduction 语义。
4. scalar 丢失状态、分母或 refs 后，不能重新包装成 `MetricValue`。
5. Report 只消费 `SemanticFrame`、闭合 `DomainView` 与 opaque identity。
6. 已完成 Experiment 由官方 Report 组合 Table、Chart 与诊断组件。
7. terminal、Web 与 static renderer 消费同一棵闭合语义树。
8. 新查询和新组件不会要求 Record migration。
