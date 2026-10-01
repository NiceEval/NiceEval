# Inspection 架构

## 固定 query catalog

Inspection catalog 是读取语义与业务聚合的唯一 owner。它的穷尽 operation 包括：

- 当前项目：`project.get`；历史 Results、Experiment、Run：`overview.get`、`experiment.get`、`run.list`、`run.get`；
- Attempt 首页与下钻：`attempt.get`、`attempt.assertion.detail`、`attempt.assertion.image`、`attempt.trace`、`attempt.trace.detail`；
- Attempt 切片：`attempt.timing`、`attempt.usage`、`attempt.diff`、`attempt.sources`、`attempt.artifacts`、`attempt.artifact`；
- 比较：`runs.compare`。

catalog 不接受任意 SQL、关系遍历、JSON path、统计或公式。每个 definition 拥有具名 operation、穷尽 request、合法
selection、typed fact codec、browser-neutral selector 与确定的 result meaning。

`facts.ts` 是所有 operation 共用的 facts reader。它在读取开始时固定 source identity 与 `PublicationCutoff`；operation
不能另开 reader 或拥有 lifecycle。selection 只能使用领域 identity，不能暴露 cursor、rowid、文件位置或调用方 page size。

## Run 读取

Run 的列表 operation 只有 `run.list`，详情 operation 只有 `run.get`。

| operation | selector | result | 缺失语义 |
| --- | --- | --- | --- |
| `run.list` | filters + opaque continuation | cutoff 内已创建且未删除的 Run 摘要、state 与 `published / expected` coverage | active 空 slot 是 pending；终态空 slot带 absence reason。 |
| `run.get` | exact `runId` | identity、state、时间、expected/published/missing、slot bindings、Attempt locators、Verdict、score、coverage、usage、issues 与 limitations | ID 未命中是 selection missing；Run 命中但 slot 为空仍成功。 |

`run.get` 在同一 `PublicationCutoff` 一次形成：

- Run identity、state、Experiment identity、`startedAt` 与可选 `completedAt`；
- 创建时冻结的完整 expected slots，以及 expected／published／missing；
- 每个 slot 的 binding、Attempt locator、`origin | reference | null` relation；
- active 空 slot 的 pending，或终态空 slot 的 `absenceReason`；
- Verdict、score、coverage、usage，以及各指标自己的分母；
- missing、partial、unavailable、truncation 与其它证据边界。

`state` 使用 Run 的 `active | completed | interrupted | failed` 生命周期。`completedAt` 只在 cutoff 已包含 Run 收口事实时提供，不取阶段性 Attempt publication 的时间。

`context` 只来自同一 cutoff 下已发布且严格验证的 Core。尚无已发布 Core 时，该字段缺席；零发布后收口的 Run 同样适用。读取不得从 staging、当前配置或默认值补造历史 context。

`missing = expected - published`。coverage 分母始终是 expected；pass rate、score 与 usage 只以已发布且相应指标 available
的 Attempt 为各自分母。Verdict 缺席不是 failed，指标缺席不是零。Show 或 View 不得 join 多份 result 补成另一种 Run 详情。

## Results、比较与 Attempt

本机当前 Results 由 `project.get` 一次关闭当前目标、结果可用性、缺口、历史入口和质量指标。
Experiment Host 拥有当前目标求值与适用性判断；Inspection 拥有闭合 result 及指标聚合；renderer 只做呈现。
Host 不把已聚合的历史 Overview 过滤成当前结果，也不将任意 consumer 提交的布尔 eligibility 当作可信判断。

`project.get` 使用 Host 为这次读取准备的完整冻结目标及适用性输入。两者与 facts 绑定同一 cutoff；
求值后输入发生变化时废弃候选并重新准备，不能混合两个目标版本。Result 附带 target identity，
只承诺这个目标与 cutoff 的判断，不声称它会随工作树变化自动更新。

