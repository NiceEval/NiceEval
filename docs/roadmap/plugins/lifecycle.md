# Plugins —— Lifecycle

Plugin resource 使用 Effect，并归 physical Sandbox Scope 所有。Group 与 Eval demand 共用一个 envelope：

```text
provider acquire
  -> Sandbox layer setup
  -> resource materialize in envelope order
  -> reset anchor
  -> Attempt reset
  -> Group resource prepare
  -> Eval resource prepare
  -> Group author commands
  -> Group Plugin commands
  -> Eval / Experiment author and Plugin commands
  -> agent and Attempt cleanup
  -> resource release in reverse materialize order
  -> Sandbox layer teardown
  -> provider finalizer
```

每个 materialize 使用 `Effect.acquireRelease`。后续 resource materialize 失败时，已经取得的 resource 按逆序 release。Replacement Sandbox 取得自己的新 Scope，并重新 materialize 完整 envelope。

## Command frequency

Group resource `materialize` 每台物理 Sandbox 只执行一次；Group resource `prepare` 与 Group Plugin command 对每条真实 Attempt 执行。物理一次性工作只能进入 materialize。

Group 作者 command 在 Group Plugin command 前。每个 owner 的 Plugin command 都保留 owner provenance；Group command 进入 `sandbox.prepare.group` 或等价的结构化 Group phase，不能误记成 Experiment prepare。

全量 carry 不创建 Sandbox，也不执行任何 resource callback 或 command。Partial carry 仍 materialize 冻结的完整 envelope，但 prepare 和 command 只为 fresh Attempt 执行。

## Failure ownership

| failure | 稳定 code / phase | 结果 |
|---|---|---|
| resource materialize | `plugin-resource-materialize-failed` / physical Sandbox setup | 物理实例不可用；Eval Group 交给 `onUnavailable` |
| resource prepare | `plugin-resource-prepare-failed` / `sandbox.prepare` | 当前 Attempt errored；Group policy 决定后续 slot |
| Group Plugin command | Sandbox prepare failure / Group phase | 当前 Attempt errored；不触发 resource replacement |
| resource release | `plugin-resource-release-failed` diagnostic | 不改已经封口的 Verdict |

`stop-group` 保留已开始的结果并停止后续 slot。`replace-sandbox` 只为下一 slot 提供新实例，不重跑发生 prepare 失败的 Attempt。同一 stage 的第二次失败停止 Group。中断不制造 replacement work。

Resource finalizer 使用统一 cleanup budget。Release timeout 或 defect 只追加 diagnostic，并继续执行后续 finalizer。

