---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 源码 Attachment 怎样安全演进

`niceeval.sources` 保存 origin Run 当时的源码 facts。演进时必须区分 family/data migration 与 physical schema migration，不能从
今天的 worktree 补造过去事实。

## Family/data change

Sources payload、SourceItem identity、Content 或 source-site join 的 canonical meaning 改变时，family owner 提供 typed adjacent
converter。converter 只消费已验证的 historical payload、items、references 与 Content bytes；不能读取当前文件、网络、provider、
clock 或 random。

成功 migration 推进 Sources family revision，重新验证依赖它的 closure并写新 Seal；它改变 logical identity。若旧 bytes 无法
证明 target fact，migration 必须具名失败或显式报告 dropped fact，不能用空值、当前 path 或猜测 digest 填补。

## Physical schema change

把 Content chunks、index 或 Seal representation 搬到新的 table/index/trigger 时，Record Host 使用 checked-in adjacent SQL。
只要 SourceItem、payload、Content bytes/digest、reference 与 family revision 都不变，migration 必须保留
`LogicalSealIdentity`，只推进 storage generation。unknown family rows 同样原样搬运。

大表 rebuild 使用 copy-on-write target，并在替换前流式验证 exact closure。ordinary reader 不自动迁移；正在执行的
`openCollection()` / Content Stream 通过 generation lease 阻止替换。physical replacement 后可重开同一 Logical Seal；family
migration 后旧 result 返回 restart-required。

## 分享历史

迁移前后要保存证据时分别生成 `RecordSnapshot`。不能复制 operational `record.sqlite`，因为它可能含 open/sealing rows 与
free-page residue。Snapshot 删除 unpublished closure、`VACUUM INTO` sealed-only bytes、验证并关闭后，才能进入 Git 或由
兼容 NiceEval runtime 的 `--record` 读取。
