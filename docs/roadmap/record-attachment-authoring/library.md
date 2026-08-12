# RecordAttachment 作者 API —— Library

`niceeval/record` 为自定义运行事实提供一个定义入口：
`defineRecordAttachment()`。它编译一个完整、opaque 的多版本 definition；同一个 definition
再分别用于 application install、producer write grant 与 owner-local `ctx.record()`。

简单 JSON 是 `ctx.record()` 的零 blob 调用形状。它不另有 definition、registry、writer、reader
或 migration primitive。Blob-backed payload 使用同一个 definition 与同一个写入命令。

## 定义一个完整版本族

一个 definition 在一次调用中固定 owner、name、从 `v1` 起连续的所有版本、最大 current 版本、
每版的 Schema 与 blob projection，以及每条相邻 edge。

```ts
import { Effect, Schema } from "effect";
import { defineRecordAttachment } from "niceeval/record";

export const gpuEnergy = defineRecordAttachment({
  owner: "attempt",
  name: "com.example.gpu-energy",
  versions: {
    v1: {
      schema: Schema.Struct({
        joules: Schema.Number,
        source: Schema.Literal("device-estimate"),
      }),
      blobRefs: () => [] as const,
    },
    v2: {
      schema: Schema.Struct({
        joules: Schema.Number,
        source: Schema.Literal("device-estimate"),
        uncertainty: Schema.NullOr(Schema.Number),
      }),
      blobRefs: () => [] as const,
    },
  },
  current: "v2",
  migrations: ({ v1, v2 }) => ({
    v1: {
      to: v2,
      migrate: (source, target) =>
        Effect.succeed(
          target.value({
            ...source.payload,
            uncertainty: null,
          }),
        ),
    },
  }),
});
```

此 definition 自动形成 `com.example.gpu-energy/v1` 与
`com.example.gpu-energy/v2`。作者不能输入 `schemaId`，也不能另行拼出单版本 definition、
family、edge 或 write。

version key 使用 canonical `v[1-9][0-9]*`；`v0`、`v01`、负数与小数都非法。keys 必须从 `v1`
逐一连续到 current，不能靠 object insertion order 或字符串排序定义相邻关系。

公共作者面不导出 `defineJsonRecordAttachment()`、`defineRecordAttachmentFamily()`、
`defineRecordAttachmentMigration()`、`makeRecordAttachmentWrite()` 或同类拼装件。它们只在
`defineRecordAttachment()` compiler 与中立写入核内部存在。

`blobRefs(payload)` 是该版本 payload 的完整 closure projection。它按 payload 出现顺序返回全部
`RecordBlobRef`；零 blob 版本明确返回 `[] as const`。它不是可省略的优化提示。

### 类型形状

以下类型展示 `defineRecordAttachment()` 的推断边界。`ValidCurrent`、`NextVersion` 与
`CompleteAdjacentMigrations` 是编译器从 literal version keys 导出的类型运算，不是作者可调用的
构造器。

