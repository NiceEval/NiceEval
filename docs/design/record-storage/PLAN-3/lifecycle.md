# PLAN-3：SQLite inventory + 外部 Content packs —— Lifecycle

## Owner

| Owner | 责任 |
|---|---|
| family producer | 提交 rich value、plain-data item、Content source 与业务 limitation |
| Attempt writer | 线性化 start/append，管理 cap，并关闭 Attempt collection |
| Run storage actor | 独占 staging SQLite；执行 fixed logical statements |
| Content pack writer | 管理 bounded file buffers、ranges、index 与 digest state |
| Run publisher | 形成 final DB，交叉验证 database/pack/Seal，fsync 并 rename directory |
| reader/maintenance | 同时服从 SQLite 与 pack 的 hostile-input、Scope 与 migration 边界 |

## Active Run

```text
create local staging directory
  → open staging SQLite actor and Content pack writer
  → append item rows / write Content ranges
  → finalize logical Attachment descriptors
  → complete Attempts and stop mutations
  → fixed export committed rows to final run.sqlite
  → close/checkpoint database; close packs and indexes
  → validate database + Content + references + whole-Run Seal
  → write seal.json and complete last
  → fsync files and staging directory
  → no-replace rename whole Run directory
  → re-open destination and return receipt
```

不同 Run 使用不同 actor与 directory，可以并行。
同 Run database command 与 pack I/O 通过 Host backpressure 协调；任何一侧失败都 poison 未发布 Run。

## Crash 与 recovery

- database row存在而 Content descriptor尚未 finalize时，row属于 staging draft，不进入 final exporter。
- pack有 partial/unreferenced range时，range不进入 final index/Seal，也不进入 portable root。
- directory rename 前崩溃只留下 local staging；recovery 不组合不同 staging attempt。
- rename 后丢 receipt 时，recovery 同时重验 final DB、pack/index 与 Seal，不重跑 producer。
- destination 重验失败时 Run 保持 invalid/unavailable，不删除 bytes，也不返回成功 receipt。

## Storage migration

maintenance host 同时只读打开 source DB 和 external packs，在新 local staging directory 形成下一 storage revision。
unknown family 依靠 generic DB inventory、raw payload/items、Content descriptors、pack ranges与 references复制。

new directory 完整验证后执行 atomic replace。
普通 read/CLI 不静默 checkpoint、repack 或修改 published DB。

## 资源成本

final metadata export 是 O(Core + payload + item bytes)，不复制 Content bytes。
迁移或 pack codec 变化仍可能需要 O(total Run bytes) 新目录。

方案必须同时预算 SQLite temp/WAL、final metadata DB、Content pack、new Seal 与 fsync handles。
任一资源不足都使 publication fail closed。
