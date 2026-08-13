# Record → Analysis → Report

NiceEval 的运行、读取与报告共享同一份持久事实，但普通使用者不应先理解 Record schema、锁、generation、writer 或
migration graph。领域 API 先形成 sealed value；RecordAttachment adapter 才把它变成版本化事实。

本方向把产品心智收成三层，并让它们共用一个 `RecordAccessRuntime`。这里的“一套”不是万能 client：producer、host、
Analysis 与 Report 仍只拿各自最小 capability。

## 核心心智

```text
领域 API                     Analysis                         Report
   │                          这些事实说明什么                  怎样让人看懂
   ▼
sealed value
   │
Record adapter → Record  →   选范围、投影、关联、计算    →     页面、终端与静态站
                 发生了什么
```

| 层 | 输入 | 输出 | 屏蔽什么 | 必须保留什么 |
|---|---|---|---|---|
| Record | sealed domain value 或 canonical root | immutable Run、Attempt、Attachment 与 frozen view | path、layout、锁、generation、blob closure、verified cache | owner、schema identity、读取六态、migration 要求、出处 |
| Analysis | 同一 frozen view 上的已发布事实 | nominal population 上的 Dimension、Measure、关系、coverage 与 evidence | reader、decode、owner lookup、跨 package 机械对齐 | Sample 分母、每 row 状态、issues、refs、unmatched／ambiguous |
| Report | 同一 population 的 Analysis fields | typed `ReportData` 与 terminal、web、static export 共用的闭合语义树 | Record I/O、迁移、projection plumbing、renderer 内部机制 | host problems、数值口径、coverage 与下钻引用 |

Selection、Projection、Relations 与 Derivation 是 Analysis 内部步骤，不是四层额外产品心智。

## 三层各自怎样扩展

| 想做什么 | 扩展单位 | 作者看到的入口 |
|---|---|---|
| 保存一种新事实 | RecordAttachment adapter + producer-facing domain API | 普通 Eval 只调用领域 Plugin／配置 |
| 增加分组、指标或跨事实关系 | `AnalysisPopulation`、`Dimension`、`Measure`、`AnalysisRelation` | Analysis script 用 `analyze()`；Report 只 import fields |
| 增加页面、图表或复合组件 | `aggregate()`、Page／PageFamily、semantic primitives | `ReportData` + `Bars`／`Table`／`Scatter` |

三层不等于三类人。普通 Eval 作者、领域 SDK 的 Record 作者、Analysis 作者、application maintainer 与 Report 作者拥有
不同 import surface 和 authority；完整分工见 [Authoring 与扩展边界](authoring.md)。

## 普通用户只与领域 API 交互

Assertions、File Diff 与 Timing 的普通调用面分别是 `t.check`、`t.sandbox.*` 与 Agent tracing 配置。第三方 GPU SDK 的
普通调用面同样是领域 Plugin：

```ts
export default defineEval({
  plugins: [
    gpuEnergy({
      meter: nvmlEnergyMeter({ device: 0 }),
    }),
  ],
  async test(t) {
    await t.send("完成任务");
  },
});
```

Eval、Experiment 与 Hook context 不暴露 Record 方法、write grant 或 versioned payload。领域 SDK 作者才使用
[`niceeval/record/adapter`](../record-attachment-authoring/README.md)，把 sealed value、版本、migration 与 projection
收在 adapter 内。

## 一套 Record 子系统，三种 host facet

一个 canonical root 只打开一个 `RecordAccessRuntime`：

| facet | 能做什么 | 谁持有 |
|---|---|---|
| `RecordSnapshotSource` | 在 child Scope 内取得 fresh `RecordReader` | Analysis／Report host |
| `RecordInvocationAccess` | snapshot 能力，加 `withWriteSession()` | Invocation coordination |
| `RecordMaintenanceAccess` | inspect、clean、plan、plan-bound authorization 与 migrate | maintenance CLI／host |

Invocation 从 write session 为每个 mounted binding 派生 host-internal owner lease。adapter binding 与 official binding 都
提交同一 canonical command；producer 从不拿 root runtime。

## 一条事实的五个动作

```text
SDK 定义 adapter + 领域 API
  → owner-specific binding 生产 sealed value
  → host 显式安装 opaque installation，并按需显式 migrate
  → SDK 定义 population 上的 Dimension / Measure
  → Report 用 aggregate + semantic component 组合 closed value
```

official Timing 与 third-party GPU 都走这五步。官方只多一枚 package-private namespace authority 与固定的
installation package owner；它没有 parallel writer 或 raw draft bypass。

## 选定的 Design PLAN

| 决策 | 采用 | 保证 |
|---|---|---|
| [Record access runtime](../../design/record-runtime/DECISION.md) | [PLAN-2](../../design/record-runtime/PLAN-2/README.md) | 同一 root 的资源 owner、facets、generation 与 verified cache 统一 |
| [Observability package layout](../../design/observability-package-layout/DECISION.md) | [PLAN-1](../../design/observability-package-layout/PLAN-1/README.md) | 七个 logical family 各自拥有 adapter 与 migration |
| [Projection API](../../design/projection-api/DECISION.md) | [PLAN-1](../../design/projection-api/PLAN-1/README.md) | direct call 返回 closed `ProjectedSample`；SDK 再包装领域 API |
| [Relations API](../../design/relations-api/DECISION.md) | [PLAN-1](../../design/relations-api/PLAN-1/README.md) | package-owned pure assembler 与穷尽 population |
| [Report authoring](../../design/report-authoring/DECISION.md) | [PLAN-6](../../design/report-authoring/PLAN-6/README.md) | static Analysis fields、typed `ReportData` 与 descriptor components |

Report 作者不声明 projection manifest 或 Calculation registration。host 从 `ReportData` 收集本次需要的有限 Analysis
fields，编译依赖闭包并在 Page／PageFamily 展开前 materialize。它不是全程序、动态或可由 callback 扩张的 graph。

## 范围

本方向包含：

- 一个 root runtime 下的 snapshot、invocation 与 maintenance facets；
- sealed domain value → adapter binding → canonical command；
- total producer obligation 与 fresh Analysis snapshot；
- Analysis selection、Projection、Relations、nominal population、Dimension 与 Measure；
- ReportData dependency closure、host 读取入口与 closed descriptor callback；
- 官方 OTel Timing 与用户 GPU 扩展两套完整纵向用例；Assertions 与 Diff 作为官方领域变体；
- verified-read cache、reuse planning 与 migration 的分权。

本方向不增加通用 context extension、Record event log、全程序／动态 Derivation graph 或第二套 Report 查询语言。本次
`analyze({ fields })` 或 Report 引用的 fields 仍形成一张有限、静态 dependency DAG。

## 入口

- [Library](library.md) —— runtime facets、adapter handoff、Analysis fields、ReportData 与精确执行入口。
- [Architecture](architecture.md) —— 三层责任、能力边界、中立 kernel 与不变量。
- [Authoring](authoring.md) —— 五类角色、每层怎样自定义与扩展，以及不可能三角的裁决。
- [Lifecycle](lifecycle.md) —— binding、write session、fresh snapshot、Report 与显式 migration 时序。
- [Use Case](use-case/README.md) —— 官方能力与用户扩展两套完整语法，以及共用的 host lifecycle 切片。
