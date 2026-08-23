# Record Library

`niceeval/record` 导出通用 RecordAttachment SPI、显式 Host composition 与 Node Layer。NiceEval CLI 使用官方
`recordHost`；替代 CLI、Web host 与 Plugin host 可以用 `makeRecordHost()` 组合第三方 definitions。

Library 是 Effect v3 API。内部不调用 `Effect.runPromise`；application 只在最外层提供 Layer 并运行 Effect。
typed failure、defect 与 interruption 在拥有该结果的边界前保持分离。

## 最小公开导出

```ts
import {
  defineRecordAttachment,
  makeRecordAttachmentBlobDrafts,
  makeRecordAttachmentCatalog,
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
  recordAttachmentMigration,
  recordAttachmentVersion,
  recordHost,
  RecordContent,
  RecordContentHandleSchema,
  RecordOwner,
} from "niceeval/record";
```

`recordHost` 只预组合 NiceEval 官方 definitions。`makeRecordHost({ attachments })` 创建另一个冻结 Host 值；
它不修改 `recordHost`，也不把 definitions 放进进程全局状态。

## Root、服务与能力

`makeRecordRoot(path)` 接受 lexical-normalized 的绝对 host path 或 `file:` URL。构造不做 I/O、不 realpath，
也不把 path 放进 portable Record。

`NodeRecordLive` 提供文件系统、身份生成和进程协调。文件系统负责 no-follow root-relative I/O、同步、atomic
replace 与 no-replace publish；协调层只提供 read、append 与 maintenance lease。Record 没有 Git service。

## Definition identity

一个 definition 的 durable identity 是：

```text
(owner, family, schemaVersion)
```

`owner` 是 `run` 或 `attempt`；`family` 是不含版本后缀的稳定身份；`schemaVersion` 是正整数。definition object
带 nominal brand。单独的 family 字符串、结构相同的对象或类型断言都不是读写 capability。

一个 family 先声明版本，再组装 definition：

```ts
import { Schema } from "effect";
import {
  defineRecordAttachment,
  recordAttachmentIssue,
  recordAttachmentVersion,
  RecordOwner,
} from "niceeval/record";

const energyV1 = recordAttachmentVersion({
  version: 1,
  schema: Schema.Struct({ joules: Schema.Number }),
  invariants: value => value.joules >= 0 ? [] : [
    recordAttachmentIssue("record-attachment-schema-invalid", ["joules"]),
  ],
  contents: {
    select: () => [],
    valueLimits: {
      maximumJsonBytes: 4_096,
      maximumDepth: 4,
      maximumNodes: 64,
      maximumObjectKeys: 16,
      maximumArrayItems: 16,
      maximumKeyUtf8Bytes: 128,
      maximumStringUtf8Bytes: 1_024,
    },
    budget: {
      maximumBlobs: 1,
      maximumBlobBytes: 1,
      maximumTotalBytes: 1,
    },
  },
  references: {
    select: () => [],
    maximumReferences: 0,
  },
});

export const runEnergy = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "acme.energy",
  current: energyV1,
  versions: [energyV1],
  migrations: [],
});
```

Schema、invariant、content projection、reference projection 与 migration 不取得 root、path、文件系统、网络、
clock 或 random capability。它们只定义 family 的持久业务语义；Record Core 统一执行 codec、预算、closure 与 I/O。

definition 创建时检查版本从 `1` 连续递增、`current` 是最后一个版本，migration 严格相邻且形成单链。
定义错误同步抛出 `RecordAttachmentSpiDefinitionError`；运行时输入错误由 `prepare()` 返回 `Either.Left`。

## Content source 与 opaque ref

`RecordContent.bytes()`、`text()` 与 `stream()` 创建 capture-only source。`makeRecordAttachmentBlobDrafts()`
为一次 Attachment 准备不可伪造的 owner-local refs；它不消费 Stream。

```ts
const drafts = makeRecordAttachmentBlobDrafts(blobs => {
  const stdout = blobs.add(RecordContent.text(commandStdout));
  return [stdout] as const;
});

const prepared = commandFamily.prepare({
  commandId: "command-1",
  stdout: drafts[0].content,
}, drafts);
```

logical Schema 中 content 位置使用 `RecordContentHandleSchema`。这个 handle 是 opaque ref，不公开 path、digest、
content key 或物理表示。definition 的 `contents.select(value)` 必须返回 value 中的完整 ref closure；Core 要求
每个 ref 恰好对应同一次 draft builder 的一个 source，且没有漏项、重复项或额外项。

`prepare(value, drafts)` 执行 exact encode/decode、invariant、reference 与 content closure 验证，成功后返回 opaque
`RecordAttachmentWrite`。真正读取 Stream、计算 digest、执行 byte budget 和写 content object发生在 `attach()`。

reader 返回 `{ value, blobs }`。`blobs.bytes(ref)` 只接受该次读取签发的 ref，并返回 defensive copy；伪造、复制到
其它 Attachment 或跨 session 使用会返回 `record-blob-handle-invalid`。

## Catalog 与显式 composition

```ts
import { Either } from "effect";
import {
  makeRecordAttachmentCatalog,
  makeRecordHost,
} from "niceeval/record";

const catalog = makeRecordAttachmentCatalog([
  ...niceevalRecordAttachments,
  ...energyPlugin.recordAttachments,
]);
if (Either.isLeft(catalog)) throw new Error(catalog.left.code);

const customRecordHost = makeRecordHost({ attachments: catalog.right });
```

