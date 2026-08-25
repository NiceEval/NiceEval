# Record Library

`niceeval/record` 导出 Record 作者 API、显式 Host composition、底层 RecordAttachment persistence SPI 与 Node Layer。
NiceEval CLI 使用官方 `recordHost`；替代 CLI、Web host 与 Plugin host 可以用 `makeRecordHost()` 组合第三方
Record contributions。

Library 是 Effect v3 API。内部不调用 `Effect.runPromise`；application 只在最外层提供 Layer 并运行 Effect。
typed failure、defect 与 interruption 在拥有该结果的边界前保持分离。

## 最小公开导出

```ts
import {
  defineAttemptRecord,
  defineAttemptRecordCollection,
  defineRunRecord,
  defineRecordAttachment,
  defineRecordMigration,
  defineRecordAttachmentPersistence,
  recordContributionFromAttachmentPersistence,
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

import type {
  AttemptRecordAppendCommand,
  AttemptRecordAppendReceipt,
  AttemptRecordCollectionDefinition,
  AttemptWriteSession,
} from "niceeval/record";
```

`defineAttemptRecord()` 与 `defineRunRecord()` 定义 rich logical value。`defineAttemptRecordCollection()` 定义
Attempt-only plain-data collection。`recordHost` 只预组合 NiceEval 官方 contribution。
`makeRecordHost({ records })` 创建另一个冻结 Host 值；它不修改 `recordHost`，也不把 contribution 放进进程全局状态。

## Root、服务与能力

`makeRecordRoot(path)` 接受 lexical-normalized 的绝对 host path 或 `file:` URL。构造不做 I/O、不 realpath，
也不把 path 放进 portable Record。

`NodeRecordLive` 提供文件系统、身份生成和进程协调。文件系统负责 no-follow root-relative I/O、同步、atomic
replace 与 no-replace publish；协调层只提供 read、append 与 maintenance lease。Record 没有 Git service。

## High-level Record definition

一个 definition brand 的逻辑 identity 是：

```text
(owner, family, current Schema, validate)
```

`defineAttemptRecord()` 固定 owner 为 Attempt，`defineRunRecord()` 固定 owner 为 Run；`family` 是不含版本后缀的
稳定身份。每次调用返回同一个 callable nominal definition `a`。单独的 family 字符串、结构相同的对象或类型断言
都不是 capability。

这个 `a` 同时承担四个角色：

- `a(value)` 或 `a(builderCallback)` 构造惰性的 owner-scoped write command；
- `reader.read(owner, a)` 中是 exact reader selector；
- `RecordAttachmentReference.to(a)` 与 `reference.to(a, value)` 中是 exact reference target；
- `makeRecordHost({ records: [a] })` 中是 Host `RecordContribution`。

新 family 只声明 current logical fact；高层入口自动形成 revision `1`，不接受 migration 或任意 revision：

```ts
import { Schema } from "effect";
import {
  defineAttemptRecord,
  defineRunRecord,
  recordContent,
  recordAttachmentIssue,
  RecordAttachmentReference,
  RecordTextContentSchema,
} from "niceeval/record";
import type { RecordAttachmentIssue } from "niceeval/record";

const validateRunEnergy = (
  value: { readonly joules: number },
): readonly RecordAttachmentIssue[] => value.joules >= 0
  ? []
  : [recordAttachmentIssue("record-attachment-schema-invalid", ["joules"])];

export const runActivities = defineRunRecord({
  family: "niceeval.runner-activities",
  schema: Schema.Struct({ activityId: Schema.String }),
  validate: (): readonly RecordAttachmentIssue[] => [],
});

export const attemptEnergy = defineAttemptRecord({
  family: "acme.energy",
  schema: Schema.Struct({ joules: Schema.Number }),
  validate: ({ joules }): readonly RecordAttachmentIssue[] => joules >= 0
    ? []
    : [recordAttachmentIssue("record-attachment-schema-invalid", ["joules"])],
});

export const runEnergy = defineRunRecord({
  family: "acme.energy",
  schema: Schema.Struct({
    joules: Schema.Number,
    report: RecordTextContentSchema.pipe(recordContent.maximumBytes(4_096)),
    source: Schema.NullOr(RecordAttachmentReference.to(runActivities)),
  }),
  validate: validateRunEnergy,
});
```