这个 operation 不分配或发布 Run，不启动资源，不执行 adoption；当前读取能力不可用时返回具名错误。
固定历史 operation 不需要当前目标，即使源码删除、定义求值失败或本机没有项目也可读取。

历史 Results 由 `overview.get` 一次关闭 totals、Experiment aggregates、Eval cells、members、MetricValue、coverage、
issues 与 locators。

`overview.get` 在 canonical Record 中按 `experimentId + evalId + attemptOrdinal` 选择每个逻辑 Slot
的最新 sealed occurrence。当前工作树、当前安装的候选与 execution identity 不参与这个 Record selection；
它们不影响历史读取。Node、machine query 与 browser View 在相同 operation 输入及
`PublicationCutoff` 上得到同一个结果；当前 operation 还必须绑定相同 target identity。

每个 member、cell 与 aggregate 都带 USD cost `MetricValue`。它只汇总已发布且有可用成本的 Attempt，并保留 samples、total、
state、issues 与 refs。没有成本的 Attempt 不是零。

token `MetricValue` 优先使用 Adapter 持久化的每次物理调用输入总量。输入总量缺席时汇总不含缓存的输入量与已知缓存分项，
然后加上输出量。缺少必要分项时保留已知小计并标为 partial；没有 Adapter 用量与 Agent 用量事实时为 unavailable，不按零聚合。
`experiment.get` 只交付 exact Experiment 的 aggregate 与 cells。`runs.compare` 固定提供 `side-by-side`、`exact`、
`paired`，并交付 left/right/pair denominator、unmatched、excluded、missing、issues 与 Evidence。

Attempt operation 都使用 canonical locator。`attempt.get` 交付身份、outcome、Verdict、score、Assertion 索引、Evidence
coverage、limitations 与 section states。sources、trace、timing、usage、diff 和 artifacts 各自关闭一个固定 evidence
切片；detail 只接受 outline 暴露的稳定 `entryId`、`itemId`、`toolOccurrenceId` 或 `commandId`。

required shape 缺失是 typed protocol error。只有 operation 声明的 empty、partial、unavailable、invalid、omitted 或
truncated 才是可呈现的领域状态。selector 不从当前工作树、相邻项、文本相似度或显示位置补配事实。

MetricValue 保留 state、value、samples、total、basis、issues 与 refs。pass rate 的 classified denominator、points 的
earned/possible、USD cost，以及 member/cell/aggregate score 都由 selector 关闭；renderer 只 decode/relabel。Insight 的
Results 散点图只把已关闭的 USD cost 作为横轴，并把已关闭的 pass rate 或 score 作为纵轴。

普通 score 指标汇总完整的 earned score，独立于 Verdict。`failed + complete` 与完整的零分都计入样本数、
均值、总分和评分完整性；失败标签仍保留。`partial` 与 `unavailable` 不补零，也不算完整评分样本。
成功排名另以 `passed + complete` 判断资格，不能用排名资格代替 score 可用性或结果完整性。

## Source adapter 与交付边界

