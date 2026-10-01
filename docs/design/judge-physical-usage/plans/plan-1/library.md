# 公开读取与展示

## 作者接口

现有 closeQA、defineJudge、受管 ScoreMatch 无需新参数。现有 defineConfig.pricing 可为请求模型提供明确价格。
不新增 recordJudgeUsage，Adapter 不承担裁判统计。t.usage 继续表示被测应用用量。

## Query

attempt.usage 保留应用 calls/totals/modelGroups，judgeUsage 改为以下联合。experiment.get 每个 origin Attempt 使用不含调用预览的 JudgeUsageSummary。
所有 number 计数为非负安全整数。TokenTotal 沿用 available/partial/unavailable、value:number|null、observationCount。

CostTotals 沿用应用的费用字段：state、source、values、totalCalls；每币种保留 coveredCalls、totalCalls 与 reported/estimated 计价依据。
JudgePriceReceipt 复用现有价格证明字段，只把 kind 定为 judge-call-price-estimate；不能出现 application 用途字段。

```ts
type JudgeUsage =
  | { state: "unavailable"; reason: "judge-usage-not-recorded" }
  | { state: "invalid"; reason: "judge-usage-source-invalid" }
  | {
      state: "complete" | "partial";
      coverage: "physical-transmissions";
      collection: CollectionState;
      calls: readonly JudgeUsageCall[];
      callsTruncated: boolean;
      omittedCallCount: number;
      totals: {
        requests: TokenTotal;
        inputTotalTokens: TokenTotal;
        outputTokens: TokenTotal;
        totalTokens: TokenTotal;
        costs: CostTotals;
      };
      priceReceipts: readonly JudgePriceReceipt[];
    };
```

