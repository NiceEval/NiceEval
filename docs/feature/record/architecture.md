# Record 架构

本页是 Record 的唯一落盘契约。Record 只保存已经提交的事实；session、锁、恢复材料和派生缓存都在 Record local sidecar。两类目录不能互相替代，也不能一起充当 portable Record。

`niceeval.record/v1` 是一条全新的格式线，不是旧 Results `schemaVersion` 1–18 的下一版。legacy bytes 不进入本页 reader；本页的兼容承诺只从首个正式 Record v1 writer 开始，面向它之后的 NiceEval 迭代。

## 三类状态

| 类别 | 默认位置 | 是否属于 Record | 生命周期与分享 |
|---|---|---|---|
| durable facts | `<project>/.niceeval/record/` | 是 | Run 发布后不可变；只以整个 root 复制、备份或纳入 Git |
| local operation state | Record sibling 的 `.niceeval-local/<recordKey>/` | 否 | session、writer lock 与 recovery manifest；不提交、不复制、不分享 |
| derived cache | local sidecar 的 `cache/` | 否 | 可随时删除；命中、损坏或写失败都不能改变公开读取结果 |

session 不是 cache。它可能是一次已付费执行能否完成提交的唯一恢复材料，未知 session schema 也不能按 cache 自动删除。

bundled CLI 把项目 root 映射到 `<project>/.niceeval/record/`。Library 接收的 `root` 已经是实际 Record root，不再补接路径。

## 实现边界：Effect-native，流式只放在字节边界

Record 的 native Library API 返回 `Effect`，不能在每个文件系统函数内部启动 runtime 再退回 `Promise`。主要消费者本来就在 NiceEval 的 Effect 调用链中；直接保留 Effect 能让 typed error、interruption、trace 与 `Scope` 贯穿 reader、writer 和 recovery。

可选 Promise facade 只能位于最外层兼容入口，并且只运行一次 Effect。Record 内部不得调用 `Effect.runPromise`、`runPromiseExit` 或建立私有 runtime。

下列边界不得混合：

| 责任 | 形态 | 理由 |
|---|---|---|
| ID、路径语法、manifest 比对、membership/reference 校验、channel 状态折叠 | 纯函数与完整 ADT | 同一输入必须得到同一结果，不需要 runtime |
| 文件、canonical physical path、no-follow、`fsync`、atomic rename、OS lock、cache 与并发 | `Effect` | 这些操作会失败、被取消或持有资源 |
| reader handle、writer lock、session owner temp 与 stream handle | `Effect.Scope` | success、typed failure、defect 与 interruption 都必须运行同一组 finalizer |
| 单项 core/channel 损坏 | `CoreRead.invalid` / `ChannelRead.invalid` 成功值 | 损坏是要呈现和隔离的 Record 事实，不是整次 I/O 调用失败 |
| 权限、真实 I/O、lock busy、capability unsupported、closed lifecycle | Effect typed error channel | 调用无法继续，调用方可用 tag/code 精确处理 |

平台依赖只抽象真实外部边界：`RecordFileSystem` 提供 canonical path、no-follow、`fsync` 与 rename，`RecordWriterLock` 提供跨进程互斥，`RecordEntropy` 提供密码学安全 ID。它们由 `Context` service 表达，并在应用组合边缘用一个 live `Layer` 配置。

公开 constructor 的 Effect 依赖集合必须如实保留这些 service：reader 需要 `Scope | RecordFileSystem`，writer、root 初始化与 recovery 还需要 `RecordWriterLock | RecordEntropy`。动态 Record root 是 scoped constructor 的普通输入，不为每个 root 创建 Layer。constructor 取得 service 后可以把能力封装进 reader/session；内部方法不再启动 runtime。

Schema、路径规则、manifest 比对和 channel 状态不能为了“Effect 化”各自变成 service。Effect 本身也不提供跨进程锁、no-replace rename 或 crash-safe `fsync`。live Layer 不得用 PID/TTL lockfile 冒充绑定进程或文件描述符的 OS lock，也不得用 check-then-rename 冒充 no-replace atomic rename；平台缺少能力时必须在昂贵工作前失败。

核心 JSON、descriptor、local session 与 recovery manifest 在不可信 bytes 边界用 Effect Schema 或等价的完整 decoder 一次解码。普通 `Schema.Struct` 的默认多余字段策略不足以兑现精确对象。

所有精确格式都必须统一使用 `{ errors: "all", onExcessProperty: "error" }`。decoder 再把 parse issues 映射到本页规定的 root error、`CoreRead.invalid` 或 `ChannelRead.invalid`；下游不得重新探测字段。

资源取得使用 scoped acquire/release。reader Scope 只关闭它拥有的 handles 和 cache temp，不取得 writer lock。write-session Scope 先停止接受新操作、等待已经开始的 local writes，再删除仍属于自己的 unsealed temp 并释放 lock。

sealed manifest、已经 rename 的 Run 和 outcome-unknown 现场不归 finalizer 删除。耗时的模型执行、JSONL/blob 形成、hash 与 seal 校验保持可中断。

从 no-replace rename 开始，到两端 parent `fsync` 与 durable 状态交接完成的短暂发布区间，使用 `Effect.uninterruptibleMask` 保护。进程崩溃仍由 recovery manifest 与 crash matrix 处理，不能把 uninterruptible 当作 crash safety。

