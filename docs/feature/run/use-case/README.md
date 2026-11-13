# Run 用户路径

先按目标选择路径。行为与公开形状由 [CLI](../cli.md)、[Library](../library.md) 和 [Run](../README.md) 拥有。
叶子用例串联调用与反馈，不另定义契约。

## 查看：`run list`、`show --run`、`--invocation`、`--json`

- [查看运行](查看运行.md)：从列表找到 exact Run，辨别已发布结果与缺口。
- [应用中列出运行](应用中列出运行.md)：Node 应用用 `runHost.list` 获取运行列表。

## 观察：`invocation list`、`invocation show`

- [观察运行中的批次](观察运行中的批次.md)：从另一个终端看每条 Attempt 的阶段、最近进展与 Sandbox 实例。

## 收口：`run recover`

- [恢复中断运行](恢复中断运行.md)：旧 owner 终止后收口遗留的 active Run，保留已发布结果。

## 删除：`run delete`、`--yes`

- [删除终态运行](删除终态运行.md)：删除不再需要且没有 incoming reference 的终态 Run。

## Library API → 篇目

| API 组 | 用户路径 |
|---|---|
| `runHost.list` | [应用中列出运行](应用中列出运行.md) |
| `runHost.get`、`decodeRunDocument` | [查看运行](查看运行.md)：展示对应的 CLI 与机器读取目标；Library 形状见 [Library](../library.md) |
| `runHost.recover` | [恢复中断运行](恢复中断运行.md)：CLI 收口路径，应用调用形状见 [Library](../library.md) |
| `runHost.delete` | [删除终态运行](删除终态运行.md)：CLI 删除路径，应用调用形状见 [Library](../library.md) |
