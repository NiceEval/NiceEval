# Authoring 与扩展边界

三层描述依赖方向，不把人强行分成三类。一个领域 package 可以发布 Capture 与 Analysis API；它仍不能把 Record authority 交给
application 或 Report。

## 角色矩阵

| 角色 | 常用 import | 自定义什么 | 明确看不到什么 |
|---|---|---|---|
| 普通 Eval 作者 | `niceeval` 与领域 package | Plugin 选项；必要时使用已注册 Capture token | Record、schema、producer fingerprint、migration、Analysis DAG |
| 领域 SDK 作者 | `niceeval/capture`、`niceeval/analysis`、`niceeval/plugin` | typed definitions、Producer identity、Capture lifecycle、Analysis fields | Record writer、converter、installation、Report host |
| Analysis 作者 | `niceeval/analysis` 与领域 fields | population、Dimension、Measure、relation、denominator、rollup | Capture capability、Record I/O、renderer |
| Report 作者 | `niceeval/report` 与 Analysis fields | 分组、显示排序、页面、图表、复合组件、下钻 | raw facts、projection、migration、业务 Measure 实现 |
| application maintainer | config 与 CLI | 挂载普通 Plugin、选择 Report、批准 migration plan | executable Record family 与第三方 converter |

## 普通 Eval 作者

默认路径只有领域语义：

```ts
export default defineEval({
  plugins: [
    otelTiming(),
    gpuEnergy({ meter: nvmlEnergyMeter({ device: 0 }) }),
  ],

  async test(t) {
    await t.send("完成任务");
  },
});
```

Plugin 负责打开采集资源、注册 obligation、原子封口和释放。用户不调用 `record()`，也不安装数据 family。

一次性领域事实确实不值得独立 Plugin 时，高级作者可以注册 Capture token：

```ts
export default defineEval({
  captures: [energyCapture],

  async test(t) {
    const energy = await measureGpuEnergy();
    await t.metric(energyCapture).seal(availableEnergy(energy));
  },
});
```

token 仍在运行前固定事实与 producer，不允许 `t.metric("gpu-energy", value)` 这种字符串写入。

## 领域 SDK 作者

一个完整领域 package 分成三个公开模块：

```text
@example/gpu-energy
  ├─ root       普通 Plugin 与 options
  ├─ capture    Metric definition 与高级 Capture token
  └─ analysis   Dimension、Measure 与跨 identity bridge
```

推荐导出形状：

```ts
// @example/gpu-energy
export { gpuEnergy } from "./plugin.js";
export type { GpuEnergyOptions } from "./plugin.js";

// @example/gpu-energy/capture
export { gpuEnergyMetric, createEnergyCapture } from "./capture.js";

// @example/gpu-energy/analysis
export { gpuDevice, gpuEnergyJoules, gpuEnergySource } from "./analysis.js";
```

普通 package root 不 re-export Capture token。这样 autocomplete 首先给普通用户领域动作，高级入口仍然存在且具名。

领域 SDK 必须完成：

1. 用 `defineMetric()`、`defineScore()` 或 `defineArtifact()` 固定事实 identity。
2. 用 Capture token 固定 Producer identity、`required` policy 与 expected coordinates。
3. 在 Plugin child Scope 内 acquire 资源，并在 Attempt 关闭前 seal exactly once。
4. 发布同一 definition 对应的 typed Analysis fields。
5. 定义 producer compatibility、三段 rollup、denominator、missing 与 Evidence policy。
6. 语义变化时发布新 fact ID，并在 Analysis 中显式声明 bridge。

领域 SDK 不提供：

- Record schema family；
- adjacent converter；
- application installation；
- arbitrary payload projection；
- Record path 或 owner routing；
- renderer primitive。

## Analysis 作者

Analysis 作者回答「怎样比较」，不回答「怎样画」。常见工作分三种：

### 从固定信封形成 Measure

```ts
export const gpuEnergyJoules = metricMeasure(gpuEnergyMetric, {
  producers: requireSameProducer(),
  withinAttempt: sum(),
  withinEval: mean(),
  acrossEvals: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
});
```

### 组合 fields 形成新 Measure