`Stream` 只用于真正有背压或有界内存收益的字节边界：

- `application/x-ndjson` 的逐行编码/解码；单行 schema 问题是带 index 的数据结果，底层权限与 I/O 才是 stream error；
- 大型 Attempt blob 与 source blob 的 chunk 读写，并在同一遍流中计算 byte length 与 SHA-256；
- Adapter 与 writer 确实并发生产/消费时，才可在实现内部加 bounded Queue；Record 不提供 PubSub 或 live tail。

blob/NDJSON Stream 是 reader Scope 内的字节能力，不是 `ChannelRead<Stream<A>>`。完整度、digest、byte length 与末行解码状态只有穷尽消费后才能确定；`inspectFact()` 必须先消费或 fold 完整条 Stream，再返回稳定的 `ChannelRead`。单行、digest 或 schema 问题折叠成成功通道里的 `invalid`/partial issues，权限和真实 I/O 才留在 Effect/Stream error channel。

只有下游 fold、hash 或复制也保持流式时，Stream 才带来有界内存。先收成数组或 `Uint8Array`，再调用 `Stream.fromIterable()` 不算流式实现；若 normalized fact 本身要求完整 bytes，最终内存成本仍由该 fact 的契约承担。

Run、Member、Attempt 核心 JSON 不流式；它们小且必须完整精确解码。`candidateSet` 也不以 Stream 暴露，因为 reader 必须先穷尽枚举、按 raw entry 排序并冻结 malformed diagnostics。普通 fact inspection 在 reader Scope 内消费完 JSONL/blob Stream 后，才形成自包含的 `ChannelRead`；`AnalysisSample`、`ReportInput` 和 `ReportExecution` 不携带磁盘 Stream、handle 或延迟读取。`niceeval view` 的更新仍通过 dispose 旧 Scope 后重新打开 reader 完成，不把 Record 变成 watch/tail 系统。

Effect 是公开类型的一部分，因此属于 Library ABI。包边界必须让 NiceEval 与调用方使用同一条受支持的 Effect v3 兼容线，不能把第二份 runtime 藏在 Record 内；升级到 Effect v4 是独立迁移，不随 Record 实现顺手发生。

## Durable Record 布局

portable root 的完整保留布局如下：

```text
record.json
runs/<encoded-runId>/
  run.json
  members/<encoded-slotId>.json
  attempts/<encoded-attemptId>/
    attempt.json
    channels/**
    blobs/**
  channels/**
  blobs/sha256/<digest>
```

Attempt 只住在它的 origin Run 内。carried 或 accepted Member 保存 `{ originRunId, attemptId }` 引用，不复制 Attempt。Record 不支持只复制一个 Run、channel 或 blob；引用闭包的 portable 单位始终是整个 root。

根文件是精确对象：

```ts
type RecordDocument = {
  format: "niceeval.record/v1";
  recordId: RecordId;
};
```

`recordId` 是小写 canonical UUID v4，必须匹配 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`，其中 `x` 是 lowercase hex，`y` 只能是 `8`、`9`、`a` 或 `b`。初始化时使用密码学安全随机源生成。复制整个 Record 时保留它；它表示 Record lineage，不表示物理路径或内容摘要。

根目录只接受 `record.json` 与 `runs/`。其它根级 entry、未知字段、错误类型或 symbolic link 都是 `record-core-invalid`。

## Core v1 精确形状

下列对象和所有嵌套对象都是精确对象；未列出的字段不存在。核心只描述 identity、membership、origin、选择排序所需事实与通道入口，业务字段不得回填到核心。

```ts
type RunDocument = {
  schema: "niceeval.run/v1";
  runId: RunId;
  experimentId: ExperimentId;
  startedAt: UtcMillis;
  completedAt: UtcMillis;
  expectedSlots: readonly ExpectedSlot[];
  channels: readonly JsonValue[];
};

type ExpectedSlot = {
  slotId: SlotId;
  evalId: EvalId;
  attempt: number;
};

type MemberDocument = {
  schema: "niceeval.member/v1";
  runId: RunId;
  slotId: SlotId;
  kind: "executed" | "carried" | "accepted";
  attempt: {
    originRunId: RunId;
    attemptId: AttemptId;
  };
};

type AttemptDocument = {
  schema: "niceeval.attempt/v1";
  attemptId: AttemptId;
  origin: { runId: RunId; slotId: SlotId };
  eval: { evalId: EvalId; attempt: number };
  channels: readonly JsonValue[];
};

type ChannelDescriptor = {
  name: ChannelName;
  schemaId: ChannelSchemaId;
  path: ChannelPath;
  mediaType: ChannelMediaType;
  coverage: Coverage;
};

type AttemptBlobRef = string;
type RunSourceBlobRef = string;

type Coverage =
  | { state: "complete" }
  | { state: "partial"; reason: string }
  | { state: "unavailable"; reason: string };
