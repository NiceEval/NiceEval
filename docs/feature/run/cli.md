# Run CLI

Run 生命周期命令为：

```sh
niceeval run list [--invocation <invocation-id>] [--json]
niceeval run show <run-id> [--json]
niceeval run delete <run-id> [--yes] [--json]
niceeval run recover <run-id> [--yes] [--json]
```

所有 Run ID 都要求 exact identity，不接受前缀、`latest` 或隐式当前 Run。

`run list` 在一个 PublicationCutoff 下列出已经提交 create transaction 且未删除的 Run。每项显示 state、Experiment、
开始/结束时间、`published / expected` coverage 与 invocationId。`active` 的空 slot 显示 pending；终态空 slot 显示
闭合 absence reason。

`run show` 消费唯一 canonical Run Inspection operation，不拼接多份近义 operation。结果包含 Run identity、state、
expected/published/missing、slot bindings、Attempt locators、absence、Verdict、score、Evidence、usage 与 limitations。

`run delete` 只接受终态 Run。目标仍为 `active` 时提示先 recover；存在 incoming reference 时零删除，并列出依赖
Run 与 Attempt locator。命令没有 `--force`、cascade 或按 selector 批量删除。

`run recover` 只在 NiceEval 能证明旧 owner 已终止时 fence writer generation 并把 Run 收口为 `interrupted`。
证据不足时拒绝；它不删除任何 Attempt。

不存在 `niceeval record`、`niceeval clean`、`niceeval migrate`、`--record` 或用户可搬运的 SQLite snapshot 输入。
内部持久化维护失败以对应 Run operation 的 typed error 反馈，不要求用户管理物理存储。
