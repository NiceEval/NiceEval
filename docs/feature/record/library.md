# Record Library

`niceeval/record` 导出通用 RecordAttachment SPI、显式 Host composition 与 Node Layer。NiceEval CLI 使用官方
`recordHost`；替代 CLI、Web host 与 Plugin host 可以用 `makeRecordHost()` 组合第三方 definitions。

Library 是 Effect v3 API。内部不调用 `Effect.runPromise`；application 只在最外层提供 Layer 并运行 Effect。
typed failure、defect 与 interruption 在拥有该结果的边界前保持分离。

## 最小公开导出

```ts
import {
  defineRecordAttachment,
  defineRecordMigration,
  defineRecordAttachmentPersistence,
  recordAttachmentIssue,
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
  recordHost,
  recordContent,
  RecordAttachmentReference,
  RecordBytesContentSchema,
  RecordTextContentSchema,
  RecordOwner,
} from "niceeval/record";
```

`recordHost` 只预组合 NiceEval 官方 persistence。`makeRecordHost({ attachments })` 创建另一个冻结 Host 值；
它不修改 `recordHost`，也不把 persistence 放进进程全局状态。

## Root、服务与能力

`makeRecordRoot(path)` 接受 lexical-normalized 的绝对 host path 或 `file:` URL。构造不做 I/O、不 realpath，
也不把 path 放进 portable Record。

`NodeRecordLive` 提供文件系统、身份生成和进程协调。文件系统负责 no-follow root-relative I/O、同步、atomic
replace 与 no-replace publish；协调层只提供 read、append 与 maintenance lease。Record 没有 Git service。

## Definition identity

一个 definition brand 的逻辑 identity 是：

```text
(owner, family, current Schema, validate)
```

`owner` 是 `run` 或 `attempt`；`family` 是不含版本后缀的稳定身份。definition object 带 nominal brand。
单独的 family 字符串、结构相同的对象或类型断言都不是读写 capability。durable interpretation revision 属于
matching persistence，不属于 definition。

definition 只声明 current logical fact：

```ts
import { Effect, Either, Schema } from "effect";
import {
  defineRecordAttachment,
  defineRecordAttachmentPersistence,
  defineRecordMigration,
  recordContent,
  recordAttachmentIssue,
  RecordAttachmentReference,
  RecordTextContentSchema,
  RecordOwner,
} from "niceeval/record";
import type {
  RecordAttachmentIssue,
  RecordMigrationDocument,
} from "niceeval/record";

const validateRunEnergy = (
  value: { readonly joules: number },
): readonly RecordAttachmentIssue[] => value.joules >= 0
  ? []
  : [recordAttachmentIssue("record-attachment-schema-invalid", ["joules"])];

const runActivities = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.runner-activities",
  schema: Schema.Struct({ activityId: Schema.String }),
  validate: (): readonly RecordAttachmentIssue[] => [],
});

const parseRunEnergyRevision1 = (
  document: RecordMigrationDocument,
): Either.Either<{ readonly joules: number }, RecordAttachmentIssue> =>
  typeof document.value === "object" &&
    document.value !== null &&
    "joules" in document.value &&
    typeof document.value.joules === "number"
    ? Either.right({ joules: document.value.joules })
    : Either.left(recordAttachmentIssue("record-attachment-schema-invalid", ["joules"]));

const runEnergyRevision1To2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseRunEnergyRevision1,
  migrate: ({ value: from, build }) => Effect.succeed({
    value: {
      joules: from.joules,
      report: build.content.text("migrated"),
      source: null,
    },
    references: [],
    impact: [],
  }),
});

export const runEnergy = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "acme.energy",
  schema: Schema.Struct({
    joules: Schema.Number,
    report: RecordTextContentSchema.pipe(recordContent.maximumBytes(4_096)),
    source: Schema.NullOr(RecordAttachmentReference.to(runActivities)),
  }),
  validate: validateRunEnergy,
});

export const runEnergyPersistence = defineRecordAttachmentPersistence({
  attachment: runEnergy,
  revision: 2,
  migrations: [runEnergyRevision1To2],
});
```

Schema 与具名 `validate` 不取得 root、path、文件系统、网络、clock 或 random capability。sealed content/reference
declaration 由 Core compiler 生成 traversal 与 closure plan；应用不能遍历任意 Schema AST 或手写 selector。

