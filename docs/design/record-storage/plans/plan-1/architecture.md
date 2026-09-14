# PLAN-1：JSON envelope + Host 私有 packs —— Architecture

## 数据建模

一个 published Run 是一个 directory closure：

```text
runs/<run-id>/
├── core/...
├── attachments/<owner-key>/<family-key>/
│   ├── envelope.json
│   ├── payload/sha256/<digest>
│   ├── items/                         optional
│   │   ├── root
│   │   ├── indexes/packs/<ordinal>
│   │   └── data/packs/<ordinal>
│   └── content/                       optional
│       ├── root
│       ├── catalogs/packs/<ordinal>
│       ├── indexes/packs/<ordinal>
│       └── data/packs/<ordinal>
├── seal/
│   ├── root
│   └── inventory/packs/<ordinal>
└── complete
```

路径名是 storage illustration，不是 public contract。
portable identity 来自 Core、envelope、小 root 与 digest 认证的 pages，不来自 path spelling。

第一版 codec 把 item、Content、index、catalog 与 Seal page 都保存为 rolling pack 中的 framed records。
一个 frame、segment 或 page 不跨 pack；pack 达到 Host 私有阈值后自动 rollover。
每个 published member 都低于共同 durable-member ceiling，私有阈值为下一条完整 record 保留余量。

### Rich Attachment

`envelope.json` 保存 owner、family、family revision、canonical payload descriptor、references 与可选 item/Content root descriptor。
它不内嵌全部 Content handle、range 或 Seal inventory。
第一版 codec 延续独立的 digest-addressed payload object；Content bytes 不进入 family JSON。

payload 中的 sealed Content token 只表达 Attachment-local handle identity。
`content/root` 是一个小 descriptor，认证 bounded-fanout handle catalog 的根、handle count 与 storage revision。
改变 payload inline/grouping、pack threshold 或 page grouping 不改变 logical value 或 family revision。

### Attempt Record collection

每个 retained item 在 Host mutex 中完成 Schema encode 与 canonical snapshot。
Host 分配单调 ordinal，并把 item frame 追加到当前 data pack。
ordinal 只保存公开 logical array 的线性化顺序，不替代 item 自带的业务顺序。

item index leaf 保存 ordinal、data pack ordinal、offset、byte length 与 item digest。
index page 满后追加到下一个 index pack；上层 catalog page 继续按固定 fan-out 认证 child page。
`items/root` 只保存 item count、complete/partial state 与 authenticated index root。
Attempt complete 不把全部 item 再读回内存。

### Logical Content

每个 Attachment 拥有自己的 Content pack、catalog 与 index closure；小 Content 共享 data packs，但 lifetime 不跨 Attachment。
Content writer 增量消费 source，把 bounded segment 追加到当前 data pack，并持续计算 logical byteLength 与整体 SHA-256。

handle catalog leaf 按 handle ordinal 保存 kind、logical byteLength、overall digest 与 range-index root。
一个 handle 的 range pages 按 segment ordinal 保存 data pack ordinal、offset、byte length 与 segment digest。
range 序列必须连续且无遗漏地描述 `[0, byteLength)`，不能出现洞、重叠或越界。

catalog、range index 与 data pack 分别 rollover。
一个 logical Content 可以跨任意多个 data packs 与 index pages，对 producer 和 reader 仍是一个 handle 与一条连续 stream。
Core 不为单 Content、Attachment Content 合计或 Run Content 合计设置 byte cap。

`recordContent.maximumBytes(n)` 只约束声明该 combinator 的 family 字段。
它是领域写入约束，不是 pack、内存或磁盘保护；没有声明时不存在默认 64 MiB 限制。

第一版 rolling codec 不做 Content byte dedup。
后续 codec 可以增加 Attachment-local range reuse，但不能跨 Attachment 建立 lifetime dependency 或 secret existence signal。

### Seal inventory

