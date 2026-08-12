# Limits

- `.niceeval/record/` 仍只保存 published facts；session、lock 与 cache 属于本地 operation state。
- `FrozenRecordView` 的 Run 集合、warnings、owner handles 与 identity 在创建后冻结。
- reader 使用 shared maintenance lease；writer 使用 shared maintenance lease 加 exclusive writer lock。
- migrate 使用 exclusive maintenance lock，不从 shared lease upgrade，也不由普通读取自动触发。
- 不建立进程全局 singleton。官方 host 在组合层复用 runtime，filesystem locks 继续提供跨进程正确性。
- cache hit、miss、size、eviction 与 local paths 不进入 consumer API、Report、Record 或 provenance。

一个自动 refresh、同时暴露 read/write/migrate/cache 的 live reader 不是候选。它直接违反 frozen snapshot、
capability separation 与 migration lock 公理，因此只作为非法组合，不建立第三个 PLAN。
