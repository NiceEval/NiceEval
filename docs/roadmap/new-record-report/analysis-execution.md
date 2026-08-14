# ③ Analysis 执行层

```text
┌────────────────────────────────────┐
│ Analysis Executor = 计算机器       │
│ 执行口径，不发明口径               │
└────────────────────────────────────┘
```

## 心智模型

Analysis 执行层回答“已经定义好的计算怎样稳定执行”。它类似编译器后端：输入是 typed `QueryPlan`，输出是完整语义结果，执行引擎不能改变业务含义。

这一层不是公共 SQL 面。Report 作者不知道 query 被解释执行、编译成 columnar operations，还是由未来的内部 DuckDB backend 执行。

## 解决的问题

- 校验 field dependency、cycle、identity collision 与 population mismatch。
- 按正确顺序执行 relation、reduction 与 Evidence propagation。
- 在同一次 execution 中按 exact identity 缓存字段结果。
- 为不同物理 backend 建立同一结果合同。
- 在 backend 不支持某个 plan 时整体回退，不产生混合口径。

## 内部 SPI

```ts
interface AnalysisExecutor {
  readonly id: AnalysisExecutorIdentity;
  readonly version: AnalysisExecutorVersion;

  execute(
    plan: QueryPlan,
    input: CurrentRecordSnapshot,
  ): Promise<SemanticFrame>;
}
```

`AnalysisExecutor` 是 host capability，不从 `niceeval/analysis` 或 `niceeval/report` 导出。

## TypeScript reference executor

TypeScript executor 是语义参考实现：

```text
QueryPlan
   ↓ dependency validation
finite field DAG
   ↓ typed evaluation
proof-carrying cells
   ↓ grouping
SemanticFrame
```

它必须支持所有合法 plan，也是未来 backend 差分验收的 oracle。性能优化不能通过省略 missing cells、Evidence refs 或 intermediate state 完成。

## 可选 DuckDB executor

DuckDB 只能位于 `QueryPlan` 之后：

```text
QueryPlan
   ├─ TypeScript executor
   └─ DuckDB executor
```

它不能位于 Record 与 Analysis 之间：

```text
Record physical tables ── raw SQL ── Report   ×
```

正式引入前必须同时满足：

1. 两个真实生产规模 workload 证明瓶颈位于 Analysis scan、group 或 join。
2. backend-neutral `QueryPlan` 已经能够表达目标 workload。
3. 冷启动、decode、load、执行时间和 peak RSS 的整体收益达到预先声明的门槛。
4. 完整结果与 TypeScript backend 语义相等。
5. 不支持的 plan 可以整体回退 TypeScript。
6. backend 选择不改变 result identity、cache identity 或 renderer output。

完整结果比较至少包括：

```text
row key
grouping coordinate
value
state
observed / denominator
issues
Evidence refs
unit / format / better
producer compatibility
```

DuckDB materialization 只能是可删除、可重建的本地 cache，不能成为 Record 事实或 migration 目标。

## 探索性 SQL

探索性 SQL 与官方 Analysis 是两条不同产品路径：

```text
versioned logical catalog → SQL → ExploratoryRows
```

`ExploratoryRows` 必须与 `SemanticFrame` 和 `MetricValue` 类型不兼容。它可以帮助调查 ad-hoc join、window 或 pivot，但不能直接进入官方 Metric、Comparison 或可复核 Report。

有长期价值的探索查询需要提升为具名 Population、Dimension、Measure 或 Relation，之后才进入官方路径。

## 禁止跨出的边界

- 不直接暴露 Record 文件或物理表。
- 不让 SQL 定义 population、denominator、missing 或 retry 语义。
- 不从缺少证明信息的 scalar 重建 `MetricValue`。
- 不读取组件和 Report 配置。
- 不把执行 cache 写成新的 durable truth。
