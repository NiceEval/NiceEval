# State —— CLI

State 不增加 `niceeval state`、`niceeval checkpoint` 或手工 restore 命令。状态生命周期由既有 `niceeval exp`
承接；需要 restore 时，Experiment 或上层 trajectory declaration 已经持有 provider-issued exact
`StateCheckpointRef`。

## Dry

```sh
niceeval exp memory/codex --dry
niceeval exp memory/codex --dry --json
```

dry 显示 state declaration、provider identity、是否 fresh 或 exact restore，以及安全的 Cohort / Region / persistence
boundary 摘要。
它不 acquire StateProvider、不 restore checkpoint、不 mint commit ID，也不写 Run。

```text
STATE DECLARATION
provider pr_7R…  namespace ns_4Q…  schema sc_v3…
cohort co_7R…  region rg_2A…  start exact-checkpoint ck_91…  content-digest 8ae1…
persistence intentional  sandbox-path 1  external-resource 0
```

若 declaration 的 ref 处于 debug，dry 只展示封闭 debug reasons；它不探测 provider 以尝试补齐 digest 或能力。

## 人读反馈

真实执行的 TTY 依次显示 restore、commit 和 reconciliation。它只显示 provider 允许展示的短引用与 digest 前缀，
不会显示 state payload、凭据或 provider 私有 locator。

```text
state restore  cohort co_7R…  region rg_2A…  checkpoint ck_91…  content-digest 8ae1…
state commit   checkpoint ck_B2… saved
state debug    Provider could not guarantee exclusive state access; results are not comparable.
state change   expected change recorded
state change   unexpected change detected
```

debug execution 在 Human 中逐项显示普通语言原因，在 JSON 中保留 `StateDebugReason`。它不是成功恢复比较能力的提示，
也不能被终端摘要隐藏。

## JSON 与退出码

`--json` 的 state event 和 Run-owned receipt 使用同一字段集合。commit receipt 总是回显 `commitId`、完整
`expectedPredecessor`、完整 `newCheckpoint` 与 `fencing`。每个 checkpoint object 都包含 provider、namespace、
cohort、schema、region、checkpoint，并只在可比较 ref 上带 `contentDigest`。

```json
{"type":"state-commit","runId":"01J...","commitId":"cm_1K...","expectedPredecessor":{"provider":"pr_7R...","namespace":"ns_4Q...","cohort":"co_7R...","schema":"sc_v3...","region":"rg_2A...","checkpoint":"ck_91...","contentDigest":{"algorithm":"sha256","value":"8ae1..."}},"newCheckpoint":{"provider":"pr_7R...","namespace":"ns_4Q...","cohort":"co_7R...","schema":"sc_v3...","region":"rg_2A...","checkpoint":"ck_B2...","contentDigest":{"algorithm":"sha256","value":"f3c9..."}},"fencing":"accepted","status":"committed"}
{"type":"state-commit","runId":"01J...","commitId":"cm_2P...","expectedPredecessor":null,"newCheckpoint":null,"fencing":"unknown","status":"indeterminate"}
```

| 结果 | `niceeval exp` 退出行为 |
|---|---|
| state lifecycle 确定完成，且没有 Eval `failed` / `errored` | `0` |
| Eval `failed` / `errored`，或任一受控 State failure、restore / commit / Scope 收尾失败、commit 不能确定 | `1` |
| argv、state declaration 或 opaque identity 无法建立 Invocation | `1` |
| 未捕获崩溃 / 受控中断 | `2` / `130` |

commit `indeterminate` 时，CLI 先发起同一 `commitId`、同一完整 `expectedPredecessor`、同一 fence 的 reconciliation。
只有得到 accepted receipt 才能继续；`not-committed` 与 `StateCommitIndeterminate` 都以退出码 `1` 停止，不自动提交
新的 checkpoint。

本方向继承 [CLI 的统一 `niceeval exp` 退出码](../../cli.md#退出码)，不新增 State 专用状态码。

## 并发与审计边界

`sharedState.key` 在 StateProvider acquire 之前取得，在 Scope finalizer 全部结束后释放。等待者不建立 Sandbox、
不 restore checkpoint，也不读取写入者的局部状态。provider fence 仍是跨进程与跨 host 的最终写入边界，不能被该
key 取代。

Run-owned receipt 是审计的唯一业务事实。CLI、JSON、query 与 View 读取它；它们不向 provider 另发查询来猜补
commit 的未知结果。

CLI 只根据 sealed mutation observation 显示 `intentional-state`、`unexpected-mutation` 或
`classification-unavailable`。它不再从“第一题通过、后续题失败”等 Verdict 形状推断污染。State 分类与
access/reset/isolation/cleanup/commit 问题并列显示；前者不能隐藏后者或改变退出码。