Schema 与具名 `validate` 不取得 root、path、文件系统、网络、clock 或 random capability。sealed content/reference
declaration 由 Core compiler 生成 traversal 与 closure plan；应用不能遍历任意 Schema AST 或手写 selector。
definition 创建时验证 owner、family、Schema 与具名 validate，定义错误同步抛出
`RecordAttachmentSpiDefinitionError`；session write 还会验证 runtime input。

## Attempt Record collection

`defineAttemptRecordCollection()` 面向只需要多次采集 plain-data item 的 Attempt producer。它固定 owner 为 Attempt，
不接受 Run owner、content/reference declaration、builder callback、Stream、custom validate、排序或去重策略。

```ts
import { Schema } from "effect";
import { defineAttemptRecordCollection } from "niceeval/record";

export const turnMetrics = defineAttemptRecordCollection({
  family: "acme.turn-metrics",
  item: Schema.Struct({
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    latencyMs: Schema.Number,
  }),
});
```

定义返回 callable nominal definition `a`。`a(item)` 构造惰性 append command；同一个 `a` 也是 reader selector、
整个 collection 的 reference target 与 Host `RecordContribution`。Host composition、reader、reference declaration 和
reference creation 都不会激活 collection。只有 `record.start(a)` 或首次执行 `record.append(a(item))` 才激活。

公开导出的 command、receipt 与 definition 类型分别是 `AttemptRecordAppendCommand`、
`AttemptRecordAppendReceipt` 与 `AttemptRecordCollectionDefinition`。读侧 value 从 definition 的 `schema` 推导；其穷尽形状是：

```ts
type AttemptRecordCollectionLimitation =
  | {
      readonly code: "capture-interrupted";
      readonly stage: "attempt-finalizer";
    }
  | { readonly code: "collection-cap-reached"; readonly omittedAtLeast: number };

type AttemptRecordCollectionValue<Item> = {
  readonly collection:
    | { readonly state: "complete"; readonly limitations: readonly [] }
    | {
        readonly state: "partial";
        readonly limitations: readonly [
          AttemptRecordCollectionLimitation,
          ...AttemptRecordCollectionLimitation[],
        ];
      };
  readonly items: readonly Item[];
};

type AttemptRecordAppendReceipt =
  | { readonly state: "retained" }
  | { readonly state: "omitted"; readonly reason: "collection-cap-reached" };
```

`record.start(a)` 可以省略。首次 append 会隐式激活；显式 start 表示即使零项也要在 Attempt complete 时发布
complete-empty。完全未激活时不形成 Attachment，reader 返回 `not-recorded`。

```ts
yield* attempt.record.start(turnMetrics);
const receipt = yield* attempt.record.append(turnMetrics({
  sessionIndex: 1,
  turnIndex: 2,
  latencyMs: 120,
}));
```

每次 append command 执行时，Host 在 Attempt mutex 内完成 item Schema encode 与 canonical snapshot，再返回
`retained` 或 `omitted`。调用者随后修改原对象不会改变已保留 item。同一个 command 可以重复执行；每次执行都产生
一项，不自动排序或去重。并发 append 的数组顺序只表示 Host mutex 的线性化顺序；业务顺序必须写进 item，例如
`sessionIndex`、`turnIndex` 或稳定 ID。

Host 使用固定实现 cap 并保留安全 prefix。达到 cap 的 append 返回
`{ state: "omitted", reason: "collection-cap-reached" }`；已激活 collection 在封口时成为
`partial`，带 `collection-cap-reached` 与 `omittedAtLeast`。

Attempt capture 被中断时，已激活 collection 自动带
`{ code: "capture-interrupted", stage: "attempt-finalizer" }` 并成为 `partial`。正常 `completed`、`errored` 或
`cancelled` outcome 在所有采集任务已经 join 后形成 `complete`。producer 必须在 `attempt.complete(...)` 前 join
自己启动的全部采集任务。

