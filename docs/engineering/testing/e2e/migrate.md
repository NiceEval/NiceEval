# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 Record，供另一个进程中的 candidate 通过公开 CLI 读取。
该 Repo 归属 Record 域，但不取代公开 Record API owner。

## Current-to-current handoff bootstrap

初始 owner 把 `producer` 和 `candidate` 绑定为两个命令身份，但两者都使用当前 candidate。
producer 运行确定性 Experiment 并持久化 Record。candidate 在同一个私有 case 项目中启动独立的
`show --run ... --json` 命令，并必须选中该次公开 Run 身份。

该 owner 只证明持久化交接和可替换的 producer 接缝。它不声称旧版兼容、旧 schema 迁移、
格式转换后的 ID 保留，也不声称已接管 legacy producer 的可靠性。

当可验证的旧包可用时，root runner 负责该包身份，测试只替换 producer 命令前缀。
直接读取仅适用于当前 reader 支持的 Record 版本；更旧的 Record major 仍须经过产品的显式迁移路径。
