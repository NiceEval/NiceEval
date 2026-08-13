# 固定事实信封上的三层 API 候选

> 观察日期：2026-08-13
>
> 状态：经过独立设计挑战的研究候选，不是 NiceEval 目标契约

本候选回答一个收缩后的问题：NiceEval 不再让每个第三方包扩张持久化 schema 后，用户还能否写自己的数据、分析它，并用
接近 0.12.1 的语法构建 Report。

研究判断是可以，但需要把「可扩展」说准确：该候选让第三方扩展 typed Metric、typed Score 与 opaque Artifact，不开放任意
durable schema、关系对象或 executable migration。这个判断是 beta 的产品范围选择，不是因为五个外部产品没有公开
schema SPI，就证明更强扩展永远没有价值。

## 先给普通用户看的心智模型

普通 Eval 作者只做两件事：选择领域能力，然后运行测试。

```ts
export default defineEval({
  plugins: [
    otelTiming(),
    gpuEnergyPlugin({ meter: nvmlEnergyMeter({ device: 0 }) }),
  ],

  async test(t) {
    await t.send("完成任务");
  },
});
```

报告作者只选择已经定义好的分析字段，然后画图。

```tsx
const rows = await aggregate(sample, {
  by: { condition, memory },
  values: { passRate, duration, gpuEnergyJoules },
});

return (
  <Bars
    points={rows}
    x="condition"
    y="gpuEnergyJoules"
    color="memory"
    layout="horizontal"
  />
);
```

两者都不接触 `Record`、projection、schema version、converter、writer、lock 或 cache。用户心智只有三层：

```text
Capture   发生了什么
    ↓
Analysis  按什么口径比较
    ↓
Report    怎样呈现给人

内部：Record 保存 frozen facts；niceeval migrate 升级平台拥有的存储表示。
```

## 三层不是三类人

三层描述依赖方向，不要求每个包只能待在一层。一个领域 SDK 可以同时发布 Capture 能力和 Analysis fields，但不能把持久层权限
交给应用。

| 角色 | 自定义或组合什么 | 不需要理解什么 |
|---|---|---|
| 普通 Eval 作者 | 选择 Plugin；必要时封口一个已注册的 Capture | Record、schema、producer fingerprint、migration、Analysis DAG |
| 领域 SDK 作者 | 定义 Metric / Score、Plugin lifecycle 与相应 Analysis fields | Record writer、owner lease、converter、installation、Report host |
| Analysis 作者 | 定义 Dimension、Measure、relation、denominator 与 rollup | Record I/O、renderer、图表 |
| Report 作者 | 用 `aggregate`、Table、Bars、Scatter、Page 组合 Analysis fields | raw facts、projection、Capture、migration |
| 应用与操作者 | 安装普通领域 Plugin；运行 `niceeval migrate` | executable Record capability 与第三方 converter |

每层分别屏蔽的细节如下：

| 层 | 作者回答的问题 | 公开对象 | 平台屏蔽的细节 | 作者仍须明确的语义 |
|---|---|---|---|---|
| Capture | 这次运行发生了什么 | 领域 API、Metric Capture、Score Capture、Artifact | Record、writer、owner lease、schema version、blob path、migration | 事实 identity、producer、值或状态、labels、Evidence refs |
| Analysis | 事实怎样成为可比较结果 | Dimension、Measure、Analysis relation | decode、跨版本读取、原始 owner、renderer | population、denominator、missing、三段 rollup、coverage、producer compatibility |
| Report | 结果怎样交给人看 | `aggregate`、Page、Table、Bars、Scatter | raw facts、projection、migration、terminal/Web 差异 | 分组、排序、显示格式、图形、下钻 |

Storage / Migration 是内部边界，不是第四个作者层。

## 候选开放的三个扩展单位

| 种类 | 用户可以扩展什么 | 可以查询与聚合什么 | 明确不允许什么 |
|---|---|---|---|
| Metric | 新的数值事实 identity、单位、有限 enum labels | finite scalar、声明过的 labels、状态、uncertainty、producer、refs | timestamp、step、顺序、动态 key、嵌套 payload |
| Score | 新的 evaluator identity 与预声明 rubric | number / boolean / enum rubric、状态、producer、Evidence refs | 动态 rubric、自由可查询 metadata、向旧 Attempt 追加 |
| Artifact | 新的日志、图片、表格、SQL 结果或大 JSON | identity、media type、refs；内容用于查看或下载 | 自动把内容字段变成 Dimension 或 Measure |