同一 Attempt 可以跨多次 `send` 与 `t.newSession()` 后的新 Agent Session 继续 append；Session 不改变 owner。
普通 Eval `TestContext`、Adapter 与 Plugin API 不暴露 `AttemptWriteSession`。完整公开路径属于组合 Record Host 并拥有
capture 生命周期的 producer：

```text
makeRecordHost({ records: [a] })
  → current.createRun()
  → run.createAttempt()
  → attempt.record.start/append
  → attempt.complete()
  → run.seal()
  → openRead()/read()
```

完整代码见[多次 send 怎样收集 Attempt 事实](use-case/多次send怎样收集Attempt事实.md)。

一个 collection 物理上仍只提交一份 revision `1` Attachment。revision 表示该 family 的 persistence schema / migration
revision，不是 append 次数或 item version。需要业务 validate、排序/去重、rich content/reference，或表达其它已知
partial gap 时，改用 `defineAttemptRecord()`、领域 collector 与最终一次 `record.write()`。

## Low-level Attachment persistence SPI

`defineRecordAttachment()`、`defineRecordAttachmentPersistence()` 与 `defineRecordMigration()` 是为现有 family
演进和显式迁移保留的底层 SPI，不是新业务 family 的常规作者路径。低层 definition 仍显式声明 owner；persistence
把 exact attachment brand 绑定到 durable revision 与严格相邻单链：

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

const validateLegacyRunEnergy = (
  value: { readonly joules: number },
): readonly RecordAttachmentIssue[] => value.joules >= 0
  ? []
  : [recordAttachmentIssue("record-attachment-schema-invalid", ["joules"])];

const legacyRunActivities = defineRecordAttachment({
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

export const legacyRunEnergy = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "acme.legacy-energy",
  schema: Schema.Struct({
    joules: Schema.Number,
    report: RecordTextContentSchema.pipe(recordContent.maximumBytes(4_096)),
    source: Schema.NullOr(RecordAttachmentReference.to(legacyRunActivities)),
  }),
  validate: validateLegacyRunEnergy,
});

export const legacyRunEnergyPersistence = defineRecordAttachmentPersistence({
  attachment: legacyRunEnergy,
  revision: 2,
  migrations: [runEnergyRevision1To2],
});
```

persistence 通过 `recordContributionFromAttachmentPersistence(legacyRunEnergyPersistence)` 适配成 Host
`RecordContribution`。现有 family 的 revision 与 migration 继续只由这层拥有；高层 API 不提供
`reviseAttemptRecord()`、`reviseRunRecord()` 或隐式迁移。

低层 `attach(definition, callback)` 技术契约继续存在。它只接受 matching owner 的底层 definition。
callback 只在 SPI owner session 内取得 `content` / `reference` builder，并由 Core 验证 exact brand、Schema、
closure 与预算。
它不直接成为 Host contribution，也不进入高层业务调用形状；高层 session 统一使用
`record.write(a(valueOrBuilderCallback))`，persistence adapter 在 SPI 边界完成桥接。

## Content source、reference 与消费

`RecordTextContentSchema`、`RecordBytesContentSchema` 和 `RecordAttachmentReference.to(ExactDefinition)` 是
Core-owned sealed Schema declarations。它们不暴露 physical path、digest、object key 或 selector。

```ts
yield* run.record.write(runEnergy(({ content, reference }) => ({
  joules: 42,
  report: content.text(energyReport),
  source: reference.to(runActivities, { activityId: sourceActivityId }),
})));
```

Core compiler 从 sealed declarations 穷尽 content/reference closure。session callback 才 mint content 与 reference
token。definition 调用本身不执行 callback，也不消费 Stream；只有匹配 owner 的 session 接受 command 后才执行。
Core 在 `record.write()` 时读取 Stream、限制字段 `maximumBytes`、编码并写入私有 object。
Reader content 是 Scope-owned consumption，调用者必须读尽或显式关闭；Scope finalizer 关闭遗留 stream、handle 与 lease。

## Catalog 与显式 composition

```ts
import {
  makeRecordHost,
  recordContributionFromAttachmentPersistence,
} from "niceeval/record";

