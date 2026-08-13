# Record → Analysis → Report —— Authoring 与扩展边界

这套产品只有三层，但不只有三类人。三层回答“能力放在哪里”，角色回答“谁可以取得哪种 authority”。不要为了让一段
demo 看起来只有一次调用，就把 producer mount、历史读取安装与 migration 授权合成一个 capability。

## 先按问题选层

```text
需要保存一个以前没有的事实？          → Record
已有事实，要增加分组、指标或关系？      → Analysis
已有字段，只想改变页面、排序或图表？    → Report
需要全新的 terminal/Web/static 形状？  → NiceEval core primitive
```

这也是普通用户唯一需要记住的心智：**Record 记发生了什么，Analysis 定义这些事实说明什么，Report 决定怎样让人看懂。**

## 五类角色

| 角色 | 写什么 | 可以扩展什么 | 明确拿不到什么 |
|---|---|---|---|
| 普通 Eval 作者 | `t.check`、`t.sandbox.*`、tracing 配置或 `gpuEnergy({ meter })` | 启用领域能力、配置 collector | Record command、Attachment schema、owner lease、migration |
| 领域 SDK 的 Record 作者 | sealed domain value、adapter、producer binding、opaque installation | 新 fact family、版本、相邻 migration、领域采集 API | canonical root、通用 writer、application 的 migration authority |
| Analysis 作者 | population、relation、dimension、measure | 新分组字段、指标口径、跨 population 的显式关系 | Record writer、页面 renderer、启发式 join |
| application maintainer | 安装 SDK 导出的 opaque installation，显式 plan／authorize／migrate | 决定本应用信任哪些历史读取与 converter | 从 Plugin mount 自动推导 migration trust |
| Report 作者 | `aggregate()`、Page／PageFamily、`Bars`／`Table`／`Scatter` 与纯组合组件 | 字段组合、页面结构、显示排序、截断、格式与布局 | Sample handle、projection、Effect、reader、migration、业务公式 |

同一个人可以同时戴多顶帽子，但 import surface 和 authority 仍按角色分开。例如 GPU SDK 分别导出
`gpuEnergy()` 与 `gpuEnergyRecordInstallation`；application 显式挂载前者、显式安装后者。Plugin mount 不自动安装
历史读取或 migration trust。

## Record：扩展事实，不给普通用户一把 writer

领域 SDK 作者在 [`niceeval/record/adapter`](../record-attachment-authoring/README.md) 内完成四件事：

1. 定义 sealed domain value 与版本化 Attachment family；
2. 把 collector lifecycle 封成 owner-specific binding；
3. 导出普通 producer-facing 领域 API；
4. 单独导出供 application 安装的 opaque installation，并声明相邻 migration。

普通 Eval 作者只看到领域 API：

```ts
export default defineEval({
  plugins: [gpuEnergy({ meter: nvmlEnergyMeter({ device: 0 }) })],
  async test(t) {
    await t.send("完成任务");
  },
});
```

他不会看到 `ctx.record(...)`、Attachment owner/ref、schema version、lock、cache 或 migration。SDK 也不能公开一条
“任意 key + 任意 JSON”的逃生写口；新增事实必须拥有自己的领域语义、total producer obligation 与版本族。

## Analysis：扩展可复用问题，不把 join 交给 Report

Analysis 的公开扩展单位是：

- `AnalysisPopulation<Row>`：名义化的行总体，拥有稳定 row identity 与穷尽规则；
- `Dimension<Population, Value>`：在该 population 上分组或标识的字段；
- `Measure<Population, Value>`：在该 population 上带聚合、分母与证据 policy 的读数；
- `AnalysisRelation<From, To>`：由 SDK 拥有、从一个 population 显式形成另一个 population 的穷尽关系。

“每个 logical slot 一行”是 grain 的解释文字，不是字符串兼容协议。两个字段只有在类型与运行期 nominal identity 都指向
同一个 population 时才能一起聚合。跨 population 必须先由 Analysis SDK 通过具名 relation 形成目标 population 上的
字段；Report 不调用 join，也不自动寻找 relation path。

