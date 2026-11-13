# Run CLI

Run 生命周期命令为：

```sh
niceeval run list [--invocation <invocation-id>] [--record <file>] [--json]
niceeval show --run <run-id> [--record <file>] [--json]
niceeval run delete <run-id> [--yes] [--json]
niceeval run recover <run-id> [--yes] [--json]
niceeval run import <record-file> [--json]
niceeval run export --run <run-id> [--run <run-id>...] --out <file> [--json]
niceeval invocation list [--all] [<experiment-prefix>] [--json]
niceeval invocation show <invocation-id> [--json]
```

所有 Run ID 都要求 exact identity，不接受前缀、`latest` 或隐式当前 Run。

`run list` 在一个 PublicationCutoff 下列出已经提交 create transaction 且未删除的 Run。每项显示 state、Experiment、
开始/结束时间、`published / expected` coverage 与 invocationId。`active` 的空 Planned attempt 显示 pending；终态空 Planned attempt 显示
闭合 absence reason。

`show --run` 消费唯一 canonical Run Inspection operation `run.get`，不拼接多份近义 operation，也不使用 Run Host 自己的投影。结果包含 Run identity、state、
expected/published/missing、Planned attempt bindings、Attempt locators、absence、Verdict、score、Evidence、usage 与 limitations。

`run delete` 只接受终态 Run。目标仍为 `active` 时提示先 recover；存在 incoming reference 时零删除，并列出依赖
Run 与 Attempt locator。命令没有 `--force`、cascade 或按 selector 批量删除。
若关联 State 租约集合仍为 active/recovering，返回 `run-state-recovery-required`、零删除、非零退出；先按 [State 恢复](../state/cli.md#中断后恢复) 处理整个集合。

`run recover` 只在 NiceEval 能证明旧 owner 已终止时 fence writer generation 并把 Run 收口为 `interrupted`。
它先进入可检查、可重试的 `recovering`，再以匹配 generation 收口；证据不足时拒绝，且不删除任何已发布 Attempt。

`session list` 默认只列 active Invocation；`--all` 加入已收口的 durable Session。`session show` 以 exact invocation ID
显示这次 Invocation 的 terminal projection、created Run IDs、completion 与 publication cutoff；它不会重新构建 live 面板，也不提供后台接管。

对 active Invocation，`invocation show` 还列出每个已派发、尚未发布的 Planned attempt，让另一个终端里的人或 agent 不必解读运行日志：

- Experiment ID、Eval ID 与从 1 开始的 Attempt 序号；
- 当前阶段及进入该阶段的时间。阶段取自 Runner 的 lifecycle，与 live 面板和 `show @<locator> --timing` 使用同一组名称；
- Sandbox provider 名与 provider 原生的实例标识（例如 Instabox 的实例名、Docker 的容器名）。实例尚未创建或 Eval 不使用 Sandbox 时写明没有；
- 最近一条 Attempt detail 及其时间，与非 TTY Human 输出的 detail 行是同一份文本。

实例标识用于排查者以 provider 的原生 CLI 直连现场，NiceEval 不代理这次连接。这些行是 owner 进程随活动写入的非权威观察值，
与 heartbeat 同级：owner 被暂停时可以停止前进，读取方只按原样显示写入时间，不据此判断 Attempt 死活。
已发布的 Attempt 不再出现在这里，改由 `show @<locator>` 读取；排队中尚未派发的 Planned attempt 只按 Experiment 计数。
`--json` 输出同一组字段。凭据、env var 值与 Sandbox 内的文件内容不进入这些行。

`run import` 将外部已交付、已验证的单文件 Record 中的已发布 Run、Attempt 闭包、family 事实与 Content chunk 汇入当前项目数据库。
它只导入完整封口的已发布 Run。目标项目已存在相同 Run ID 且散列一致时幂等跳过；Run ID 冲突但内容不一致时完整拒绝且零写入。
导入成功后更新项目发布时钟，新汇入的 Run 立即对 Inspection 与后续沿用可见。

`run export` 将一个或多个选定 Run 及其传递依赖的 Attempt、family 事实与 Content chunk 导出为自洽的单文件 portable Record。
导出文件剔除未选中的历史 Run、未引用的临时状态与项目内部会话。输出文件自动完成只读完整性验证，可直接用于离线审计交付或跨机汇合。

canonical Record 固定为项目内 `.niceeval/record.sqlite`。受控退出会自动 close writer、checkpoint、truncate WAL，并以内建
只读验证通过后才成功。portable gate 仅由正在收尾的 Invocation 发起，且任何 active work 都会完整拒绝；该文件本身即可直接复制或归档。
跨机器分片汇合使用 `run import`，离线审计交付选定子集使用 `run export`；无需手工运行 `clean` 或 `migrate` 命令。

`show`、`query`、`run list/show` 与 `view` 可以直接读取支持的历史 portable Record，无需先运行评估。
历史格式只在私有副本中迁移；原件、历史 Run 与引用不被改写，也不创建新 Run。
`query --record <file>` 的外部输入必须是已交付、无并发修改的单文件 Record。未知格式、非空 WAL、损坏文件或无法证明的 owner 状态明确拒绝。
项目 operational 读取保留当前格式的实时事实；输入选择、原件保护与失败边界统一见 [自动迁移](architecture/README.md#自动迁移)。
