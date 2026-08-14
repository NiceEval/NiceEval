# Braintrust 历史读取、查询与 Experiment comparison

本文从用户重新打开历史对象开始，沿 query → filter/group → align/compare → render 说明读取路径，并单列缺失/partial 怎样呈现。保存的底层 shape 见 [storage.md](storage.md)。

## 用户入口

| 入口 | 重开/读取能力 | 适合的粒度 |
| --- | --- | --- |
| Web app：Project → Experiments | list 历史 Experiments，打开单个 Experiment，选择 Views/Comparisons，点 row 进入 trace | 日常 filter、human diagnosis、comparison、sharing |
| SDK `init({experiment, open:true})` | 返回 `ReadonlyExperiment`；async iterate rows，或 `asDataset()` 把历史 output 作为下一轮 data | programmatic replay / hill climbing |
| REST resources | `GET /v1/experiment` list/filter container；per-container `fetch` 读 rows；`/btql` 做 SQL/BTQL | integration/export/versioned recovery |
| `bt sql` | 对 data-plane query endpoint 执行 SQL，支持 human table/JSON/CSV 等 output | shell automation 与 ad-hoc analysis |
| `bt view` | `logs` TUI，或按 object ref/root span id/row id 读 trace/span；还能渲染 thread、waterfall/timeline | terminal 中诊断真实 trace |

