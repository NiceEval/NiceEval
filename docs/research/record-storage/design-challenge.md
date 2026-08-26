# SQLite 候选独立设计挑战

> 挑战日期：2026-08-25
>
> 角色：独立、只读 `design_grill`
>
> 判定：`CONDITIONAL`

本页保存候选形成过程，不构成 Feature 或 Design 的采用状态。
挑战者收到完整 NiceEval 现状、三个候选、外部研究和已知 Memory，未继承主流程的隐式判断。

## 第一轮：SQLite 是否在替领域模型做决定

挑战首先拆开五件事：

1. 当前 create-once family 是否真的要改成 generic collection；
2. 原子 publication 是 whole-Run directory 还是一 Run 一 file；
3. lazy ordinary read 与 hostile SQLite input 能否共存；
4. 一个同步 writer 怎样处理并发 Attempt 与大 Content；
5. JSON-in-SQLite 是否真正修复 4 MiB、深层 snapshot 与整体内存问题。

这一轮迫使候选承认：

- SQLite 只有在 generic collection 是产品语义时才有主要收益；
- 大数组必须成为 item Schema，大材料必须成为 Content；
- rowid、到达时间和 transaction 顺序都不是业务顺序；
- SQLite transaction 不能替代 outer publication commit；
- ordinary read 与 `requireComplete()` 的证明强度必须分层。

## 第二轮：append、draft 与 publish 的隐藏协议

挑战继续提出四个问题：

- write-time fold 与 seal-time canonical order 是否使用同一套数学；
- collection completeness 由哪个显式 command 写入；
- `draft_content_chunks` 是否在 `journal_mode=DELETE` 上重做一份较差的 WAL；
- close 热数据库再 rename 是否真的形成单文件 publication 证明。

候选因此发生四项实质修订：

1. 顺序相关 invariant 只能在 seal 时按 logical order key 重新读取并流式归约；
2. collection capture obligation 必须拥有一次性 sealer，不能用 sentinel item 或 Run 级默认 complete；
3. active staging 可以使用 WAL，因为它只位于 local sidecar；
4. 热 staging DB 和它的 freelist 永远不能直接成为 published file，必须 exporter 生成新的 final-schema DB。

## 为什么不是 `PASS`

逻辑模型已经自洽，但下列事实尚未通过可运行证据：

1. exporter 是否能稳定生成 exact portable schema，并最终只保留一条 canonical path；
2. crash matrix 是否在目标 filesystem 与平台上保持 reader 的 fail-closed 可见性；
3. 同 Run actor 在 bounded chunk、取消、RSS、吞吐与 fairness 下是否合格；
4. full `integrity_check` 前的 hostile ordinary open 是否可接受；
5. unknown family 是否能由 storage migration 逐 raw bytes/chunks 保留；
6. O(run bytes) final snapshot 与约两倍临时磁盘是否可接受；
7. Linux 与其它承诺平台的 migration replace/old-fd 语义是否穷尽；
8. SQLite 后 NiceEval 仍拥有的协议是否真的少于 JSONL + segments。

这些条件没有证据前，SQLite 只能作为研究候选，不能标成 selected plan 或进入实现。

## 为什么不是 `REJECT`

generic collection 若正式成立，SQLite 能实质替代这些自管能力：

- item identity/order unique index；
- canonical-order pagination cursor；
- logical inventory、reference 与 Seal transaction；
- 大量小事实的 packing；
- storage-level integrity primitive。

这些收益不是「把 JSON 放进数据库」，而是 collection 领域模型形成后的真实需求。

## Publication crash matrix 输入

下表是后续 spike 必须转成可运行测试的最小矩阵。
「available」指 NiceEval reader 接受并提供 Run，不等于目录中恰好存在同名文件。

| 故障点 | portable path 可能状态 | recovery / reader 要求 |
|---|---|---|
| final file 形成前 | absent | 只删除 local staging 残留；不得重跑 producer |
| exporter 写 final file 时 | absent | partial file 只在 local staging；不得进入 portable root |
| full validation 后、rename 前 | absent | 可重新验证同一 staging candidate 后重试 publication |
| rename 后、destination parent fsync 前 | absent 或 present | path absent 视为未发布；present 必须 read-only 全面重验 |
| parent fsync 后、destination 重验前 | present | receipt 尚未完成；reader 自己仍按 published 验证规则 fail closed |
| destination 重验后、receipt 前 | present 且 valid | recovery manifest 只补验和 receipt，不重跑 producer |
| destination 重验失败 | present 且 invalid/unavailable | 不删除，不以同名新文件替换，不返回成功 receipt |
| receipt 后 | present 且 valid | 普通读取与 `requireComplete()` 各自执行约定证明 |

spike 还必须注入进程终止、I/O error、disk full 与 competing destination，而不只在函数调用之间抛普通异常。

## 条件失败时的方向

任一硬条件失败，就采用 [JSON envelope + Host 私有 Content store](options/json-content-store.md)。
若 generic collection 已经采用，该方案再增加 JSONL 或逐项 object 与 Host 私有 index。

全 JSON 不作为退路；它仍与已观察到的 payload byte/depth、Content 内存和 lazy item read 冲突。
