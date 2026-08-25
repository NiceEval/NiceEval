# Record storage 候选方案比较

> 比较日期：2026-08-25
>
> 状态：研究候选，不构成采用状态

五个候选都服从同一作者边界：business definition 只声明 logical value/item、Content 与 reference；物理存储由 Host 自动决定。

## 候选

1. [全 JSON](all-json.md)：一 Run 一份 canonical JSON，binary 使用 base64。
2. [JSON envelope + Host 私有 Content store](json-content-store.md)：结构化事实为 JSON；大材料自动成为 object/segment。
3. [一 Run 一 SQLite](sqlite-run-file.md)：generic tables 保存 singleton、collection item、Content chunk、reference 与 Seal。
4. [SQLite metadata + 外部 Content](sqlite-external-content.md)：SQLite 管 item/index，Content 仍在 Run directory 的 segment files。
5. [MCAP profile + outer Run Seal](mcap-profile.md)：MCAP 管 file 内 framing、chunk、CRC 与部分 index，NiceEval 管 logical profile 与 closure。

## 横向比较

| 维度 | 全 JSON | JSON + Content store | 一 Run 一 SQLite | SQLite + 外部 Content | MCAP profile |
|---|---|---|---|---|---|
| 作者是否接触 chunk/path/SQL | 否 | 否 | 否 | 否 | 否 |
| 大 Content 有界写入 | 否 | 是 | 是，需 chunk rows | 是 | 是，需 bounded Messages |
| 大量小 item | 整体重写 | JSONL/shard + 自管 index | row/index 原生 | row/index 原生 | Message/Chunk；业务 index需 profile |
| item lazy read | 弱 | 可做，但协议自管 | 强 | 强 | time/topic index 可部分复用 |
| 同 Run logical transaction | 整文件替换 | manifest/rename 协议自管 | SQLite transaction | SQLite + directory protocol | outer protocol 自管 |
| published unit | 单 JSON | Run directory | 单 final DB file | Run directory | 单 MCAP 或 rolling MCAP directory |
| Git 文本 diff | 最好 | envelope 可 diff | 最差 | metadata 不可 diff | 差 |
| unknown family 保留 | 原 JSON bytes | 通用 envelope/object copy | generic raw rows/chunks copy | generic raw rows/segments copy | profile descriptor/Messages copy |
| 主要复杂度 | 内存与重写 | index、orphan、segment、manifest | actor、snapshot、hostile DB、revision | 同时维护 DB 与 segment 两套 closure | profile、logical index、outer Seal、SDK边界 |

## 按产品前提排序

### 只修 Content 物理写入

若 family 仍是 create-once、collection 仍由 producer 一次提交完整有界 value：

1. JSON + Content store；
2. MCAP profile；
3. SQLite + external Content；
4. 一 Run 一 SQLite；
5. 全 JSON。

SQLite 此时主要是把 opaque JSON 放进 database，没有足够领域收益抵消二进制格式、actor 与 migration 成本。

### 正式采用 generic collection

若 definition 明确区分 singleton 与 collection，collection item 可多次 write、必须 terminal seal，并需要 item lazy read：

1. 一 Run 一 SQLite；
2. MCAP profile；
3. SQLite + external Content；
4. JSON + Content store；
5. 全 JSON。

SQLite 的优势来自 row-level item、唯一索引、canonical-order cursor 与 transaction；不是来自把大 JSON 换一个容器。

### 极大 Content 直通优先

若真实需求提升为数百 MiB 或 GiB Content 直接 pipe 到文件/网络，而且 sealing 时不接受将全部 bytes 重写进 final SQLite：

1. JSON + Content store；
2. MCAP profile；
3. SQLite + external Content；
4. 一 Run 一 SQLite；
5. 全 JSON。

这时 segment file 的直接 streaming 与 range I/O 比单文件 packing 更重要。

## 当前排除项

全 JSON 已被现实预算和 Memory 排除为默认方向。
CAR/IPLD、ZIP64/TAR、DuckDB、Parquet、Arrow 与 Perfetto 没进入五个候选。
它们分别更适合 content-addressed/archive transport、Analysis/export 或单一 event stream，不拥有 NiceEval 的 capture completeness、reference closure 与 migration。

MCAP 进入候选不代表采用。
它与 custom pack 的差别是复用 file 内 codec，不是取消 NiceEval profile、outer Seal 或 publication protocol。

## 进入 Design 前必须回答

- generic collection 是产品语义还是仅为存储便利引入；哪些现有 family 需要它；
- collection identity、canonical order、complete/partial sealer 与跨项 invariant 的公开语义；
- Content 目标上限与 direct streaming 场景；
- published Run 需要单文件，还是 opaque directory 已足够；
- ordinary lazy read 对 hostile bytes 的验证强度；
- durable-member ceiling 是有证据的产品政策，还是可以由 single-file lazy I/O 取代；
- chosen option 的 crash matrix、copy/migration matrix 与 bounded-memory receipt。

这些答案固定后，才应把一个候选晋升到 `docs/design/`。