```

`channels` 刻意保留为逐项 `JsonValue`，不在 core decoder 中一次强制为 `ChannelDescriptor[]`。reader 对每个 raw entry 单独解码和归属；一个 descriptor 损坏只影响能安全关联到的 channel，不把同 owner 的其它 channel 或 core 一起判坏。

`ExpectedSlot.attempt` 是非负安全整数。一个 Run 内的 `slotId` 和 `(evalId, attempt)` 分别唯一。Member 文件名、`runId`、`slotId` 与对应 expected slot 必须逐项一致；没有 outcome 的 slot 可以没有 Member，但不能出现 expected slots 之外的 Member。

`AttemptId` 在整个 Record 内唯一。每个 origin Run 内的 Attempt 必须恰好被同 Run 的一个 `executed` Member 反向锚定；该 Member 的 `originRunId` 必须是当前 Run，Attempt 的 origin 与 eval 也必须和 slot 一致。未被锚定、被多个 slot 锚定或在其它 Run 重复出现的 Attempt 都是 invalid。

`carried` 与 `accepted` 必须指向另一个或同一个已发布 origin Run 中、具有有效 executed 反向锚的 Attempt。它们不改变 origin，不复制事实。`rename` 不是第四种 Member；reuse、adoption 与 rename 的理由由 Run-owned `niceeval.actions` 表达。

`runId`、`slotId`、`attemptId`、`invocationId` 与 `sessionId` 是 128-bit opaque ID，canonical 字符串为 26 个大写 Crockford Base32 字符。字母表是 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`，首字符只能是 `0` 至 `7`；`I`、`L`、`O`、`U` 与 lowercase 都非法。Attempt locator 是 `@` 加完整 `attemptId`。

`experimentId` 与 `evalId` 是非空 NFC Unicode、大小写敏感文本，不参与目录编码。时间是精确 RFC 3339 UTC 毫秒文本 `YYYY-MM-DDTHH:mm:ss.sssZ`。已发布 Run 的 `completedAt` 必填；运行中反馈和未封口状态不进入 Record。

## Run 是提交单位

writer 在 local session 中形成完整 Run，包括它本次 executed 的 Attempt、全部 Member、Run/Attempt channels 与 blobs。只有以下条件全部满足才可 seal：

1. core、descriptor、payload、blob、coverage 与全部引用有效；
2. 每个嵌套 Attempt 都有唯一 executed 反向锚；
3. carried/accepted 的 origin 引用已经按 writer 打开时的 frozen view 验证；
4. `completedAt` 已形成；全部普通文件已经 `fsync` 并 close，全部 source directory 已按由深到浅顺序 `fsync`，目录内不再有可写句柄；
5. recovery manifest 已在被移动目录之外持久化。

publish 不是一个瞬时布尔值，而是从 sealed source 到 durable receipt 的状态转换：

| 状态 | 位置与可见性 | 允许的下一步 |
|---|---|---|
| building | local `build/`；reader 不可见 | 继续形成，或由 owner Scope 删除 |
| sealed | local `publish/`，且已有外置 manifest；reader 不可见 | 只可 commit-only publish 或 explicit abandon |
| visible | final Run 名称已由 rename 原子出现；reader 可见完整 immutable Run | 完成两端 parent `fsync` 与 destination 重验 |
| durable | destination 重验匹配，且两端 parent `fsync` 已完成 | 返回 `PublishReceipt.durable: true` |
| cleanup-pending | durable Run 已成立，local 现场尚未删完 | 只重做 local 收尾，不倒推 Run 失败 |

lock-free reader 可能在 `visible` 到 `durable` 的短暂区间读到完整 Run，因此“reader 看见”不等于 writer 已经返回 durable receipt。reader 永远不能看见半个 Run；跨进程崩溃的持久保证只从 durable receipt 开始。崩溃发生在该区间时，下文 recovery matrix 决定 destination 能否完成提交，不能由先前一次读取反推结果。

seal 后的 source 不能再修改。writer 以同一文件系统的一次 no-replace atomic directory rename，把 `publish/<runId>` 变为 `R/runs/<runId>`。destination 必须不存在；碰撞不替换、不合并、不比较“谁更新”。

发布后整个 Run immutable。NiceEval 没有修改 channel、补写 `completedAt`、删除 Run、删除 Attempt 或压缩历史的写 API。外部工具改坏字节不会得到自动修复；reader 按普通 invalid/unsupported 规则反馈。

一次 Invocation 可以发布多个 Run，但没有 Invocation 级事务。并发 reader 可能只看到其中一部分；每个已经可见的 Run 必须完整。`InvocationReceipt` 只在进程内返回本次 Run identity 与 completion，不是 durable 目录。

## Frozen weak read view

`RecordReader` 不取得 writer lock。打开时枚举一次 `runs/` 并冻结 `candidateSet`；文件系统枚举不是 point-in-time、linearizable 或 Invocation snapshot，因此它可以漏掉并发刚发布的 Run，也可能只看到一次 Invocation 的一部分。

这项弱语义不允许吞掉损坏 entry。初次扫描按目录 entry 的原始 UTF-8 bytes 排序，给每项保留 `read | invalid` 结果；非法编码、非法类型、case-fold 冲突、目录与 identity 不符和无法安全取得 ID 的 entry 都留在 candidate diagnostics。analysis/execution projector 必须显式决定这些 invalid candidates 是否让 latest 或 target selection fail closed，不能先过滤成“合法 ID 列表”。

只有 `candidateSet` 能参与：

