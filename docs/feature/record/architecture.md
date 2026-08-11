# Record 架构

本页是 Record 的唯一落盘契约。Record 保存完整发布的事实；本地操作状态住在 sibling sidecar；算法与展示住在 Record 之上。

当前 portable format 是 `niceeval.record/v1`。后续 major 通过本页定义的显式 migration contract 演进。

## 三个物理层

| 层 | 内容 | 可携带与 Git |
|---|---|---|
| portable Record | bootstrap metadata、Record Core、Channel closure | 以整个 root 携带；可以由用户选择纳入 Git |
| local control state | session manifest、maintenance lease、writer lock、recovery 与 migration manifest | 不属于 Record；不复制、不分享、不进 Git |
| target-volume staging | sealed Run payload、migration 的 `N`/`O` | 位于 portable root 之外的 private sibling；不复制、不分享、不进 Git |
| derived cache | 可以从 portable Record 重建的索引与派生值 | 可随时删除；命中或失败不能改变公开结果 |

session 不是 cache。它可能是一次已经付费执行能否完成发布的唯一现场，因此不能按 cache 自动删除。

默认 portable root 是 `<project>/.niceeval/record/`。Library 的 `root` 参数已经是实际 Record root，不再自动补接子目录。

local control state 位于 sibling `.niceeval-local/<recordKey>/`，只放 control：lock、manifest 与 recovery 现场。payload staging 与 migration 树不放在这里。`recordKey` 由 canonical root 用固定算法派生，不随 Record major、文件内容或机器身份改变。

### Local state 与只读 root