JudgeUsageCall 的穷尽形状见[账本定义](architecture.md#持久形状)。公开调用预览最多 128 条，按 entryIndex、logicalOrdinal、transmissionOrdinal 排序。
priceReceipts 仅返回预览调用的证明，全部证明仍留在附件。所有 totals 必须从全账本计算。

调用加对应价证按 canonical UTF-8 总字节选择完整前缀，预览最多 128 KiB；放不下一条时 calls=[] 且 omitted 为全量。
最终 Query envelope 超过 512 KiB 时继续缩短该前缀，不删 totals、完整度或已知金额；仍放不下才按既有预算错误拒绝。
截断必须同步 callsTruncated/omittedCallCount，不能只按行数限制。

请求计数只依赖登记完整性；token 和费用各自计算完整性。state complete 表示调用集合完整，不能替代指标完整度。
完整空账本的 requests/tokens 为已知 0、observationCount 0，costs complete 且 values=[]、totalCalls=0。

```ts
type JudgeUsageSummary =
  | Extract<JudgeUsage, { state: "unavailable" | "invalid" }>
  | Omit<Extract<JudgeUsage, { state: "complete" | "partial" }>,
      "calls" | "callsTruncated" | "omittedCallCount" | "priceReceipts">;

interface TotalCosts {
  state: "complete" | "partial" | "unavailable";
  values: readonly {
    currency: string;
    value: string;
    source: "reported" | "estimated" | "mixed";
  }[];
  missingSources: readonly ("application" | "judge")[];
}
```

missingSources 固定 application、judge 顺序，无重复。任一 owner 不完整就列入；没有缺口为 complete。
有缺口且有已知金额为 partial，否则 unavailable。完整但无收费调用可 values=[]，不伪造某个币种的零。
精确十进制按相同币种相加；不转换汇率。旧 application costUSD 和 totals.costs 不改为总成本。

旧应用缺源仍未知；合法完整空应用账本可在 totalCosts 判断为无应用收费调用，不更改旧应用 totals 的展示语义。

## Show 与 View

Attempt 是费用汇总主体。默认 show @attempt、show @attempt --usage 与实验中的单局展示，首先呈现同一官方 totalCosts 投影：完整时显示 Total costs，存在缺项时显示 Known subtotal、Incomplete 和 Missing sources。不能把应用费用或预览小计称为整局价格。

用途、实际模型和 Judge 放在后续明细；View 可折叠这些明细。沿用应用模型的三列表格。Judge 单独显示物理调用数、输入/输出/总 token、费用完整度及已知小计。
无调用明确显示 No Judge calls；缺账本显示 Judge usage unavailable，不显示 0。
有调用无费用显示已知请求数与 Cost unavailable；已知零显示币种与 0、已知费用调用数及全部调用数。

Total costs 在有缺口时标 Known subtotal 和 Missing sources。Show --experiment 对每个 origin Attempt 展示同一摘要，不累加分页预览。
experiment.get 不嵌入调用或价证数组；按 origin 顺序在 64 项及最终响应预算内保留完整摘要前缀，并准确报告 omittedAttemptCount。
其完整 JSON 响应上限为 4 MiB，单 Attempt 用量仍为 512 KiB。实验 aggregate/cells 含逐断言证据完整度，800 条断言的既有公开场景仅这部分即约 639 KiB，不能套用单 Attempt 用量的上限而拒绝完整实验。超过实验上限仍返回预算错误，不删金额、币种或证据完整度。

View 读取同一 Query 结构，保留中英 catalog，不在浏览器解码 provider 原文或重算价格。


## 实验费用汇总

`experiment.get` 新增 `costSummary`，复用 Attempt 的 `TotalCosts`，不新增账本。

```ts
interface ExperimentCostSummary {
  scope: "latest-recorded-slots";
  totalCosts: TotalCosts;
  coverage: {
    selectedSlotCount: number;
    resolvedSlotCount: number;
    originAttemptCount: number;
    completeAttemptCount: number;
    partialAttemptCount: number;
    unavailableAttemptCount: number;
    unresolvedSlotCount: number;
  };
}
```

选择遵守现有 `selectLatestSlots`：同一 experimentId、evalId、attemptOrdinal 只取最新已发布 occurrence。
比较次序为 completedAt、startedAt、runId。未在本次重跑的槽位保留各自最新已发布结果；被替代的旧执行不累计。
这是已发布槽位的最新结果集合，未读取当前源码以移除已删除 Eval，也不是某一次 invocation 或全部历史支出。
Show 和 View 必须显示这一范围，不能笼统标成某次运行的账单。指定历史 Run 仍使用现有 Run 入口；本扩展不新增历史选择参数。

selectedSlotCount 是全部所选槽位，resolvedSlotCount 是成功定位 origin 的槽位数量。
按 originRunId + attemptId 去重后得到 originAttemptCount，三个完整度计数仅计各个唯一 origin，并唯一依据该 origin 的 totalCosts.state；调用集合、token 与费用完整度互不替代。

同一 origin 被多个槽位复用只收费一次；失败、errored 和 skipped 的已执行 Attempt 只要有封存费用就计入，不按 Verdict 过滤。
无法定位的槽位计入 unresolvedSlotCount，同时为 totalCosts 加入 application、judge 缺口。
三个完整度计数之和等于 originAttemptCount；resolvedSlotCount + unresolvedSlotCount 等于 selectedSlotCount。

从已选槽位承接精确 originRunId 与 attemptId，在同一 PublicationCutoff 的已加载 facts 中定位 origin。
不得将已选成员转回 locator discovery 枚举历史引用 Run；历史引用数量不影响所选 origin 的可读性。
只有确实缺失或无法定位的成员计入 unresolved；预算错误沿既有错误返回，不能伪装为缺源。


在同一 PublicationCutoff 上为所有唯一 origin 读取应用和 Judge 全账本，先完成总金额、币种、计价依据和缺口合并，再裁剪 modelUsage 明细。
按币种精确十进制相加，不换汇；missingSources 取各 origin 缺口的有序并集。
没有缺口为 complete；存在缺口且有已知金额为 partial，否则 unavailable；完整空集合不伪造 USD 0。
即使超过 64 项或响应字节限制导致全部明细省略，costSummary 仍保留全范围总额与完整度计数。

最终 envelope 预算不足时继续裁剪现有 modelUsage 完整前缀，不能裁剪参与总额计算的集合。
modelUsage 明细已空仍超限时返回既有 evidence-budget-exceeded；不得删除币种、金额或参与汇总的 origin。

`show --experiment` 首先显示 Experiment total costs 或 Experiment known subtotal，以及范围、唯一 Attempt 完整度和未定位槽位。
随后保留现有 Eval/Attempt 结果与各局费用明细；不再把实验总额从这些展示行求和。
View 的单实验路由读取同一 experiment.get.costSummary，在结果表之前显示相同总额与完整度信息。
旧 application costUSD、散点图和 t.usage 的含义保持；应用费用处明确标注 Application cost，不与整局或实验总额混称。

验收至少包含两个 Eval、多 Attempt、失败结果、未知费用、零费用，以及超过 64 个 origin 的明细截断。
对同一实验再次执行部分 Eval，证明已替代旧 origin 不累计、未重跑槽位仍保留；复用 origin 不双计。
Query、Show 与 View 验证同一总额；只读旧账本缺 Judge 源依旧不完整，不补造账本。


## 应用账本完整性

`AdapterCreateContext` 新增 `sealUsage(input: AdapterUsageSeal): void`。
`AdapterUsageSeal` 从根包导出，与 `AdapterUsageInput` 同属应用用量协议。

```ts
type AdapterUsageSeal =
  | { readonly state: "complete" }
  | { readonly state: "partial"; readonly reason: string };
```

Adapter 在全部物理请求已结清、所有可取得的最终快照通过 recordUsage 上报后，显式封存完整账本。
完整且没有调用也必须 sealUsage({state:"complete"})；不把完全没有上报或一次 Eval 抛错作为完整空账本证明。
部分调用可读时先上报这些真实调用，再 sealUsage({state:"partial",reason:"journal-not-sealed"})。
reason 必须是 1..128 字符的非秘密 ASCII 标识，首字符字母或数字，其余仅字母、数字、点、下划线、冒号、连字符。

未封存时 t.usage 对已经上报的调用提供已知小计；底层账本 collection 为 partial，限制为 capture-interrupted / adapter-usage-unsealed。
EvalUsage 不因此新增 collection 或 limitations 字段。cleanup 中封存只影响之后的读取与最终持久结果，不改变此前 t.usage 快照或已登记预算断言。
Eval 若需完整预算判分结果，Adapter 必须在取得该快照之前封存。

框架关闭 capture 时仍未封存，保留这个状态；不会根据 Attempt verdict、诊断文字或调用数猜测完整度。
显式 partial 映射到既有 CollectionState 的 capture-failed，stage 为作者的 reason；unknown 的 token/cost 仍由逐项字段表达。
complete 仅证明调用集合完整，不会把调用内 null token 或 null cost 变为已知值。

旧 v1/v2/v3 的 collection.complete 仅证明框架捕获未报错，不能证明生产者声明了完整调用集合。
旧账本仍按原 collection 解码，保留字节、已知金额和既有应用 costUSD 口径；新的 totalCosts 始终保留 application 缺口。
旧空账本且 Judge 完整空时 totalCosts unavailable；旧账本有已知金额（包括明确币种零）时为 partial，保留原金额。

sealUsage 同步封存当前不可变 calls，停止该 Attempt 的 recordUsage 接纳。
框架 capture 仍开放时，重复封存、封存后 recordUsage、非法输入均是捕获协议错误。
即使作者 catch，沿既有 collector.failure 使 Attempt errored，并将 collection 降为 partial。

错误不能删除已接纳调用或费用。框架 close 与作者 seal 分开：框架 close 仍统一关闭捕获入口，不能通过作者再次封存延长 cleanup 时段。
Adapter 允许在既有独立 cleanup 时段尚开放时补齐回执再 sealUsage；signal abort 不是物理完成证明。
框架 capture close 后只拒绝迟到调用，不再修改 collector.failure 或已捕获快照。
若 cleanup 截止抢先关闭，迟到封存拒绝，已发布费用与完整性不再变化。

Agent 的内部账本 owner 不调用这个自定义 Adapter API，不改变 Agent 当前贡献完整度定义。

同一应用附件 family 升至 revision 4，保持 calls/collection/priceReceipts 形状；不新增表、账本或虚假调用。
v1/v2/v3 使用独立历史解码；v3 仍须检查 modelSlot 对 origin Run 配置的引用，不能落入 migration-required。
读取投影保留 producer 声明依据：仅 revision 4 且 collection.complete 能证明完整应用调用集合。

Query/Show/View/实验总费用共用这一依据，不解码应用 journal，也不根据错误字符串推断。
应迁移仓库中正式上报用量的 Adapter fixture：它们能证明全部调用的最后一个捕获位置显式封存。

未使用用量的普通 Adapter 可以不声明，其费用保持未知；不能为让总费用完整而默认替它封存零调用。

验收包含创建成功但账本不可读且零 call、显式完整空账本、已知子集加 partial、完整集合中 token/cost 缺项、失败/重试与cleanup 尾部回执。
封存后写入和捕获截止后的封存不得改变旧 t.usage 快照与已发布账本；已知小计不能通过完整预算断言。