- `latest` 排序；
- 显式 `--run` 选择校验；
- `AnalysisSample` 分母；
- execution projector 的 source candidate。

普通 `reader.run(id)` 只能访问 candidateSet，不能看到 reader 创建后发布的 Run。选择形成后，reader 有一个不公开的 `resolveDependency({ originRunId, attemptId })` 能力，只能沿已选 Member 的持久引用直接补入 origin。补入集合称为 `dependencyClosure`；它不成为 latest 候选、不扩张分母，也不能作为任意 Run lookup。

dependency closure 完成后同样冻结。`AnalysisSample`、`ReportPlan`、`ReportInput` 与一次 `ReportExecution` 不得重新扫描或寻找“更新版本”。origin 缺失、重复、非法或反向锚不匹配时保留具名 invalid/gap，不回扫其它 Run。

`niceeval view` 每次 rebuild 先完整 dispose 上一轮 execution、input、closure 与 reader，再打开新的 reader。单轮渲染从不刷新；下一轮可以看见后来发布的 Run。

## Local sidecar 映射

设实际 Record root 为 `R`。实现先对最近存在祖先求 physical absolute path，再拼回尚不存在的规范段；每个已存在组件都以 no-follow 打开并拒绝 symbolic link。canonical R 的 UTF-8 bytes 计算完整摘要：

```text
recordKey = lowercaseHex(SHA-256(UTF-8(canonical physical absolute R)))
L = dirname(R)/.niceeval-local/<recordKey>/
```

`recordKey` 恰为 64 个 lowercase hex。`L/local.json` 是精确对象：

```ts
type LocalDocument = {
  schema: "niceeval.local/v1";
  canonicalRoot: string;
  recordId: RecordId;
};
```

R 已存在时，writer/recovery 要求 `local.json.canonicalRoot` 与 canonical R 相同，且 local/durable `recordId` 相同。identity mismatch 时不得把旧 session 归给新 Record，也不得仅凭路径接管。Record 同路径删除重建会得到新 `recordId`；整个 Record 复制到新路径时保留 `recordId`，但 canonical R 不同，所以使用新的 sidecar。

reader 不受这项本地 identity 故障支配。`cache: "disabled"` 完全不打开 L；`cache: "allowed"` 只有在 `local.json` 精确匹配时才使用 cache。sidecar 缺失、权限失败、错误类型、未知 schema 或 identity mismatch 都退化为 no-cache，不能阻止 durable Record 打开，也不能改变任何公开读数。

writer 遇到 recordId mismatch 时先取得旧 `write.lock`。若旧 sidecar 只有 cache，可删除 cache，并 atomic replace `local.json` 绑定当前 Record。若存在任一 session、recovery、root-init、build 或 publish entry，则返回 `record-local-identity-collision` 并保留现场。这样 cache 不会变成权威障碍，旧 write state 也不会穿越 lineage。

`open-or-create` 遇到 R 不存在但同 key sidecar 已存在时，先取得现有 `write.lock`。只要有任一 session、recovery、build 或 publish entry，就返回 `record-recovery-required`，绝不把它归给新 Record；没有这些现场时，允许丢弃旧 cache，并以 atomic replace 写入新 `local.json` 后建立新 root。未知 local schema、无法安全枚举或错误类型仍 fail closed。这样同路径重建有唯一安全出口，而不会让旧 session 穿越 lineage。

root 初始化发生在创建 `RecordWriteSession` 和启动昂贵工作之前。它在 `L/root-init-v1/<ownerId>/record/` 形成只有 `record.json` 与空 `runs/` 的完整 root，逐层 `fsync` 后 no-replace rename 为 R，再 `fsync dirname(R)` 并重开核对 `recordId`。只有核对成功才创建 write session。`ownerId` 是 local-only 128-bit ID，使用与 `sessionId` 相同的 canonical grammar，不进入 Record。

`root-init-v1` 不含 Run 或已付费执行，因此 lock 空闲后可以删除当前版本的遗留 temp 并从头初始化；它仍是 local operation state，不是 cache。R 已存在时，只有 temp 与 R 的 `recordId` 相同才可删除 temp；未知 init 版本、identity mismatch 或错误 entry type 都 fail closed。

sidecar root、record-key directory、`local.json`、lock anchor、session、manifest、cache temp 与 staging 的每一级都 no-follow，并验证期望的 regular file 或 directory。device、socket、FIFO、hard-link 替换、symbolic link 与错误类型都拒绝。

## Writer lock 与 local session

local 布局如下；它不是 portable schema：

```text
local.json
write.lock
root-init-v1/<ownerId>/record/**
sessions/<sessionId>/
  session.json
  build/runs/**
  publish/<encoded-runId>/**
  recovery/<encoded-runId>.json
cache/**
```

`write.lock` 是稳定的普通文件 anchor。Record writer lock 的互斥所有权由绑定进程或文件描述符的操作系统 lock 决定，文件内容和 session marker 都不是 owner 真源。进程崩溃必须释放 lock。一个 Record 同时最多一个 `RecordWriteSession`，reader 可并发。

`session.json` 是精确 local recovery 对象：

```ts
type LocalSessionDocument = {
  schema: "niceeval.local-session/v1";
  sessionId: SessionId;
  canonicalRoot: string;
  recordId: RecordId;
  state: "building" | "cleanup-pending";
};
```