OTel Timing、Assertion / Evidence、File Diff、Conversation 与 Usage 是 NiceEval 官方固定事实。它们经过相同的内部提交、快照
和读取核，但第三方不能重定义其 schema。

### 这些定义仍然是 schema，只是受限

不能把 typed definition 宣传成「没有 schema」。本候选使用以下硬边界，正式契约可以调整数字，但不能取消有限性：

| 边界 | 候选上限 |
|---|---|
| definition ID | 最多 160 个 ASCII 字符 |
| 一个 Metric 的 label keys | 最多 8 个；每个 key 最多 64 个 ASCII 字符 |
| 一个 enum label 的 members | 最多 64 个；每个值最多 128 UTF-8 bytes |
| 一个 Metric Capture 的 cells | 最多 256 个唯一 coordinates |
| 一个 Score 的 rubrics | 最多 64 个；每个 rubric ID 最多 64 个 ASCII 字符 |
| 一个 enum rubric 的 members | 最多 64 个；每个值最多 128 UTF-8 bytes |

Metric 只接受 finite number。绝对 uncertainty 必须是 finite、non-negative number。Score rubric 只接受预声明的 number、
boolean 或 enum。自由解释、SQL 结果与文件进入 Evidence / Artifact，不成为隐藏的查询 schema。

每条事实保存 canonical definition snapshot 与 fingerprint。平台只接受完全相同的定义，或以下内建的单调演进：

- 新增 optional label 或 optional rubric；旧事实得到显式 `missing`，不会被补默认值。
- 给既有 enum 增加 member。
- 改显示名、格式、颜色或 catalog alias；alias 不参与事实 identity。

改名、删除、值类型、unit、observation granularity、bounds 含义或事实语义改变时，必须发布新 ID。跨 ID 的 convert、union 或
side-by-side comparison 只能由 Analysis 显式声明，不能迁移或重解释旧事实。

## Capture：先声明义务，再恰好封口一次

### 用户 GPU Energy

领域包先定义事实的长期含义：

```ts
import { defineMetric, enumLabel, optionalEnumLabel } from "niceeval";

export const gpuEnergy = defineMetric({
  id: "com.example.gpu-energy",
  unit: "J",
  labels: {
    source: enumLabel(["device-estimate", "nvml"]),
    device: optionalEnumLabel(["gpu-0", "gpu-1"]),
  },
  uncertainty: "absolute",
});
```

定义说明「这个量是什么」。Capture 另行说明「谁用什么行为产生」：

```ts
export const energyCapture = defineMetricCapture({
  metric: gpuEnergy,
  producer: {
    id: "com.example.nvml-meter",
    behaviorVersion: "2",
    config: { sampling: "attempt-boundary" },
  },
  required: false,
  expectedCoordinates: [
    { source: "nvml", device: "gpu-0" },
  ],
});
```

`producer.config` 是 canonical plain data；固定信封保存其 fingerprint，不保存 callback、Layer 或其它 executable capability。
Metric identity 表达事实含义，producer identity 表达测量行为。`source` 只是领域维度，不能代替 producer identity。

普通一次性作者必须先在 Eval 注册 Capture token，再在 Attempt open 期间恰好封口一次：

```ts
export default defineEval({
  captures: [energyCapture],

  async test(t) {
    const measurement = await measureGpuEnergy();

    await t.metric(energyCapture).seal({
      state: "available",
      cells: [{
        labels: { source: "nvml", device: "gpu-0" },
        value: measurement.joules,
        uncertainty: { absolute: measurement.uncertaintyJoules },
      }],
    });
  },
});
```

这里没有 `t.metric(gpuEnergy, value)` 这种未声明写入，也没有字符串 event log。可复用 SDK 把 Capture token 与 open / collect /
seal lifecycle 藏在 Plugin 里，普通 Eval 作者只配置前文的 `gpuEnergyPlugin(...)`。

### total obligation

每个已挂载 obligation 必须恰好封口一次。状态必须保持可区分：

| 结果 | 含义 |
|---|---|
| `available(0)` | 合法零值，不是 missing |
| `empty` | producer 成功运行，但领域上没有结果 |
| `unavailable(reason)` | 当前宿主运行条件无法取得结果 |
| `failed(error)` | producer 执行失败，但确实完成了失败封口 |
| 未封口 | SDK 违反 producer contract |

