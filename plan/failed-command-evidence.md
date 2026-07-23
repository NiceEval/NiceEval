# 非零 Sandbox 命令证据：实现 TODO

目标契约单点：

- 落盘形状、截断与横切接线（writer 参数面 / reader 懒加载 / `copySnapshots` 缺省）：
  `docs/feature/results/architecture.md#证据-registry`、`#commandsjson`
- 终端 / JSON 读取：`docs/feature/reports/show/execution.md`、`show/json.md`
- 反馈分层：`docs/error-feedback.md`
- 测试类别：`docs/engineering/testing/unit/{sandbox,results,reports}.md`

## TODO

- [x] 在 runner 的公开 Sandbox timing wrapper 中，给最外层 `runCommand` / `runShell` 分配的
  command node id 同时作为 evidence id；非零返回先登记完整 `CommandResult`，再交还调用方。
- [x] 按证据 registry（`docs/feature/results/architecture.md#证据-registry`）给 `commands`
  加一行接线：attempt writer 落盘 `commands.json`，写入的 `AttemptRecord.artifacts` 含
  `commands`；stdout/stderr 复用 `ARTIFACT_VALUE_MAX_BYTES` / `Truncation`，不另造截断规则。
- [x] Results reader 按 registry 表新增 `commands` 懒加载方法；携带按 `artifactBase` 回退；
  `copySnapshots` 的 `artifacts` 联合按 registry 词表带上 `"commands"`（缺省带）。
- [x] execution compose 把 `events.json` 的 Agent 卡与 `commands.json` 的失败命令卡组成同一
  attempt 视图；命令卡按 timing node `startOffsetMs` 排序，缺 timing node 时保留证据并明确显示
  timing unavailable，不按数组偶然顺序猜时间。
- [x] `--expand cmd<N>`、`--grep`、JSON `failedCommands` 与 Attempt 首页下钻提示接线。
- [x] 按三份测试文档补最小区分力场景；重点反证 Eval 在拿到结果后 `.slice(-500)` 不会删除
  wrapper 已登记的 EACCES/path。

## 非目标

- 不把 stdout/stderr 塞进 `TimingNode` 或 `result.json`。
- 不记录成功命令输出。
- 不捕获 Agent 内部 shell 工具或 provider 私有步骤；它们分别属于 events 与 provider timing。
- 不承诺无限大小的“完整 stderr”；持久化上限沿用 256 KiB 逐值规则。