```ts
import type { Effect, Schema } from "effect";

type RecordAttachmentOwner = "attempt" | "run";
type VersionKey = `v${number}`;

declare const recordAttachmentDefinitionTypeId: unique symbol;
declare const recordAttachmentReaderTypeId: unique symbol;
declare const recordAttachmentVersionTokenTypeId: unique symbol;
declare const recordBlobRefTypeId: unique symbol;

interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: typeof recordBlobRefTypeId;
}

interface RecordAttachmentReader<
  Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly [recordAttachmentReaderTypeId]: {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

interface RecordAttachmentDefinition<
  Owner extends RecordAttachmentOwner,
  CurrentPayload,
  CurrentBlobRefs extends readonly RecordBlobRef[],
> {
  readonly reader: RecordAttachmentReader<Owner, CurrentPayload>;
  readonly [recordAttachmentDefinitionTypeId]: {
    readonly owner: Owner;
    readonly currentPayload: CurrentPayload;
    readonly currentBlobRefs: CurrentBlobRefs;
  };
}

interface RecordAttachmentVersionToken<Key extends VersionKey, Payload> {
  readonly [recordAttachmentVersionTokenTypeId]: {
    readonly key: Key;
    readonly payload: Payload;
  };
}

type AttachmentVersions = Readonly<
  Record<
    VersionKey,
    {
      readonly schema: Schema.Schema.AnyNoContext;
      readonly blobRefs: (payload: never) => readonly RecordBlobRef[];
    }
  >
>;

type PayloadAt<
  Versions extends AttachmentVersions,
  Key extends keyof Versions,
> = Versions[Key] extends {
  readonly schema: infer S extends Schema.Schema.AnyNoContext;
}
  ? Schema.Schema.Type<S>
  : never;

type BlobRefsAt<
  Versions extends AttachmentVersions,
  Key extends keyof Versions,
> = Versions[Key] extends {
  readonly blobRefs: (...arguments_: never[]) => infer Refs extends readonly RecordBlobRef[];
}
  ? Refs
  : never;

type VersionKeys<Versions extends AttachmentVersions> = Extract<
  keyof Versions,
  VersionKey
>;

type VersionNumber<Key extends VersionKey> = Key extends `v${infer Number extends number}`
  ? Number
  : never;

type BuildTuple<
  Number extends number,
  Result extends readonly unknown[] = [],
> = Result["length"] extends Number
  ? Result
  : BuildTuple<Number, [...Result, unknown]>;

type Increment<Number extends number> = [...BuildTuple<Number>, unknown]["length"];

type VersionRange<
  Last extends number,
  Next extends number = 1,
> = Last extends 0
  ? never
  : Next extends Last
    ? `v${Next}`
    : `v${Next}` | VersionRange<Last, Increment<Next>>;

type HasExactContinuousVersions<
  Versions extends AttachmentVersions,
  Last extends number,
> = [VersionKeys<Versions>] extends [VersionRange<Last>]
  ? [VersionRange<Last>] extends [VersionKeys<Versions>]
    ? true
    : false
  : false;

type ValidCurrent<
  Versions extends AttachmentVersions,
  Current extends VersionKeys<Versions>,
> = HasExactContinuousVersions<Versions, VersionNumber<Current>> extends true
  ? Current
  : never;

type NextVersion<
  Versions extends AttachmentVersions,
  From extends VersionKeys<Versions>,
> = Extract<`v${Increment<VersionNumber<From>>}`, VersionKeys<Versions>>;

type VersionTokens<Versions extends AttachmentVersions> = {
  readonly [Key in keyof Versions]: RecordAttachmentVersionToken<
    Key & VersionKey,
    PayloadAt<Versions, Key>
  >;
};

type RecordAttachmentMigration<
  Owner extends RecordAttachmentOwner,
  From,
  To,
  ConvertE,
  BlobE,
> = (
  source: RecordAttachmentValue<From>,
  target: RecordAttachmentMigrationTarget<Owner, To>,
) => Effect.Effect<RecordAttachmentMigrationWrite<Owner, BlobE>, ConvertE, never>;

type CompleteAdjacentMigrations<
  Owner extends RecordAttachmentOwner,
  Versions extends AttachmentVersions,
  Current extends VersionKeys<Versions>,
> = {
  readonly [From in Exclude<VersionKeys<Versions>, Current>]:
    | {
        readonly to: VersionTokens<Versions>[NextVersion<Versions, From>];
        readonly migrate: RecordAttachmentMigration<
          Owner,
          PayloadAt<Versions, From>,
          PayloadAt<Versions, NextVersion<Versions, From>>,
          unknown,
          unknown
        >;
        readonly unavailable?: never;
      }
    | {
        readonly to: VersionTokens<Versions>[NextVersion<Versions, From>];
        readonly unavailable: { readonly reason: string };
        readonly migrate?: never;
      };
};

declare function defineRecordAttachment<
  const Owner extends RecordAttachmentOwner,
  const Name extends string,
  const Versions extends AttachmentVersions,
  const Current extends VersionKeys<Versions>,
>(input: {
  readonly owner: Owner;
  readonly name: Name;
  readonly versions: Versions;
  readonly current: Current;
  readonly migrations: (
    tokens: VersionTokens<Versions>,
  ) => CompleteAdjacentMigrations<Owner, Versions, Current>;
} & (ValidCurrent<Versions, Current> extends never ? never : unknown)): RecordAttachmentDefinition<
  Owner,
  PayloadAt<Versions, Current>,
  BlobRefsAt<Versions, Current>
>;
```