未知或未来 session schema 不能自动删除、接管、resume 或判断为 orphan；CLI 只报告 `record-session-schema-unsupported`。用户仍可在取得 writer lock 后，对精确 session ID 执行显式 abandon；abandon 只删除该 no-follow session directory，不读取其内容或修改 Record。

lock 已空闲但仍存在的 session 称为遗留 session。任意遗留 session 都阻止新 writer。只有不存在遗留 session 时才能创建新 session；存在一个或多个时返回 `record-recovery-required`，并列出全部 session ID，不按时间猜 owner。

处于 building 且没有 sealed recovery manifest 的 session 只能 explicit abandon，不能恢复模型、Sandbox 或外部命令。具有 sealed manifest 的 session 只能 commit-only resume 或 abandon，不能继续执行。

一个 session 可以同时含有已 durable 的 Run、sealed Run 与尚未 seal 的 build。commit-only recovery 只按 manifest 处理 sealed Run；全部 manifest 成功收敛后，尚未 seal 的 build 作为不可恢复执行现场删除。任一 manifest 仍 ambiguous、unknown 或 invalid 时，整个 local session 保留，不得先删其它 build 来伪装恢复完成。

destination 已提交但 local 现场删除失败时，session 进入 `cleanup-pending`。durable publish 仍是成功事实，但后续 writer 继续得到 `record-local-cleanup-pending`，直到显式 commit recovery 重新校验 destination 并删除 local 现场，或用户显式 abandon 该现场。

新 session 以 `building` 开始。commit-only recovery 不需要把“当前进程正在恢复”持久化；互斥由 OS lock 表达，进程崩溃后仍由 manifest 与下述矩阵重算事实。destination 已验证 durable 后，writer/recovery 在删除 local entry 前把状态 atomic replace 为 `cleanup-pending`；状态写失败不推翻 durable commit，遗留 manifest 仍会让下一位 writer进入 recovery。全部 manifest、publish 与 build entry 清完后删除整个 session directory；正常 writer Scope 也只在没有 sealed 现场时这样收尾。

## Recovery manifest 与 crash matrix

每个 sealed Run 在 `sessions/<sessionId>/recovery/<runId>.json` 写一份不会随 source rename 消失的精确 manifest：

```ts
type RecoveryManifest = {
  schema: "niceeval.publish-recovery/v1";
  sessionId: SessionId;
  recordId: RecordId;
  runId: RunId;
  source: `publish/${RunId}`;
  destination: `runs/${RunId}`;
  entries: readonly RecoveryEntry[];
};

type RecoveryEntry =
  | { path: string; kind: "directory" }
  | {
      path: string;
      kind: "file";
      byteLength: number;
      sha256: Sha256Digest;
    };
```

每个 `RecoveryEntry.path` 都相对于这份 manifest 对应的 Run directory root；`.` 精确表示该 root。entries 以 canonical 相对 POSIX path 的 UTF-8 bytes 升序，并穷尽全部目录与普通文件；不允许重复、缺口、额外 entry、link 或特殊文件。SHA-256 是文件原始 bytes 的 64 个字符 lowercase hex 摘要。manifest 只用于 local 恢复，不进入 Run identity、proof 或防伪链。

seal 先 `fsync` 并 close source 的每个普通文件，再由深到浅 `fsync` 每个 source directory。随后枚举并重新读取 source 形成 manifest，在 recovery parent exclusive-create owner temp。

owner temp 完整写入并 `fsync` file，close 后 atomic rename 为最终 manifest，再 `fsync` recovery parent。完成前不得 publish。已有同名 manifest 只有 byte-for-byte 解码等价且重新校验 source 匹配才可继续，否则保留现场。

恢复必须执行下列穷尽矩阵：

| publish source | destination | 处理 |
|---|---|---|
| 存在且匹配 manifest | 不存在 | 重校验后 commit-only rename |
| 不存在 | 存在且匹配 manifest | 视为已提交；重校验与 fsync 后只清 local |
| 存在 | 存在 | `record-publish-ambiguous`；禁止认作成功 |
| 不存在 | 不存在 | `record-publish-outcome-unknown`；禁止认作成功 |
| 任一存在但不匹配 | 任一 | `record-publish-invalid`；保留全部现场 |

rename 成功后必须 fsync source parent 与 destination `runs/` parent，再从 destination 重新计算完整 manifest。只有 destination 匹配且两端 parent fsync 完成，才能记为 committed 并删除 local recovery/staging。local 现场删除被中断时进入 `cleanup-pending`，不能倒推 publish 失败。

在启动模型、Sandbox、外部命令或其它昂贵工作之前，writer 必须执行 capability preflight。它验证 source 与 destination 位于同一 filesystem，并验证 no-replace atomic directory rename、file fsync、directory fsync、no-follow open 与所需 OS lock 都可用。

缺任一项都以 `record-storage-capability-unsupported` 失败，且零昂贵工作、零 durable Run。

## Cache 不是事实

reader 可以在 `L/cache/` 写派生索引或 decoder 结果，但没有公共 cache 格式。写入只用 owner-specific temp 与 atomic replace；竞争、权限失败、损坏或 replace 失败全部退化为 no-cache。

