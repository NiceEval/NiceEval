# MCAP 日志容器与 NiceEval profile

> 观察日期：2026-08-25
>
> 格式版本：MCAP magic `MCAP0`

MCAP 是 serialization-agnostic 的日志容器。
它主要服务 pub/sub 与 robotics，但其 record、chunk、index 和 footer 与 NiceEval 准备自研的 storage codec 高度重合。

## 标准已经提供什么

MCAP record 使用一字节 opcode、`uint64` content length 与 record content。
标准定义了：

- Header、Schema、Channel 与 Message；
- 可压缩 Chunk，以及 chunk uncompressed CRC32；
- Message、Chunk、Attachment 与 Metadata index；
- Data End、可选 Summary、Summary Offset、Footer 与 CRC；
- `0x80`–`0xFF` 的 private record opcode 范围；
- C++、Go、Python、Rust、Swift 与 TypeScript SDK。

Message index 以 channel 与 `log_time` 定位 chunk 内 message。
Chunk index 保存时间范围、文件 offset、压缩大小与 message-index 位置。
这些 index 不理解 NiceEval owner、family、reference 或 logical Content handle。

active writer 可以持续顺序写 records。
已经 close 的 MCAP 不是纯 tail append：TypeScript `InitializeForAppending` 会读取旧 index，移除 Data End 及其后的 sections，并在再次 close 时重写它们。

## 标准边界

Message 必须属于 Channel，并携带 `sequence`、`log_time` 与 `publish_time`。
Attachment 是一个带 `uint64` length prefix 的完整 data field，不能直接表达未知长度 Content Stream。
TypeScript SDK 的 Message data 也是完整 `Uint8Array`。

MCAP Chunk writer 会在内存中形成当前 uncompressed/compressed chunk。
这对 bounded chunk 合理，但单个 Message 大于 chunk threshold 时仍可能单独超过该 threshold。
NiceEval 必须先把 logical Content 切成 bounded segment Messages，不能把完整 Content 写入一个 Message 或 Attachment。

CRC32 是损坏检测，不是 logical identity 或 exact Run closure。
MCAP Footer 关闭一个文件，却不证明同目录没有 extra/missing file，也不关闭跨文件 reference。
规范允许 Data End 携带 data-section CRC，但官方 SDK feature matrix 注明当前 writers 不计算该 CRC。
spike 不能把标准字段的存在误当成现成 whole-data receipt。

## 建议 spike 的 profile

优先使用标准 Message，才能复用现成 message/chunk index。
private record 适合 MCAP 不认识的 bounded descriptor，但现成高层 writer 与 index 不一定处理它。

```text
MCAP Header.profile
  → niceeval.record/<storage-revision>

Schema + Channel
  → bounded record kind 与 owner/family/revision association

Message(channel, ordinal, bounded payload)
  → collection item 或 generic descriptor

ordered Message sequence
  → logical Content segments

MCAP Summary/Index
  → 单 MCAP file 内的 seek acceleration

NiceEval outer catalog + Seal
  → logical handle mapping、reference closure 与 exact Run members
```

profile 必须明确 `log_time` 是真实时间还是 storage ordinal。
若用 ordinal 复用 Message Index，generic MCAP 工具显示的时间将没有 wall-clock 含义；这是互操作成本，不能隐式发生。

owner/family/revision 不应只放在自由文本 Metadata map。
profile 需要 bounded binary descriptor，并规定 canonical encoding、unknown record preservation 与跨 SDK 的整数语义。

## 单文件与 rolling 两种形态

### 一 Run 一 MCAP

一个 Run 使用一个 MCAP file，bounded Message/Chunk 保持 active write 与 read RSS 有界。
NiceEval 只需补 application Seal、logical Content index、reference closure 与 outer publication。

这条路径只有在 durable-member ceiling 可重审时成立。
MCAP SDK 是否在 close 时把全部 summary index 保留在内存，也必须实测，不能从 file framing 推断。

### rolling MCAP files

达到 Host threshold 后关闭当前 MCAP，再打开下一个 file。
每个 file 内复用 MCAP framing、compression、CRC 与 index；NiceEval 外层 catalog 关联 owner/family/handle 与 file ordinal。

rolling 仍是 NiceEval-owned protocol。
MCAP 不提供跨 file transaction、exact directory inventory、root-last publication 或 multi-file migration。
它减少的是 file 内 codec 工作，不消灭 Run closure 工作。

## 与 custom rolling pack 的真实比较

| 能力 | MCAP 可复用 | NiceEval 仍须拥有 |
|---|---|---|
| TLV record parsing | 是 | record kind/profile validity |
| Chunk 与压缩 | 是 | bounded segment policy 与 RSS receipt |
| file 内 message/chunk index | 是 | owner/family/content-handle catalog |
| CRC 与 Footer | 是 | SHA-256 logical digest 与 exact Run Seal |
| 多语言 reader | 是 | NiceEval profile 实现与 conformance fixtures |
| append active records | 是 | Attempt complete、publication 与 crash matrix |
| rolling files | 否 | rollover descriptor 与跨 file closure |
| unknown family migration | 否 | raw descriptor/messages 的通用 copy path |

## 必须由 spike 回答

1. standard Message profile 能否自然表达 item、descriptor 与 Content segment；
2. `log_time`/topic index 的复用收益是否大于语义扭曲与额外 catalog；
3. TypeScript writer/reader 的 chunk、summary、attachment 与 random-read RSS；
4. 单 file close 和 rolling file close 的 crash、fsync、truncation 与 recovery；
5. disabled summary、partial summary 或 rebuilt summary 的 validity 规则；
6. private records 在各官方 SDK 的 preserve/read/write 行为；
7. unknown family 与 unknown profile version 的 byte-preserving migration；
8. MCAP CRC 后仍需多少 NiceEval digest/index/Seal code。

## 官方资料

- [MCAP format specification](https://mcap.dev/spec)
- [MCAP format registry and profiles](https://mcap.dev/spec/registry)
- [MCAP SDK feature matrix](https://mcap.dev/reference)
- [TypeScript `McapWriter`](https://mcap.dev/docs/typescript/classes/_mcap_core.McapWriter)
- [TypeScript `McapWriterOptions`](https://mcap.dev/docs/typescript/types/_mcap_core.McapWriterOptions)
- [TypeScript Message shape](https://mcap.dev/docs/typescript/types/_mcap_core.McapTypes.Message)