实际公开声明保留每条 `migrate` 的 `ConvertE` 与 `BlobE` 推断；上面的 `unknown` 只把映射表的
形状压缩在一个可读代码块中。`RecordAttachmentMigrationWrite` 是 target 返回的 opaque 值，
没有公开 constructor。

对于 literal TypeScript 输入，类型检查拒绝缺少或多出的 edge、错误 entry key、非相邻 `to` token、
错误 source/target payload，或不是最大版本的 `current`。这层类型运算是作者 DX，不宣称对任意大的
十进制 `N` 做无界算术证明；类型验收至少固定包含 `v1`、`v2`、完整的 `v1` 到 `v10`、wrong target、
missing edge 与 wrong payload。runtime compiler 才是任意 `vN` 与 dynamic JavaScript 的最终权威。

动态 JavaScript 不因绕过 TypeScript 而获得宽松定义。编译器同步检查 own fields、name、owner、
每个 `vN` key、numeric 连续性、最大 current 与迁移表。它按数值处理 version，所以 `v10` 紧接
`v9`，不会按字符串顺序误判。它还验证 callback 返回的 key set、token identity 与 `to` 的唯一相邻关系。

任一非法定义同步 `throw` 同一个稳定错误类型：

```ts
declare class RecordAttachmentDefinitionError extends Error {
  readonly name: "RecordAttachmentDefinitionError";
  readonly code: "record-attachment-definition-invalid";
  readonly issues: readonly RecordAttachmentDefinitionIssue[];
}
```

`issues` 只包含 bounded 的定义问题，例如 reserved namespace、非法 name、非连续版本、错误 current、
错误 migration key 或 target、缺失 edge、重复 edge、无效 Schema/`blobRefs` 形状。`migrations` callback
本身无法形成定义时也归入此错误；不向调用者暴露不稳定的任意 exception message。

`blobRefs` 是否真的穷尽某一实际 payload 的 refs 在写入和 migration target 验证。缺 ref、多 ref、重复 ref
或非本次 builder mint 的 ref 都是 closure failure，而不是定义阶段猜测。

## install 与 write 是两项独立授权

### Application install

application 只在配置中安装它信任的完整 definition。安装提供 reader 与显式 migration；它不写入任何
Run 或 Attempt。

```ts
import { defineConfig } from "niceeval";
import { gpuEnergy } from "./gpu-energy.js";

export default defineConfig({
  recordAttachments: {
    install: [gpuEnergy],
  },
});
```

### Producer write grant

producer 在自己声明处取得 write grant。Eval 与 Eval Plugin 只可 grant Attempt-owned definition；
Experiment 与 Experiment Plugin 只可 grant Run-owned definition。

```ts
import { defineEval } from "niceeval";
import { gpuEnergy } from "./gpu-energy.js";

export default defineEval({
  recordAttachments: {
    write: [gpuEnergy],
  },
  async test(ctx) {
    await ctx.record(gpuEnergy, {
      joules: await measureGpuEnergy(),
      source: "device-estimate",
      uncertainty: null,
    });
  },
});
```

`defineConfig()` 没有 `recordAttachments.write`，producer 没有 `recordAttachments.install`。
两处字段不能互换、不能由其中一处隐式补齐另一处，也不决定 reuse presence requirement 或 producer behavior
identity。

### Identity