cache 不能保存权威的“没有这个 Run”、latest、candidateSet、dependency closure、coverage、diagnostic 或 carry 决策。使用 cached decode 前仍须验证对应 durable owner、descriptor 与 payload identity；删除整个 cache 后必须得到逐项相同的公开结果。

因此 `show`、`view` 与 `exp --dry` 对 durable Record 是只读命令。它们可以 best-effort 更新 local cache，但不创建 writer session、不取得 writer lock，cache 无法写时也不能失败。

## Channel identity 与局部演进

`ChannelName` 是稳定的业务语义，例如 `niceeval.verdict`。`ChannelSchemaId` 是精确 bytes shape，格式为 `<channel-name>/v<positive-safe-integer>`，例如 `niceeval.verdict/v1`。`mediaType` 只描述编码，不能代替 schema identity。

同一业务语义的兼容或不兼容 payload 演进都发布新 schema ID；语义真正变化时发布新 channel name。writer 不能让同一 schema ID 接受两种形状，也不能为兼容展示同时写两个会让旧 projector 错误通过的 eligibility descriptor。

同一个 Run 或 Attempt owner 内，`ChannelName` 必须唯一；writer 不同时写同名 v1/v2 descriptor。重复同名 descriptor 是该 channel 的 invalid，不按数组顺序、schema 数字或 reader 偏好选择一个。这样 schema 演进始终是“一项事实选择一个精确版本”，而不是在同一 owner 内维护双写协议。

`ChannelName` 使用 3 至 253 个 lowercase ASCII 字符的反向域名，至少两个点分 label。`ChannelSchemaId` 在其后附加 `/vN`。`ChannelPath` 是不超过 240 bytes 的 lowercase ASCII POSIX 相对路径，以 `channels/` 开头，拒绝空段、点段、反斜线、NUL、绝对前缀、重叠路径与 link。`mediaType` 是无参数 lowercase ASCII `type/subtype`。

`AttemptBlobRef` 使用与 `ChannelPath` 相同的 canonical ASCII segment 与总长度规则，但必须以 `blobs/` 开头。它只出现在 registry 明确授权 blob 的 Attempt-owned built-in payload 中，不能出现在 Run channel 或 generic custom fact。

`RunSourceBlobRef` 精确为 `blobs/sha256/<digest>`，其中 digest 是 blob 原始 bytes 的 64 个字符 lowercase SHA-256；它只由 Run-owned `niceeval.sources/v1` 使用。Attempt blob 不跨 Attempt 去重，source blob 只在同一 Run 内按 digest 去重。

decoder 以 no-follow 方式从当前 owner 读取普通文件，只得到 bytes，不得到 root 或物理路径。descriptor 或 schema payload 引用的 blob 越界、缺失、类型错误、byte length 或 digest 不符时，该 fact 是 invalid。未被 descriptor/schema payload 引用的 blob 不参与读取，也没有独立 GC；它只随 immutable Run 生命周期存在。

coverage 只说明 producer 持久化集合的完整度，不说明当前 reader 是否有 decoder。没有 descriptor 是 unavailable；descriptor 与 payload 存在但 reader 不认识 schema 是 unsupported；schema、路径、bytes 或引用损坏是 invalid。一个通道的问题不让未请求通道或 core 自动失效。

`coverage.unavailable` 的 descriptor 不要求 payload 存在，reader 也不打开其 path；reason 本身就是持久事实。`complete` 与 `partial` 必须各有一个 descriptor 指向的普通 payload。coverage 不能用来掩盖缺文件、坏 JSON、未知 schema 或 decoder 失败。

### Normalized requirement 也不可原地改形状

拆出 channel schema 只能隔离落盘变化，不能单独隔离 TypeScript API 变化。每个正式 `FactRequirement<A>` identity 还必须永久绑定 owner kind、normalized 语义与精确输出类型 `A`；已发布 requirement 不能原地增加必填字段、改变判别联合或复用同一个 identity 返回另一种形状。

normalized API 需要破坏性演进时，新增 requirement identity，并保留旧 identity 与输出类型。一个 schema decoder 可以把同一份 bytes 投影成多个 requirement view；新 requirement 只把能完整形成其输出的历史 schema 放入 accepted set。反过来，新 schema 若能无损形成旧输出，也应继续服务旧 requirement。标准 Report 可以迁移到新 identity，但旧 Report 与第三方调用方仍能请求旧 identity。

因此兼容性有三个独立 ID：core format 决定导航能否打开，channel schema ID 决定 bytes 怎样解码，FactRequirement identity 决定调用方得到哪种 normalized 值。任一层变化都不得偷用另一层的 ID，也不得靠可选字段让一个 identity 同时表示两代 API。

下表的 `verdictFact`、`assertionsFact` 等名称是首代 exported constant label；其内部 `id` 必须带不可变版本。若输出类型升级，发布新的 constant 与 requirement ID，旧 constant 不改指向、不改泛型参数，也不从导出面删除。

### Storage API 保持能力稳定

未来兼容不能靠给 storage facade 反复增加 `readAssertions2()`、`writeUsage3()` 一类代际方法。Record 的长期 API 只保留少量能力动词：

