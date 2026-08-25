# 无固定 logical Content 容量独立设计挑战

> 挑战日期：2026-08-25
>
> 文档性质：设计挑战过程与证据，不是 Feature 或 selected storage contract

本页保存取消单 logical Content 64 MiB 上限后的独立挑战。
它延续 [Attachment aggregate Content budget 挑战](aggregate-content-budget-challenge.md)，并满足该页末尾“取消单 Content 64 MiB 必须重新挑战”的条件。

## 触发问题

旧结算只移除了 Attachment Content 合计 128 MiB，上层仍有三项假设：

- 单 logical Content 受 Core 64 MiB cap；
- `content.bytes()` / `content.text()` 可以始终整体分配；
- Content data会 rollover，但单 index、catalog 或 Seal inventory仍可以有固定大小。

用户指出：physical member 已由 Host 自动 rollover时，单 Content 不应继续继承文件大小限制。
若 logical Content 没有固定产品 cap，公开与内部读取又必须保留真正的流式路径。

## 并行审查

本轮使用三个独立只读 agent：

| 角色 | 独立问题 | 研究判断 |
|---|---|---|
| API/DX 挑战 | `text` / `bytes` / `stream` 是否都需要；整体读取怎样失败；`maximumBytes` 属于谁 | 保留三入口；`stream` 是任意长度规范路径；新增不读取 bytes 的 `byteLength`；整体读取失败不改变 Record validity |
| storage protocol 挑战 | pack、index、catalog、Seal 怎样共同 rollover；三个 PLAN 是否仍成立 | PLAN-1 使用 rolling data/metadata packs 与小 roots；PLAN-2 与无 Run cap 不兼容；PLAN-3 只作条件后备 |
| 跨层 `design_grill` | API、validity、hostile input、migration、publication 与文档归属是否闭合 | `CONDITIONAL`；允许改 Design/Roadmap，不允许 selectedPlan、Feature 或实现 |

三者分别读取现有 Design、blob Roadmap、Record Feature、旧挑战与 writer/reader 实现。
API 与 storage worker 承担不同子问题，不能按同一交付物排名；两份研究判断在逻辑/物理边界上相互吻合。

## Assertions Stream 证据纠正

代码盘点发现唯一 official `build.content.stream(...)` 位于 Assertions material 写入。
继续追踪后确认它不是真正的活流 producer：

1. 公开 `AssertionMaterial` 只有内存 snapshot 或 `record-attachment` preview，作者不能提交 Stream；
2. `encodeMaterial()` 先执行 `JSON.stringify` 与 `TextEncoder.encode`，形成完整 `Uint8Array`；
3. 完整 bytes 随后才进入 `Stream.succeed(bytes)`；
4. Assertions Content Schema 另有 16 MiB family 领域上限。

因此这条路径使用 Stream 只是内部 source 类型前载，不降低 RSS，也不能证明 official family已有任意长度 live source。
后续实现应让该有界路径使用 `content.bytes(bytes)`。

这项纠正也不能支持删除全局 `content.stream()`。
无 Core Content cap 后，Host 与第三方 capture producer仍需要一个不预先整体分配的规范输入；Assertions 只是不能作为该 API 的正面证据。

## 已定逻辑边界

“没有固定 Content 容量上限”精确定义为：

- Core 不为单 Content、Attachment Content 合计或 Run Content 合计设置 byte cap；
- payload JSON 继续整体有界；
- family `recordContent.maximumBytes(n)` 只在真实领域值约束存在时声明，省略即没有 family byte cap；
- wire representability、frame/page/member/path/depth/count 与 safe integer是 storage revision 的结构 ceiling；
- disk、inode、内存、时间、取消和 I/O 是当前 Host 的 admission/resource failure。

结构 ceiling 不是 64/128 MiB 产品预算的改名。
它们在分配、seek 或遍历前约束 hostile shape，并由同一 storage revision 的 writer、reader 与 migration一致执行。

失败分三层：

