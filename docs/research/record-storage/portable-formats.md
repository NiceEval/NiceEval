# Record storage 底层格式总览

> 观察日期：2026-08-25
>
> 本地运行时：Node v24.19.0，内置 SQLite 3.53.3

本页比较底层格式已经提供的机制，以及 NiceEval profile 仍须拥有的语义。
格式支持大文件或流式读取，不代表它已经理解 Attempt、family、reference、Content 与 Run complete。

## 研究入口

本组资料的目录入口见 [底层协议](protocols/README.md)。

| 格式族 | 详细研究 | 最接近的可复用角色 |
|---|---|---|
| SQLite | [application file](protocols/sqlite.md) | transaction、row/index、单文件 packing 与 crash recovery |
| MCAP | [日志容器与 NiceEval profile](protocols/mcap.md) | record framing、chunk、CRC、summary/index 与跨语言 reader |
| CAR/IPLD | [内容寻址归档](protocols/car-ipld.md) | 流式 block、CID 与 CARv2 block index |
| ZIP64/TAR | [通用归档](protocols/zip-tar.md) | 成熟的多 entry 封装与搬运工具链 |
| DuckDB/Parquet/Arrow/Perfetto | [分析与事件格式](protocols/analysis-event-formats.md) | seal 后分析、列式交换与事件摄入参照 |

## 横向比较

| 格式 | active append | 有界大 Content 路径 | 原生索引 | 原生完整性/事务 | NiceEval 仍须补齐 |
|---|---|---|---|---|---|
| SQLite | 强；单 writer | bounded chunk rows | 任意 SQL index | ACID、journal/WAL、page integrity | family profile、Content digest、Run Seal、outer publication |
| MCAP | 强；顺序 records | bounded Message sequence；标准 Attachment 不合格 | message time/topic、chunk、attachment、metadata | chunk/data/summary CRC；无跨文件 transaction | owner/family/reference、logical Content、exact closure、migration |
| CARv1 | 强；顺序 blocks | bounded raw blocks | 无 | CID 验 block；root 不证明完整 archive | 业务顺序、root DAG、index、transaction、exact closure |
| CARv2 | 形成时需写 header/index | bounded raw blocks | CID digest → offset | 与 CARv1 相同；规范仍是 Draft | 同上，并需承担实现成熟度 |
| ZIP64 | entry 顺序写；最终 central directory | data descriptor 可延后 size/CRC | central directory | entry CRC32；无业务 transaction | append/crash 规则、业务 index、Seal 与 unknown-family profile |
| TAR/PAX | 强顺序写 | entry size 通常先给定 | 无 | header checksum 不校验 payload | payload digest、随机读取、transaction、Seal 与 profile |
| Arrow stream | 强顺序 batches | binary buffers 可表达 | 无 durable file index | 无 Run transaction | 整个 Record 领域与 publication |
| Arrow file/Parquet | batch/finalize 更强 | binary column 可表达 | footer/row-group metadata | 无 Run transaction | active capture、Artifact lifecycle 与 closure |

`CRC32` 适合发现随机损坏，不能替代 NiceEval 对 logical Content、member inventory 与 exact closure 的强 digest。
格式自带 index 也只回答它自己的 key；例如 MCAP 的 time/topic index 不自动成为 family/content-handle index。

## 重新校准的研究判断

没有现成格式直接提供完整 NiceEval Record。
但“没有可直接采用的领域格式”不等于“必须自研全部 framing、index 与 footer”。

最接近的两个候选格式是：

1. SQLite application file：最少自研 row、index、transaction 与 crash recovery；
2. MCAP profile：最贴近持续 record、bounded chunk、summary/index 与跨语言读取。

CAR/IPLD、ZIP64/TAR 与 Arrow/Parquet分别证明 block archive、通用 archive 和 columnar interchange 的成熟做法。
它们没有足够贴合 NiceEval active Record，不进入领先候选。

## “单文件很大”与 rolling 的边界

大型单文件不要求整体载入内存。
SQLite 按 page/row 读取，MCAP reader 按 record/chunk 读取，CAR 与 TAR 也支持顺序扫描。
因此“Run 可能很大”本身不足以排除单文件格式。

若 Design 同时要求每个 durable member 受固定 ceiling，并要求 data、index、catalog 与 Seal 都能独立 rollover，那么多文件 closure 是逻辑结果。
这组要求是 NiceEval 的存储政策，不是外部格式证明的业务事实。
后续裁决必须分别比较两条路径：

- 保留 member ceiling，评估 rolling MCAP files 或自定义 rolling packs；
- 重审 member ceiling，评估一 Run 一 SQLite 或一 Run 一 MCAP 的有界 RSS、安全与搬运成本。

## 建议的证据顺序

1. 保持公开 value、collection、Content 与 reference 模型不变；
2. spike 一 Run 一 SQLite，并以 chunk rows 承接 logical Content；
3. spike [MCAP profile](options/mcap-profile.md)，量出 framing/index/SDK 的实际复用量；
4. 只有二者无法通过 RSS、crash、unknown-family、hostile-input 与 exact Seal Case，才实现完整 custom rolling-pack codec。

这个顺序是研究建议，不改变当前 Design 的采用状态。