- reader 枚举与冻结 core、沿 frozen selection 导航，并用 generic `inspectFact(requirement)` 读取事实；
- writer 打开单写 session、stage 完整 Run，再 publish sealed Run；
- recovery 只处理具名 session。

业务功能通过 registry entry、schema decoder、FactRequirement 与 generic channel payload 扩展，不扩张这组动词。

因此，API 重构是否需要持久格式变化，按变化实际落在哪一层判断：

| 未来变化 | 发布动作 | 旧数据与旧调用方 |
|---|---|---|
| 只重构内部模块、Effect 组合或调用语法，持久 bytes 与 normalized 语义不变 | 不改任何持久 identity | 同一个 requirement 继续返回同一个 `A`；这不是格式迁移 |
| 新增一种业务事实 | 新 `ChannelName`、首个 schema ID、decoder 与 requirement | 旧 reader 忽略未知事实；新 reader 不要求旧 Run 凭空拥有它 |
| 同一业务语义的 bytes shape 改变 | 新 `ChannelSchemaId`，保留旧 decoder | later reader 可把各代 schema 投影到明确接受它们的 requirement |
| normalized 输出类型或语义破坏性改变 | 新 FactRequirement identity 与 exported constant，保留旧 identity、类型和投影 | 调用方显式选择所需代；同一 identity 永不返回两种形状 |
| carry gate 或复用语义改变 | 切换 `reuseContract.domain`；持久形状也变时同时发布新 eligibility schema | 不认识新 gate 的 projector 得到 gap，不能误 carry |
| core owner、identity、路径或发布原子性改变 | 发布完整 `niceeval.record/v2`，保留 v1 reader；需要迁移时显式离线写入新 root | v1 root 不被原地改写，v1/v2 对象不在同一 root 混用 |

“保留”是发布契约，不是临时过渡：core v1 reader、正式 built-in decoder、已发布 requirement identity 与对应输出类型，在 v1 生命周期内不能因内部 API 再设计而删除。

反过来，兼容也不意味着 later requirement 自动接受全部历史 schema。accepted set 必须逐项声明；不能完整形成目标输出时就返回 `unsupported`，execution-required fact 再由 projector fail closed 为 gap。

### Built-in channel registry

core v1 生命周期内，所有正式发布的 built-in schema decoder、normalized FactRequirement 与标准展示入口永久保留。下表是首批可审计 registry；payload 的精确对象由链接的领域 owner 定义。

兼容级别同时约束 writer seal：

- `execution-required`：每个 origin Attempt 必须恰有一个同名、complete、可解码的 descriptor/payload；缺失、partial 或 unavailable 都拒绝 seal；
- `provenance`：每个 Run 必须写出 complete fact，解释 membership 与 Invocation；它不参与 carry equality；
- `presentation`：允许 descriptor 缺席、partial 或 unavailable，但出现时必须满足对应 schema。

reader 仍按 `ChannelRead` 隔离外部损坏或未知 future schema，不能因为 mandatory writer rule 就把整个 core 判坏。execution projector 则把 required fact 的 unavailable、unsupported、partial 或 invalid 全部转成 gap。

| schemaId | owner | media type | FactRequirement identity | 兼容级别 | 永久 decoder | 标准消费者 |
|---|---|---|---|---|---|---|
| `niceeval.verdict/v1` | Attempt | `application/json` | `verdictFact` | execution-required | 是 | project-target、overview、Attempt state |
| `niceeval.eligibility/v1` | Attempt | `application/json` | `eligibilityFact` | execution-required | 是 | project-target |
| `niceeval.assertions/v1` | Attempt | `application/json` | `assertionsFact` | presentation | 是 | Attempt checks 与 score |
| `niceeval.usage/v1` | Attempt | `application/json` | `usageFact` | presentation | 是 | usage 与 cost cards |
| `niceeval.conversation/v1` | Attempt | `application/x-ndjson` | `conversationFact` | presentation | 是 | conversation/tool timeline |
| `niceeval.commands/v1` | Attempt | `application/json` | `commandsFact` | presentation | 是 | commands 与 evidence |
| `niceeval.diff/v1` | Attempt | `application/json` | `diffFact` | presentation | 是 | change summary 与 detail |
| `niceeval.timing/v1` | Attempt | `application/json` | `timingFact` | presentation | 是 | duration 与 waterfall |
| `niceeval.diagnostics/v1` | Attempt | `application/x-ndjson` | `attemptDiagnosticsFact` | presentation | 是 | Attempt diagnostics |
| `niceeval.diagnostics/v1` | Run | `application/x-ndjson` | `runDiagnosticsFact` | presentation | 是 | Run diagnostics |
| `niceeval.actions/v1` | Run | `application/json` | `actionsFact` | provenance | 是 | membership provenance |
| `niceeval.sources/v1` | Run | `application/json` | `sourcesFact` | presentation | 是 | origin source viewer |
| `niceeval.run-provenance/v1` | Run | `application/json` | `runProvenanceFact` | provenance | 是 | Invocation detail |

自定义 schema 使用调用方的反向域 namespace，并由调用方注册 decoder。它不获得 built-in 永久兼容承诺，也不能使用 `niceeval.*`。

### Verdict 与 eligibility v1

两份 execution-required document 是精确对象：

