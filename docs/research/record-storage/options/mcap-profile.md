# 候选：MCAP profile + outer Run Seal

> 状态：需要 spike 的容器复用候选

本候选不把 MCAP 当作 NiceEval 领域模型。
它使用标准 MCAP records/chunks/indexes 承担 file 内 framing，再由 NiceEval profile 定义 owner、family、item、Content 与 reference。

## 物理形态保持开放

```text
形态 A：一 Run 一 MCAP + small publication descriptor

形态 B：一 Run 多个 rolling MCAP files
       + NiceEval catalog/Seal pages + small roots
```

形态 A 用于验证单文件可以有界 RSS 地写读，并量出 close/summary 与搬运成本。
形态 B 用于保留 durable-member ceiling，并验证 MCAP 能减少多少 rolling codec 工作。

不能在 spike 前把两者合并成一个实现。
它们对 outer catalog、Seal、summary state 与 crash matrix 的要求不同。

## Profile 映射

| NiceEval logical fact | MCAP 承载 | profile 仍须规定 |
|---|---|---|
| owner/family/revision | bounded descriptor、Schema/Channel association | canonical identity、unknown revision 与 migration |
| collection item | standard Message | ordinal、item bytes、complete/partial 与 limitation |
| Content | bounded Message sequence | handle、segment ordinal、overall length/digest 与 range continuity |
| reference | bounded descriptor Message/private record | source/target validity 与 closure |
| file 内 index | Message/Chunk/Summary indexes | topic/time 到 owner/family/handle 的映射 |
| Run complete | NiceEval outer Seal | exact members、extra/missing、publication 与 receipt |

标准 Attachment 不用于任意长度 logical Content。
它是一段完整 length-prefixed bytes，而且 TypeScript SDK 没有 non-materialized attachment reader。

## 实际减少的代码

- TLV record encoder/decoder；
- chunk framing、可选压缩与 chunk CRC；
- file footer、summary offset 与部分 seek index；
- 多语言基础 reader、writer 与 conformance fixtures。

NiceEval 仍须实现：

- profile descriptor 与 canonical item/content segment encoding；
- owner/family/reference catalog；
- Content logical digest、range continuity 与 whole-value admission；
- exact Run Seal、outer fsync/rename、crash recovery 与 receipt；
- rolling file association；
- storage revision 与 unknown-family migration。

## 采用前翻转条件

满足任一项就撤销该候选：

1. `log_time`/topic index 无法在不扭曲语义的情况下服务 family/ordinal lookup；
2. TypeScript SDK 的 Message、Chunk 或 Summary state让 RSS 随 file/Content 线性增长；
3. private record 的跨 SDK 行为迫使 NiceEval fork parser/writer；
4. rolling 后仍须自研几乎完整的 catalog/index/footer，复用量不足；
5. CRC 与 summary 的恢复规则不能嵌入 NiceEval fail-closed publication；
6. unknown-family raw preservation 或相邻 migration 无法跨 profile version稳定完成；
7. MCAP dependency、format evolution 或跨语言 conformance成本高于窄 custom codec。

## Spike 收据

- RS2：一个 logical Content 跨 bounded Messages，write/stream-read 不形成完整数组；
- RS3：50,000 items 的 append、close、index size、RSS 与 full read；
- RS7：Message、Chunk、DataEnd、Summary、Footer、fsync、rename 各 fault point；
- RS8：ordinary family read 不扫描无关 Content；
- RS9/RS16：record/chunk/footer 修改、truncate、extra/missing file 与 outer Seal；
- RS10：unknown family profile bytes 的 copy-on-write migration；
- RS17：小 threshold 下的 chunk/index/summary 与 rolling-file行为；
- custom codec 对照：production code、dependency size、throughput、RSS、migration 与修复面。

底层事实与官方资料见 [MCAP 日志容器研究](../protocols/mcap.md)。