`seal/root` 是小 descriptor，认证按 canonical path 排序的 rolling inventory pages。
inventory entry 保存 member kind、logical association、byte length 与 digest；inventory page 与上层 catalog page也进入固定 framing。

完整验证流式 merge-join authenticated inventory 与分 shard 的实际 directory stream。
缺失、额外、截断、digest mismatch 或非法 page pointer 都是 storage corruption。
pack 内未被 logical range 使用的 padding/slack 可以存在，但额外 filesystem member 不能被忽略。

## Wire 与 ceiling

storage revision 固定 record kind、二进制 framing、little-endian unsigned 64-bit length/ordinal 与 authenticated page shape。
当前 JavaScript Host 只接受可精确落入 safe integer 的 decoded value；更大的 wire value 是 structure invalid。

page、frame、segment、path、tree depth、fan-out、entry count、member count/bytes 与 handle count 有共同结构 ceiling。
这些 ceiling 在分配、seek 或递归前校验，并由同一 storage revision 的 writer、reader 与 migration共同执行。

rollover threshold、buffer size 与 ceiling 内的 grouping 是 Host 私有策略。
它们不能改变同一 published closure 的 validity，也不能进入 producer 配置或 logical digest。

## 数据流

### Collection append

```text
append command
  → item Schema encode
  → canonical immutable bytes
  → collection cap check
  → append item frame
  → append/roll index page and catalog page
  → retained/omitted receipt
```

frame、index/catalog page 或 fsync 失败会 poison 未发布 Run。
collection cap 保留既有领域 `retained` / `omitted` 与 partial 语义；storage structure failure 不伪装成 collection partial。

### Content write

```text
Content source
  → bounded buffer
  → incremental byteLength/SHA-256
  → append/roll data segment
  → append/roll range pages
  → append/roll handle catalog
  → small authenticated root
```

source EOF、family value constraint、digest 与 closure 全部通过后，Attachment envelope 才成为 committed staging entry。
rich write 逐份消费 Content；一份 Content 完成后释放 byte buffer，只保留 digest/page state。
Host 不能为了 envelope、index或 Seal 持有此前 Content 的完整 bytes 或完整 range table。

### Read

reader 先验证 requested envelope 与小 root，再按 handle ordinal 下钻 authenticated catalog。
`content.byteLength(handle)` 只读取 descriptor page，不打开 Content data。
`content.stream(handle)` 顺序读取 range pages与 data segments，每次只持有当前 page、segment 与 digest buffer。

`content.bytes/text(handle)` 在分配前使用认证的 logical byteLength 做 Host admission。
admission 被拒绝时 Attachment 仍是 available；该失败不能把同一 durable closure改判 corrupt。
collection read 按 item index 顺序形成现有完整 logical array，本候选不引入 public cursor。

## 不变量与错误

- envelope、小 root、authenticated pages、data packs 与 Seal 共同构成 closure，缺一不可。
- partial frame/page tail、未闭合 root 与 staging temp file 不能进入 published inventory。
- frame、segment、page、pack 与 rollover boundary 不进入 family identity、Analysis、Report 或 public error。
- collection ordinal 只表达 append linearization；业务 order 仍来自 item fields。
- unknown family 的 envelope、roots、packs 与 pages 可以按 generic inventory 原样复制。
- ordinary read 不打开无关 Attachment，也不宣称整 Run complete；`requireComplete()` 流式验证全部 inventory。
- digest、missing、extra、truncated、range overlap/hole/out-of-bounds 与非法 codec 是 corruption。
- memory/time admission、disk/inode exhaustion、取消与 I/O 是 resource failure，不改判 published closure。

## 身份与演进

storage revision 固定 framing、authenticated page codec、root descriptor 与 wire integer。
family revision 只解释 logical payload/items。

改变 buffer size、rollover threshold、pack grouping 或 inline threshold 不改变 logical identity。
改变 page framing、catalog tree、range reuse 或 root shape 需要相邻 storage migration，但不调用 unknown family decoder。