`makeRecordAttachmentCatalog()` 是纯函数。它只接受 branded definitions，按 `(owner, family)` 排序并拒绝重复。
没有 `registerAttachment()`、global map、module side effect、last-one-wins 或 dynamic family loader。

catalog 只授予解释 bytes 的能力。真正的 I/O 仍由 Host session 与 Effect Layer 持有。第三方 package 仅调用
`defineRecordAttachment()` 不会取得 reader、writer、path、lease 或 migration executor。

## Host composition

`RecordHostSDK` 分成两个入口：

- `current.openRead()`、`createRun()` 与 `createReferenceRun()` 只处理 current root。
- `maintenance.planClean()` / `applyClean()` 与 `planMigrate()` / `applyMigrate()` 执行显式维护。

`makeRecordHost()` 只预绑定 immutable catalog，不增加逐 family method，不提供 Live Layer，也不启动 runtime。

## Reader

```ts
const result = yield* Effect.scoped(Effect.gen(function* () {
  const reader = yield* customRecordHost.current.openRead({ root });
  const selection = yield* reader.selectRuns({ runIds: [runId] });
  const run = yield* reader.readRun(selection.runRefs[0]);
  if (run.state !== "available") return run;
  return yield* reader.read(run.value.owner, runEnergy);
}));
```

`openRead()` 验证 current root、Core navigation 与 structural inventory，并冻结观察到的 published RunId。
它不要求 catalog 认识 inventory 中每个 family。

`read(owner, definition)` 只解码传入 definition。owner 没有该 family 时返回 `not-recorded`；current Attachment
可返回 `available` 或 `invalid`。已知 predecessor 返回 `migration-required`，future version 返回 `unsupported`。
直接请求未贡献 definition 返回 `family-definition-required`。

`requireComplete(selection)` 遍历 selection 的完整 inventory。未知 identity、非 current version、invalid
Attachment、reference closure 或 Seal 不一致都会 fail closed。返回值只证明本次 frozen selection 与 immutable
catalog，不是可跨 session 更新的证明。

## Owner-scoped writer

```ts
const prepared = runEnergy.prepare({ joules: 42 }, []);
if (Either.isLeft(prepared)) return yield* Effect.fail(prepared.left);

yield* run.attach(runEnergy, prepared.right);
```

Run session 的 `attach()` 只接受 Run definition 与匹配它的 prepared write；Attempt session 只接受 Attempt
definition。TypeScript 保留 owner、family、version、content error 与 Effect requirements，dynamic JavaScript
边界再次验证 brand 与 owner。

writer 没有 `appendAssertion()`、`writeSources()`、`attachArtifact()`、raw JSON、path 或 blob writer。producer
负责 capture 和构造 current value；Record Core 负责持久化。

一个 owner/family 最多提交一次。`seal()` 等待所有 Attempt 与 attach Effect 停稳，再验证 Core、inventory、
definitions、references、contents 与预算，最后发布完整 Run。

## 显式 migration

family 的 migration 内容属于 family，执行协议属于 Record Core：

```ts
const energyV1ToV2 = recordAttachmentMigration({
  from: energyV1,
  to: energyV2,
  migrate: ({ value, sources }) => Effect.succeed({
    value: { joules: value.joules, source: "measured" },
    sources,
  }),
});
```

migration callback 返回 Effect，但 requirements 固定为 `never`。它不能读写文件、访问网络、读取当前时间、生成随机身份或
capture 新事实。Core 严格解码 source version、运行相邻 step、验证 target version、重建 content/reference
closure，并以 envelope-last、Seal-last 顺序提交。

Library maintenance 使用 plan/apply 两阶段：

```ts
const plan = yield* customRecordHost.maintenance.planMigrate({ root });
if (plan._tag === "RecordMigrationReady") {
  const receipt = yield* customRecordHost.maintenance.applyMigrate({ root, plan });
}
```

ordinary `openRead()`、`show`、`view` 与 `exp` 不自动迁移。`applyMigrate()` 取得 exclusive maintenance lease；
已经 current 的 Attachment 会跳过，所以进程中断后可重新 plan 并续跑。

迁移不要求 Git clean，不读 HEAD / index，也不写 sentinel、journal、backup 或 rollback metadata。每个目标
envelope 用临时文件加 atomic replace 保证单文件完整；Git 只由用户保存、比较或恢复历史。

## Typed failure 与 Scope

`not-recorded`、`unsupported` 与已知 current `invalid` 是读取状态。缺 definition、I/O、permission、closed
Scope、invalid handle、maintenance busy、旧 plan 与 migration invalid 是 typed failure。

每个 error 只带 stable code 与有界安全上下文。raw filesystem error、Schema tree、stack、source bytes、secret
与第三方 message 不进入默认 CLI JSON。interruption 不属于 typed union；finalizer 释放 lease、Stream 与文件
handle 后保留原 Cause。

## 资源与并发

`openRead()` 与 `createRun()` 分别取得 shared read / append lease。`migrate()` 与 `clean()` 取得 exclusive
maintenance lease；冲突时返回 `record-maintenance-busy`。

多个 Run 可以并行写各自 staging。一个 owner 的不同 family 可以并发 prepare 与 attach；envelope commit 仍以
owner/family 排他。Scope finalizer 关闭 Stream、文件 handle 与 lease，且不会删除已发布 Run。
