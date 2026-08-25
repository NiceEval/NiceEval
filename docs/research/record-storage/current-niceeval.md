# NiceEval 当前存储证据

> 核对日期：2026-08-25
>
> 核对对象：当前工作树的 Record Feature、blob Roadmap、Memory 与 writer 实现

本页只列出当前事实和已经出现的失败，不用候选方案反向解释现状。

## 已定逻辑边界

当前 [Record Library](../../feature/record/library.md) 把 `(owner, family)` 定义为 create-once Attachment。
producer 通过 `record.write(definition(value))` 提交一份完整 logical value；collection producer 仍在 family collector 内聚合、排序、去重，再一次写入完整 value。

Content 已经是 Core-owned sealed declaration。
producer 可以提交 text、bytes 或 byte Stream，但看不到 path、digest、object key 与物理布局。
reader 得到的是 scope-owned logical Content。

[Record blob Roadmap](../../roadmap/record-blob-storage/README.md) 已经固定更长期的原则：

- producer 只提交逻辑 blob；
- Host 增量读取、计算总长度和整体 digest，并私有分段；
- segment 与 manifest 不进入 family payload 和 Analysis；
- 一个 Attachment closure 不依赖外部对象库即可复制、验证和读取。

Roadmap 尚未定案 segment wire layout、边界算法与发布格式。

## 当前物理写入

当前 [`current-attachment.ts`](../../../packages/niceeval/src/record/writer/current-attachment.ts) 的 `collectContent()` 会：

1. 逐 chunk 消费输入 Stream；
2. 把每个 chunk 的副本保存在数组中；
3. EOF 后分配完整 `Uint8Array`；
4. 把全部 chunk 再复制进完整数组；
5. 由后续 Host 写成一个完整 content object。

输入 Stream 的 chunk 边界不会成为持久分段。
因此 `content.stream()` 当前提供输入协议，却没有把峰值内存从逻辑 Content 总长度中解耦。

当前硬预算是：

| 资源 | 当前上限 |
|---|---:|
| Attachment payload JSON | 4 MiB |
| 单个 Content | 64 MiB |
| 一个 Attachment 的 Content 合计 | 128 MiB |
| Content handle 数 | 100,000 |
| JSON depth | 64 |
| JSON node 数 | 100,000 |

超过上限会返回具名 `record-resource-limit-exceeded` 或 schema/closure failure；Host 不自动生成 `part-1`、`part-2`，也不自动把结果标成业务 `partial`。

## 已观察到的真实失败

[Assertion diagnostic tree 超出 Record](../../../memory/assertion-diagnostic-tree-overflows-record.md) 证明一份正常诊断材料可以让整体 JSON 越过 4 MiB。
[Assertion snapshot shape 需要 blob fallback](../../../memory/assertion-snapshot-shape-needs-blob-fallback.md) 证明小字节但深层的 snapshot 也可能先触发 JSON shape limit。

这两条证据证明：

- 大或深层材料不能都保留在 family JSON 中；
- payload metadata 与 byte-exact material 需要分离；
- 「换成 SQLite 后仍把同一巨大 JSON 放进一行」不能修复问题。

它们尚未单独证明所有 family 都需要 generic collection append。

## 必须分开裁决的两个变化

### Content 物理写入

目标是让一个逻辑 Content 的读写峰值内存有界，并由 Host 自动决定单 object 或多 segment。
这可以在不改变 create-once family 语义的前提下完成。

### Collection item persistence

目标是让同一个 `(owner, family)` 多次提交独立 item，并在之后显式 `complete` 或 `partial` seal，reader 可按 logical order 分页或流式读取。
这会改变 capture authority、duplicate identity、canonical order、跨项 invariant 与 Run seal，不是单纯的存储优化。

只有产品先采用第二个逻辑变化，SQLite 的 row/index/transaction 优势才成为主要选择依据。

## 评价候选的共同案例

后续方案都必须用相同案例验证：

- 64 MiB Artifact 与 16 MiB Assertion material 的有界写入、取消和读回；
- 数万条 Agent turn 或 command item 的并发提交、canonical order 和惰性读取；
- 零 item 的 complete collection、具名 partial collection、缺 seal 与重复 seal；
- 同一 Run 多 Attempt 并发，不同 Run 并行写入；
- 写入任意 chunk/item 后崩溃，published reader 只能看到不可见或完整 Run；
- unknown family copy、显式 migration、损坏检测与 whole-root portability；
- Git/copy 在 publication 前后取得的文件集合是否形成撕裂 closure。