write grant 以 exact definition object identity 判断。结构相同的对象、复制出的 phantom brand 与类型断言
都不是 grant。link 与 application registry 的冲突则以 `(owner, name)` 判断：同一位置不能安装或 link
两个同 owner/name 的 definition，即使它们是不同 object 或含不同版本。durable identity 始终是
`(owner, name, vN)`。

每次 link 还形成独立的 occurrence provenance identity。相同 definition 可以在彼此独立的 owner / link 中被
多个 Eval、Experiment 或 Plugin occurrence grant；同一 owner link 内仍按 `(owner, name)` 冲突。它们的
provenance 不因共享 definition object 而合并。详见
[Architecture](architecture.md)。

## 以 `ctx.record()` 提交事实

Eval、Experiment、Plugin 作者都使用同形的 Promise surface。宿主按 owner 提供相应 context，类型只接受
该 context 的 write grant 中的 exact definition。

### Owner-local record context

```ts
type CurrentPayload<Definition> = Definition extends RecordAttachmentDefinition<
  infer _Owner,
  infer Payload,
  infer _BlobRefs
>
  ? Payload
  : never;

type CurrentBlobRefs<Definition> = Definition extends RecordAttachmentDefinition<
  infer _Owner,
  infer _Payload,
  infer BlobRefs
>
  ? BlobRefs
  : never;

type ZeroBlobDefinition<Definition> = CurrentBlobRefs<Definition> extends readonly []
  ? Definition
  : never;

type RecordBlobDrafts = readonly RecordBlobDraft<unknown>[];

type RecordBlobErrors<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordBlobDraft<infer BlobE> ? BlobE : never;

interface RecordAttachmentBlobBuild<
  Payload,
  Blobs extends RecordBlobDrafts,
> {
  readonly payload: Payload;
  readonly blobs: Blobs;
}

interface RecordAttachmentContext<
  Owner extends RecordAttachmentOwner,
  Allowed extends RecordAttachmentDefinition<
    Owner,
    unknown,
    readonly RecordBlobRef[]
  >,
> {
  record<Definition extends Allowed>(
    definition: ZeroBlobDefinition<Definition>,
    payload: CurrentPayload<Definition>,
  ): Promise<void>;

  record<
    Definition extends Allowed,
    const Blobs extends RecordBlobDrafts,
  >(
    definition: Definition,
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<CurrentPayload<Definition>, Blobs>,
  ): Promise<void>;
}

type AttemptRecordContext<
  Allowed extends RecordAttachmentDefinition<
    "attempt",
    unknown,
    readonly RecordBlobRef[]
  >,
> = RecordAttachmentContext<"attempt", Allowed>;

type RunRecordContext<
  Allowed extends RecordAttachmentDefinition<
    "run",
    unknown,
    readonly RecordBlobRef[]
  >,
> = RecordAttachmentContext<"run", Allowed>;
```

直接 payload overload 只适用于 current `blobRefs` 静态声明为 `readonly []` 的 definition。runtime 仍会
确认实际 projection 是空的。任何可能有 blob 的 payload 都必须选择 builder overload。

```ts
import { Stream } from "effect";
import { recordBlobSource } from "niceeval/record";

await ctx.record(commandLog, (blobs) => {
  const stdout = blobs.add(
    recordBlobSource(Stream.fromIterable([new Uint8Array([79, 75])])),
  );

  return {
    payload: {
      command: "check",
      stdout: stdout.ref,
    },
    blobs: [stdout] as const,
  };
});
```

```ts
import type { Stream } from "effect";

declare const recordBlobSourceTypeId: unique symbol;
declare const recordBlobDraftTypeId: unique symbol;

interface RecordBlobSource<BlobE> {
  readonly [recordBlobSourceTypeId]: { readonly error: BlobE };
}

declare function recordBlobSource<BlobE>(
  stream: Stream.Stream<Uint8Array, BlobE, never>,
): RecordBlobSource<BlobE>;

interface RecordAttachmentBlobBuilder {
  readonly add: <BlobE>(source: RecordBlobSource<BlobE>) => RecordBlobDraft<BlobE>;
}

interface RecordBlobDraft<BlobE> {
  readonly ref: RecordBlobRef;
  readonly [recordBlobDraftTypeId]: { readonly error: BlobE };
}
```

