# RecordAttachment 作者 SDK —— CLI

## 显式安装的 migration world

`niceeval migrate` 只使用本次加载配置明确安装的第三方 definitions，加上 NiceEval CLI 固定安装的内建
definitions：

```ts
export default defineConfig({
  recordAttachments: [gpuEnergy, agentTrace],
});
```

producer allowlist、历史 link、Record bytes 中的 name 或 package metadata 都不是 registry 输入。CLI 不扫描
Eval、调用 Plugin factory、执行 hook，也不根据旧 schemaId 动态 import package。

删除 producer 后，项目可以只保留 definition import 与 config registration，以继续迁移历史 Attachment。package
或 definition 不可用时，该 Attachment 保持 `unsupported`，bytes 原样保留；其它已知 family 与 Record Core 仍按
自己的 plan 处理。

## 命令

```sh
niceeval migrate [--record <root>] [--config <path>] [--yes]
```

`--config` 显式选择提供 application registry 的 NiceEval config。省略时沿用项目 config resolution；`--record`
仍只选择实际 Record root，不暗示 converter 注册位置。

preflight 输出每个 Attachment 的 owner、name、from、to 与状态：`current`、`migrate`、
`migration-unavailable` 或 `unsupported`。plan 绑定 root snapshot、installed registry identity 与 Git inspection；
任一输入变化后执行返回 `record-migration-plan-stale`。

CLI 在取得 maintenance lock 与创建 sentinel 前完成 config import、definition nominal identity、完整 graph 与
duplicate registry validation。config throw、伪造 definition、重复 owner/name 或非法 graph 都以零 portable write
失败；不会在锁内才执行用户 config。

## Git 与恢复

CLI 在第一次修改 portable bytes 前检查 Git restore point，并在 root 下 exclusive create + sync
`migration.in-progress`。存在 Git restore point 时，用户确认后原地迁移；没有 Git restore point 时，`--yes` 只
表示用户确认自己承担备份与数据损失风险。

`--yes` 不创建备份，也不能把 unavailable edge 变成 converter。NiceEval 不维护内部 backup、rollback、shadow
copy、out directory 或 migration history。

converter failure、I/O failure、defect 或 interruption 留下 sentinel。此后 open、plan 与 migrate 都返回
`record-migration-interrupted`；反馈要求从 Git 或用户备份恢复，不能直接重跑或删除 sentinel 猜测状态。