const customRecordHost = makeRecordHost({
  records: [
    attemptEnergy,
    turnMetrics,
    runEnergy,
    recordContributionFromAttachmentPersistence(legacyRunEnergyPersistence),
  ],
});
```

`makeRecordHost()` 的规范输入只有 `{ records }`。Host composition 是纯函数，按 exact nominal brand 与
`(owner, family)` identity 拒绝重复；高层 definition 和 persistence adapter 都实现同一个 `RecordContribution`。
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
yield* attempt.record.write(attemptEnergy({ joules: 42 }));

yield* run.record.write(runEnergy(({ content }) => ({
  joules: 42,
  report: content.text("measured"),
  source: null,
})));
```

Run session 的 `record.write()` 只接受 Run command；Attempt session 只接受 Attempt command。TypeScript 保留
owner、family、content error 与 Effect requirements，dynamic JavaScript 边界再次验证 brand 与 owner。普通 Eval
`TestContext`、Adapter 与 Plugin 不取得 writer。只有组合 Host、创建 Attempt 并拥有真实 capture 生命周期的 producer
才能收到 `AttemptWriteSession` 的窄能力；其它 API 不能从 definition 或 contribution 反向取得它。

`a(value)` 适合已经在内存中形成的 logical value；`a(builderCallback)` 只为 content/reference token 提供 session-local
builder。两种形式都只构造惰性的 Record write command。`record.write(command)` 是 owner/family 的 create-once staging mutation；
成功返回 `void` 只表示该完整 logical value 已进入未发布 staging，不表示 durable publication。只有 Run `seal()`
成功后，整份 Run 才成为 reader 可见的持久事实。

### Write / append case matrix

| case | 作者动作 | 结果 |
|---|---|---|
| rich family 的首次完整 value | `record.write(a(value))` | staging 写入一次；`void` 不代表发布 |
| 需要 content/reference builder | `record.write(a(callback))` | command 被 owner session 接受后才执行 callback、Stream 与 I/O |
| 同 owner/family 重复或并发 write | 第二个 command 在 callback、Stream 或 I/O 前失败 `record-already-written` | 本次未发布 Run 被标记为 fail closed；捕获错误后也不能 seal 发布 |
| rich family 没有调用 write | 无 | reader 对该 owner/family 返回 `not-recorded` |
| rich family 完整观察到零项 | 领域 collector 写入 complete-empty logical value | 发布后为 `available` 的空集合，不是 `not-recorded` |
| rich family 只观察到有界前缀 | collector 写一次带 `partial` 与非空 limitation 的完整 bounded value | 发布后保留领域 partial 语义；不能把截断伪装成 complete |
| simple collection 从未 start/append | 无 | 未激活，reader 返回 `not-recorded` |
| simple collection 显式 start 后零项 | `record.start(a)` 后 complete Attempt | 发布 standard complete-empty logical value |
| simple collection 首次 append | `record.append(a(item))` | 隐式激活、执行时 snapshot，并按 cap 返回 `retained` / `omitted` |
| simple collection 重用 command | 多次执行同一个 `record.append(command)` | 每次产生一项；不自动去重 |
| simple collection 达到 cap | 继续 append | 保留安全 prefix，返回 `omitted` + `reason: "collection-cap-reached"`，最终为 `partial` + `collection-cap-reached` / `omittedAtLeast` |
| 已激活 collection capture 中断 | Host 收尾 | 保留安全 prefix，自动为 `partial` + `capture-interrupted` / `stage: "attempt-finalizer"` |
| write 后 seal 失败或未调用 seal | 无 durable publication | reader 不观察 staging value |
| seal 成功但调用方未收到 receipt | 不再补写 | 已发布 Run 仍是 durable fact |

每个 family 仍只有一个 capture authority。simple collection 只提供 Attempt-scoped、typed `start/append`；它不是 raw
JSON、path、blob、content/reference 或逐 family Host method。rich logical value 继续由领域 collector 负责业务 validate、
canonical order、去重与 complete/partial 表达，再最终一次 `record.write()`。

`seal()` 等待所有 Attempt、collector 与 write Effect 停稳，再验证 Core、inventory、persistence、compiled closures
与预算，最后发布完整 Run。任何重复写 poison、未停稳 command、缺少 required contribution 或 closure 错误都使
未发布 Run fail closed。

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
