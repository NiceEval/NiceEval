# 核对数据完整度

自动化先发现固定 operation，再在一个 `PublicationCutoff` 下核对 Run 是否完整：

```sh
niceeval query discover
niceeval query explain --request operation.json
niceeval query run --request operation.json
```

选择 `run.get` 与 exact `runId` 后，结果一次交付完整 expected Planned attempts、`expected`／`published`／`missing`、Planned attempt binding、
Attempt locator、coverage 与每项指标自己的分母。Run 仍为 `active` 时，missing Planned attempt 显示 `pending`；Run 进入终态后，
同一 Planned attempt 显示具名 `absenceReason`。两种情况都不会伪造失败 Attempt 或把缺失按零计入指标。

```json
{
  "protocol": "niceeval.query/v3",
  "operation": { "kind": "run.get", "runId": "run_example_next" }
}
```

需要终端审阅时，使用同一 result 的人读 renderer：

```text
$ niceeval show --run run_example_next
Run run_example_next · active
  Expected   2
  Published  1
  Missing    1
  Coverage   1/2

Planned attempts
  plannedAttempt-1  published  @ATTEMPT-NEXT
  plannedAttempt-2  pending

Metrics
  Pass rate  100% (1/1 classified)
  Score      16 (1 available)
```

这里 coverage 的分母是全部 expected Planned attempts；pass rate 和 score 的分母只包含已发布且对应指标 available 的 Attempt。
删去任一分母都会让读者误把“运行尚未发布完”与“已发布结果质量差”混为一谈。

Attempt evidence 继续通过 locator 下钻：

```sh
niceeval show @ATTEMPT-NEXT
niceeval show @ATTEMPT-NEXT --assertions
niceeval show @ATTEMPT-NEXT --source
niceeval show @ATTEMPT-NEXT --execution
niceeval show @ATTEMPT-NEXT --execution --expand tool_example_install
niceeval show @ATTEMPT-NEXT --timing
niceeval show @ATTEMPT-NEXT --usage
niceeval show @ATTEMPT-NEXT --diff
```

outline 只允许以它暴露的稳定 identity 展开 detail。missing、partial、unavailable、truncated、limits、issues 与
Evidence 都是结果的一部分；renderer 不猜相邻项、不读取当前工作树补事实，也不输出已经成功 section 的半张结果。

有界列表继续读取时，调用方原样传回 opaque continuation token。token 所绑定的 request、source identity、
`PublicationCutoff` 或 `behaviorVersion` 变化时，调用方重新开始，不能拼接不同读取边界的页。

需要浏览器连续审阅时进入 [Insight](../../insight/README.md)；Insight 在自己的读取开始时固定 cutoff，并执行相同的
Inspection operation，而不是消费本次 CLI document。

## 中止后核对已完成结果 {#audit-interrupted-run}

两条 Eval 串行执行，第一条已经发布 Attempt，第二条运行期间按 Ctrl-C。保存实时输出的 locator，
用前面的 `run.get` 请求读取本次 exact Run，再用 `niceeval show @<locator>` 审阅第一条结果。
不要用较早 Run 的完整摘要判断本次执行是否完整。

检查 Run 终态、已发布成员和缺失原因。已发布 Attempt 继续可读；未发布位置按
[Run 生命周期](../../run/architecture/lifecycle.md#创建与执行)收口，不把中断解释为零分或零费用。
终端错误摘要被截断时，从对应 Attempt 详情读取诊断，再按需要展开 execution 与 timing。

全部成员都打印终态后，如果 Run 收尾失败，同样先核对已发布成员与具名缺失原因。
已发布成员不因其它成员封存失败而消失；没有公开 Attempt 的位置不能伪造 locator 或推断执行成功。
保留 exact Run、可查询的 locator 和诊断，确认当前 dry plan 后再决定补跑范围。

进程被强制终止时，Run 可能仍为 active。此时 pending 只表示尚未发布，不能据此判断哪个 Eval 正在执行。
恢复操作遵循 [Run recovery](../../run/architecture/lifecycle.md#崩溃与-recovery)；本用例不通过等待时长推断进程已经退出。