| 类别 | 例子 | 对 published Record 的含义 |
|---|---|---|
| corruption | digest mismatch、missing、extra、truncated、range hole/overlap、非法 codec | closure invalid |
| structure invalid | 超出该 storage revision 的 page/member/path/integer ceiling | durable shape invalid；writer 在发布前 fail closed |
| admission/resource | 整体读取内存、disk、inode、时间、取消、I/O | 本次操作失败；同一 closure 不改判 corrupt |

## API 结算

writer 保留：

```ts
content.text(text)
content.bytes(bytes)
content.stream(byteStream)
```

`text` / `bytes` 表达调用方已经整体持有的值。
`stream` 只产生 bytes handle，是任意长度与有界 RSS 的规范输入；它不能填入 text Content Schema。

reader 保留 `text` / `bytes` / `stream`，并增加不打开 data 的：

```ts
content.byteLength(handle)
```

`bytes` / `text` 不接受公开 `maximumBytes` option。
Host 在分配前读取 catalog 认证的 logical byteLength并执行本机 admission；被拒绝时错误包含 byteLength与 `next: "content.stream"`，不包含 path、pack、page、range 或 offset。

## Storage 结算

PLAN-1 的最小闭包不只是 Content data packs：

```text
Attachment envelope
├── small item/content roots
├── rolling item data + index/catalog packs
├── rolling Content data + range-index + handle-catalog packs
└── Run Seal small root + rolling inventory packs
```

root 认证 bounded-fanout catalog；handle entry认证 logical byteLength、overall digest 与 range-index root。
range pages 连续且无遗漏地描述 `[0, byteLength)`，每次 ordinary stream read 只保留当前 catalog/index page、segment 与 digest buffer。

full validator流式 merge-join authenticated Seal inventory与实际 directory stream。
额外、缺失、截断 member是 corruption；pack 内未引用 padding/slack可以存在。
publication 保持 root-last：pages fsync → small roots → complete → whole-Run no-replace rename。

## 候选结果

- PLAN-1 是唯一 live 候选，但尚未 selected。
- PLAN-2 保留为历史候选。final SQLite 本身是一个 durable member；保留共同 member ceiling会形成 Run cap，取消 ceiling会形成无界 hostile单文件。
- PLAN-3 是条件后备。只有 PLAN-1 framing或 RS3 失败，且 item-level lazy reader成为明确产品目标时才重新比较。

## Grill verdict

最终 verdict：`CONDITIONAL`。

允许立即写回 Design 与 blob Roadmap：

- 删除 Core 64 MiB 与 aggregate 128 MiB Content cap；
- 固定三入口、logical byteLength 与 whole-value read admission 语义；
- 把 PLAN-1 补成 rolling data/index/catalog/Seal + small roots；
- 将 PLAN-2 历史化，将 PLAN-3 标为条件后备；
- 增加 metadata rollover、extra-member 与 whole-value read Cases。

仍然禁止：

- 声明 `selectedPlan`；
- 改写 Record Feature 或 official family Schema；
- 开始 storage migration 或生产实现；
- 在第一版增加跨 Attachment dedup、ordinary silent migration 或 permanent dual reader。

## 采用门

1. hostile-input spike 写回 L16/L18/L19 的具体结构 ceiling；
2. RS2 证明单 Content 超过旧 64 MiB、跨 data packs 且 stream不形成完整数组；
3. RS7 验证 data/index/catalog/Seal rollover、小 root、fsync、complete、rename 与 receipt fault；
4. RS13 回归三个不同 48 MiB Content 合计 144 MiB；
5. RS14 把结构超限与领域 partial、本机 admission分开；
6. RS15 证明 `byteLength` 不读 data，整体读取 admission 失败后 Record 仍 available 且 stream 成功；
7. RS16 证明 rolling Seal 对 extra/missing/truncated fail closed；
8. RS17 用私有小 page threshold强制 index/Seal rollover，并证明 RSS 有界；
9. digest-file converter对 known/unknown family流式、byte-preserving且不静默迁移；
10. Git/copy/file-count、reader latency、50,000-item 与同 revision validity收据通过。

fixture bytes 与私有 rollover threshold只负责触发 Case，不能写回成新的产品容量上限。
