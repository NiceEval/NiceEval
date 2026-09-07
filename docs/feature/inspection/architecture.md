# Inspection 架构

## 固定 query catalog

Inspection catalog 是读取语义与业务聚合的唯一 owner。它的穷尽 operation 包括：

- 当前项目：`project.get`；历史 Results、Experiment、Run：`overview.get`、`experiment.get`、`run.list`、`run.get`；
- Attempt 首页与下钻：`attempt.get`、`attempt.assertion.detail`、`attempt.trace`、`attempt.trace.detail`；
- Attempt 切片：`attempt.timing`、`attempt.usage`、`attempt.diff`、`attempt.sources`、`attempt.artifacts`；
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

## Source adapter 与交付边界

Node adapter 为 `niceeval query` 和 `niceeval show` 打开短寿只读连接；本机 Insight Host 拥有 generation-bound
connection 与 statement lifecycle。固定历史路径调用 `selectInspectionOperation(facts, operation)`。
`project.get` 另接收 Experiment Host 生成的冻结当前输入；其 owner 规则见[当前结果可用性](../experiments/cache.md#当前结果可用性与执行选择)。
浏览器只消费 Host 交付的正式 result，不加载项目模块、不重新计算适用性。仅有 Record 的 Preview 显式显示历史 Results。

每个 result envelope 包含 protocol、operation、`behaviorVersion`、source identity、`PublicationCutoff`、selection、
limits、issues、Evidence 与 result。source provenance 不含物理路径。Node operation 在编码前关闭 reader 与内容 handle；
浏览器在切换 cutoff 后释放旧 generation。

列表与重 payload 使用 bounded domain page。
opaque continuation token 绑定 operation、canonical request、source identity、`PublicationCutoff` 与 `behaviorVersion`。
任一变化都返回 restart-required，不能把不同 cutoff 的页拼成一个结果。

Inspection 拥有已发布事实及冻结当前输入的选择、解释与闭合 result。当前目标求值及沿用资格属于 Experiment Host。
人读 navigation、drawer、语言、Preview、session 与刷新属于
[Insight](../insight/README.md)；Run publication、收口、retention 与物理回收属于 [Run](../run/README.md)。