`add()` 为本次 command mint 新 ref，并由 builder 捕获 source。作者只能从 Effect `Stream` 创建
`RecordBlobSource`；没有 raw attachment name、path、file name、blob key、JSON、`Uint8Array` 或 bytes
overload。build 返回的 `blobs` 显式携带每个 draft 的 `BlobE`；payload 只能引用本次 builder 给出的 `ref`，
而 `blobRefs`、`blobs` 与 builder 捕获的 sources 必须三方完全相等。missing、extra、duplicate 或 foreign
draft 都是 closure failure。

### 同一 turn 接受 command

`ctx.record()` 在返回 Promise 前、同一个 JavaScript turn 中完成四项动作：

1. 检查 context lease 仍 open、definition 的 owner 正确且它是该 occurrence 的 exact write grant。
2. 取得 `(owner, name)` reservation；同一 owner 后续调用立即是 duplicate。
3. 对 payload 做 Schema encode、package-owned snapshot capture 与 closure 预检查。
4. 向 owner 注册可追踪 command，再返回代表异步 blob I/O 与 generic writer 的 Promise。

reservation 永不释放。即使第一个 command 随后失败，也不能用第二个 payload 替换它。
owner 封口等待所有已注册 command；漏掉 `await` 不会越过封口屏障。

Open 期间任一个 command 的 typed failure、defect 或 interruption 都 poison owner。作者对 returned Promise
调用 `catch` 只能观察失败，不能撤销 owner 的失败状态或令 seal 成功。closed lease 的调用返回
`record-attachment-context-closed`，不会重新打开 owner。完整的状态与封口顺序见
[Lifecycle](lifecycle.md)。

### payload snapshot 的 plain-data 边界

编码后的 payload 必须属于不可变 plain-data algebra：

```text
PlainData ::= null
            | boolean
            | finite number
            | string
            | readonly PlainData[]
            | plain record<string, PlainData>
            | package-minted RecordBlobRef
```

plain record 只允许 own enumerable string keys，且原型必须是 `Object.prototype` 或 `null`。guard 拒绝
`undefined`、function、symbol、非有限 number、Date、Map、Set、typed array、class instance 与任何非标准
object prototype。Blob ref 是唯一允许的 opaque object，并保持 package mint 的 exact identity。

package 不 mutation 或 freeze 作者传入的对象。每次 command 都按下列顺序形成独立 snapshot：

```text
Schema encode → package-owned clone → Schema decode → plain-data guard → deep freeze
```

clone 保留 minted ref 的 identity，不依赖它的可枚举字段重建 capability。因而作者稍后 mutation 输入，或把
同一输入传给另一个 consumer，都不会改变已接受的 payload。

### Promise facade、Effect kernel 与错误边界

公开 `ctx.record()` 返回 Promise，内部只有一个在宿主 `Scope` 中运行的 Effect-native command。Eval、
Experiment、Plugin 的 Promise facade 都适配这个 command；内建 producer 直接使用同一个 Effect adapter，
不拥有另一条 writer 语义。

Effect 3.22.1 的 `Effect.runPromise` 签名只接收 `Effect<A, E, never>`。
宿主在已经 provide services 并建立 `Effect.scoped` 的最外层 Promise 边界运行一次。

`record()`、generic writer、blob Stream 与 migration orchestration 内部都不调用 nested
`Effect.runPromise`、`runPromiseExit` 或 `runSync`。可能 reject 的作者 Promise callback 只在进入 Effect
的边界用 `Effect.tryPromise({ try: (signal) => ..., catch: (error) => ... })` 适配一次。

作者可观察的 command rejection 是具名错误。它们带稳定 `code` 与 bounded safe context：

