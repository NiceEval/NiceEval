# 候选三：一 Run 一 SQLite application file

> 状态：generic collection 成立时的领先候选；采用前有硬门槛

portable root 保留小 `record.json`；每个 published Run 是独立只读 SQLite application file。
整个 Record root 不共用一份数据库，以免不同 Run 争用同一个 writer。

```text
record/
├── record.json
└── runs/
    ├── <run-a>.niceeval-run
    └── <run-b>.niceeval-run
```

## 逻辑模型前提

SQLite 只有在 Record 先采用以下领域模型时才有主要收益：

- definition 穷尽声明 `singleton` 或 `collection`；
- singleton 仍 create-once；
- collection 的每次 `record.write(definition(item))` 提交一个 logical item；
- exact owner/family capture obligation 另签发一次性 sealer，只允许 `complete()` 或 `partial(nonEmptyClosedLimitations)`；
- collection identity 与 order key 由 definition 声明并 canonical encode，不使用 rowid、arrival time 或 scheduler order；
- duplicate identity/order key、缺 seal、重复/foreign/late seal 都让未发布 Run fail closed；
- Host budget 超限是 typed failure，不能自动生成领域 `partial`。
- Source receipt 继续表达 capture authority/completeness；没有逐项读取价值的 receipt 保持 singleton。
- `RecordAttachmentReference` 继续引用 owner/family Attachment，不因 collection 自动取得 item-level identity。Item-level reference 需要另行设计。

需要顺序的跨项 invariant 只能在 seal 时按 order-key cursor 重新读取并流式归约。
fold state 有独立小预算；不能有界表达的关系进入 Analysis，或该 family 继续使用 singleton。

## 通用存储，不建 family table

候选只允许 Core-owned generic STRICT tables，概念上包括：

- Core、owner 与 family instance；
- singleton value 或 collection entry；
- logical Content 与 bounded content chunk；
- reference；
- collection completeness 与 Run Seal。

family payload/item 是 canonical opaque bytes。
family 不能贡献 SQL、table、column、index、trigger、view、expression 或 migration statement。
storage revision 与 family revision 分离；unknown family 通过 generic identity/revision/raw bytes/chunks 复制，不解释业务 schema。

## Active write

每个 active Run 由一个 Host storage actor 独占一个连接；同 Run SQL command 排队，不同 Run 使用不同 DB/actor 并行。
Content source 读取、hash 与 Schema encode 可以在 actor 外有界并发。

Content 不写成单行巨型 BLOB。
Host 按私有上限形成 chunk，使用短 transaction 写 staging draft，同时增量计算 overall length/digest；finalize transaction 才把 item、Content 与 reference 变成 committed logical write。
取消或失败不能成为领域 `partial`；未发布 staging 可以被 abandon。

active staging 可以使用 WAL，因为它位于 local sidecar，永远不是 portable closure。

## 不能直接发布热数据库

热 staging DB 的 journal/WAL、draft row、freelist 与失败 material 不能进入 Git。
候选的 publication 必须从 sealed logical state 形成一个新的 final-schema file：

1. 停止新 command，等待所有 capture obligation；
2. 拒绝任何 draft、缺 collection seal 或不完整 closure；
3. 写 logical Run Seal；
4. 从稳定 snapshot 通过一个 fixed exporter 重建新 final file；
5. 新文件不得包含 active-staging-only schema、draft 或外部 sidecar；
6. 对新文件执行 full integrity、foreign key、application Seal、inventory 与 Content closure 验证；
7. 关闭所有 handle，fsync file 与 staging parent；
8. no-replace rename 到 `runs/<run-id>.niceeval-run`，fsync destination parent；
9. read-only 重验 destination 后才返回 receipt。

rename 是 publication commit，SQLite transaction 不是。
rename 前的崩溃只留下 local staging；rename 后丢 receipt 由 local recovery manifest 重验，不能重跑 producer。
destination 重验失败时该文件保持 invalid/unavailable，不删除、不以同名新文件替换，也不返回成功 receipt。

采用前 spike 必须在 `VACUUM INTO` 与只读 cursor + fixed inserts 中选定唯一 exporter。
只有前者能在删除 internal draft schema 后产生 exact portable schema 时，才可以选择前者。
长期保留两条 publication path 会形成两个 storage truth，禁止进入 Design。

这条 O(run bytes) 的 final snapshot/rebuild 是单文件 closure 的明确 seal 成本，不应隐藏。
临时磁盘预算必须按接近两份 Run bytes 评估；不可接受就采用 JSON + Content store。

## Published read 的安全边界

portable DB 是不可信输入。
Host 只发 fixed prepared statements，并禁用 extension、ATTACH、custom function 与 family SQL。
连接使用 read-only、defensive、`trusted_schema=OFF`、`query_only=ON`、`mmap_size=0` 和收紧的 runtime limits。
Host 先验证 application id、storage revision 与 exact schema，并拒绝额外 trigger、view 与 virtual table。

ordinary read 只验证 requested owner/family/item/Content closure 与相关 digest，不宣称整 Run complete。
publish、migration source validation 与 `requireComplete()` 才执行 full database integrity、foreign key、Seal、inventory 与全部 Content closure 检查。

若安全审查证明在 full integrity 前执行局部查询不可接受，SQLite 候选翻转为 JSON + Content store；不能用「read-only」代替 hostile-file threat model。

## SQLite 实际减少什么

- item unique/index 与 canonical-order cursor；
- row-level lazy read；
- logical inventory/reference/Seal 的 transaction；
- 大量小事实的单文件 packing；
- storage-level integrity primitives。

SQLite 不会减少这些 NiceEval-owned 协议：

- logical Content chunk、overall digest 与 budget；
- storage actor、backpressure、取消和 fairness；
- outer publication、fsync、crash recovery 与 receipt；
- family schema、unknown family preservation 与 storage migration；
- hostile resource limits 与 application closure validation。

## 采用前硬门槛

满足任一项就撤销 SQLite 推荐：

1. generic collection 未被采用，Content streaming 可由 JSON + segments 完成；
2. lazy ordinary read 与 hostile database 安全无法同时成立；
3. 一 Run 一 writer 无法满足并发 Attempt、取消、RSS 与 throughput；
4. final snapshot + no-sidecar + rename 的 crash matrix无法证明；
5. `node:sqlite` worker/transfer/cancel 实测复杂度或性能不优于自管方案；
6. storage migration 需要解释 unknown family 或把 family 字段升格为 SQL；
7. seal 时 O(run bytes) snapshot 成本不可接受；
8. Git 文本 review 被提升为产品硬目标。

SQLite 的 RC Node API 标签本身不是持久格式翻转条件；SQLite disk format 与 package-private adapter 必须分别评估。
完整挑战过程与 publication fault points 见 [独立设计挑战](../design-challenge.md)。
