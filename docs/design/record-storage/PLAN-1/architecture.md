# PLAN-1：JSON envelope + Host 私有 packs —— Architecture

## 数据建模

一个 published Run 是一个 directory closure：

```text
runs/<run-id>/
├── core/...
├── attachments/<owner-key>/<family-key>/
│   ├── envelope.json
│   ├── items.pack          optional
│   ├── items.index         optional
│   ├── content.pack        optional
│   └── content.index       optional
├── seal.json
└── complete
```

路径名和文件名是本候选的 storage illustration，不是 public contract。
portable identity 来自 Core/envelope/Seal 中的 canonical IDs 与 digest，不来自 path spelling。

### Rich Attachment

`envelope.json` 保存 owner、family、family revision、canonical payload bytes descriptor、references 与 logical Content descriptors。
小且有界的 payload 可以直接进入 envelope；Content bytes 不进入 family JSON。

### Attempt Record collection

每个 retained item 在 Host mutex 中完成 Schema encode 与 canonical snapshot。
Host 同时分配单调 ordinal，并把 frame 追加到 `items.pack`。
ordinal 只保存公开 logical array 的线性化顺序，不替代 item 自带的业务顺序。

`items.index` 使用 fixed storage framing 保存 ordinal、offset、byte length 与 item digest。
Attempt complete 后，envelope 保存 item count、pack/index overall digest 与 complete/partial state。
ordinary public read 按 ordinal 读取全部 item，并形成现有 logical array。

### Logical Content

Content writer 增量消费 source，并把 bounded segment 追加到 `content.pack`。
`content.index` 保存 handle-local ordered ranges、per-segment digest、overall byte length 与 overall SHA-256。

Host 可以在同一 Attachment closure 内让相同 logical bytes 复用 pack ranges。
复用不能跨 Attachment 建立 lifetime dependency 或 secret existence signal。

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
  → pack segment
  → index entry
  → logical Content descriptor
```

source EOF、budget、digest 与 closure 都通过后，Attachment envelope 才成为 committed staging entry。

### Read

reader 先验证 requested envelope 和 index digest。
collection read 按 index 顺序形成完整 logical array；Content read 只在消费时打开 pack ranges，并逐 segment 校验。

## 不变量

- envelope、pack 与 index 共同构成一份 Attachment closure，缺一不可。
- partial frame、index 尾部、unreferenced pack range 与 staging temp file 都不能进入 published Seal inventory。
- frame/segment boundary 不进入 family identity、Analysis、Report 或 public error。
- collection ordinal 只表达 append linearization；业务 order 仍来自 item fields。
- Host 只在 Attachment closure 内做 byte reuse。
- unknown family 的 envelope、packs 与 indexes 可以按 Seal inventory 原样复制。
- ordinary read 不打开无关 Attachment pack；`requireComplete()` 验证全部 inventory。

## 生命周期与错误

Host 拥有 open handles、append offsets、digest state、staging temp names、fsync 与 close。
producer interruption 先进入 existing collection limitation；storage interruption 使 Run fail closed，不能伪装成业务 partial。

pack/index disagreement、frame length invalid、digest mismatch、truncated file 与额外 inventory member都返回 storage corruption。
任何错误都不尝试从目录中猜测缺失 frame。

## 身份与复用

storage revision 固定 framing、index codec 与 envelope storage descriptors。
family revision只解释 logical payload/items。

改变 buffer size、一个 pack 中的 segment grouping 或 inline threshold 不改变 logical identity。
改变 frame/index codec 需要相邻 storage migration，但不调用 unknown family decoder。
