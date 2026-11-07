# Run 删除与恢复的预期领域错误成为 Effect defect

开发 review 发现 `run/host/lifecycle-adapter.ts` 在 `Effect.gen` 中直接 throw 六个 `RunDeleteError` / `RunRecoverError`：数据库已有但 Run 缺失、删除 active Run、恢复 terminal Run、owner 仍活跃或未证明终止等分支因此进入 defect，公开调用方的 `Effect.catchTag` 无法按领域错误恢复。

正常拒绝应进入 typed error channel，不能改变 active Run、终态 Run 或其已发布事实。复用独立 Run Host consumer 的公共生命周期目标，在已安装候选中先证明 catchTag 失败，再修 throw 为 typed failure，并验证失败后仍可在同一进程操作其它 cwd。

已只读枚举 GitHub open/closed Issues；未发现同义 Run Host 错误处理项。当前是源码确认的根因，公开红灯与最终接管尚待取得；不声明 fixed。