```ts
type RecordAttachmentRecordError =
  | { readonly code: "record-attachment-context-closed" }
  | { readonly code: "record-attachment-wrong-owner" }
  | { readonly code: "record-attachment-undeclared" }
  | { readonly code: "record-attachment-duplicate" }
  | RecordAttachmentPayloadInvalid
  | RecordAttachmentClosureInvalid
  | RecordWriteError;
```

blob builder overload 还保留 `RecordBlobErrors<Blobs>` 中的 source failure；它不会被改写成 payload 或 closure
invalid。Promise 本身不编码 rejection type，但 definition、command kernel 与 host failure folding 仍能辨认对应的
blob producer。

`RecordAttachmentPayloadInvalid` 包含 Schema 或 plain-data failure；
`RecordAttachmentClosureInvalid` 包含 missing、extra、duplicate 或 illegal ref。原始 exception、
filesystem detail、stack 与 secret 不进入这些值。callback throw 是 defect，fiber cancellation 保留 Effect
Cause；两者不伪装成 payload、closure 或 typed writer error。

## 读取与 projector

application 安装 definition 后，frozen Record view 用只读 reader capability 读取相应 owner 的 current
value。writer definition 不能由 reader capability 反推。

```ts
const state = yield* view.readAttemptAttachment(
  attempt,
  gpuEnergy.reader,
);

if (state.state === "available") {
  const joules = state.value.payload.joules;
}
```

读取成功状态是 `available`、`unavailable`、`migration-required`、`migration-unavailable`、
`unsupported` 或 `invalid`。形成 `available` 前，payload 已 exact decode、通过 plain-data guard、
deep-freeze，且全部 own blobs 已 materialize 为只读 snapshot。I/O、permission 与 closed reader 留在
`RecordReadError` typed Effect channel。

