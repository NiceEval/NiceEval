# 功能域 · Machine Inspection

`e2e/inspection/` 验证安装后 candidate 的固定 Inspection 公开面。它只经 Node 与真实 CLI 进入，不安装 Playwright 或 Chromium。

`niceeval query discover | explain | run` 交付 machine document。discover 是静态 catalog，不读取项目事实；explain 与 run 才绑定当前 project 的 Run facts 与 PublicationCutoff。每个 source-bound document 都带有不泄露路径的 `source.kind + source.sealedCutoffIdentity`。

`show` 是固定 Inspection operation 的英文终端读面。machine query / CLI 只交付英语协议面。测试不读 SQLite table、Record bytes 或源码。

## 公开验收边界

- Machine query 保留固定 operation catalog，同一 request 从当前 project 的 PublicationCutoff 执行。
- `show` 不保留旧显示位置 handle、`show --json` 或 `--report`。
- source、trace、diff 与 artifacts 均由固定 Inspection operation 读取；消费方不得从行数或标量重算 denominator、pass rate、score、coverage 或 Evidence。

## E2E owner anchors

### show-terminal-review

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Inspection CLI · `niceeval show`](../../../feature/inspection/cli.md#niceeval-show)

`show-cli.test.ts` 是人读终端 Inspection Journey owner。它从安装后 candidate 经真实 CLI 读取已封口 Record，验证默认 Overview、重复 exact `--run`、重复 exact `--experiment`、Attempt 概览与全部五个证据切面。

overview 必须保留 operation 已选的 totals、Experiment summary 与完整 locator。层级固定为 Experiment 路径首段显示分组 → 完整 Experiment → Eval → Attempt；同组多个 Experiment 之间留空行，Experiment 标题与自己的 Eval 表头紧邻。默认 Attempt 表不以 membership action 或 relation 挤占 identity。健康 metric 隐藏 `available`，其它 state 继续可见。

Attempt 概览要给出可执行的 source、execution、timing、usage 和 diff 后续命令。Journey 分别运行 `--source`、`--execution [--expand <stable-id>]`、`--timing`、`--usage` 与 `--diff`。

它核对 source/Assertion facts，以及 execution 有界 outline 与其 `itemId` / `toolOccurrenceId` / `commandId` 详情。

它还核对 activity 时序、operation-owned usage totals 与已封存 file-change state。任一重复 selector 未命中时不得先输出部分结果。

### inspection-query

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Inspection CLI · `niceeval query`](../../../feature/inspection/cli.md#niceeval-query)

`inspection-query.test.ts` 是 machine Inspection Journey owner。它经安装后 `exp` 产生已封口 origin Run，随后以 full carry 发布第二个 target Run，并运行 `alternate` Experiment。历史 Attempt locator 必须继续沿 origin Run 读取事实。

测试再验证 compact discovery 的完整固定 catalog，并以 `query explain` 审计 selection 和 fact kinds。

`query run` 返回含 operation identity、behavior version、publication cutoff、issues、Evidence、usage 与 Run / Attempt 公开身份的闭合 `niceeval.query/v1` document。三个入口都以单个 canonical JSON document 交付协议与 behavior version。fixture 显式携带 conversation partial limitation；完整 usage 保留 input/output totals。

`overview.get` 必须在一次读取中关闭 `main`／`alternate` × `inspection` cell 的 latest logical-slot membership。

它交付 denominator、missing、`pass | points | mixed`、四态 Verdict tally、coverage、issues 与 Evidence。

pass-rate 与 points 使用状态闭集为 `available | partial | unavailable | empty | unsupported | failed` 的 MetricValue。结果保留 selected Run identity、origin/reference relation 与 Attempt locator。

`inspection-multi` 用两个 points Eval 和各两个 Attempt 区分三层 score：member 是单次 Attempt 真值，cell 是完整 Attempt 的均值，Experiment 是可见 cell 之和。测试只读 operation 交付的 MetricValue。

`attempt.get` 公开稳定 Assertion entry index。`attempt.assertion.detail` 按 exact `entryId` 交付完整已封存 entry、sourceSites、规范化 check/decision diagnostic tree、matcher comparator/source ledger 与 retained target。

tool/event target 的 anchor 与 trace 使用同一 `toolOccurrenceId`／`eventId`。不存在的 `toolOccurrenceId` ↔ Sandbox `commandId` join 必须明示 unavailable。

`attempt.trace` 把 current durable `tool-start` / `tool-finish` 投影成有界 `tool-call` / `tool-result` outline，保留稳定 `itemId` 与 exact `toolOccurrenceId`，不暴露 family wire。

`attempt.trace.detail` 以 `toolOccurrenceId` 取得同一 occurrence 的 call/result 与完整已封存输入和结果。下钻只接受 `itemId`、`toolOccurrenceId` 与 `commandId`；数组 index、Turn/card 序号、旧 `t<N>.c<M>` 与 `cmd<N>` 都不是公开 selector。

`attempt.sources` 从同一 Attempt 的 Assertions source sites 连接 exact origin Run Sources；target carry Run 不能替换历史源码事实。