Node adapter 为 `niceeval query` 和 `niceeval show` 打开短寿只读连接；本机 Insight Host 拥有 generation-bound
connection 与 statement lifecycle。固定历史路径调用 `selectInspectionOperation(facts, operation)`。
`project.get` 另接收 Experiment Host 生成的冻结当前输入；其 owner 规则见[当前结果可用性](../experiments/cache.md#当前结果可用性与执行选择)。
浏览器只消费 Host 交付的正式 result，不加载项目模块、不重新计算适用性。仅有 Record 的 Preview 显式显示历史 Results。

每个 result envelope 包含 protocol、operation、`behaviorVersion`、source identity、`PublicationCutoff`、selection、
limits、issues、Evidence 与 result。source provenance 不含物理路径。Node operation 在编码前关闭 reader 与内容 handle；
浏览器在切换 cutoff 后释放旧 generation。

列表与重 payload 使用 bounded domain page。
读取身份包含同一 pinned transaction 内的 publication clock。Run 创建、Attempt publication 和 Run 收口都改变该身份；仅散列已发布 Core 不能表示生命周期变化。

opaque continuation token 绑定 operation、canonical request、source identity、`PublicationCutoff` 与 `behaviorVersion`。
任一变化都返回 restart-required，不能把不同 cutoff 的页拼成一个结果。

Inspection 拥有已发布事实及冻结当前输入的选择、解释与闭合 result。当前目标求值及沿用资格属于 Experiment Host。
人读 navigation、drawer、语言、Preview、session 与刷新属于
[Insight](../insight/README.md)；Run publication、收口、retention 与物理回收属于 [Run](../run/README.md)。

## 附件分块读取

`attempt.artifacts` 用 `{ locator, offset?, limit? }` 列出附件 metadata。offset 默认 0，以条目计；
limit 默认且最多 128，必须为正安全整数。响应 `artifacts.value.artifacts` 与 `artifacts.collection.items`
是同一页条目，包含 `artifactId`、`label`、`mediaType`、`byteLength`、`sha256`。

每页 metadata 数组同时受 128 KiB 序列化 UTF-8 JSON 预算限制，完整保留标签；
`artifacts.collection` 的 `total` 是总条数，`nextOffset` 指向下一条，否则为 null，`hasMore` 明示剩余页。
客户端按返回的 nextOffset 继续，不能按请求 limit 自增。offset 等于 total 返回空末页，超过 total 则拒绝。
`value.collection` 仍表示整个采集的 complete 或 partial 状态，不表示当前页状态。


`attempt.artifact` 用 `{ locator, artifactId, offset?, limit? }` 读取同一 origin Attempt 的附件。
`offset` 和 `limit` 以原始 bytes 为单位；offset 默认 0，limit 默认 64 KiB、最大 256 KiB，且必须是正 safe integer。
offset 必须是非负 safe integer。这里的字节区间属于附件领域读面，不暴露存储页或物理 chunk 身份。

成功 document 的 `artifact` 字段为
`{ state: "available", artifactId, name, mediaType, byteLength, sha256, offset, base64, nextOffset }`。
base64 是当前区间的标准 base64；metadata 描述整件附件。还有内容时 nextOffset 指向下一字节，否则为 null。
offset 等于 byteLength 时返回空 base64 与 null；超过 byteLength、limit 为零或超过上限都形成 `inspection-request-invalid`。
附件 ID 不存在时同一成功 envelope 返回 `{ state: "not-found", artifactId }`。

读取沿 locator 查找 exact origin，校验 artifact descriptor、content metadata、总字节数与完整 SHA-256。
实现逐块读取并校验，只保留请求区间，不把整件附件预载入内存。错误 origin、损坏内容或不一致的 metadata 形成
`inspection-record-integrity-failure`。carry 与历史 locator 继续读取已发布 origin bytes，不读取外部路径或当前应用文件。

附件继续使用既有 artifacts family、revision 与 bytes content；新 operation 不改变历史附件的持久解释。

## 模型用途与费用读取

`attempt.usage` 在同一 PublicationCutoff 上读取 origin Run 配置及其账本。v3 的非空 modelSlot 必须引用该 origin 配置，错误引用返回 invalid。
物理贡献按 origin Run、origin Attempt、application、callId 识别，不以用途或模型去重。

configuredModels 为 available bindings 或 not-recorded。bindings 按用途键排序，每项含 modelSlot、model、reasoningEffort、recordedCalls。
计数读取全部合法封存调用；完整空账本为 0，缺源或 invalid 为 null，不依据预览缺席判断未调用。

modelGroups 含 basis、state、groups、totalGroupCount、groupsTruncated、omittedGroupCount。
普通 Adapter 的 basis 为 recorded-calls，各组按 modelSlot/provider/model 精确三元组区分，null 排在字符串前。
每组含 recordedCalls、tokens（inputTotalTokens/outputTokens/totalTokens）和官方 effective costs，完整性与已知小计分别保留。

全部最多 4000 调用参与统计，最多预览 64 组；调用预览的 128 条上限不影响聚合。
Agent 为 reported-sends 与 physical-call-identity-not-recorded，不把配置模型或 Adapter 名称当作实际物理事实。

judgeUsage 读取同一 origin Attempt 的独立物理调用账本；旧缺源为 unavailable，完整空账本为已知零调用，指标完整性独立于调用集合完整性。
totalCosts 包含 state、values（currency/value/source）、missingSources，按币种汇总全部应用与 Judge 已知金额。
两者均完整时为 complete；有缺口且有已知金额（包括明确零）时为 partial，否则 unavailable。不推断应用与 Judge 的合并总调用数。
Judge 调用、价证、有界预览与摘要的穷尽形状遵守[Judge 读面契约](../../design/judge-physical-usage/plans/plan-1/library.md)。

既有 totals.costs 和 costUSD 仍表示应用费用，不改变历史口径。价格匹配仍按模型字符串，不声称独立 provider/model 定价。

`experiment.get.modelUsage` 复用已选成员的 origin Attempt usage，按 origin 去重，不合并不同历史配置。
它含 attempts（locator、originRunId、usage）、totalAttemptCount、omittedAttemptCount、unresolvedAttemptCount。

usage 仅含 state、configuredModels、modelGroups、judgeUsage、totalCosts、totals，不重复调用预览。
最多返回按 originRunId/locator 排序的 64 个 Attempt；未找到的成员单列。Judge 使用不含 calls/priceReceipts 的摘要。
experiment.get 的最终 JSON 响应上限为 4 MiB；完整 aggregate/cells 保留逐断言证据完整度，因此独立于单 Attempt 用量的 512 KiB 上限。
最终响应字节预算内保留完整 Attempt 摘要前缀，omittedAttemptCount 反映省略数量；保留摘要中的金额及完整度不变，不以预览重算总量。


## 实验总费用与应用完整性

`experiment.get.costSummary` 使用 `scope: "latest-recorded-slots"`，包含 `totalCosts` 与 `coverage`。
每个 experimentId、evalId、attemptOrdinal 选择最新已发布槽位，排序使用 completedAt、startedAt、runId。
未重跑槽位保留其最新结果，替代的旧执行不累计；该范围不表示一次 invocation 或全部历史支出，也不读取当前源码删除旧 Eval。

coverage 包含 selectedSlotCount、resolvedSlotCount、originAttemptCount 与 unresolvedSlotCount。
完整度分为 completeAttemptCount、partialAttemptCount、unavailableAttemptCount。
后三种完整度计数以各 origin 的 totalCosts.state 为准，合计等于 originAttemptCount。
resolvedSlotCount 与 unresolvedSlotCount 合计等于 selectedSlotCount。

读取直接承接已选槽位的 originRunId 与 attemptId，在同一 PublicationCutoff 上定位原始账本，不经 locator 历史引用发现。
按 originRunId 与 attemptId 去重，从全部所选原始账本汇总；失败、错误或复用结果不因 Verdict 被排除。
无法定位的槽位保留 application 与 judge 缺口，不能将预算错误伪装为缺源。

同币种使用精确十进制相加，不换汇。完整时为总费用，缺项时为已知小计，并保留有序 missingSources。
聚合先于 modelUsage 的 64 项与字节裁剪；清空明细仍超出响应预算时返回 evidence-budget-exceeded，不删金额或币种。
Show 与 View 从同一 costSummary 展示范围、总额和完整度，各 Attempt 的后续明细不参与客户端求和。

应用 usage family revision 4 的 complete 表示 Adapter 显式确认调用集合完整。
v1、v2、v3 保留独立历史解码及原金额、原应用 costUSD；总费用对其保留 application 缺口。
revision 3 仍检查用途引用属于 origin Run 的配置。未声明的新账本也保持缺口；已知零金额不等于未知。