漏封、重复、foreign 或 Attempt 关闭后的 late seal 都令 Attempt 失败。显式 `failed` 已履行封口义务；`required: true` 时它令
Attempt 失败，`required: false` 时 Attempt 可结束，但失败状态必须进入 Analysis，不能退化成 missing。

一次 Metric seal 是原子的 bounded finite coordinate set，不是事件流：

- 每个 cell 只有 finite scalar、完整的已声明 enum labels、可选 uncertainty 与穷尽状态。
- 完整 coordinate 在 bundle 中唯一；没有 timestamp、step、顺序或嵌套 payload。
- obligation 声明 `expectedCoordinates` 时，每个 coordinate 必须恰有一个 cell state；缺、多或重复都是 contract violation。
- 没有声明 expected set 时，实际 cells 只代表观察到的集合，系统不能声称发现了漏掉的设备。
- 整个 bundle 也可以原子封口为 `empty`、`unavailable` 或 `failed`。

## Score 与外部 SQL Evidence

用户可以自己运行 SQL、保存结果并展示，但不能把任意 SQL 列静默变成 Record schema。领域 evaluator 先预声明 Score rubric：

```ts
export const dataQuality = defineScore({
  id: "com.example.data-quality",
  rubrics: {
    correctness: numberRubric({ min: 0, max: 1, required: true }),
    freshness: enumRubric(["fresh", "stale"], { required: false }),
  },
});

export const dataQualityCapture = defineScoreCapture({
  score: dataQuality,
  producer: {
    id: "com.example.sql-check",
    behaviorVersion: "3",
    config: { queryVersion: "2026-08-13" },
  },
  required: true,
});
```

运行时由用户代码执行查询。原始 rows 作为官方 Evidence / opaque Artifact 保存；可比较判分结果进入预声明 Score，并精确引用材料：

```ts
const rows = await warehouse.query(checkSql);
const evidence = await t.evidence.attach({
  name: "quality-check.json",
  mediaType: "application/json",
  value: rows,
});

await t.score(dataQualityCapture).seal({
  state: "available",
  rubrics: {
    correctness: {
      state: "available",
      value: calculateCorrectness(rows),
      evidence: [evidence.ref],
    },
    freshness: {
      state: "available",
      value: classifyFreshness(rows),
      evidence: [evidence.ref],
    },
  },
});
```

一次 evaluator invocation 原子封口整个 rubric bundle。required rubric 必须给出 `available | empty | unavailable | failed`，
optional rubric 可以 absent；也可以封口 bundle-level failure。rubric 不能在运行时增加，自由 explanation 只能进入 Evidence /
Artifact。

该候选中的 Score 只能在原 Attempt Capture lifecycle 中产生。「历史重分析」只表示用新 Analysis / Report 读取同一批 frozen facts，
不表示向旧 Attempt 追加新 evaluator 结果。未来如需 post-hoc 持久判分，应新增 NiceEval 拥有的 immutable Assessment
Run，引用旧 Attempt 与 frozen Evidence，而不是重开旧 owner。

## Analysis：定义口径，不重新读 raw facts

同一个 typed definition 产生 typed labels，领域包发布具名 Measure：

```ts
import {
  allLogicalSlots,
  mean,
  metricMeasure,
  requireComparableProducer,
  sum,
} from "niceeval/analysis";

export const gpuEnergyJoules = metricMeasure(gpuEnergy, {
  producers: requireComparableProducer(),
  withinAttempt: sum,
  withinEval: mean,
  acrossEvals: mean,
  denominator: allLogicalSlots,
  missing: "partial",
});

export const gpuEnergySource = gpuEnergy.labels.source;
```

多 cell Metric 必须显式经过：

```text
withinAttempt → withinEval → acrossEvals
```

Measure 保留 value、observed / denominator、state、issues、Evidence refs 与 producer compatibility。合法零值、cell missing、
bundle failure 和 producer contract violation 不能合并。多个 producer 的事实不能静默混算；Analysis 必须要求相同 producer、按
producer 分组，或明确声明一条跨 producer 可比 policy。

Analysis 作者只能读取固定事实投影和已经发布的 fields / relations。新增 population、Attempt 成员表或关系必须形成具名
Analysis definition，不能让 Report 临时过滤 raw Sample 改分母。

