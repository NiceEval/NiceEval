# 阶段一调用契约

阶段一只适用于普通 Adapter。Agent 多模型执行、Agent 物理请求上报与 Judge 物理费用账本后置。
既有 Agent 单模型入口保持；传入 models 的 Agent Experiment 明确拒绝，不任取一个用途执行。

## 作者配置

```ts
interface ModelSlotSelection {
  readonly model: string;
  readonly reasoningEffort?: string;
}
// Experiment 新增：
models?: Readonly<Record<string, ModelSlotSelection>>;
```

用途键匹配 `[A-Za-z][A-Za-z0-9_-]{0,63}`，最多 64 项。映射必须非空，每项 model 为非空模型标识。
models 与顶层 model、reasoningEffort 互斥。模型选择不复制进 flags；transport 路由可以保留在应用 flags。
框架不替应用选择路由，也不由路由或模型名推断 serving provider。

Adapter 必须将配置用于模型选择与支持的参数替换；不支持的 reasoningEffort 在开局前明确拒绝，不能静默忽略。
实际调用允许模型回退。配置意图与实际 provider/model 不同是可上报的事实，不是必须拒绝的结果。

## 唯一归一值

```ts
interface ResolvedModelSlot {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}
// AdapterCreateContext 新增只读值：
readonly models: Readonly<Record<string, ResolvedModelSlot>>;
// AdapterUsageInput 新增：
readonly modelSlot?: string | null;
```

归一只做一次，键按字典序排列并深度冻结。默认用途键固定为 `default`。
所有入口的 ctx.model 与 ctx.reasoningEffort 都派生自 models.default，null 对外映射为 undefined。
输入写法不参与派生判断，相同归一值不能产生不同执行行为。

| 输入 | 归一 models | ctx.model / ctx.reasoningEffort |
| --- | --- | --- |
| 完全省略模型配置 | 空映射 | 均 undefined，应用使用自身默认 |
| 仅 model | default 的 model，effort=null | model / undefined |
| 仅 reasoningEffort | default 的 model=null、给定 effort | undefined / effort |
| models 有 default | 原样归一 | 来自 default |
| models 仅有业务用途 | 原样归一 | 均 undefined；应用显式读取对应用途 |

显式用途项要求 model；仅 effort 的单模型简写保留原有原生默认语义。
没有已登记调用的配置项仍展示。显示 no-recorded-calls 不等于证明外部系统从未调用，不能制造零费用调用。

```ts
const selection = ctx.models.planner;
if (selection?.model == null) throw new Error("planner model is required");
// 交给应用自己的正式模型选择机制。
ctx.recordUsage({ ...actual, callId: physicalRequestId, modelSlot: "planner" });
```

modelSlot 缺席或 null 表示用途未登记，不自动归入 default。显式非空值必须引用本 Attempt 冻结配置中的键。
引用错误按既有采集错误规则拒绝，不能被 catch 后静默封存成功。实际 model 与配置不一致仍允许。

## 正式读取

阶段一不新增 Query operation。`attempt.usage` 仍按 locator 读取同一 PublicationCutoff，新增以下字段：

- configuredModels：`available` 时含按键排序的 bindings，每项为 modelSlot、model、reasoningEffort、recordedCalls；旧 Run 没有该字段时为 `not-recorded`。
- modelGroups：只分组普通 Adapter 的 recorded-calls。每项含 modelSlot、provider、model、recordedCalls、tokens、costs。
- judgeUsage：固定 `{ state: "unavailable", reason: "judge-usage-not-recorded" }`，不声称没有裁判请求。
- totalCosts：application 与 judge 的带缺口合计，含 state、values、missingSources。

应用费用继续读取 `usage.totals.costs`。已有 Overview、Run 与 Attempt 的 costUSD 继续表示应用费用，不静默改成总费用。
`usage.judgeUsage` 表达阶段一的裁判用量缺口。`usage.totalCosts` 的 values 只包含已知应用费用小计，不能当作完整预算。

modelGroups 的每个 tokens 只含 inputTotalTokens、outputTokens、totalTokens，复用官方数值完整度与已知小计语义。
costs 复用既有按币种的 effective cost、coveredCalls、reportedCalls、estimatedCalls 和 totalCalls。
分组键是 modelSlot/provider/model 的精确三元组，null 独立分组，不从配置补实际模型或 provider。

modelGroups 还包含 basis、state、groups、totalGroupCount、groupsTruncated、omittedGroupCount。
有合法 Adapter 账本时 basis=recorded-calls，state=available；数组按三元组字典序排序，null 排在字符串之前。
最多返回 64 组；totalGroupCount 与 omittedGroupCount 基于全部最多 4000 次已封存调用。每组统计也基于全部调用。
这里是有界预览，没有翻页 token；不能把前 128 条调用预览用于分组或费用重算。

缺少 Adapter 账本时 modelGroups 为 unavailable、groups=[]、totalGroupCount=null、omittedGroupCount=0。
Agent 只声明 basis=reported-sends 和 physical-call-identity-not-recorded 原因，不将配置模型或 adapter.name 移入实际物理分组。
其他缺源为 basis=unavailable，并保留原因。数组空不代表统计为零。

configuredModels 与 modelGroups 分开读取，未调用配置不会凭空形成一组调用。
每个配置项的 recordedCalls 由全部合法封存账本计算，不受 64 组或 128 calls 预览限制。
合法账本中 recordedCalls=0 只表示该用途无已登记调用；缺源或 invalid 时为 null。
Show/View 只按这个计数区分无已登记调用与调用被预览省略，不能检查 groups/calls 数组缺席来推断。
单 Attempt 用量服从 512 KiB 输出界，完整实验 aggregate/cells 与费用摘要服从 4 MiB 输出界；超过时返回正式有界错误，不能截断金额或改成零。

## 费用缺口

应用缺源、partial 或未计价调用都保留。totalCosts.values 每项只有 currency、value、source，表示已知小计。
missingSources 阶段一必含 judge；应用费用非 complete 时还含 application。
有任何已知金额时 totalCosts.state=partial，否则为 unavailable；明确已知零仍是一个金额，不变成缺席。
不同货币分别列出，不换算。totalCosts 不给无法证明的总物理调用数或应用与 Judge 的合并 covered count。

## Show 的实验范围

`show --experiment <id>` 保留正式选中成员的 Summary 与 Attempts，增加 Models and usage 区。
每个 origin Attempt 复用同一 usage 读面，标出 locator 与 origin Run；相同 origin 只展示一次。
不同 Run 的配置不合并成一个虚构配置，费用不从已截断的调用或模型组预览重算。

`experiment.get.modelUsage` 包含 attempts（locator、originRunId、usage）、totalAttemptCount、omittedAttemptCount、unresolvedAttemptCount。
usage 仅包含 state、configuredModels、modelGroups、judgeUsage、totalCosts、totals，不重复调用原文预览。

最多展示 64 个去重 Attempt，按 originRunId、locator 排序；未找到的成员和省略数单独显示。
每个 usage 是该 Attempt 的完整账本统计与有界预览，不声称展示区域是实验完整费用合计。

单模型保持简洁摘要，多模型按用途逐行列配置，实际调用另表列用途、serving provider、实际模型、调用数、tokens 与应用费用完整度。
Judge 不可用与带缺口的总费用小计分别显示；缺源、未知费用与没有已登记调用不能共用一个零值。