definition 创建时验证 owner、family、Schema 与具名 validate。persistence 创建时验证 exact attachment brand、
revision 与严格相邻单链。定义错误同步抛出 `RecordAttachmentSpiDefinitionError`；session attach 验证 runtime input。

## Content source、reference 与消费

`RecordTextContentSchema`、`RecordBytesContentSchema` 和 `RecordAttachmentReference.to(ExactDefinition)` 是
Core-owned sealed Schema declarations。它们不暴露 physical path、digest、object key 或 selector。

```ts
yield* attempt.attach(commandFamily, ({ content, reference }) => ({
  commandId: "command-1",
  stdout: content.text(commandStdout),
  source: reference.to(runActivities, { runId: sourceRunId }),
}));
```

Core compiler 从 sealed declarations 穷尽 content/reference closure。session callback 才 mint content 与 reference
token；它不消费 Stream。Core 在 `attach()` 时读取 Stream、限制字段 `maximumBytes`、编码并写入私有 object。
Reader content 是 Scope-owned consumption，调用者必须读尽或显式关闭；Scope finalizer 关闭遗留 stream、handle 与 lease。

## Catalog 与显式 composition

```ts
import { makeRecordHost } from "niceeval/record";

const customRecordHost = makeRecordHost({
  attachments: [...niceevalRecordAttachments, runEnergyPersistence],
});
```

Host composition 是纯函数。它只接受 persistence，并按 exact attachment brand 与 identity 拒绝重复。
没有 `registerAttachment()`、global map、module side effect、last-one-wins 或 dynamic family loader。

catalog 只授予解释 current logical bytes 的能力。真正的 I/O 仍由 Host session 与 Effect Layer 持有。第三方 package
定义 attachment 或 persistence 都不会取得 reader、writer、path、lease 或 migration executor。

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
可返回 `available` 或 `invalid`。已知 predecessor 返回 `migration-required`，future revision 返回 `unsupported`。
直接请求未贡献 definition 返回 `family-definition-required`。

`requireComplete(selection)` 遍历 selection 的完整 inventory。未知 identity、非 current revision、invalid
Attachment、reference closure 或 Seal 不一致都会 fail closed。返回值只证明本次 frozen selection 与 immutable
catalog，不是可跨 session 更新的证明。

## Owner-scoped writer

```ts
yield* run.attach(runEnergy, ({ content }) => ({
  joules: 42,
  report: content.text("measured"),
  source: null,
}));
```

Run session 的 `attach()` 只接受 Run definition 与其 callback；Attempt session 只接受 Attempt definition。
TypeScript 保留 owner、family、content error 与 Effect requirements，dynamic JavaScript
边界再次验证 brand 与 owner。

writer 没有 `appendAssertion()`、`writeSources()`、`attachArtifact()`、raw JSON、path 或 blob writer。producer
负责 capture 和构造 current value；Record Core 负责持久化。

一个 owner/family 最多提交一次。`seal()` 等待所有 Attempt 与 attach Effect 停稳，再验证 Core、inventory、
persistence、compiled closures 与预算，最后发布完整 Run。

## 显式 migration

attachment persistence 的 migration 内容属于 family，执行协议属于 Record Core：

定义片段中的 `parse(document)` 先返回 source revision value，`migrate({ value, document, build })`
再用本次调用的封闭 builder 返回 target result；两者都在 persistence 创建前声明。

migration callback 返回 Effect，但 requirements 固定为 `never`。它接收 storage-neutral tokenized document，
而不是 envelope raw JSON、inline/blob/path。family-private parser 证明旧业务 closure；Core 证明通用 physical/token
closure。相邻 revision 只在内存流转，只有 current revision 的完整结果以 envelope-last、Seal-last 顺序提交。

Library maintenance 使用 plan/apply 两阶段：

```ts
const plan = yield* customRecordHost.maintenance.planMigrate({ root });
if (plan._tag === "RecordMigrationReady") {
  const receipt = yield* customRecordHost.maintenance.applyMigrate({ root, plan });
}
```

ordinary `openRead()`、`show`、`view` 与 `exp` 不自动迁移。`applyMigrate()` 取得 exclusive maintenance lease；
已经 current 的 Attachment 会跳过，所以进程中断后可重新 plan 并续跑。plan 和 receipt 列出 retained、dropped
与 rerun impact。

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

多个 Run 可以并行写各自 staging。一个 owner 的不同 family 可以并发 attach；envelope commit 仍以
owner/family 排他。Scope finalizer 关闭 Stream、文件 handle 与 lease，且不会删除已发布 Run。
