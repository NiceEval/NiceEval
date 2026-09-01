# Inspection 架构

## 固定 query catalog

Inspection catalog 是读取语义与业务聚合的唯一 owner。它的穷尽 operation 包括：

- Results、Experiment、Run：`overview.get`、`experiment.get`、`run.list`、`run.get`；
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

用户面 Results 由内部 `overview.get` 一次关闭 totals、Experiment aggregates、Eval cells、members、MetricValue、coverage、
issues 与 locators。

默认 `overview.get` 在 canonical Record 中按 `experimentId + evalId + attemptOrdinal` 选择每个逻辑 Slot
的最新 sealed occurrence。当前工作树、当前安装的候选与 execution identity 不参与这个 Record selection；
它们只影响 Experiment planning 的 reuse 资格。因此 Node `show`、machine `query` 与 browser View 在相同
`PublicationCutoff` 上得到同一个默认 Overview，Host 不得用当前项目计划另建 selection 门。

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

Node adapter 为 `niceeval query` 和 `niceeval show` 打开短寿只读连接；Browser adapter 由 Insight 的 sqlite-wasm Worker
拥有 connection 与 statement lifecycle。两者都产生相同 facts interface，并调用
`selectInspectionOperation(facts, operation)`。它们不创建业务 DTO、query cache、派生数据库或可搬运的持久输入。

每个 result envelope 包含 protocol、operation、`behaviorVersion`、source identity、`PublicationCutoff`、selection、
limits、issues、Evidence 与 result。source provenance 不含物理路径。Node operation 在编码前关闭 reader 与内容 handle；
浏览器在切换 cutoff 后释放旧 generation。

列表与重 payload 使用 bounded domain page。
opaque continuation token 绑定 operation、canonical request、source identity、`PublicationCutoff` 与 `behaviorVersion`。
任一变化都返回 restart-required，不能把不同 cutoff 的页拼成一个结果。

Inspection 只拥有已发布事实的选择、解释与闭合 result。人读 navigation、drawer、语言、Preview、session 与刷新属于
[Insight](../insight/README.md)；Run publication、收口、retention 与物理回收属于 [Run](../run/README.md)。