```ts
type VerdictDocumentV1 = {
  state: "passed" | "failed" | "errored" | "skipped";
};

type EqualityToken = {
  domain: string;
  value: string;
};

type DurationToken = {
  domain: string;
  milliseconds: number;
};

type EligibilityDocumentV1 = {
  reuseContract: EqualityToken;
  inputIdentity: EqualityToken;
  configIdentity: EqualityToken;
  executionDuration: DurationToken;
};
```

`domain` 与 `value` 是非空 NFC 文本，`milliseconds` 是非负安全整数。所有嵌套对象精确；未知字段、缺失字段或其它 media type 都 invalid。

每个 execution projector 必须把 eligibility 列为 required fact，并穷尽列出接受的 `schemaId` 与 `reuseContract.domain`。target 与 Attempt 只有 schema 可解码、domain 被接受且 equality token 完全相等时才能继续其它 gate。missing、unsupported、domain mismatch 或 value mismatch 都是 gap。

新增、删除或改变任一 carry gate，至少切换 `reuseContract.domain`；持久形状变化时同时发布新的 eligibility schema。policy identity 只解释一次历史 action，不能充当前向安全栅栏。展示 decoder 可以归一历史 schema，但 carry accept set 必须另行显式声明。

## 兼容矩阵

本节的“旧/新”只指 `niceeval.record/v1` 正式发布后的 NiceEval 迭代。旧 `niceeval.results` 全局 schemaVersion 1–18 不属于 Record reader 契约：新 reader 不打开、不猜测，也不在普通 open 中自动迁移。若未来需要导入旧 Results，它是一次显式、离线、写入全新 Record root 的转换工具，不是兼容 decoder。

| consumer | durable input | 结果 |
|---|---|---|
| 后续 reader | 较早的新 Record v1 writer | 永久 registry decoder 读取早期 channel schema；按具名 requirement 归一 |
| 较早 reader | 后续的新 Record v1 writer | 已知 schema 正常读取；未知 schema 只让对应 fact unsupported |
| 支持 core-v2 的后续 reader | 既有 core-v1 Record | 保留 v1 core 与已发布 channel decoder，继续按 v1 契约读取 |
| 任一 core-v1 reader | core-v2 Record | 根格式不支持，不能猜测打开 |
| 新 requirement | 旧 channel schema | 只有 accepted set 包含该 schema，且 decoder 能完整形成新输出时才 read |
| 旧 requirement | 新 channel schema | 能无损形成旧输出时继续 read；否则只让旧 requirement unsupported |
| 新 execution policy | 旧 eligibility | 仅当 policy 显式接受其 schema 与 reuse domain 才可能 carry，否则 gap |
| 旧 execution policy | 新 eligibility/gate | required schema unsupported 或 reuse domain mismatch，必须 gap |

较早的新 Record Attempt“可以展示”不等于“可以 carry”。局部 decoder 累积把 API 与业务事实变化限制在对应 channel；它不承诺所有历史 Attempt 永远满足未来 policy。

旧 Results Format 的逐版升版证据、正式与未合并版本边界统一归档在 [schemaVersion 历史存档](../../../memory/results-schema-version-history.md)。该存档只解释为什么另起 Record 格式线，不构成旧格式读取承诺。Record 不再维护一个因任意业务字段变化就整包失效的全局整数 `schemaVersion`。

## Portable、Git 与外部操作

portable boundary 是整个 durable root `R`。copy、backup、Git checkout 或 merge 的支持前提是 Record quiescent：没有活跃 writer、reader 或外部编辑；普通文件复制本身不是原子快照。外部操作完成后必须重新打开并验证 root、全部新增 Run identity 与引用。NiceEval 不提供跨 Record merge、局部 cherry-pick 或冲突自动解决。

把整个 root 纳入 Git 是显式选择，不是默认推荐。conversation、sources、commands、diff 与 blobs 可能含凭据、源码、prompt 或其它敏感信息；大量历史和 binary blobs 也会显著增大仓库。选择性分享使用自包含静态 Report，只带 ReportPlan 实际请求的值与资源。

`.niceeval-local/`、session、lock、recovery manifest 与 cache 永远不进 Git、不复制给他人，也不能用于接收方恢复。复制出的 Record 第一次写入时，在新 canonical path 建自己的 local sidecar。

## Core 格式演进边界

以下任一变化需要新的完整格式名，例如 `niceeval.record/v2`：

- root、Run、Member、Attempt 或 descriptor 的字段、精确性或 owner 改变；
- identity、路径、origin、membership 或发布原子性改变；
- Attempt 不再由 origin Run 拥有，或 blob 跨 owner/Record 共享；
- 已发布 Run 变为可修改；
- portable boundary 从 whole root 改为局部对象或远端引用。

新增业务事实、增加 channel schema 或增加 decoder 不触发 core 升版。不能为了保住 `v1` 而把业务字段写入核心，也不能用无 schema identity 的自由 JSON 隐藏版本变化。

发布 `niceeval.record/v2` 不授权删除 v1 reader，也不把 v2 对象混写进 v1 root。后续 NiceEval 必须继续打开已发布的 v1 Record；写入已有 v1 root 时只能使用 v1 core 与可局部演进的 channel。只有显式离线转换到新的完整 root，才会把一个 Record 从 v1 迁到 v2。
