# Run CLI

Run 生命周期命令为：

```sh
niceeval run list [--invocation <invocation-id>] [--json]
niceeval run show <run-id> [--json]
niceeval run delete <run-id> [--yes] [--json]
niceeval run recover <run-id> [--yes] [--json]
niceeval session list [--all] [<experiment-prefix>] [--json]
niceeval session show <invocation-id> [--json]
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
它先进入可检查、可重试的 `recovering`，再以匹配 generation 收口；证据不足时拒绝，且不删除任何已发布 Attempt。

`session list` 默认只列 active Invocation；`--all` 加入已收口的 durable Session。`session show` 以 exact invocation ID
显示这次 Invocation 的 terminal projection、created Run IDs、completion 与 publication cutoff；它不会重新构建 live 面板，也不提供后台接管。

canonical Record 固定为项目内 `.niceeval/record.sqlite`。受控退出会自动 close writer、checkpoint、truncate WAL，并以内建
只读验证通过后才成功。portable gate 仅由正在收尾的 Invocation 发起，且任何 active work 都会完整拒绝；该文件本身即可复制或归档，
不存在 snapshot/export、`clean` 或 `migrate` 命令。

`query` 与 `view --record <file>` 可以只读导入一个外部 SQLite artifact，但必须把它当 hostile input：精确 current schema、
SQLite 完整性或领域不变量任一失败都拒绝整个 source。旧 schema 的反馈要求在原项目用 current NiceEval 重新运行；命令
不迁移、修补或部分读取，也不泄漏表名或内部 `RunStorageError`。
