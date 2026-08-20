# PLAN-7：受限 ReportSample + 运行时局部 field DAG

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

## 裁决形状

PLAN-7 保留 PLAN-6 的 nominal Analysis fields、closed `ReportExecution` 与 semantic components，但恢复普通 async callback 与
0.12.1 的调用体验：

```text
Page callback receives restricted ReportSample
  → await aggregate(sample, fields)
      → compile only this finite field DAG
      → execute or reuse within-execution cache
      → return closed typed rows
  → compose Bars / Table / Scatter
  → close semantic tree
```

```tsx
export const Performance = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  });

  return (
    <>
      <Scatter points={rows} x="costUSD" y="passRate" />
      <Table rows={rows} />
    </>
  );
});
```

`aggregate()` 返回 closed typed rows，不返回 projection、reader 或 lazy query。每个 Measure value 仍携带 state、observed /
denominator、issues、refs、unit、format 与 better。

## ReportSample 的权限

callback 获得受限 `ReportSample`。它能看到 frozen Sample identity、selection summary、整体问题与 completeness summary，但不能：

- 枚举 raw Run / Attempt；
- 用任意函数改变 population；
- 读取 raw facts 或 Artifact JSON；
- 调用 projection 或 Record reader；
- 取得 migration、Capture 或 Effect runtime capability。

Attempt 明细、成员表、新 population 与业务公式必须由 Analysis 发布具名 fields / relations。Report 可以对 closed rows 做
display-only sort、limit 或 filter，但不能重算 MetricValue 或缩小 denominator。

## 局部闭包

每次 `aggregate()` 第一次调用时编译该请求的有限 field DAG。host 在事实读取前拒绝 cycle、population mismatch、identity
collision 与 producer incompatibility。

同一次 `ReportExecution` 按 frozen Sample identity 与 nominal field/dependency identity memoize。callback 可以根据第一组 rows
决定是否调用第二组 `aggregate()`；不存在 discovery dry-run，也不会执行 callback 两次。

## Page isolation

只执行请求的 Page。未请求 Page 的 dependency error 不影响当前 Page。static export 在一次 execution 中枚举所有目标 Page /
PageFamily instances，因此可以跨 Page 复用 exact field cache。

每个 Page / component instance 在一次 execution 中最多执行一次。失败属于该 Page；static export 只有全部目标成功时才发布目录。

## Closed output

callback 完成后只留下 closed semantic tree。`ReportSample`、reader、Promise、Effect、callback 与 field executor 不进入 renderer。
terminal、Web 与 static face 消费同一棵树。

普通 JavaScript callback 的跨 execution 纯度是 trusted-author contract，不是 sandbox 保证。provenance 保存 Report module
fingerprint、Sample identity、selection 与 host version。同一 closed tree 与 renderer version 必须产生稳定 static output。

## 不可能三角

以下三件事不能在 data-dependent JavaScript callback 中同时成立：

1. callback 只执行一次，并可依据已算出的 rows 分支；
2. 任何 callback 前预编译整份 Report 的全部依赖；
3. 只执行请求 Page，并隔离其它 Page 的失败。

PLAN-7 保留第 1、3 项，放弃第 2 项。PLAN-6 选择第 2、3 项，因此 `aggregate()` 只能返回 static declaration，无法恢复旧作者心智。

## Analysis 承担口径

PLAN-7 不把计算正确性退回 Report：

- population 与 denominator 属于 Analysis；
- Metric 执行 withinAttempt → withinEval → acrossEvals；
- cross-population join 需要具名 relation；
- producer 必须相同、分组或显式声明可比；
- `MetricValue` 保留 completeness 与 Evidence refs；
- Report 只能组合 fields 和显示形状。

## 扩展边界

- 新事实：领域 SDK 使用 fixed Metric / Score / Artifact Capture。
- 新分组、指标或关系：Analysis 作者发布 Dimension、Measure 或 AnalysisRelation。
- 新页面与复合组件：Report 作者组合 `aggregate()` 与现有 primitives。
- 新 primitive：NiceEval core 同时定义 terminal、Web、static 与无 JavaScript 降级。

Report TSX 使用 NiceEval 自有 runtime，不引入 React ABI，也不允许 DOM intrinsic。

## 与 PLAN-6 的关系

保留：

- nominal Analysis fields；
- typed grouping 与 MetricValue；
- stable row / route identity；
- once-per-execution field cache；
- closed semantic tree；
- renderer parity。

替换：

- static `ReportData` declaration → `await aggregate(sample, ...)` closed rows；
- callback 前整份依赖编译 → 每次 aggregate 的局部 DAG；
- descriptor-only callback → 受限 data-dependent callback；
- component props 才能排序 / limit → closed rows 也可做 display-only JavaScript 处理。

## 代价

- host 无法在 callback 前知道整份 Report 的所有 dependencies；
- trusted callback 可以读取时钟、随机数或外部资源，因此跨 execution 不能机械保证字节相同；
- 未请求 Page 的 dependency error 只在该 Page 执行时出现；
- callback 需要明确的 purity contract 与 provenance；
- Report rows 的 display-only 处理边界依赖 API 约束和作者纪律，不能由 TypeScript 完全证明。

这些代价换回普通 async TypeScript、数据依赖分支和接近 0.12.1 的作者体验，同时不牺牲 Analysis correctness 与 closed rendering。