## Report：恢复 0.12.1 的调用体验

Report callback 获得受限的 `ReportSample`。它能看到 frozen identity、selection 描述与整体 coverage / problem 摘要，但不能：

- 枚举 raw Run / Attempt。
- 用任意函数 `.filter()` 改变 Sample population。
- 读取官方或自定义 raw facts。
- 调用 projection 或 Record reader。

需要 Attempt 明细、成员表或新的 population 时，Analysis 先发布 identity Dimension、Measure 或具名 relation。Report 可以对
`aggregate()` 返回的 closed rows 做显示排序、limit 或 filter，但不能重算 MetricValue 或缩小 denominator。

```tsx
export const Leaderboard = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: {
      condition,
      memory,
      source: gpuEnergySource,
    },
    values: {
      passRate,
      costUSD,
      duration,
      gpuEnergyJoules,
    },
  });

  return (
    <Bars
      points={rows}
      x="condition"
      y="gpuEnergyJoules"
      color="source"
      sort={{ field: "gpuEnergyJoules", direction: "asc" }}
      layout="horizontal"
    />
  );
});
```

报告作者不写 projection、join、Calculation state、并行数组或 branded ID。`Bars` 负责视觉语义和 terminal fallback；Table、
Scatter 与 Page 使用同一套 closed semantic components。

### Report 的不可能三角怎样取舍

以下三件事不能在普通 data-dependent JavaScript callback 中同时成立：

1. callback 像 0.12.1 一样只执行一次，并可依据已算出的 rows 分支。
2. 在任何 callback 执行前，预编译整份 Report 的全部依赖。
3. 只执行当前请求的 page，并隔离其它 page 的失败。

本候选保留第 1、3 项，放弃「callback 前预编译整份 Report」。具体模型是：

- `aggregate(sample, fields)` 第一次调用时编译自己的有限 field DAG，先拒绝 cycle、population 与 identity 错误，再 materialize。
- callback 每个 page instance 只执行一次；不 dry-run，也不双执行。
- 同一次 `ReportExecution` 按 frozen Sample identity 与 nominal field/dependency identity memoize，多个 page 可以复用。
- callback 可以根据已经 materialize 的 closed result 分支，再调用另一个 `aggregate()`。
- 只执行请求的 page；page failure 局部化。静态导出则在同一次 execution 中显式枚举需要发布的 page instances。
- execution 结束后只留下 closed semantic tree；reader、Sample handle、Promise 与 callback 不逃逸。
- terminal、Web 与 static face 消费同一棵 closed tree。

硬保证只到同一次执行。普通 JavaScript callback 的跨执行纯度是 trusted-author contract，不是 sandbox 的机械保证；输出 provenance
保存 Report module fingerprint、Sample identity、selection 与 host version。不同 CLI / view execution 不承诺共享 cache 或产生
逐字节相同输出。将来若需要不信任作者时仍机械可复现，应另建 restricted declaration / isolate，而不是把两种保证混在一起。

## 官方 OTel Timing、Assertion 与 File Diff

官方事实不要求用户定义 Metric，也不暴露 Record 名字：

```ts
export default defineEval({
  tracing: otelTiming(),

  async test(t) {
    await t.send("完成任务");
  },
});
```

NiceEval instrumentation 形成官方 Timing；Analysis 发布 `duration`、`firstTokenLatency` 等 fields。Report 与用户 GPU Energy
使用相同 `aggregate()`：

```tsx
const rows = await aggregate(sample, {
  by: { agent },
  values: { passRate, duration, firstTokenLatency, gpuEnergyJoules },
});

return <Table rows={rows} />;
```

Assertion、Evidence 与 File Diff 同样保留自己的官方语义：

```ts
await t.check("生成了迁移文件", async (assert) => {
  const diff = await t.sandbox.diff();
  assert.fileChanged(diff, "migrations/002_add_energy.sql");
});
```

NiceEval 保存 Assertion outcome、evaluator / producer identity 与实际使用的 exact Evidence refs。它们和 Metric 使用同一个内部
commit / snapshot / read core，不代表用户需要看见同一种 RecordAttachment schema API。

## migration：用户运行，平台定义

```console
$ niceeval migrate
Record v1 → v2
Metric envelope v1 → v2
2 runs, 41 facts

Run again with --yes to apply.

$ niceeval migrate --yes
Migration complete.
```