Analysis 作者可以新增字段而不新增事实。比如 GPU SDK 从已保存的事实导出 `gpuSource` 与
`gpuEnergyJoules`；MemoryBench Report 只 import 这些字段。普通 Analysis script 使用 `analyze()` 取得 closed rows，
而不是自己重开 reader。精确 constructor、聚合 policy 与失败语义见 [Library](library.md#analysis-作者面)。

## Report：组合字段，不再手写 projection plumbing

Report 作者的默认问题形状回到容易阅读的业务语法：

```tsx
const leaderboard = aggregate({
  by: { condition, memory },
  values: { passRate, costUSD, gpuEnergyJoules },
});

export const Leaderboard = defineComponent(() => (
  <Bars
    points={leaderboard}
    x="condition"
    y="passRate"
    color="memory"
    sort={{ field: "passRate", direction: "desc" }}
    layout="horizontal"
  />
));
```

这恢复的是 0.12.1 的业务词汇、调用形状与阅读成本，不是行为兼容：

- `aggregate({...})` 返回静态、typed `ReportData` declaration；它不是数组，不能 `await`，也没有
  `.map()`／`.toSorted()`；
- `aggregate()`、`defineComponent()` 与 Page `render` 在定义期只建立 descriptor，不取得 `sample` 或 `ctx`；
- Report 作者不看到 `RecordProjection`、`reportInputs()`、`defineCalculation()`、`completeness`、Effect、`Either`、
  branded id 或 Calculation state；
- population narrowing、排除规则、ratio、denominator、两级聚合与新 measure 都属于 Analysis；
- `sort`、`limit` 与可见性选择只作用于已经 materialize 的行，不重算 `MetricValue` 或缩小 denominator。

`ReportData` 的每行拥有 opaque `ReportRowKey`。`aggregate()` 用 population identity 与完整 grouping coordinate 形成它；
measure、排序、截断与格式都不改变身份。`Bars`、`Table` 与 `Scatter` 自动消费每个 measure channel 自己的 value、state、
unit、format、better、observed／denominator、issues 与 refs，不把多个 channel 的 coverage 或 evidence 提前合并。

## 三种 Report 扩展

### 组合已有组件

`defineComponent()` 只纯组合现有 semantic primitives，可以由 application 或领域 SDK 发布：

```tsx
export const EnergyLeaderboard = defineComponent(() => (
  <Section title="GPU energy">
    <Bars points={leaderboard} x="condition" y="gpuEnergyJoules" />
    <Table rows={leaderboard} />
  </Section>
));
```

组件 callback 不能返回新的数据依赖。它可以被多个 Page 复用，但不会在 render 时读取 Record 或执行 arbitrary I/O。
Report module 是可信 TypeScript，不是安全沙箱；直接 import `node:fs` 属于作者违反契约，不表示 API 授予了 I/O
capability。

### 添加动态详情页

`PageFamily` 只能作为 `defineReport({ pages })` 的顶层 page declaration。它接收静态 `ReportData`、一个声明为 stable
identity 的 Dimension，以及只消费 closed row 的 route／render callback。family 的 `target(key)` 返回绑定该 family
object identity 的 typed target；Report 不用直接 route string 猜目标。

family 必须显式列入 `pages`。definition compile 验证它已注册；materialization 再验证 key 唯一、instance 存在且 route
无冲突。普通 `<ForEach>` 即使存在，也只重复当前页面 block，不能注册全局 route。

Evidence 自动下钻只在三个条件同时成立时形成：一个 `MetricValue` 恰好一个 ref、Report 为该 evidence kind 显式声明了
唯一默认 PageFamily、对应 instance 确实存在。否则 refs 与 coverage 原样保留，但不伪造链接，也不从多个 refs 中任选
一个。组件不能暗中增加 Page、projection 或数据依赖。

### 添加全新视觉形状

普通用户不能插件式增加新的 host primitive。新的 `ReportBlock`／Chart mark 必须进入 NiceEval core 契约，并同时定义
terminal、Web 与 static face、无 JavaScript 降级、键盘行为、exact values、evidence 与稳定 identity。普通扩展使用
`defineComponent()` 组合已有 primitive；这条限制换来三种 host 不会各自解释一套报告。

## TSX runtime

Report TSX 使用 NiceEval 自有的 `niceeval/report` JSX runtime，不依赖 React，也不接受 `<div>` 等 DOM intrinsic。

- `niceeval show/view --report ./reports/example.tsx` 的 loader 自动使用该 runtime，命令侧零配置；
- 普通 `tsc`／编辑器检查需要让项目 `tsconfig` extend package 提供的 report preset，或在单文件声明
  `/** @jsxImportSource niceeval/report */`；
- `ReportExecution` 与 static export 只保存闭合 semantic tree，不携带 JSX runtime、React 或浏览器查询代码。

“CLI 零配置”不等于所有 TypeScript 工具链绝对零配置。

## 不可能三角的裁决

以下三项不能同时成立：组件可在 render 时任意异步取数；host 在 render 前知道全部依赖并只投影一次；作者面没有任何
声明／编译阶段。本方向放弃第一项，保留后两项：

```text
定义 descriptor
  → 编译本次 Report 的有限依赖闭包
  → 每个 projection／Analysis field materializer 至多执行一次
  → 展开 Page／PageFamily
  → 形成 closed ReportExecution
```

这不是全程序 Analysis graph。host 只编译本次 `analyze({ fields })` 或 ReportData 引用的有限 DAG；callback 不能在
materialization 后追加 node。cycle、population mismatch 与 field identity collision 在任何 Record I/O 前拒绝。