lease 与 lock 全部落在 local control state，portable root 自身不因 reader 或 writer 变可写。lock anchor 对同一 locator 全进程唯一：固定为 sibling `.niceeval-local/<recordKey>/`，按 [recordKey 算法](#recordkey-与-root-定位) 派生，没有按权限动态选择的第二位置。

anchor 不可创建或不可取得时，reader、writer 与 migrate 一律返回 `record-sidecar-capability-unsupported`，不存在只读验证现场的回退模式。manifest 的物理位置可以有策略，maintenance lock 与 writer lock 的 anchor 不分叉。

reader 与 writer 都从同一个 anchor 取得同一 kernel/shared maintenance lease；reader 再取得同一 shared lease 才能读取。只读 root 可以正常打开、导航与投影，因为 anchor 不落在 root 内；anchor 所在 parent 只读时返回 typed capability failure。

### recordKey 与 root 定位

`root` 参数只接受 absolute string path 或 absolute `file://` URL。相对路径、relative URL 与含变量的写法一律拒绝，不相对当前工作目录猜测。

打开按段进行，每段用 handle-relative open（POSIX `openat`、Windows handle-relative）并拒绝 symlink 与 reparse point。existing root 以 opened parent 和真实落盘 case 打开；Windows 按 volume 与 UNC server/share 归一，drive letter 统一大写。root 缺失时先 canonicalize 最深的已存在 parent，再逐段 safe create；`createIfMissing: false` 时不创建任何段。

跨进程算法固定如下。domain separator 是版本字节、字段计数与字段定界的固定字节序列；每个字段按顺序先写 u32 LE length-prefix 再写 UTF-8 bytes，字段本身不再内嵌分隔符；endianness 固定为 little-endian。

```text
recordKey = hex(SHA-256(
  version = 0x01 (1 byte),
  fieldCount = 0x03 (u32 LE),
  length-prefixed UTF-8: canonical opened parent locator identity,
  length-prefixed UTF-8: canonical leaf segment,
  length-prefixed UTF-8: platform case semantics,
))
```

canonical locator input 的三个字段：opened parent 的 canonical locator identity、canonical leaf segment、platform case semantics。case-insensitive 平台把 leaf 折叠为 lowercase，并在第三个字段编码折叠模式。输入不包含 root 自身的 inode 或 file-id。定位不依赖 root 是否存在：root 缺失时按最深的已存在 parent 打开，用同一算法计算 identity，仍能定位并检查 sibling sidecar 的 migration 与 session 现场。

`recordKey` 是 SHA-256 的完整 64 字符小写 hex。算法在 Record v1 定稿，后续 major 只使用同一结果，不重新定义。

parent rename 对 `recordKey` 的影响逐平台由 capability 验收决定，实现不得猜测：Linux、macOS 与 Windows 分别验证 opened parent identity 在父目录改名或移动后的定位结果。未通过验收的平台与文件系统不承诺 rename 后的稳定性，也不自动恢复旧 sidecar；用户显式处理现场后重新建立。

local manifest 保存 root file identity（POSIX dev+inode、Windows volume+file ID）与 durable `recordId`，只用于 lineage 校验，不进入 `recordKey`。同一路径被删除后重建、或从备份原样恢复时，`recordKey` 不变，但 lineage 不匹配，open 返回 `record-sidecar-stale`。

migration 的 `N`、`O` 与 staging sibling 名从 `recordKey` 与 `sessionId` 派生，no-replace 创建；它们与 portable root 的布局互不重叠。

## 什么叫“Record 只保存事实”

portable Record 只允许三类内容：

| portable 层 | 保存内容 |
|---|---|
| bootstrap metadata | `format` 与 `recordId`，用于识别 root |
| Record Core | identity、导航、分母、关系与时间 |
| Record Channel | 独立 envelope 与 producer-owned、schema-identified、immutable payload closure |

Record 不判断一份 recorded claim 是否真实、最新或可沿用。Schema 只能证明 bytes 满足一份已命名契约，不能证明现实世界与 payload 一致。

以下内容永远不进入 portable Record：

- 作者 API、matcher、Plugin 调用顺序与执行算法；
- analysis selection、reuse planning、compiled Report plan 与页面模型；
- session、锁、build、staging directory、recovery、migration checkpoint、inventory 与 converter ID；
- cache、迁移历史、回滚历史与“已经成功迁移”的 durable proof。

迁移是同一份事实的表示转换，不是新的业务事实。成功 root 不保存 migration lineage；Git 或外部备份承担历史与回退。

## 三个 durable 演进边界

```text
作者 API / producer / policy / Report
                    │
                    ├─ behavior identity   reuse 比较语义
                    │
                    ├─ RecordChannelSchemaId  payload bytes 的 shape 与语义
                    │
                    └─ RecordFormatId      owner、导航、引用与发布公理
```

三个 identity 不能互相代替：

| identity | 冻结什么 | 何时发布新 identity |
|---|---|---|
| behavior identity | 当前输入、配置和 reuse gate 的比较语义 | 可观察行为、输入规范或沿用安全边界改变 |
| `RecordChannelSchemaId` | 一份 Channel payload 的精确 bytes 与含义 | payload shape 或 bytes 解释改变 |
| `RecordFormatId` | Core owner、导航、引用、目录与原子发布单位 | 任一结构公理改变 |

Channel projector 是代码中的 typed adapter，不是 durable identity。它可以单调增加一个无损的新 schema case；返回类型或解释发生破坏性变化时，Library 发布新的 projector export/API，而不是把代码版本写进 Record。一个进程内的 projection 去重使用 definition 的私有 token 或对象 identity。

Record major 变化不授权重算 Channel。migration 只转换结构表示，并证明业务事实等价。

## Effect 实现边界

Record 的 native Library API 返回 Effect。内部模块不得在文件系统操作中运行 `Effect.runPromise`，也不得建立私有 runtime。

| 责任 | 形态 |
|---|---|
| ID、路径语法、版本路由、引用验证、preservation inventory | 纯函数与完整 ADT |
| 文件、no-follow、锁、Stream、`fsync`、rename 与 cleanup | Effect |
| lease、handle、writer session、migration staging | `Effect.Scope` |
| missing、unknown schema、局部损坏 | `ChannelProjectionResult` 或 `RecordCoreRead` 成功值 |
| 权限、I/O、busy、closed lifecycle、capability unsupported | Effect typed error |

平台服务只包含真实外部边界：`RecordFileSystem`、`RecordMaintenanceLease`、`RecordWriterLock` 与 `RecordEntropy`。四个都是独立 `Context.Tag`，没有把它们打包成一个聚合 tag：reader 只依赖 FileSystem 与 MaintenanceLease，不被强迫持有 writer lock 或 entropy 能力。普通 TypeScript interface 不能直接充当 Effect environment。Schema、路径和引用算法保持纯函数。

JSON 边界使用精确 decoder，并拒绝 excess property。固定 parse options 是 `{ errors: "all", onExcessProperty: "error" }`，`Schema.Struct` 的默认行为不能代替。

`Stream` 用于 NDJSON、大型 blob 与候选枚举。Stream 必须在 reader Scope 内穷尽消费，不能出现在 `ChannelProjectionResult<A>`、`AnalysisSample` 或 `ReportInput` 中。

耗时转换保持可中断。Run 发布和 migration cutover 的短临界区使用 `Effect.uninterruptibleMask`；进程崩溃仍由持久化 local manifest 恢复。

## Durable Record 布局

```text
record.json
runs/<encoded-runId>/
  run.json
  members/<encoded-slotId>.json
  channels/<channel-name>/
    channel.json
    payload
    blobs/**
  attempts/<encoded-attemptId>/
    attempt.json
    channels/<channel-name>/
      channel.json
      payload
      blobs/**
```

Attempt 只住在 origin Run。其它 Run 的 Member 保存精确 `{ originRunId, attemptId }` 引用，不复制 Attempt。

portable unit 是整个 Record root。局部 Run、Channel 或 blob 不能被复制后冒充独立 Record。

## 路径段编解码与碰撞规则

Record 内每个落盘名都经过 canonical segment codec。`runs/` 的 Run 目录、`members/` 与 `attempts/` 的文件、`channels/` 的 Channel 目录、blob ref 与 migration/staging sibling 一律以 codec 输出的 segment 落盘。

公开 `RecordChannelName` 是逻辑名；落盘使用它的 canonical segment 形式 `RecordChannelDirectorySegment`。物理 segment 是包内私有类型，由逻辑名经 codec 派生，Record 只接受 codec 输出，不信任调用方拼出的任意文件名。逻辑名与物理 segment 双向可转换，转换失败返回 `record-path-invalid`。

codec 在 lowercase ASCII 基础上拒绝以下名字，全部返回 `record-path-invalid`：

| 拒绝规则 | 例子 |
|---|---|
| Windows device basename，带 extension 也拒绝 | `con.example`、`aux`、`lpt1.json` |
| 尾随空格或点 | `name.`、`name ` |
| ADS colon | `name:stream` |
| 路径 separator | `/`、`\` |
| `.` 与 `..` 段 | `a/../b` |

同目录内还要检查三种碰撞，命中即 `record-path-invalid`：

- exact：两个名字字节相同；
- ASCII casefold：忽略大小写后相同；
- file-directory-prefix：一个名字是另一个名字加 `.` 后缀的前缀，例如 `a` 与 `a.txt`。

blob closure 的每个 ref 与文件都用同一 codec。migration 的 `N`、`O` 与 staging sibling 名由 `recordKey` 与 `sessionId` 派生后同样经过 codec，且 no-replace 创建，不允许占用既有名字。

## 固定 bootstrap 与打开边界

每个 Record major 都把格式入口放在 root 的 `record.json`。这个路径和最小探测语法跨 major 固定。

```ts
type RecordFormatProbe = {
  format: RecordFormatId;
  recordId: RecordId;
};
```

探测器只在固定 byte limit 内取得 `format` 与 `recordId`（见 [Record v1 限制](#record-v1-限制)）。它拒绝 duplicate JSON key，也要求这两个字段各出现一次并满足字符串与 canonical identity 规则。

探测器不信任其它字段，不枚举 Run，不读 Channel，不构造 Sample，也不写 cache。探测为 current 后，current exact decoder 再验证整个 `record.json`，包括 excess property。

普通 open 的结果固定为：

| 现场 | 结果 |
|---|---|
| local migration state 存在 | `record-migration-recovery-required` |
| sidecar lineage 与 root file identity 不匹配 | `record-sidecar-stale` |
| sidecar 存在未收敛的 session 或 recovery 现场 | `record-sidecar-recovery-required` |
| lock anchor 无法创建或无法取得唯一 lease | `record-sidecar-capability-unsupported` |
| lock anchor 或 manifest 位置权限不足 | `record-sidecar-permission-denied` |
| bootstrap 文档坏或超过探测上限 | `record-bootstrap-invalid` |
| `format` 是 current major | 用 current exact reader 打开 |
| `format` 是已知旧 major，且 converter chain 完整 | `record-migration-required` |
| future 或 foreign format | `record-format-unsupported` |

`show`、`view`、`exp --dry` 与 `exp` 共用这个入口。旧 major 不能以只读模式打开，也不能在内存中自动适配。

## Core v1 精确形状

`record.json` 是精确对象：

```ts
type RecordDocumentV1 = {
  format: "niceeval.record/v1";
  recordId: RecordId;
};
```

Core 文档和嵌套对象都是精确对象。未列出的字段不存在。

```ts
type RunDocumentV1 = {
  schema: "niceeval.run/v1";
  runId: RunId;
  experimentId: ExperimentId;
  startedAt: UtcMillis;
  completedAt: UtcMillis;
  expectedSlots: readonly ExpectedSlotV1[];
};

type ExpectedSlotV1 = {
  slotId: SlotId;
  evalId: EvalId;
  attempt: number;
};

type MemberDocumentV1 = {
  schema: "niceeval.member/v1";
  runId: RunId;
  slotId: SlotId;
  attempt: {
    originRunId: RunId;
    attemptId: AttemptId;
  };
};

type AttemptDocumentV1 = {
  schema: "niceeval.attempt/v1";
  attemptId: AttemptId;
  origin: { runId: RunId; slotId: SlotId };
  eval: { evalId: EvalId; attempt: number };
};
```

Core 不内嵌 Channel 列表或 envelope。一个 Channel 的 JSON 容器即使被截断、出现坏逗号或 duplicate key，也不能阻止 Core 与其它 Channel 各自形成语法树。

一个 Run 内的 `slotId` 和 `(evalId, attempt)` 分别唯一。没有 outcome 的 slot 可以没有 Member，但不能出现 expected set 之外的 Member。

Member 只声明一个 slot 由哪个精确 Attempt 占据。当前 Member 与所指 Attempt 的 origin 相同时是 `origin`，否则是 `reference`。

`executed`、reuse、manual adoption 或以后新增的形成原因不属于 Core。它们由 `niceeval.membership-provenance/v1` 解释。

每个 Attempt 恰有一个 origin Member。reference 只能指向 reader frozen view 中已发布且具有有效 origin anchor 的 Attempt。

同一 Attempt 不能占据不同 `(evalId, attempt)` 的 slot。orphan、重复 anchor、跨 slot 引用或 identity mismatch 都是 Core invalid。

ID、时间、目录编码与 Unicode 规则由 [Library](library.md#identity-与路径类型) 的 branded 类型统一定义。文件名与文档内 identity 必须一致。

## ChannelEnvelopeV1

每个 owner-local Channel 使用一个独立目录。`channel.json` 是固定 envelope，`payload` 是唯一主 payload；schema 若需要 blob，只能引用同一 Channel 目录下的 `blobs/**`：

```ts
type ChannelEnvelopeV1 = {
  name: RecordChannelName;
  schemaId: RecordChannelSchemaId;
  mediaType: RecordChannelMediaType;
  collection:
    | { state: "complete" }
    | { state: "partial"; reason: string };
};
```

Record 不保存 descriptor schema、descriptor registry 或 durable `absent`。没有同名 Channel 目录就是 `ChannelProjectionResult.unavailable`；目录存在但 envelope 或 payload 损坏就是该 Channel 的 `invalid`。

`partial` 只表示 producer 没有收集完整 payload。sampled、redacted 与 truncated 是 payload 或 typed view 自己的 limitation，不是 collection state。

同一 owner 内 `RecordChannelName` 由目录身份保证唯一，不按枚举顺序或版本号选择。目录名与 envelope 的 `name` 必须精确相等。

三个公开逻辑类型都有精确 grammar 与 UTF-8 byte limit，parse 失败返回具名错误，不产生 brand：

| 类型 | grammar | UTF-8 上限 |
|---|---|---|
| `RecordChannelName` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$` | 120 bytes |
| `RecordChannelSchemaId` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*/v[1-9][0-9]*$` | 140 bytes |
| `RecordChannelMediaType` | `^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$` | 80 bytes |

`RecordChannelName` 使用 reverse-domain lowercase ASCII namespace。落盘物理 segment 是包内私有 `RecordChannelDirectorySegment`，由逻辑名经 [canonical segment codec](#路径段编解码与碰撞规则) 派生。

Record v1 的 `RecordChannelMediaType` 只有两个取值：`application/json` 与 `application/x-ndjson`。同一 schema identity 永远保持相同的 bytes shape、media type、closedness 与语义。

`niceeval.*` 只归 NiceEval 官方领域 owner，第三方使用自己的域名。公开 `defineJsonChannel` 对 `niceeval.` 前缀在调用时返回 `niceeval-namespace-reserved`（见 [Library](library.md#channel-definition)）。官方 built-in 由包内私有 constructor 定义，运行时 authority 是 WeakMap 中的 exact object identity（见 [Channel definition 与 projector](#channel-definition-与-projector)）。

`channel.json` 与 `payload` 都必须是 no-follow regular file。自定义 JSON Channel 的 closure 只有这两个固定文件，不接受任意 path。

官方 blob-backed schema 可以引用 Channel-local blob。该 schema 必须永久提供 storage closure codec，能从 payload 穷尽列出 `blobs/**` closure，并验证 canonical relative path、长度与 digest。一个 Channel 不能引用另一个 Channel 或 owner 的文件。

storage closure codec 不是 Channel projector。它只证明哪些 bytes 属于这份持久事实，不形成业务 typed view。

不受当前 consumer 支持的 schema 也可以由 migration 连同整个已验证 Channel closure 逐 byte 复制。无法穷尽 closure 的 payload 必须让 migration 在 cutover 前失败。

## Record v1 限制

Record v1 对文档大小、条目数量、路径、闭包字节与组合总量设固定上限。上限随 `niceeval.record/v1` 冻结，不随 Channel schema 演进改变；收紧或放宽都需要新的 Record major。

文档与 payload 上限按 media type 拆分。closure 计数是 inclusive 的：`channel.json`、payload、全部 blob 与目录 overhead 都计入单个 Channel closure。

| 对象 | 上限 |
|---|---|
| `record.json` 探测读取 | 64 KiB |
| `record.json` 完整文档 | 64 KiB |
| `run.json`、`member.json`、`attempt.json`、`channel.json` | 1 MiB |
| JSON payload（`application/json`） | 16 MiB |
| NDJSON payload（`application/x-ndjson`） | 128 MiB |
| 单个 blob | 64 MiB |
| 单个 Channel closure（`channel.json` + payload + 全部 blob + overhead） | 256 MiB |
| 一个 Run 的 closure 总量（全部文档、payload 与 blob） | 1 GiB |
| root 的 Run 数量 | 1,048,576 |
| 一个 Run 的 expectedSlots 数量 | 4096 |
| 一个 Run 的 Member 数量 | 4096 |
| 一个 Run 的 origin Attempt 数量 | 4096 |
| 一个 Run 的 Channel 总数（Run-owned 与全部 Attempt-owned） | 4096 |
| 一个 Run 的 blob refs 总数 | 131,072 |
| 一个 Run 的 filesystem entries 总数 | 262,144 |
| 一个 owner 的 Channel 数量 | 256 |
| 一个 owner 目录的 entries 数量 | 4096 |
| 一个 Channel 的 blob refs 数量 | 65,536 |
| 一个 Channel 的 blob 数量 | 65,536 |
| 一个 Channel closure 的 filesystem entries 数量 | 65,536 |
| 一个 Channel closure 的目录数量 | 1024 |
| root 的直接 entries 数量 | 4096 |
| root 的 filesystem entries 总数 | 16,777,216 |
| NDJSON 单行 | 64 KiB |
| NDJSON 单文件 | 256 MiB |
| NDJSON 行数 | 1,048,576 |
| NDJSON 逻辑 record 数 | 65,536 |
| 路径深度 | 16 层 |
| 路径 segment | 120 bytes（UTF-8） |
| portable 相对完整路径 | 1024 bytes（UTF-8） |
| JSON 嵌套深度 | 64 层 |
| `RecordChannelName` | 120 bytes（UTF-8） |

portable 完整路径以 portable root 为基准的 canonical 相对路径计（UTF-8 bytes 与 depth 如上）。absolute `RecordRoot` path 的打开是 platform constructor 能力：平台不能证明逐段 no-follow 打开语义时返回 typed unsupported，不改变 format validity。

单项上限都可实际 seal：16 MiB JSON payload 与 128 MiB NDJSON payload 都小于 256 MiB closure，closure 公式按 `channel.json + payload + blobs + overhead` 计数，任一单项达到上限时其余部分仍能封口。NDJSON 上限与 closure 上限互相可达，不允许出现不可封口的常量组合。

组合受总量约束：

- 一个 Run 的全部 Channel closure 与文档之和不能超过 1 GiB，防止 4096 个 Attempt 各带 256 个 Channel 组合出任意大的 Run；
- 一个 Run 的 Channel 总数、blob refs 总数与 fs entries 总数是独立 aggregate cap，防 4096 Attempt × 256 Channel 的百万 zero-byte 对象；
- 一个 Channel 的 blob refs、blob 数与 closure entries 有机械关系：每个 blob ref 必须命名一个 entry，closure entries ≥ blob refs + 2（`channel.json` 与 payload）；
- NDJSON 行数 ≥ 逻辑 record 数；每条逻辑 record 至少占一行，record 分配前先按行数上限做 stream 检查；
- root 的 fs entries 总数包含全部 Run 与文档；root 直接 entries 只数 `record.json` 与顶层目录。

已知计数在分配前检查：expectedSlots、Member、origin Attempt、Channel、blob refs 与 root entries 的数量先于任何内存分配验证。Stream 累计（NDJSON 行数、logical record、blob bytes）边读边比对上限，命中即中止，不读完整文件。

百万 Run 的扫描不一次性构造 `RecordCoreRead` 数组。`candidates` 与 `latest` 使用 bounded streaming 或冻结索引：内存按固定批次大小上界，时间 O(runs) 单遍；索引只缓存 identity 与排序键，不缓存 payload。

读取超限按可隔离损坏处理，只影响该 entry 或该 Channel：

- `record.json` 超过探测上限时无法建立可信 bootstrap，返回 `record-bootstrap-invalid`；
- Core 文档超限让该 entry 变成 `RecordCoreRead.core-invalid`；
- envelope、payload 或 blob 超限让该 Channel 变成 `ChannelProjectionResult.invalid`，issues 具名 `limit-exceeded`。

写入超限在 seal 前失败。`stageRun` / `sealRun` 检查上述所有上限，命中时返回 `record-limit-exceeded`，携带 kind、具名对象、`maximum` 与 `observedAtLeast`；staging 现场由 session 删除，不产生部分发布。错误不携带精确观测值：Stream 可能在上限前已中止，`observedAtLeast` 只是下界。

boundary matrix：以下组合在 seal 前被拒绝，不允许同时到达各自单项上限：

| 组合 | 结果 |
|---|---|
| 256 个 owner Channel 各 256 MiB closure | 超过 Run closure 1 GiB，拒绝 |
| 4096 个 origin Attempt 各 256 个 Channel | 超过 Run Channel 总数 4096，拒绝 |
| 1,048,576 个 Run 各含 4096 个 Member | 超过 root fs entries 上限，拒绝 |
| 一个 Channel 的 blob refs = 65,536 且 blob 数 = 65,536 | 每个 ref 必须对应一个 blob entry，机械关系成立，封口可行 |
| NDJSON payload = 128 MiB 且行数 = 1,048,576 | 行数 × 单行上限 ≤ payload 上限，机械关系成立 |
| `channel.json` = 1 MiB、payload = 128 MiB、blobs = 127 MiB | closure = 256 MiB，恰好封口，允许 |
| `channel.json` = 1 MiB、payload = 16 MiB、blobs = 239 MiB | closure = 256 MiB，恰好封口，允许 |

## Channel definition 与 projector

typed producer 通过 Channel definition 写入。definition 的 codec 从 exact schema 推导，decoded `Payload` 与 schema-specific encoded `I` 都不声明 `PortableJsonValue` 或递归 JSON 泛型上界：

```ts
interface JsonChannelDefinition<Owner extends "run" | "attempt", Payload> {
  readonly owner: Owner;
  readonly name: RecordChannelName;
  readonly schemaId: RecordChannelSchemaId;
  readonly mediaType: RecordChannelMediaType;
  readonly codec: PortableExactJsonCodec<Payload>;
}

declare const defineJsonChannel: <
  Owner extends "run" | "attempt",
  S extends Schema.AnyNoContext,
>(input: {
  owner: Owner;
  name: string;
  schemaId: string;
  mediaType: "application/json" | "application/x-ndjson";
  schema: S;
}) => Either.Either<
  JsonChannelDefinition<Owner, Schema.Type<S>>,
  RecordChannelDefinitionError
>;
```

`S extends Schema.AnyNoContext` 从 exact schema 推导 `Type<S>` 与 `Encoded<S>`，固定 parse options `errors: "all"` 与 `onExcessProperty: "error"`。JSON Channel 的 wire 仍是 closed exact JSON，不允许原生 bytes；`Date`、`BigInt` 等非 JSON 类型必须显式 transform 到 JSON 表示。公开 `defineJsonChannel` 接收 raw string，在内部完成 parse 与 `niceeval.` reserved 检查；调用方不能先构造 brand 再得到 `name-invalid`。

```ts
type RecordChannelDefinitionError =
  | { code: "niceeval-namespace-reserved"; name: string }
  | { code: "record-channel-name-invalid"; name: string }
  | { code: "record-channel-schema-id-invalid"; schemaId: string }
  | { code: "record-channel-media-type-invalid"; mediaType: string }
  | { code: "record-channel-schema-invalid"; issues: NonEmptyRecordIssues };
```

官方 built-in 由包内私有 constructor 构造，不经过公开 `defineJsonChannel`。definition 的运行时 authority 是包内 WeakMap 中的 exact object identity：公开字段、`_typeId` 一类的符号字段可以复制，但复制出的对象不在 WeakMap 中，传入任何 API 都返回 `record-definition-forged`。

projector 是 output codec 的唯一 owner：

```ts
interface RecordChannelProjector<Owner extends "run" | "attempt", Value> {
  readonly owner: Owner;
  readonly channel: RecordChannelName;
  readonly output: PortableValueCodec<Value>;
}

declare const defineJsonChannelProjector: <
  Owner extends "run" | "attempt",
  Value,
  Cases extends readonly [
    ProjectionCase<Owner, unknown, Value>,
    ...readonly ProjectionCase<Owner, unknown, Value>[],
  ],
>(input: {
  owner: Owner;
  channel: RecordChannelName;
  output: PortableValueCodec<Value>;
  cases: Cases;
}) => Either.Either<
  RecordChannelProjector<Owner, Value>,
  RecordProjectorDefinitionError
>;
```

`Value` 按 `output` codec 的 encode + decode 真实设为 invariant，不伪称 covariant。constructor 捕获 typed codec 并私有注册；`RecordProjection` 与 `Frame` 不得再复制一份 codec。

case 由 builder 构造。builder 在构造点捕获 `Payload`，把精确类型存进包内 WeakMap，返回 erased base；projector 接受 nonempty tuple：

```ts
declare const projectionCase: <Owner extends "run" | "attempt", Payload, Value>(input: {
  schema: JsonChannelDefinition<Owner, Payload>;
  project: (payload: Payload) => Either.Either<Value, NonEmptyProjectionIssues>;
}) => ProjectionCase<Owner, unknown, Value>;
```

```ts
type RecordProjectorDefinitionError =
  | { code: "projector-cases-empty" }
  | { code: "projector-case-duplicate-schema"; schemaId: RecordChannelSchemaId }
  | { code: "projector-case-mismatch"; reason: string }
  | { code: "projector-output-invalid"; issues: NonEmptyRecordIssues };
```

constructor 验证：cases 非空（tuple 类型保证，运行时再查一次）、每个 case 的 schema owner 与 `input.owner` 相同、schema 属于 `input.channel`、schema case 不重复（按 schema 对象 identity）。empty、duplicate 与 mismatch 都返回具名 Either，不产生 projector。

typed write 公开为 opaque 类型：

```ts
declare const recordChannelWriteTypeId: unique symbol;

type RecordChannelWrite<Owner extends "run" | "attempt"> = {
  readonly [recordChannelWriteTypeId]: { readonly owner: Owner };
};

declare const makeRecordChannelWrite: <
  Owner extends "run" | "attempt",
  Payload,
>(
  definition: JsonChannelDefinition<Owner, Payload>,
  payload: Payload,
) => Either.Either<RecordChannelWrite<Owner>, RecordChannelWriteError>;
```

`makeRecordChannelWrite` 捕获 `(definition, payload)` typed pair，立即用 definition 的 codec 验证 payload，并把 payload 存进以 write 对象为 key 的包内 WeakMap。write 本身只有 package-private symbol 字段，不公开 definition 或 payload 字段，公开字段不构成 authority。

数组擦除 `Payload` 后仍保留 `Owner`，外部代码无法构造 write。transplant 复制的对象不在 WeakMap 中，stage 时返回 `record-write-forged`。`RecordChannelWrite<"run">[]` 不能出现在 attempt 槽位，owner 混用在类型层即被拒绝，运行时 owner 检查作为最终防线。

definition 的 `RecordChannelSchemaId` 是 durable identity；projector 是当前程序中的 typed adapter。Record 不保存 projector identity。

每个 Channel projector 只接受一个 owner kind、一个 `RecordChannelName` 的自包含 decoded payload。API 不向 callback 传其它 Channel、其它 owner、path、reader 或平台 service。

读取分两步：

```text
envelope + scoped bytes
          ↓ schema decoder
self-contained decoded payload
          ↓ pure projector case
ChannelProjectionResult<Value>
```

projector callback 属受信任扩展代码。参数缩窄是 capability minimization，不是 JavaScript security boundary；闭包仍可能自行 import 文件系统、读取 `process.env` 或联网。内建 projector 必须满足确定性纯函数约定，第三方代码若需要安全隔离必须进入独立进程或 data-only AST，Effect 不自动提供沙箱。

projector case 对 payload 的预期语义拒绝必须显式返回 issues；意外 throw 是 defect。Report host 可以在第三方执行边界把 defect 隔离成 `execution-failed`，但不能把它伪装成 Record input `invalid`。interruption 继续传播，权限与 I/O 仍留在 Effect error channel。

## ChannelProjectionResult

```ts
type CollectionState =
  | { state: "complete" }
  | { state: "partial"; reason: string };

type DecodingState =
  | { state: "complete" }
  | { state: "partial"; issues: NonEmptyProjectionIssues };

type ProjectionSource = {
  name: RecordChannelName;
  schemaId: RecordChannelSchemaId;
  mediaType: RecordChannelMediaType;
};

type ChannelProjectionResult<Value> =
  | {
      state: "available";
      source: ProjectionSource;
      collection: CollectionState;
      decoding: DecodingState;
      value: Value;
    }
  | { state: "unavailable"; name: RecordChannelName }
  | {
      state: "unsupported";
      source: ProjectionSource;
      issues: NonEmptyProjectionIssues;
    }
  | {
      state: "invalid";
      source?: Partial<ProjectionSource>;
      issues: NonEmptyProjectionIssues;
    };
```

`unavailable` 表示没有同名 envelope。`unsupported` 表示 envelope 可读，但当前 projector 不认识 schema 或 media type。

`invalid` 表示独立 envelope、payload bytes、schema、closure 损坏，或 projector 显式判定该 payload 无法形成声明的 typed view。callback throw 不属于这个状态。权限和真实 I/O 仍进入 Effect error channel。

`available` 有三条独立信息：collection、decoding 与 `Value` 自己的 limitations。通用 `requireComplete` 只检查前两条；领域 consumer 必须另查 `Value.limitations`。

## Generic writer 与 Evaluation aggregate

`RecordWriteSession` 只验证 storage contract：

- Core shape、identity、owner 与引用完整性；
- 独立 Channel directory、固定 envelope 与完整 closure；
- 文件 sync、目录 sync、atomic no-replace publish 与 crash recovery；
- 一个完整 Run 的原子发布。

generic writer 不评估 Assertions、Verdict、Eligibility、Evaluation 或 membership provenance。它也不判断一次运行是否可 reuse。

官方 NiceEval Evaluation producer 在调用 generic writer 前，用内部 `EvaluationRecordContract` 验证自己的 aggregate。缺少 required Channel 时，官方 producer 在 stage 前失败。

外部损坏或第三方 producer 形成的 Record 仍按 Core 与 Channel 局部读取。Evaluation aggregate 规则不能反向把整个 Core 判坏。

官方首批 Channel catalog 是：

| owner | schema ID | 领域 owner |
|---|---|---|
| Attempt | `niceeval.assertions/v1` | Assertions |
| Attempt | `niceeval.verdict/v1` | Verdict |
| Attempt | `niceeval.score/v1` | Assertions / Score Eval grading |
| Attempt | `niceeval.eligibility/v1` | Experiments |
| Attempt | `niceeval.usage/v1` | Observability |
| Attempt | `niceeval.conversation/v1` | Observability |
| Attempt | `niceeval.commands/v1` | Runner / evidence |
| Attempt | `niceeval.diff/v1` | Sandbox |
| Attempt | `niceeval.timing/v1` | Observability |
| Attempt | `niceeval.diagnostics/v1` | Diagnostics |
| Run | `niceeval.evaluations/v1` | Eval |
| Run | `niceeval.membership-provenance/v1` | Experiments |
| Run | `niceeval.sources/v1` | Sources |
| Run | `niceeval.run-provenance/v1` | Runner |
| Run | `niceeval.diagnostics/v1` | Diagnostics |

这张 catalog 不是 Core enum。新增业务事实只增加所属领域的 Channel definition 与 projector，不修改 Record capability。

`niceeval.evaluations/v1` 对每个 distinct `evalId` 保存一次 `evaluationKind: "pass" | "score"`。集合与 expected slots 中的 eval 精确相等，离线 Report 不回读当前源码。

`EvaluationRecordContract` 要求每个 origin Attempt（Pass 或 Score）都写完整四态 Verdict（`passed | failed | errored | skipped`）。Score Eval 的 origin Attempt 另外写完整 score grading。Verdict 与 score 不互斥：Score Eval 两者都写；也不可互推：Report 只能分别读取 `niceeval.verdict/v1` 与 `niceeval.score/v1`，不能从其中一个推导另一个。

`niceeval.membership-provenance/v1` 解释每个 expected slot 怎样形成 Member 或为什么没有 Member。Core 只保留可验证的占位关系。

## Atomic publish platform capability

Run publish 依赖一个不能由 `node:fs.rename`、`exists + rename` 或 copy 组合模拟的平台原语。能力以 opened handle 表达，不跨调用重开 absolute path：

```ts
interface RecordFileSystemService {
  readonly exclusiveRenameNoReplace: (input: {
    sourceParent: OpenedDirHandle;
    sourceLeaf: PinnedLeaf;
    targetParent: OpenedDirHandle;
    targetLeaf: PinnedLeaf;
  }) => Effect.Effect<
    void,
    | AtomicPublishTargetExists
    | AtomicPublishCrossDevice
    | AtomicPublishUnsupported
    | RecordFileSystemFailure
  >;

  readonly syncFile: (handle: OpenedFileHandle) => Effect.Effect<void, RecordFileSystemFailure>;
  readonly syncDirectory: (handle: OpenedDirHandle) => Effect.Effect<void, RecordFileSystemFailure>;
  readonly syncTree: (parent: OpenedDirHandle, leaf: PinnedLeaf) => Effect.Effect<void, RecordFileSystemFailure>;
}
```

`OpenedDirHandle` 是 no-follow 打开的目录 handle，`PinnedLeaf` 是创建时固定的 leaf 名。source-parent 与 target-parent 可以是不同父目录，只要求同一文件系统或 volume；不允许跨卷。目标以任意文件类型存在时都必须得到 `target-exists`，且既有目标原封不动；不得先检查再调用普通 rename。

发布顺序固定：先 `syncTree(sourceParent, sourceLeaf)` 并 `syncDirectory(sourceParent)`，再 `exclusiveRenameNoReplace`，最后 `syncDirectory(targetParent)`。

平台或当前文件系统只能证明同父 exclusive rename 时，返回 `record-atomic-publish-unsupported`。网络文件系统、跨卷移动与 copy fallback 不在支持面。

Node platform 的候选实现：

- Linux `renameat2(RENAME_NOREPLACE)`；
- macOS `renamex_np` / `renameatx_np(RENAME_EXCL)`；
- Windows `SetFileInformationByHandle(FileRenameInfo, ReplaceIfExists=false)`。

atomic visibility 与 crash durability 是两条契约。发布原语保证竞争者恰有一个成功、reader 不看见半个目录；写入方还必须先 sync 所有 payload 与目录，在 rename 后 sync target parent，才能返回 durable receipt。Scope cleanup 不能替代这些 OS 原语。

平台验收至少验证：两个进程竞争同一 target、已有 file/directory/symlink target、跨卷、跨 parent、unsupported filesystem、rename 前后中断与 sync failure。只有通过平台验收的文件系统才 advertise capability。

## Run 发布

writer 在 target-volume staging 形成完整 Run。只有 storage contract 与调用方 `EvaluationRecordContract` 都通过后，Run 才能 seal。

sealed payload staging 位于 portable root 之外的 private sibling：`.niceeval-staging/<recordKey>/<sessionId>/`，与 R 同文件系统或 volume。staging 区 owner-only、no-follow、no-replace 创建，绝不放进 `runs/`；local control sidecar 只放 manifest 与 lock，不放 payload。

| 状态 | 位置 | 下一步 |
|---|---|---|
| building | `.niceeval-staging/<recordKey>/<sessionId>/` 内 staging tree | 继续形成，或由 owner Scope 删除 |
| sealed | staging tree 完整，control manifest 已 durable | 只可 commit-only publish 或显式 abandon |
| visible | `runs/<runId>` 已出现 | 完成 target parent `fsync` 与 destination revalidation |
| durable | destination 已验证且 target parent `fsync` 完成 | 返回 durable receipt |
| cleanup-pending | durable Run 已成立，staging cleanup 未完成 | 只重做 staging cleanup |

portable Record 只包含 complete 且 durable 的 Run。每个 portable Run 的 `completedAt` 必填；draft、building 与 sealed 未发布的 Run 只存在于 target-volume staging，永远不进入 portable root。

seal 后的 source 不可修改。writer 通过 `exclusiveRenameNoReplace`（opened source-parent + target-parent handles）把完整 Run 从 staging sibling 发布到 `runs/<runId>`。发布前 sync source tree 与 source parent，rename 后 sync target parent。

reader 取得 shared maintenance lease，但不取得 writer lock，因此可以和正常 writer 并发。reader 可能漏掉刚发布的 Run，但绝不能看到半个 Run。

一次 Invocation 可以发布多个 Run，但没有 Invocation 级事务。每个 Run 是独立 atomic unit。

发布后没有 edit、delete、revision、merge 或补写 API。需要新事实时发布新的 Run。

## Frozen reader

`RecordReader` 打开时从唯一 anchor 取得 shared maintenance lease，并建立一次 `runs/` 的冻结扫描。它冻结 `candidateSet`，不是 linearizable Invocation snapshot。

`candidates` 与 `latest` 是 bounded streaming 或冻结索引查询，不一次性构造百万 `RecordCoreRead` 数组。初次扫描按 raw entry bytes 排序，并保留每项 `read | core-invalid`；projector 不能先过滤损坏 entry，再把剩余集合伪装成完整 latest candidates。

按 identity 查找（Run、Attempt）返回 `RecordCoreRead` 三态 ADT：`read`、`core-invalid` 与 `missing`。枚举只产生前两态；`missing` 只出现在按 id 查找时。

只有 candidate set 可以参与 latest、显式 Run 选择、Sample 分母与 execution source。reader 创建后发布的 Run 不会进入这次 view。

选择形成后，reader 可以沿已选 Member 的精确 AttemptRef 补入 origin Run。这个 `dependencyClosure` 不成为 latest candidate，也不扩张 Sample 分母。

reader 与 write session 的 frozen view 都提供受控 project capability。它以 FrozenRun / FrozenAttempt handle 与 typed projector 为参数，返回 `Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>`。按需 payload/blob I/O 与 `PortableValueCodec` 输出都可中断，因此 projection 是 Effect 而不是同步函数。closed Scope 与 session 失配进入错误 channel。

reuse planning 用它读取 Verdict、score、eligibility 与 evaluations 等具名 Channel，并形成有界的 analysis selection。capability 只输出已解码的 typed 值，不暴露 path、raw bytes 或 reader handle。

closure 完成后同样冻结。ReportInput 形成前必须消费完所需 Channel；关闭 Scope 后，Sample、ReportInput 与 ReportExecution 都不再访问 Record。

`view` 的每次 rebuild 都在新的 Scope 中打开 reader、形成完整自包含输入并关闭该 reader Scope。构造成功后，view host 才把新的 immutable Report revision 替换为 current；旧 revision 从不被并发 publish 原地改变。

## 锁与并发

local control state 从 Record v1 起固定两个跨 major lock anchor：maintenance lock 与 writer lock。anchor 对同一 locator 全进程唯一，只有一个 deterministic discovery 算法（sibling `.niceeval-local/<recordKey>/`），没有按权限动态选择的第二位置。

```text
reader            shared maintenance lease（同一 anchor）
writer/recovery   shared maintenance lease → exclusive writer lock
migrate           exclusive maintenance lease → source-version writer lock
```

锁顺序固定，不能反向取得。正常 reader 与 writer 可以并发；同一 root 同时最多一个 writer。

reader 也取得同一 kernel/shared maintenance lease，不采用只读验证现场的回退。anchor 无法发现或无法取得时返回 `record-sidecar-capability-unsupported`；manifest 的物理位置可以有策略，lock anchor 不分叉。

migration 是独占 maintenance window。存在 reader、writer 或 recovery 时，`niceeval migrate` fail fast；它不等待，也不接管其它进程。

## 显式原地 migration

`niceeval migrate [--record <root>]` 是唯一 Record major migration 入口。它原地把同一个 root 更新到当前 major。

迁移满足以下 identity 规则：

- 保留 `recordId`、RunId、SlotId、AttemptId 和所有 Core 关系；
- 不产生新 Run，不补默认值，不重算任何业务 Channel；
- 不运行 Channel projector、analysis selection、reuse planning 或当前算法；
- 不修改未受当前 consumer 支持的 domain payload，只在 closure 可证明时逐 byte 保存；
- 不写 durable lineage、receipt、converter ID 或 rollback state。

source-major decoder、validator 与 converter 只存在于 migrate 工具。普通 reader 包中没有跨 major Core adapter。

converter 只支持相邻 major：

```text
niceeval.record/vN → niceeval.record/vN+1 → current major
```

每一步都先构出 target 树，再用目标版本 exact validator 验证。中间树位于 R 同父的 target-volume private sibling：`.niceeval-staging/<recordKey>/migration-<sessionId>/`，不会成为 public root，也不进 local control sidecar。

每个相邻 converter 有 immutable converter ID，但该 ID 只写入 local migration manifest。成功后 manifest 与 intermediate tree 全部删除。

### Preservation inventory

每一步在 cutover 前比较 source 与 target inventory：

- `recordId`；
- Run、Slot、Member 与 Attempt identity；
- origin/reference、expected denominator 与时间；
- Channel 的 logical owner、name、schemaId、mediaType 与 collection；
- payload 与 blob closure 的 digest。

物理文件可以拆分、合并或换目录。上面这些事实必须等价。

如果未来 Core major 改变这些业务实体，converter 无法证明一一等价，就返回 `record-migration-not-lossless`。NiceEval 不提供自动 migration path。

已知 invalid domain payload 可以原样保留，只要 source closure 结构安全。缺失、越界、link、无法穷尽的 closure 或 digest 不一致会在 cutover 前失败。

### Cutover

定义：

- `R`：用户看到的 public root；
- `N`：已经验证的 current target；
- `O`：cutover 期间暂存的旧 root；
- `M`：位于 local control sidecar 的 exact migration manifest。

`N` 与 `O` 都位于 R 同父的 target-volume private sibling：`.niceeval-staging/<recordKey>/migration-<sessionId>/N|O`。cutover 在 exclusive maintenance lease 下执行：

```text
phase 1: rename R → O（no-replace，collision → fail closed）
  manifest phase 1 已 durable 并 fsync
  syncTree(R 的 staging 副本) 不需要；sync source parent 与 target sibling parent
phase 2: rename N → R（no-replace，collision → fail closed）
  manifest phase 2 已 durable 并 fsync
validate R
fsync R 与父目录
删除 O、M、intermediate 与 cache
```

这不是单次 rename swap。它是由 local manifest 保护的两次 no-replace rename，并通过 recovery matrix 收敛。每次 rename 前检查 collision：`O` 或 `R` 已存在且不是本次操作留下的现场时 fail closed。

每次 rename 后、写下一个 manifest phase 前，按 bottom-up 顺序 fsync：先文件后目录、先叶子后根，再 fsync manifest 所在目录与 source/target parent。

短暂的 `R → O`、`N → R`、validate 与 `fsync` 区间是 uninterruptible。进程崩溃仍可能停在任意持久边界。

### Migration recovery matrix

恢复不只信任 manifest phase。它重新检查 `R`、`N`、`O` 的存在性、format、`recordId` 与 manifest digest。

| 现场 | 恢复动作 |
|---|---|
| `R=source, N=target, O=missing` | cutover 尚未开始；继续迁移 |
| `R=missing, N=target, O=source` | 完成 `N → R`（no-replace，先 fsync parent） |
| `R=target, N=missing, O=source` | 重验 target，再 cleanup |
| `R=target, N=missing, O=missing` | target 已提交；cleanup manifest |
| `R=source, N=missing, O=source` | cutover 前崩溃；删除 `O` 副本，回到 source |
| `R=missing, N=missing, O=source` | `N → R` 前崩溃且 `R` 丢失；fail closed |
| 其它组合 | fail closed，保留现场 |

在 target 安装前，把 `O` 恢复为 `R` 只是恢复一次未提交的操作现场，不是用户回滚。target durable 后绝不自动恢复旧 root。

cleanup 失败不会取消 durable target，但普通 open 继续返回 `record-migration-recovery-required`。用户再次执行 `niceeval migrate` 完成 cleanup。

迁移成功会删除 `O`、intermediate、migration state 与 cache。NiceEval 不保留旧 root，也没有 `migrate --rollback`。

## 普通 write-session recovery

Run publish recovery 与 Record major migration 是两种 control session。它们使用不同 manifest，但都阻止新的 writer 猜测现场。

sealed Run session 只允许 commit-only recover。building session 可以由用户显式 abandon；未知 session schema 不自动删除。

已经 durable、只剩 cleanup 的 Run 不会被倒推成失败。recovery 只完成 validation、`fsync` 与 local cleanup。

## 变化归属矩阵

| 变化位置 | 所属 identity | Record Core |
|---|---|---|
| Assert-first author API、evaluator、matcher 或 Plugin lifecycle | behavior identity | 不变 |
| AssertionResult payload 的 shape 或语义 | `RecordChannelSchemaId` | 不变 |
| consumer 需要新的 typed view | 新 projector export / Library API | 不变 |
| membership provenance 的业务联合 | 对应 provenance Channel schema | 不变 |
| owner、reference、path 或 atomic publish unit | `RecordFormatId` | 发布新的 major |

判断顺序是：先问 recorded claim 是否变化，再问 typed view 是否变化，最后问 Core 公理是否变化。API 名词变化不能触发磁盘升级，也不能为了避免 migration 把 Core 变成自由 JSON。

## Portable、Git 与外部操作

复制、备份、Git checkout 或 merge 前，用户必须让 root 停稳。普通文件复制不是运行中的 atomic snapshot。

`.niceeval-local/` 与 `.niceeval-staging/` 永远不复制、不提交。迁移、Run recovery 和 cache 都只对当前 canonical root 有效。

Record Channel 可能含源码、prompt、凭据、conversation 与 binary blob。把 root 纳入 Git 是用户的显式数据治理选择。

用户需要回退 migration 时，使用 Git checkout 或自己的备份恢复整个 root。恢复后普通命令会重新按该 root 的 `format` 决定是否要求迁移。

选择性分享使用自包含静态 Report。它只包含 compiled Report plan 实际请求的 projected values 与资源，不是可继续写入的 Record。

## Record major 升级条件

以下变化要求新的 `niceeval.record/vN`：

- root、Run、Member、Attempt、Channel directory 或 `ChannelEnvelopeV1` 的精确形状改变；
- owner、identity、navigation、reference 或 directory safety 改变；
- Attempt 不再由 origin Run 拥有；
- portable unit 不是整个 Record root；
- Run 不是 immutable atomic publish unit；
- migration preservation inventory 无法用当前 Core identity 表达。

新增业务事实、增加 Channel schema、增加 projector、重写 matcher 或改变 Report 不触发 Record major。

Record major 不是兼容读取承诺。当前 NiceEval 只打开 current major；旧 major 必须先由用户显式迁移。