```ts
export const qualityPerJoule = defineMeasure({
  id: "com.example.quality-per-joule",
  population: logicalSlots,
  inputs: { quality: passRate, energy: gpuEnergyJoules },
  denominator: allLogicalSlots(),
  calculate: ({ quality, energy }) =>
    metricRatio({ numerator: quality, denominator: energy }),
});
```

### 跨 population 建立 relation

```ts
export const attemptEvidenceBySlot = defineAnalysisRelation({
  id: "niceeval.attempt-evidence-by-slot",
  from: attemptEvidence,
  to: logicalSlots,
  on: exactAttemptIdentity,
});
```

relation 必须使用 durable anchors 与穷尽 cell state。不能按 label、时间接近或数值相等做 heuristic join。

Analysis callback 不选择另一个 Record root，也不动态读取任意 Artifact JSON。需要 Artifact 中某列参与比较时，Capture 必须同时
产生 typed Metric / Score；或者领域 package升级为由 NiceEval 拥有的新固定信封。

## Report 作者

Report 作者只 import fields：

```tsx
export const Overview = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { condition, memory },
    values: {
      passRate,
      costUSD,
      duration,
      energy: gpuEnergyJoules,
    },
  });

  return (
    <Grid columns={2}>
      <Bars points={rows} x="condition" y="passRate" color="memory" />
      <Scatter points={rows} x="costUSD" y="passRate" color="memory" />
      <Table rows={rows} />
    </Grid>
  );
});
```

允许的扩展：

- 新 Page / PageFamily；
- 用现有 primitives 写复合组件；
- 选择 fields、分组和呈现；
- 对 closed rows 做 display-only sort、limit 或 filter；
- 根据已经计算的 rows 决定是否展示区块，或继续调用另一组 `aggregate()`。

不允许的扩展：

- 读取 raw Run / Attempt / Attachment；
- 直接调用 projection；
- 在 Report 里定义 population、denominator 或 Measure 公式；
- 把 display-filter 后的 rows 当作新 population 重新聚合；
- 只实现 Web 或 terminal 一面的 primitive；
- 从 callback 取得 migration 或 Capture capability。

## Application maintainer

application 只安装普通 package 和 Plugin：

```ts
export default defineConfig({
  report: memoryReport,
});
```

旧数据需要平台升级时，maintainer 运行：

```console
niceeval migrate
niceeval migrate --yes
```

config 没有 `recordAttachments.install`、converter registry 或 executable migration module。Report module 的 import 只能提供
pure definitions、Analysis fields 与 trusted Report callback，不能扩大 maintenance authority。

## 添加能力时怎样判断层

| 新需求 | 应落在哪里 | 判断依据 |
|---|---|---|
| 采集 GPU joules | Metric Capture | 它是运行时 finite scalar fact |
| 保存 SQL rows | Artifact / Evidence Capture | 它是复杂材料，不直接分组聚合 |
| 从 SQL rows 得到 correctness | Score Capture | evaluator 在运行期形成 typed rubric |
| 计算 joules / passed eval | Analysis Measure | 它改变比较口径，不产生新历史事实 |
| 按 model 分组 | Analysis Dimension | 它定义 population 上的稳定字段 |
| 只显示前十名 | Report component option | 它不改变任何 MetricValue |
| 排除某类 Eval 后重算 | Analysis selection / population | 它改变 denominator，不能是显示过滤 |
| 增加 Sankey primitive | NiceEval Report core | 需要 terminal、Web、static 与可访问降级共同契约 |
| 保存第三方关系图并查询 | 不在该公共面 | 需要具体反例重新设计受限 advanced SPI |

## 0.12.1 DX 与执行保证

作者调用保持 `await aggregate(sample, ...)`、普通 async component 与 `Bars` / `Table` / `Scatter`。这套调用仍保留：

- frozen Sample；
- field DAG 的 cycle 与 population 检查；
- 同一次 execution 的精确 memoization；
- Page failure isolation；
- closed semantic tree；
- terminal、Web、static 共用 renderer input。

为此明确放弃 callback 前整份 Report 的全局依赖预编译。依赖在每次 `aggregate()` 调用时局部闭合，callback 不会 dry-run 或执行
两次。
