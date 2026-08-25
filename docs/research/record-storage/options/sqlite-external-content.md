# 候选四：SQLite metadata + 外部 Content segments

> 状态：条件性退路，不是默认折中

每个 Run 仍是一个 opaque directory。
SQLite 保存 singleton、collection item、identity/order index、reference 与 logical Seal。
大 Content 保存为 directory 内的 object/segments，数据库只保存 logical handle、length、digest 与 manifest reference。

```text
record/
├── record.json
└── runs/
    └── <run-id>/
        ├── run.sqlite
        └── content/...
```

整个 Run directory 通过 no-replace rename 发布。
SQLite 在 directory rename 前关闭、checkpoint 并验证；任何 journal/WAL 都只留在 local staging。

## 收益

- collection item、unique index、canonical-order cursor 与 logical transaction 交给 SQLite；
- 大 Content 可直接写 segment files，避免 seal 时把全部 bytes 重建进 final DB；
- reader 可对 Content 做自然的 sequential/range file I/O；
- published closure 仍自包含，不依赖全局 object store。

## 代价

- 同时拥有 SQLite hostile-read/storage-revision 与 segment manifest/integrity 两套协议；
- logical write 横跨 DB row 与 filesystem bytes，需要自管 envelope-last commit；
- whole-Run 原子性仍来自 directory rename，不来自 SQLite transaction；
- 小 Content inline/pack、orphan segment、DB reference 与 file closure 必须一起校验；
- published Run 的物理形态是 directory，因此没有 SQLite 单文件封装的主要产品收益。

## 何时才选择

只有同时满足以下事实时，它才优于另外两个主候选：

1. generic collection 与 item lazy read 已成为明确产品需求，因此 JSONL + 自管 index 成本过高；
2. SQLite chunk row 的 RSS、throughput、取消或 O(run bytes) final snapshot 经实测不合格；
3. direct streaming 大 Content 是硬需求；
4. opaque Run directory 满足 portability，不要求一 Run 一文件。

若没有第 1 项，直接选择 JSON + Content store 更简单。
若第 2、3 项不成立，直接选择一 Run 一 SQLite 可以避免双存储协议。
因此该方案不是「两边都要一点」的默认折中，而是由实测反转条件触发的专门形态。