`bt view` 接受如 `experiment:<id>`、`project_logs:<id>` 的 `--object-ref`；`trace --trace-id <root_span_id>` 取 whole trace，`span --id <row id>` 取一条 full payload。这里再次体现 trace identity 与 event row identity 不同。[`bt view` README, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/README.md#L258-L285)；[`ViewArgs`, `src/traces.rs`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/src/traces.rs#L68-L285)

## 重开一个 Experiment

Web app 的 Experiments list 先列 containers；API `GET /v1/experiment` 默认按 created 新到旧，支持 id/name/project/org/metadata 等 filters。选择 container 后才 query 它的 events。[List experiments API](https://www.braintrust.dev/docs/api-reference/experiments/list-experiments)

SDK path 更具体：

1. `init(..., {experiment: name, open: true})` 请求 `api/experiment/get`，得到 project/experiment metadata，并构造 `ReadonlyExperiment`；`open` 与 `update` 互斥。
2. `ReadonlyExperiment` 继承 `ObjectFetcher<ExperimentEvent>`。`fetch()` 对 `/btql` 发 `SELECT * FROM experiment(id)`，默认每批 1000，用 cursor 直到结束；可带 pinned `version`。
3. plain async iteration 每次可重新从 API stream；`fetchedData()` 才把全部 rows memoize 在 wrapper 中，`clearCache()` 清掉。
4. `asDataset()` 逐 row 投影 input、`output`→expected、metadata/tags/origin，供另一次 Eval 使用；它没有复制一个 server Dataset resource。

实现证据：[`init` open path, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3889-L3950)、[`ObjectFetcher`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L6885-L7077)、[`ReadonlyExperiment.asDataset`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L7470-L7555)。

per-resource fetch 的 pagination 遍历 whole version history、只能从新到旧。OpenAPI 特别警告：后一页可能再次出现前页同一 `id` 的 older `_xact_id`，client 合并多页时应按 `id` 排除来自旧 `_xact_id` 的重复 rows。传 `version/max_xact_id` 可以读过去 snapshot；这也是已删 row recovery 的基础。[OpenAPI `FetchLimit` / `FetchEventsRequest`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1437-L1510)；[Recover deleted experiment rows](https://www.braintrust.dev/docs/kb/recovering-deleted-experiment-rows)

## Query：source、shape 与 cursor

Braintrust 的 SQL/legacy BTQL 都通过 data-plane query engine。常用 sources 包括 `project_logs('<id>')`、`experiment('<id>')`、`dataset('<id>')`，以及 container resources `experiment`, `dataset`, `prompt`, `view` 等。SQL sandbox、`POST /btql`、SDK client 与 `bt sql` 是同一公开 query surface 的不同入口。[SQL reference](https://www.braintrust.dev/docs/reference/sql)

对 event sources，shape 决定 row semantics：

| shape | 一条返回 row 表示什么 | filter 命中后的范围 |
| --- | --- | --- |
| `spans`（默认） | 一个 span/event | 只返回实际匹配的 spans |
| `traces` | 仍返回 spans | 先找至少一个 span 命中的 trace，再返回这些 traces 的全体 spans |
| `summary` | 一个 trace 的 pre-aggregated rollup；带 `GROUP BY` 时再形成 groups | scores/metrics/error/root previews 等从 spans 聚合 |

因此“query trace”不是从独立 Trace table 读一行。尤其多个条件分属不同 children 时，需要 `ANY_SPAN(error...) AND ANY_SPAN(type='llm')`；普通 `WHERE error... AND type...` 要求同一个 span 同时满足。`FILTER_SPANS()` 则在选中 traces 后只返回 matching spans。[SQL data shapes 与 span filters](https://www.braintrust.dev/docs/reference/sql/query-structure#data-shapes)；[SQL best practices](https://www.braintrust.dev/docs/reference/sql/best-practices)

Query surface 还包括：

- `WHERE` 做 pre-aggregation filter，`HAVING` 做 post-aggregation filter；全文用 field `MATCH` 或 `search()`；
- `GROUP BY`、`ROLLUP`、`GROUPING SETS`、`PIVOT/UNPIVOT` 做切片与交叉呈现；
- `ORDER BY`、`LIMIT` 与 opaque cursor/SQL `OFFSET '<cursor>'` 做 pagination；
- `project_logs()` 必须有 created/`_xact_id`/`_pagination_key` range，或 scope 到 `root_span_id/id`，否则可能被 strict lint 拦下；
- SQL parser 不支持 `JOIN`、`UNION/INTERSECT/EXCEPT` 或 window functions；subquery 只可作为 `FROM` source，Braintrust-specific span filters只在 innermost raw query。

这意味着跨 Experiment comparison 不是用户用任意 SQL join 拼出来的通用 relation；产品有专门 comparison engine/UI。SQL 仍可自行选 baseline containers、按 metadata 聚合或导出 rows。[SQL reference：unsupported features](https://www.braintrust.dev/docs/reference/sql)

## UI filter、group 与 saved View

单 Experiment 默认一行一个 trace/root preview；`Display > Row type > Spans` 才显示 individual operations。comparison/diff 只在 trace rows 可用。内建 Views 有 Default、Non-errors、Errors、Scorer errors、Unreviewed、Assigned to me；Basic filter 或 SQL filter 可继续收窄。[Interpret evaluation results](https://www.braintrust.dev/docs/evaluate/interpret-results)

`Display > Group by` 可按 metadata/facet 等 fields 聚合，选择 Include comparisons in group 可把 comparison summary 一起带入。trials 则有专门的 Input grouping：同 input 的多次 trial 收成可展开 group，header 展示 aggregate，children 保留每次结果。[Compare experiments：Compare trials](https://www.braintrust.dev/docs/evaluate/compare-experiments#compare-trials)

Save view 持久化 filters、sort、columns、layout、group/chart choices，不 freeze results。共同可见的 custom views 是 `View` API resources。organization/project default 也由服务端配置，personal default 只存在 browser。打开时采用 personal → project → organization → standard view precedence。[Interpret results：custom/default views](https://www.braintrust.dev/docs/evaluate/interpret-results#customize-the-experiments-table)；[OpenAPI `View`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L8355-L8655)

## Compare 的 baseline 与 alignment

### 选择 baseline

用户可以从 Experiments list 勾选多项后 Compare，或在单 Experiment 的 Comparisons selector 选 one/many。一个 Experiment 可保存 baseline，Project 可设 default baseline；两者同时存在时 UI 提供“prefer project default”选择。没有 baseline 时，若有 git metadata，产品默认找同 branch 最新 Experiment；这项 auto-select 可关闭。[Compare experiments：Set a baseline](https://www.braintrust.dev/docs/evaluate/compare-experiments#set-a-baseline)

SDK path 是在 `init()` 传 `baseExperiment/baseExperimentId`，最终保存 `base_exp_id`。`summarize()` flush 后调用 `/experiment-comparison2`，返回每个 score 的 mean/diff/improvements/regressions 与 metrics。explicit id 优先；没有时 SDK fetch persisted base。[`Experiment.summarize`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L7305-L7382)

### 对齐 test cases

默认 comparison key 是整个 `input` 的相等性；这是为什么 SDK 注释要求 input 不含本次 run 特有状态。Project Settings → Advanced 可把 key 改成 SQL expression，例如 `input.user_query`；需要 composite identity 时用 array expression `[input.query, metadata.category]`。[Compare experiments：Set a comparison key](https://www.braintrust.dev/docs/evaluate/compare-experiments#set-a-comparison-key)

alignment 发生在 trace rows，而不是任意 child span。对齐后每项 score/metric 才能算 delta。UI 以 green/red 标 improvement/regression。diff mode 展开每个 Experiment sub-row，可比较 outputs，或在有 `expected` 时看 output-vs-expected character diff。Trials 不靠 row position 对齐，而是先由相同 input bucket 聚合/展开。

comparison grade 是进一步的 read-time classification：Summary table/Grid 把相对 baseline 归为 Improvement、Regression、Tradeoff 或 Tie，综合 latency、cost、errors、load 等类别。它不是 Experiment resource field，也没有公开 versioned algorithm contract。[Compare experiments：Assess overall impact](https://www.braintrust.dev/docs/evaluate/compare-experiments#assess-overall-impact)

## 缺测、unmatched 与 partial 怎样出现

不要把所有空白都归成 score 0：

| 情形 | 持久事实 | reader / UI 能表达什么 |
| --- | --- | --- |
| baseline 没有相同 comparison key | 一侧根本没有 aligned trace | comparison row 显示 `-`；官方明确说常见根因是 inputs 不完全相等，不应转为 0 |
| scorer 返回 `null` 或未产出该 score | score key 缺失或 value `null`；OpenAPI score value nullable | 没有可计算 delta；空值不是 failure score。只有显式 error score handler 才可能写 0 |
| scorer 抛错 | score/classifier span 可带 error；root 可能缺该 score | `Scorer errors` view 可找到；其他 scores/cases 仍可比较 |
| task 抛错 | root/task error，output/score 可能缺 | `Errors` view；summary error count/grade 可变化，不凭空填 output |
| span 未 end 或 final write 丢失 | 缺 `metrics.end`/duration，可能只有 early fragments | UI 可标 trace in progress；child 完成不证明 root 完成 |
| evaluator timeout/进程崩溃 | 已写 case traces 存在，未启动 cases 完全不存在；Experiment 无 expected-count/completion record | 页面只显示现存 rows；comparison 无从区分“dataset 本来没有”与“run 中断未跑” |
| source origin 被 delete 或 retention 删除 | destination 只剩 `ObjectReference` pointer | destination row 仍可读，但 origin navigation 未必能 dereference；公开 docs 没规定统一 placeholder 文案 |

证据：[comparison blank rows](https://www.braintrust.dev/docs/evaluate/compare-experiments#set-a-comparison-key)、[trace in progress troubleshooting](https://www.braintrust.dev/docs/kb/troubleshooting-traces-stuck-in-progress)、[OpenAPI nullable scores, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L2223-L2490)。Experiment-level partial 的成因与 delivery 行为见 [execution.md](execution.md#失败partial-与-retry)。

Hosted history 还受当前 plan retention（Starter 14 days、Pro 30 days、Enterprise custom）影响，也受可配置 object-specific retention policy 影响。因此，“permanent experiment”是产品工作流表述，不是无期限保存保证。[Plans and limits](https://www.braintrust.dev/docs/plans-and-limits)；[Security：data residency and retention](https://www.braintrust.dev/docs/security#data-residency-and-retention)

## Render 与导出

Experiment table 的 layouts 包括 List（逐 row table）与 Grid（case cards/跨 Experiment fields）。另两种是 Summary（aggregate cards）和 Summary table（score/metric rows × Experiment columns）。Summary/Summary table 隐藏 individual cases。需要诊断必须回 List/Grid，再打开 trace detail。[Interpret results：layouts](https://www.braintrust.dev/docs/evaluate/interpret-results#adjust-table-layout)

trace detail 提供 hierarchy、input/output/expected、metadata、scores/explanations、timing/tokens；Raw 有 This span 与 Full trace JSON。comparison diff 开启时只有 default trace view，Timeline、Thread 与 custom views 不可用；普通 trace 可用这些视图，CLI `bt view thread/waterfall` 也提供对应 terminal projection。[Examine traces](https://www.braintrust.dev/docs/observe/examine-traces)；[Interpret results：Examine a trace](https://www.braintrust.dev/docs/evaluate/interpret-results#examine-a-trace)

CSV/JSON 供 raw result export；comparison UI download 上限 1,000 rows，大量导出要走 API。Summary table 可导出 PDF；share link 仍受 org membership/public settings。所有这些都是对现存 rows 的 render/export，不补上未执行 cases，也不生成有独立 schema/version 的 Report resource。[Compare experiments：Share results](https://www.braintrust.dev/docs/evaluate/compare-experiments#share-results)