迁移规则：

1. NiceEval 发布并测试 Record Core 与固定事实信封的相邻 converter；用户包不提供 converter、installation 或 executable
   migration capability。
2. 普通读取发现旧版本时返回 `migration-required`，不自动改盘。
3. CLI 固定 source snapshot、验证完整计划并取得恢复点；所有转换成功后才原子发布新 snapshot，不部分发布。
4. unknown future envelope 必须连同 exact bytes 与完整 blob closure 原样 carry-forward；做不到时整个 migration fail closed，
   source 保持不变。
5. 第三方包消失后，平台仍可保存、显示和迁移 generic Metric / Score definition snapshot、value 与 Artifact；包特有 typed
   Analysis / bridge 只有恢复该包或 exact-compatible pure definition 后才可用。
6. 历史错误修复采用追加的具名 correction 或新 identity，并保留 provenance；不能原地改已发布事实，也不能伪装成 schema
   migration。

例如焦耳改为千瓦时必须发布 `com.example.gpu-energy-kwh`。Analysis 可以显式转换或并列比较两个 ID，历史焦耳事实永远保持原义。

## 什么时候重新考虑 advanced SPI

该候选明确不承诺：结构化第三方 tool event、用户关系对象、Artifact 内容字段查询，以及 post-hoc 持久判分。

满足以下任一证据门槛时，重新设计一个受限 advanced SPI：

- 两个相互独立的真实领域 SDK，无法在不损失原子性、关系或可查询语义的情况下映射到 Metric / Score / Artifact。
- 一个 NiceEval 核心 dogfood 场景出现同样问题，并且为它新增一个平台固定信封也不合理。

「将来可能有用」不够。触发后也不是恢复当前 RecordAttachment authoring 方案，而是根据具体反例重新划定数据形状、authority 与
migration 责任。

## 四个端到端验收场景

这四条不是自动化测试计划，而是候选进入 Roadmap 前必须能完整讲通的契约 walkthrough。

| 场景 | 必须通过的完整路径 |
|---|---|
| 官方 OTel Timing | `tracing` 配置 → 官方 Timing 信封 → duration / TTFT Analysis fields → `aggregate()` → terminal / Web / static。零值、缺失与失败可区分；公共面没有 Record API。 |
| 用户 GPU Energy | 运行前固定 obligation 与 producer identity → 原子 bounded coordinate bundle → withinAttempt / withinEval / acrossEvals → coverage 与 Evidence → Bars / Table。J 改 kWh 必须换 ID；包移除后 generic value 仍可显示和迁移。 |
| 外部 SQL Evidence 与第三方 Score | 用户代码运行 SQL → 原始 rows 进入 Evidence / Artifact → evaluator 原子封口预声明 rubric 并保存 exact refs → Analysis 聚合 Score → Report 展示数值并下钻材料。自由 explanation 不可查询，bundle failure 保持可见，不向旧 Attempt 后补。 |
| 旧数据迁移后重分析 | `niceeval migrate` 迁 Core / 固定信封 → unknown envelope 与 blob closure 完全保留 → compatible definition 重新声明并分析 → 新 callback 从同一 frozen Sample 生成 closed terminal / Web / static output。不能无损 carry 或 definition 不兼容时 fail closed。 |

## 候选之间的取舍

| 候选 | 写入体验 | 类型与分析 | migration 成本 | 本轮判断 |
|---|---|---|---|---|
| 任意 `t.log({ key: value })` | 最短 | 字符串键、缺值和单位容易漂移 | 平台无法迁用户语义 | 不作为默认面 |
| 固定信封 + typed definition + total obligation | 多一次定义与注册 | 同一 token 连接 Capture 与 Analysis；Report 只 import field | 平台迁信封，领域语义变化换 ID | **推荐候选** |
| 任意 RecordAttachment schema SPI | 表面最强 | 能表达任意 durable 类型 | 每个 SDK 承担 schema、converter、installation 与历史信任 | 无反例证据前不开放 |

推荐项不是关闭扩展。它开放新的事实名字、有限类型、producer、Analysis fields 与任意 Report 组合；关闭的是「应用随意增加持久化
类型和可执行迁移代码」。这保留了 NiceEval 的 frozen Sample、明确分母、coverage、Evidence refs、单次执行 memoization 与
closed static output，也让普通作者重新获得 0.12.1 的 Report 调用体验。
