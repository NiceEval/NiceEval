# Sandbox —— 数据模型

本页定义 Sandbox 在 UserDatabase 中持久保存的数据。读写这些数据的时序与不变量见 [远端 snapshot Before cache](architecture/remote-snapshot-cache.md)。

## 远端 snapshot 账本

所有使用 `remoteSnapshotPreparer` 的 Provider 共用 UserDatabase 的 `before-cache-snapshots` repository。所有写操作由 UserDatabase worker 的 `BEGIN IMMEDIATE` 事务完成；Provider 请求不持有数据库事务。

### `before_cache_snapshots`

每行表示一次 NiceEval 发起的 snapshot。行在 snapshot 请求之前写入，因此 NiceEval 创建的每份 snapshot 都有登记（[OPS-7](../../user-story.md)）。

| 字段 | 类型与约束 | 含义 |
| --- | --- | --- |
| artifact_id | TEXT PRIMARY KEY | 宿主生成的 UUID，不是 Provider locator |
| provider | TEXT NOT NULL | Provider module 的 `id`；core 不枚举取值 |
| execution_domain_id | TEXT NOT NULL | driver `resolveBase` 返回的服务与账号摘要 |
| before_cache_key | TEXT NOT NULL | 通用 planner 计算的 BeforeCacheKey |
| base_identity | TEXT NOT NULL | 不可变 Base 身份 |
| declaration_json | TEXT NOT NULL | 严格编码的完整累计声明（`BeforeCacheDeclaration`）；不含 secret |
| replacement_scope | TEXT NOT NULL | 按声明位置计算的摘要，算法见[替换按声明位置](architecture/remote-snapshot-cache.md#发布与竞争) |
| generation | INTEGER UNIQUE NOT NULL CHECK > 0 | 全库单调分配，取值为已分配的最大值 + 1 |
| snapshot_name | TEXT UNIQUE NOT NULL | `niceeval-<artifact_id>`，用于结果不确定时的精确查询 |
| snapshot_id | TEXT NULL | Provider 返回的 locator；Ready 之前为空 |
| state | TEXT NOT NULL CHECK IN ('preparing', 'ready', 'deleting', 'deleted') | 生命周期 |
| lease_token | TEXT NULL | `preparing` / `deleting` 行的 [lease](../../concepts.md#lease) token |
| lease_until | INTEGER NULL | lease 到期时间，Unix 毫秒 |
| created_at | INTEGER NOT NULL | 写入时间，Unix 毫秒 |
| published_at | INTEGER NULL | 首次发布时间；未发布的行保持 NULL，进入删除后不清空 |

约束：

- `(provider, execution_domain_id, snapshot_id)` 唯一。
- `(provider, execution_domain_id, before_cache_key)` 在 `state = 'ready'` 上条件唯一。
- `preparing` 必须同时有 `lease_token` 与 `lease_until`；`ready` 与 `deleted` 两者都为空；`deleting` 两者同时为空或同时非空，同时为空表示任意进程可立即领取。
- `ready` 必须有 `snapshot_id`；`deleting` 可以没有，此时回收按 `snapshot_name` 查询。

索引：`(provider, execution_domain_id, before_cache_key, state)` 服务 lookup；`(provider, execution_domain_id, replacement_scope, state)` 服务替换；`(provider, execution_domain_id, state, lease_until)` 服务过期接管与删除。generation 分配只读唯一索引的端点，成本不随 `deleted` 行数增长。

`deleted` 行保留 `published_at`，用于拒绝更小 generation 的迟到发布。

### `before_cache_snapshot_holds`

每行是一个 [hold](../../concepts.md#hold)。两种持有者的语义见 [远端 snapshot Before cache · 回收](architecture/remote-snapshot-cache.md#回收)。

| 字段 | 类型与约束 | 含义 |
| --- | --- | --- |
| hold_id | TEXT PRIMARY KEY | 宿主生成的 UUID |
| artifact_id | TEXT NOT NULL REFERENCES before_cache_snapshots | 被保护的 artifact |
| holder | TEXT NOT NULL CHECK IN ('run', 'sandbox') | 持有者种类 |
| sandbox_id | TEXT NULL | `sandbox` hold 在实例创建成功后记录的 Provider 实例 ID；`run` 恒为 NULL |
| expires_at | INTEGER NULL | `run` 必填，随 Run 心跳延后；`sandbox` 恒为 NULL |
| created_at | INTEGER NOT NULL | 写入时间，Unix 毫秒 |

按 `artifact_id` 建索引。`sandbox` hold 在创建实例之前插入，Provider 确认该实例删除后才删除，不凭时钟过期。`run` hold 过期后无效，任何进程都可以删除该行。

### 事务边界

| 操作 | 同一事务内完成 |
| --- | --- |
| lookup / reserve | 读 ready 行并插入 `run` hold；或分配 generation 并插入 `preparing` 行 |
| 续期 | `state = 'preparing'`、`lease_token` 相同且 `lease_until >= now` 时延长 lease；否则不写入，调用方失去 lease |
| 接管 | 比较旧 `lease_token` 与已过期的 `lease_until`，换上新 token 与新 lease |
| 发布 | 校验 lease 与 generation、写 `snapshot_id` 与 `ready`、插入 `run` hold、把同 scope 更小的 ready 改为 `deleting` |
| 请求结果不确定 | 以当前 lease 把 `preparing` 改为 `deleting`，`snapshot_id` 留空，清空 lease |
| 交接 | 插入 `sandbox` hold；依赖该 artifact 的 Planned attempts 都已交接时删除对应 `run` hold |
| 删除领取 | `state = 'deleting'`，lease 为空或已过期，且没有 `sandbox` hold 与未过期的 `run` hold，写入新 token 与 lease |
| 删除结算 | 以领取 token 改为 `deleted` 并清空 lease；失败或 `Pending` 时只清空 lease |

### 建立

账本由一次新的相邻 UserDatabase migration 建立，不读取、不转换任何既有缓存数据（[T-1](../../taste.md#t-1)）。同一 migration 删除既有的 E2B、OpenSandbox、Docker 与 Incus before 缓存表，并按新名字重建 Docker 与 Incus 的表；临时的 GC lock 行同样丢弃。

已有缓存因此全部失效：

| 遗留物 | 结果 |
| --- | --- |
| E2B、OpenSandbox 账号中 NiceEval 创建过的 snapshot | 不再登记，NiceEval 不回收；用户在 Provider 控制台删除 |
| 本机 Docker 中的 before 缓存 image | 不再登记，`docker cache inventory` 与 `docker cache gc` 都看不到；用户自行删除 |
| Incus prepared artifact（VM、disk 与 image） | 不再登记，`inventory incus` 与 `gc incus` 都看不到；用户用 `incus` CLI 按 `user.niceeval.setupPrefixKey` metadata 找到并删除 |

下一次运行按新 key 重新准备并发布。
