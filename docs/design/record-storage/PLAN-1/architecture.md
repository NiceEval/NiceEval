# PLAN-1：JSON envelope + Host 私有 packs —— Architecture

## 数据建模

一个 published Run 是一个 directory closure：

```text
runs/<run-id>/
├── core/...
├── attachments/<owner-key>/<family-key>/
│   ├── envelope.json
│   ├── payload/sha256/<digest>
│   ├── items/              optional
│   │   ├── index
│   │   └── packs/<pack-ordinal>
│   └── content/            optional
│       ├── index
│       └── packs/<pack-ordinal>
├── seal.json
└── complete
```

路径名和文件名是本候选的 storage illustration，不是 public contract。
portable identity 来自 Core/envelope/Seal 中的 canonical IDs 与 digest，不来自 path spelling。

### Rich Attachment

`envelope.json` 保存 owner、family、family revision、canonical payload bytes descriptor、references 与 logical Content descriptors。
第一版 codec 延续独立的 digest-addressed payload object；Content bytes 不进入 family JSON。
未来 codec 可以改变 payload inline/grouping policy，但不能改变 logical value 或 family revision。

### Attempt Record collection

每个 retained item 在 Host mutex 中完成 Schema encode 与 canonical snapshot。
Host 同时分配单调 ordinal，并把 frame 追加到当前 item pack。
ordinal 只保存公开 logical array 的线性化顺序，不替代 item 自带的业务顺序。

下一个完整 frame 放不进当前 pack 时，Host 关闭它并打开下一个 pack；一个 item frame 不跨 pack。
item index 使用 fixed storage framing 保存 ordinal、pack ordinal、offset、byte length 与 item digest。
Attempt complete 后，envelope 保存 item count、pack-set/index overall digest 与 complete/partial state。
ordinary public read 按 ordinal 读取全部 item，并形成现有 logical array。

### Logical Content

每个 Attachment 拥有一套 Content pack set；小 Content 共享 packs，但 pack lifetime 不跨 Attachment。
Content writer 增量消费 source，并把 bounded segment 追加到当前 content pack。
pack 达到 Host 私有 rollover threshold 后，后续 segment 自动进入下一个 pack；一个 logical Content 可以跨 pack。

content index 保存 handle-local ordered ranges、pack ordinal、per-segment digest、overall byte length 与 overall SHA-256。
每个 segment 完全位于一个 pack file；逻辑 Content 是按 ordinal 重组的 segment/range 序列。

第一版 rolling codec 不做 Content byte dedup；相同 logical bytes 可以占用不同 ranges。
后续 codec 可以增加 Attachment-local range reuse，但不能跨 Attachment 建立 lifetime dependency 或 secret existence signal。

单 logical Content 仍受 64 MiB Core 上限与 family `maximumBytes` 约束。
多个 Content 的合计不再受固定 128 MiB 上限约束；Content count、index bytes、pack count、磁盘空间与取消继续形成有界失败面。

## 数据流

### Collection append

```text
append command
  → item Schema encode
  → canonical immutable bytes
  → cap check
  → append frame + index entry in local staging
  → retained/omitted receipt
```

frame write、index write 或 fsync 失败会 poison 未发布 Run。
Attempt complete 只形成 collection envelope，不把所有 item 再读回内存。

### Content write

```text
Content source
  → bounded buffer
  → incremental length/SHA-256
  → current pack segment
  → private threshold rollover
  → index entry
  → logical Content descriptor
```

source EOF、budget、digest 与 closure 都通过后，Attachment envelope 才成为 committed staging entry。
rich write 逐份消费 Content；一份 Content 完成后释放其 byte buffer，只保留 descriptor 与 digest state。
Host 不能为了最终 envelope 持有此前 Content 的完整 bytes。

### Read

reader 先验证 requested envelope、index digest 与 referenced pack descriptors。
collection read 按 index 顺序形成完整 logical array；Content read 只在消费时打开 pack ranges，并逐 segment 校验。

## 不变量

- envelope、pack set 与 index 共同构成一份 Attachment closure，缺一不可。
- partial frame、index 尾部、unreferenced pack range 与 staging temp file 都不能进入 published Seal inventory。
- frame/segment boundary 不进入 family identity、Analysis、Report 或 public error。
- rollover threshold、pack count 与 pack ordinal 不进入 logical value；它们不能触发新的 family revision。
- 每个 pack file 都低于共同 durable-member byte ceiling；私有 rollover threshold 必须为 frame/segment 留出安全余量。
- collection ordinal 只表达 append linearization；业务 order 仍来自 item fields。
- 第一版不做 byte reuse；后续 codec 即使增加，也只能局限在 Attachment closure 内。
- unknown family 的 envelope、packs 与 indexes 可以按 Seal inventory 原样复制。
- ordinary read 不打开无关 Attachment pack；`requireComplete()` 验证全部 inventory。
- index/manifest bytes、entry count、frame/segment bytes、depth、nodes、path 与整数范围在分配或遍历前校验。
- pack/index/Seal mismatch 是 storage corruption；取消、memory/time admission、disk/inode exhaustion 与 I/O failure 是 resource failure，不把已发布 closure 改判 corruption。

## 生命周期与错误

Host 拥有 open handles、append offsets、rollover、digest state、staging temp names、fsync 与 close。
producer interruption 先进入 existing collection limitation；storage interruption 使 Run fail closed，不能伪装成业务 partial。

pack/index disagreement、frame length invalid、digest mismatch、truncated file 与额外 inventory member都返回 storage corruption。
任何错误都不尝试从目录中猜测缺失 frame。

## 身份与复用

storage revision 固定 framing、index codec 与 envelope storage descriptors。
family revision只解释 logical payload/items。

改变 buffer size、rollover threshold、一个 pack 中的 segment grouping 或 inline threshold 不改变 logical identity。
增加 range reuse 或改变 frame/index codec 需要相邻 storage migration，但不调用 unknown family decoder。
