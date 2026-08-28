# Inspection CLI

Inspection 有两个交付入口：`niceeval query` 输出稳定 machine document，`niceeval show` 输出同一固定 operation 的人读视图。
两者都在命令开始时固定一个 `PublicationCutoff`，不会把读取期间后续发布的 Attempt、Run 收口或删除混入结果。

## `niceeval query`

```sh
niceeval query discover
niceeval query explain --request <request.json>
niceeval query run --request <request.json>
```

`discover` 只列出固定 operation 与 bootstrap schema；`explain` 返回 selector、结果形状、限制和后续请求；`run`
执行请求并输出 `niceeval.query/v1` JSON document。调用方不能提交 SQL、表名、文件路径、任意统计公式或自定义 operation。

Run 的 operation 只有：

- `run.list`：在一个 `PublicationCutoff` 下分页发现 Run；
- `run.get`：按 exact `runId` 取得唯一 Run detail。

不存在其它 Run 列表或详情别名。`run.get` 一次交付 Run identity、state、时间与完整 expected slots。
它也交付 `expected`／`published`／`missing`、每个 slot 的 binding 与 Attempt locator。
空 slot 按状态交付 `pending` 或 `absenceReason`；结果还包含 Verdict、score、coverage、usage、issues 与 limitations。

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "run.get", "runId": "run_01JSHOW" }
}
```

Run 已命中但仍有空 slot 时，selection 成功。`active` Run 把空 slot 交付为 `pending`；终态 Run 交付具名
`absenceReason`。`missing = expected - published`，不会把缺失补成失败 Attempt 或零。coverage 始终显示
`published / expected`；pass rate、score 与 usage 等指标只以已发布且相应指标 available 的 Attempt 为各自分母，
并同时交付该指标分母，不能借 coverage 分母补值。

其它固定 operation 包括 `overview.get`、`experiment.get`、`attempt.get`、`attempt.sources` 与 `attempt.trace`。
还包括 `attempt.trace.detail`、`attempt.timing`、`attempt.usage`、`attempt.diff` 与 `runs.compare`。
Overview 一次关闭 Experiment × Eval 的成员、分母、Verdict、score、coverage 和 Attempt locator。
比较 operation 交付两侧及配对结果的 denominator、missing、unmatched、excluded、issues 与 Evidence。

列表或有界 evidence 使用 opaque continuation token。token 绑定 operation、canonical request、source identity、
`PublicationCutoff` 与 `behaviorVersion`；边界变化时返回 restart-required，不允许拼接两个 cutoff 的页。

每个 document 都包含 operation、selection、`PublicationCutoff`、limits、issues 与 Evidence。Node 与浏览器 source adapter
读取同一已发布事实并调用同一 selector；protocol 不是 View 的输入、缓存或中间文件。

## `niceeval show`

```sh
niceeval show
niceeval show --run <run-id>...
niceeval show --experiment <experiment-id>...
niceeval show @<locator>
niceeval show @<locator> --source
niceeval show @<locator> --execution [--expand <stable-id>]
niceeval show @<locator> --timing
niceeval show @<locator> --usage
niceeval show @<locator> --diff
```

`show` 是固定 Inspection result 的严格 renderer：

- 无 selector 时调用 `overview.get`；
- 每个 `--experiment` 调用 exact `experiment.get`；
- 每个 `--run` 调用 exact `run.get`，不组合或补算其它 Run result；
- Attempt locator 默认调用 `attempt.get`，五个 evidence flag 分别调用对应固定 operation；
- `--expand` 只能与 `--execution` 同用，并只接受 outline 暴露的 `itemId`、`toolOccurrenceId` 或 `commandId`。

`@<locator>`、`--run` 与 `--experiment` 互斥。重复 Run 或 Experiment selector 去重后逐个 exact 选择；全部 selector
必须在同一个 `PublicationCutoff` 命中后才输出。任一 selection missing、required result shape 无效或 detail identity
未命中，都向 stderr 写英文诊断并非零退出，不输出半张结果。

`show --run` 明确显示：

```text
Run run_example_next · active
  Expected   3
  Published  2
  Missing    1
  Coverage   2/3

Slots
  slot-1  published  @ATTEMPT-A
  slot-2  published  @ATTEMPT-B
  slot-3  pending

Metrics
  Pass rate  100% (2/2 classified)
  Score      30 (2 available)
```

同一 Run 收口后，空 slot 保持 missing，但以终态 absence reason 取代 pending。终态不是重新发布详情；新的读取在新的
`PublicationCutoff` 看见收口事实，已经开始的读取继续保持一致。

human renderer 可以折行或截断明确标注的 preview，但不得截断 identity 或改变排序。
它不能隐藏 missing／partial／unavailable，也不能从 observations、raw rows 与组件状态重算指标。

`show` 不提供 JSON、自由 statistics、SQL、theme、component、renderer、静态导出或持久输入参数；machine consumer
使用 `query`，浏览器审阅使用 [Insight](../insight/README.md)。
