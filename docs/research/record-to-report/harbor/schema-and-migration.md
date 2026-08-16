# Harbor 的 Schema、兼容与 Migration

本页回答 Harbor 有哪些彼此独立的版本轨道，旧 Job / Trial 怎样被 current reader 读取，以及哪些升级会重写用户保存的数据。
信封字段见 [存储与权威事实](storage.md)。

## 版本轨道

Harbor 同时存在多条互不替代的版本轨道：

| 轨道 | 版本字段 | 改的是什么 | 用户命令 |
|---|---|---|---|
| Python 包 | `harbor` 的 PyPI 版本；观察日为 `0.21.0` | CLI 与模型代码 | `uv tool install harbor` |
| Task 格式 | `task.toml` 的 `schema_version`，默认 `"1.4"` | 题目目录形状 | `harbor task migrate` 只服务 Terminal-Bench → Harbor |
| Task / Dataset 包 | `[task].version` / `[dataset].version` | 发布包身份；与格式版本分开 | `harbor publish` |
| Job lock | `JobLock.schema_version = 3` | 已锁定的 Job 输入 | 没有用户 migrate |
| Trial lock | `TrialLock.schema_version = 2` | 已锁定的 Trial 输入 | 没有用户 migrate |
| ATIF | `schema_version` 从 `ATIF-v1.0` 到 `ATIF-v1.7` | 轨迹 JSON | 没有用户 migrate；使用 Pydantic 字面量联合 |
| Hub 数据库 | 未公开 | `job` / `trial` 等表 | 平台侧；用户没有 `harbor migrate` |
| Hub `leaderboard` | definition / row 一次提交 | 策展表；不是历史 Job bytes | `harbor hub leaderboard update --dry-run` |

包版本证据见 [`pyproject.toml`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/pyproject.toml)。

## Job / Trial 没有用户 migration

Harbor 没有 `harbor migrate` 去改已经保存的 Job / Trial。
`harbor task migrate` 修改题目源目录，不修改 `jobs/` 中的运行事实。

该命令只服务 Terminal-Bench 题目到 Harbor Task 的迁移。
见 [Migrating from Terminal-Bench](https://harborframework.com/docs/migration)。

Hub 数据库由平台拥有，用户没有数据库 migration 命令。
Hub 服务端 migration 是否修改用户已经保存的 Job / Trial bytes，本次检查的一手公开面未提供。

## 兼容读取

旧 JSON 的兼容依赖 Pydantic `model_validator`，而不是一条显式 migration 链：

- `JobConfig` 仍能读取旧的嵌套 `orchestrator` 与 `plugins`；后者被忽略并打印警告。
- `DatasetConfig` 把旧的嵌套 `registry` 摊平。
- `EnvironmentConfig` 仍接受 `mounts_json`。
- `JobStats` / `JobResult` 把旧字段 `n_trials` / `n_errors` 和嵌套 `status` 映射到现行进度字段。
- viewer 把托管配置中的数字 `version` / `ref` 转成字符串。

这些 reader 在加载时修改内存对象。
它们不会重写磁盘上的 `config.json` 或 `result.json`。

## Lock 与 resume

`lock.json` 的整数 `schema_version` 参与相等比较。
版本不同会被视为不同实验，resume 因而拒绝继续。

公开材料没有给出 v1 → v2 → v3 的字段对照表。
resume 还要求已有 `config.json`、已完成 Trial 的 `TrialConfig` 和重建的 lock 分别相等。
完整恢复规则见 [Resume](execution.md#resume)。

Regrade 的 lock 相等比较源 Trial UUID 与 Task digest，不比较源路径。
因此移动源目录不影响 resume；在同一路径放入另一个 Trial 会被拦住。

## ATIF

ATIF 使用字符串枚举处理轨迹格式兼容。
观察提交中的默认版本是 `ATIF-v1.7`，公开模型接受从 `ATIF-v1.0` 到 `ATIF-v1.7` 的版本。

RFC 列出过破坏性变更。
例如 v1.7 不再允许只使用 `session_id` 定位子轨迹。

公开材料见 [ATIF 文档](https://harborframework.com/docs/agents/trajectory-format) 与
[ATIF RFC](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/rfcs/0001-trajectory-format.md)。

## Hub 认证迁移

Hub 认证从 GoTrue session 切换到个人 API key。
已有登录不会自动迁移，需要重新运行 `harbor auth login`。

这个变化修改 `~/.harbor/credentials.json`，不修改 Job archive。

## 持久化选择怎样影响 schema

Job / Trial 的 `config` / `lock` / `result` 信封相对稳定。
新增 Agent 日志、artifact 路径、ATIF `extra` 或 viewer 列，通常不会提升 `JobLock.schema_version`。

Metric、`pass_at_k` 与费用合计写在 `JobResult` 中，因此统计形状会与代码一起演进。
Harbor 使用兼容 reader 消化旧字段，而不是提供用户 migration。
代价是 `result.json` 的 stats 块会积累遗留键，reader 必须继续识别它们。

比较网格留在读取侧。
新增排序或筛选不需要修改磁盘，这也是 Harbor 中最接近「上层变化不改持久格式」的部分。

Hub 又把 rewards 写进表，并把 token 与费用写进 `trial_model`。
同一事实因此存在本地 Trial、Job 派生统计与 Hub 行等副本。
服务端聚合怎样版本化，本次检查的一手公开面未提供。

具体哪些值持久化、哪些值读取时计算，见
[哪些计算仍然持久化](storage.md#哪些计算仍然持久化)。
