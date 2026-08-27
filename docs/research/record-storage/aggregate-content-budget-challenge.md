# Attachment aggregate Content budget 独立设计挑战

> 挑战日期：2026-08-25
>
> 角色：独立、只读 `design_grill`
>
> 判定：`CONDITIONAL`

本页保存取消 Attachment Content 合计 128 MiB 上限、并引入 rolling pack sets 的挑战过程。
它不构成 Feature adoption 或 Design `selectedPlan`。

## 输入问题

现行 Core 同时限制：

- payload JSON 4 MiB；
- 单 logical Content 64 MiB；
- 一个 Attachment 的全部 Content 合计 128 MiB；
- Content handle、JSON、Seal 与目录 inventory 的结构数量。

PLAN-1 已把 Content source 转成 Host 私有 segment，但最初只写了一份 `content.pack`。
用户指出：若多个物理文件可以自动承载 Content，固定的 128 MiB aggregate cap 没有继续承担物理文件保护的理由。

## 第一轮：取消哪个预算

挑战区分了三种上限：

1. payload 与单 logical Content 的业务/调用级预算；
2. pack file、frame、index 与 Seal 的 storage-neutral 结构 ceiling；
3. 多个 Content 的 byte length 合计。

结算为：

- payload 4 MiB 与单 Content 64 MiB 保留；family `maximumBytes` 可以更小；
- Attachment 合计 128 MiB 只描述当前实现；候选共同目标不包含 aggregate cap；
- 不用另一个 1 GiB 常量复活同一种 aggregate cap；
- 不引入新的 operator quota API，也不让未定义 quota 代替正确性证明。

三个候选必须使用同一 RS13 证明多个 Content 合计超过旧上限。
Feature 与 Blob Roadmap 只有在某个 Plan 正式 adopted 后才同步修改。

## 第二轮：rolling 不等于无限制

挑战拒绝“没有 aggregate cap 就没有其它上限”。共同 hostile-input ceiling 必须使用 storage-neutral 分类：

- logical Content handle 数；
- durable closure member count/bytes；
- index/catalog encoded bytes 与 entry 数；
- frame、segment 或 chunk bytes；
- Seal inventory entries 与 bytes；
- safe integer、offset、range 与 path；
- collection 的 item、encoded bytes、nodes 与 depth 组合 cap。

PLAN-1 把这些类别映射到 pack files、indexes 与 ranges；PLAN-2 映射到 SQLite rows/chunks；PLAN-3 同时映射两侧。
`members × maximum member bytes` 会形成一个很高的派生物理信封，但它不是 family-visible Content byte-sum，也不进入 portable identity。

相同 storage revision 的 reader、publisher 与 migration 必须使用同一组 ceiling。
rollover threshold、buffer 与 cap 内 grouping 仍是 Host 私有策略；改变它们不能改变同一 published closure 的 validity。

## 第三轮：第一版 rolling codec

PLAN-1 第一版候选收窄为：

- 每个 Attachment 一套 item rolling pack set 与一套 Content rolling pack set；
- 一个 item frame 或 Content segment 完全位于一个 pack file；
- 一个 logical Content 是跨 pack ordinal 的有序 ranges；
- 小 Content 共享 Attachment-local packs；禁止跨 Attachment/global pack；
- rich write 逐份流式消费 Content，写完即释放完整 bytes；
- 第一版不做 Content byte dedup，不做 small-payload inline；
- `stream()` 按 ranges 真正流式读取，`bytes()` / `text()` 一次只读取一个不超过 64 MiB/family max 的完整 Content。

whole-Run directory rename 仍是唯一 publication commit。
任何未进入最终 Seal inventory 的 pack/index tail 都只属于 staging；published index 不能指向缺失或截断 pack，也不能把可读 prefix 当作业务 partial。

## 失败、未知 family 与迁移

digest、frame、index 或 inventory mismatch 是 durable invalid/corrupt。
取消、memory/time admission、ENOSPC、inode、fsync 与 I/O failure 是 typed resource/cancel；它们不能把已发布 closure 改判 corruption。

unknown family 仍按 Seal inventory 原样复制 envelope、indexes 与 packs，并做 generic structure/digest validation。
它不运行 family Schema，也不能提供 path、SQL 或 storage capability。

ordinary reader 只接受当前 storage revision。
现行 digest-file layout 返回 typed `storage-migration-required`；相邻 converter 按旧 envelope inventory 流式形成新 packs/index。
known 与 unknown family 都保持 logical bytes，maintenance 在 copy-on-write staging 完整验证后 atomic replace；普通 read/show/view 不静默改写。

## `CONDITIONAL` 条件

下列证据写回 Design 前，不能声明 `selectedPlan`：

1. hostile-input spike 给出 durable member、index/catalog、frame/segment/chunk 与 Seal 的具体共同 ceiling；
2. RS2 证明单个 64 MiB Content 可以跨物理 member 且 RSS 有界；
3. RS13 证明三个不同的 48 MiB Content 合计 144 MiB 可以 write、seal、stream read 与完整校验；
4. RS3 证明 50,000 个 tiny item 全部 retained，full-array read 的 RSS/latency 可接受；
5. RS4 使用真实产品 cap 输入证明 omitted/partial，不使用测试专用低 cap；
6. RS7/RS14 分别注入 rollover、partial index/pack、disk/inode/fsync、rename，并验证很多小 Content；
7. `stream()` 探针证明内部没有先形成完整 `Uint8Array`；
8. digest-file → rolling converter 对 known/unknown family 均有 byte-preservation receipt；
9. Git/copy benchmark 收据写明默认 rollover 下的文件数、Seal cost 与 reader latency。

若单 Content 64 MiB 也被取消、第一版引入跨 Attachment dedup、ordinary reader 静默/双栈改旧布局，或 RS13 仍需要 O(aggregate bytes) RSS，本次结算必须重新挑战。