普通 read 从不自动迁移。current definition 遇到可达旧版本时返回 `migration-required`；遇到显式
unavailable edge 时返回 `migration-unavailable`；未安装或未知 family 保留 bytes 并返回 `unsupported`。
只有 [CLI](cli.md#命令) 的显式 migration 使用 application install 的完整 graph。

projector 是 reader value 的独立 consumer。它既不是 definition，也没有 write grant、application install
权或 migration authority。

```ts
import { defineRecordAttachmentProjector } from "niceeval/projection";

export const gpuEnergyProjector = defineRecordAttachmentProjector({
  attachment: gpuEnergy.reader,
  project: (value) => value.payload.joules,
});
```

## 相邻 migration

`migrate` 的 source 是已 exact decode、完整 materialize 的旧 version value。它只读 source payload 与
own blob closure；它没有 Record root、path、clock、network、current Eval、Plugin 或 Agent context。

```ts
import type { Either } from "effect";

declare const recordAttachmentMigrationWriteTypeId: unique symbol;

interface RecordAttachmentMigrationWrite<
  Owner extends RecordAttachmentOwner,
  BlobE,
> {
  readonly [recordAttachmentMigrationWriteTypeId]: {
    readonly owner: Owner;
    readonly blobError: BlobE;
  };
}

type RecordAttachmentPayloadSnapshot<Value> = Value extends RecordBlobRef
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly RecordAttachmentPayloadSnapshot<Item>[]
    : Value extends object
      ? {
          readonly [Key in keyof Value]: RecordAttachmentPayloadSnapshot<
            Value[Key]
          >;
        }
      : Value;

type RecordBlobHandleInvalid = {
  readonly code: "record-blob-handle-invalid";
};

interface RecordAttachmentBlobs {
  readonly refs: () => readonly RecordBlobRef[];
  readonly bytes: (
    ref: RecordBlobRef,
  ) => Either.Either<Uint8Array, RecordBlobHandleInvalid>;
}

interface RecordAttachmentValue<Payload> {
  readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
  readonly blobs: RecordAttachmentBlobs;
}

interface RecordAttachmentMigrationTarget<
  Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly value: (
    payload: Payload,
  ) => RecordAttachmentMigrationWrite<Owner, never>;

  readonly create: <const Blobs extends RecordBlobDrafts>(
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<Payload, Blobs>,
  ) => RecordAttachmentMigrationWrite<Owner, RecordBlobErrors<Blobs>>;
}
```

`target.value()` 与 `target.create()` 走同一 Schema encode、owned clone、decode、plain-data guard、
deep-freeze 与 blob-closure validator。`value()` 因而只适合 projection 为空的 target；有 ref 的 target
使用 `create()` mint 新 ref。旧 ref、raw key 与 storage path 不能冒充 target ref。

每条 converter 的 Effect requirement 固定为 `never`：

```ts
type RecordAttachmentMigration<Owner, From, To, ConvertE, BlobE> = (
  source: RecordAttachmentValue<From>,
  target: RecordAttachmentMigrationTarget<Owner, To>,
) => Effect.Effect<RecordAttachmentMigrationWrite<Owner, BlobE>, ConvertE, never>;
```

`ConvertE` 是 converter 用 `Effect.fail` 表达的具名失败；`BlobE` 来自 target blob Stream。orchestration
分别接收两者，再以 family 与 edge identity 收口为
`record-attachment-migration-step-failed`。它不把 author error 原样写入 portable data 或 CLI JSON。

callback throw 或 `Effect.die` 保持 defect，fiber cancellation 保持 Effect Cause，二者都不是 migration
step failure。`R = never` 表示 converter 不请求 NiceEval Effect service；它不是 JavaScript sandbox。clock、
random、environment、network、filesystem 与 ambient mutable state 都违反 determinism 作者契约，即使闭包
技术上能够访问它们。

不能无损迁移的 edge 使用同一个 token 关系明确声明：

```ts
migrations: ({ v1, v2 }) => ({
  v1: {
    to: v2,
    unavailable: {
      reason: "v1 did not record the measurement interval",
    },
  },
})
```

`migrate` 与 `unavailable` 是穷尽联合，不能同时出现。后者是 settled read state，不是 converter
failure，也不会由普通 read 或 CLI 自动补写事实。migration plan、sentinel 与恢复语义由
[Architecture](architecture.md) 和 [CLI](cli.md) 定义。

## 官方 definition 只读暴露

`niceeval.*` 只由 package-private namespace authority 构造。它调用与第三方完全相同的
`defineRecordAttachment()` compiler，随后经过相同的 application registry、write grant、context lease、
generic writer、reader 与 migration orchestration。

公共包不导出 writable official definition，也没有 `official: true`、namespace authority 或 self-allowlist
token。官方事实只暴露只读 reader 与 projector capability：

```ts
import type { RecordAttachmentProjector } from "niceeval/projection";

export declare const usageAttachmentReader: RecordAttachmentReader<
  "attempt",
  UsageAttachment
>;

export declare const usageProjector: RecordAttachmentProjector<
  "attempt",
  UsageView
>;
```

`usageAttachmentReader` 不能传给 `recordAttachments.write` 或 `ctx.record()`。这让第三方无法把官方
family 加入自己的 write grant；内建 producer 仍以私有 definition 取得显式内部 grant。definition 与
projector 分离，因此项目也不能借某个 projector 替换、扩张或写入官方 durable shape。

第三方给 `defineRecordAttachment()` 传入 `niceeval.*` name 会同步得到
`RecordAttachmentDefinitionError`。官方与第三方的差异止于这个私有 namespace construction boundary，
不延伸为 writer、reader、closure 或 migration 特权。

## 相关契约

- [README](README.md) —— definition、install、write 与 lease 的四权分离。
- [Architecture](architecture.md) —— identity、occurrence isolation、generic kernel 与官方 namespace。
- [Lifecycle](lifecycle.md) —— reservation、tracked command、poison 与封口。
- [CLI](cli.md) —— installed registry、显式 migration、sentinel 与恢复。
- [Record Library](../../feature/record/library.md) —— frozen value、blob snapshot 与底层 Record errors。
