# Run CLI

Run 生命周期命令为：

```sh
niceeval run list [--invocation <invocation-id>] [--json]
niceeval run show <run-id> [--json]
niceeval run delete <run-id> [--yes] [--json]
niceeval run recover <run-id> [--yes] [--json]
```

ProjectDatabase 的具名维护命令为：

```sh
niceeval migrate [--record <root>] [--yes]
niceeval clean [--record <root>] [--yes]
```

`migrate` 只能执行 NiceEval 随包发布的固定相邻迁移。它先展示不写盘的 plan；已经 current 时明确
返回 no-op，有可应用的 plan 时需要 `--yes`。`clean` 只删除用户确认的 incomplete Runs。
两个命令都不接受 SQL、schema revision 或物理 SQLite 文件作为用户输入。

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

不存在通用 `niceeval record` 管理面，也不接受用户可搬运的 SQLite database 作为运行输入。
普通 Run operation 不隐式迁移；遇到具名相邻 predecessor 时返回稳定 typed error 并指向
`niceeval migrate`。不支持的 baseline 与损坏的 current database 必须使用不同 code，不能泄漏表名或
内部 `RunStorageError`。
