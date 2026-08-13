# RecordAttachment adapter SPI —— Library

`niceeval/record/adapter` 是领域 SDK 与 NiceEval 内建 adapter 的低层 SPI。普通 Eval、Experiment、Plugin consumer、
Analysis 与 Report 不从这个子路径导入。

本页只定义通用语法。完整 GPU、OTel、Assertions 与 File Diff 代码分别位于
[Use Case](../record-analysis-report/use-case/README.md)。

## 定义 RecordAttachment adapter

一个 adapter 同时声明：

- sealed domain value 怎样适配为 current payload；
- owner、reverse-domain name、从 `v1` 起连续的 schema family；
- 每版完整 blob closure projection；
- 每条相邻 migration 或明确 unavailable edge；
- available current value 怎样投影为 SDK 的 typed domain view。

```ts
import { Effect } from "effect";
import { defineRecordAttachmentAdapter } from "niceeval/record/adapter";

const adapter = defineRecordAttachmentAdapter({
  owner: "attempt",
  name: "com.example.measurement",
  versions: {
    v1: {
      schema: payloadV1Schema,
      blobRefs: () => [] as const,
    },
    v2: {
      schema: payloadV2Schema,
      blobRefs: () => [] as const,
    },
  },
  current: "v2",
  migrations: ({ v1, v2 }) => ({
    v1: {
      to: v2,
      migrate: (source, target) =>
        Effect.succeed(target.value(toPayloadV2(source.payload))),
    },
  }),
  adapt: (value: SealedMeasurement, target) =>
    Effect.succeed(target.value(toCurrentPayload(value))),
  project: ({ payload }) => toMeasurementView(payload),
});
```

`versions` 中的每一项都是完整 definition。`migrations` callback 收到相同 definition 的 typed token，并且必须为
每个非 current version 返回恰好一条相邻 edge。通用形状如下：

```ts
import { Effect, Either, Stream } from "effect";

declare const recordBlobRefTypeId: unique symbol;

interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: typeof recordBlobRefTypeId;
}

type DeepReadonly<Value> =
  Value extends RecordBlobRef ? Value
    : Value extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : Value extends object ? {
        readonly [Key in keyof Value]: DeepReadonly<Value[Key]>;
      }
    : Value;

type RecordAttachmentPayloadSnapshot<Payload> = DeepReadonly<Payload>;

interface RecordBlobHandleInvalid {
  readonly code: "record-blob-handle-invalid";
  readonly reason: "foreign-ref" | "unknown-ref";
}

interface RecordBlobSource<E> {
  readonly stream: Stream.Stream<Uint8Array, E, never>;
}

interface RecordBlobDraft<E> {
  readonly ref: RecordBlobRef;
  readonly source: RecordBlobSource<E>;
}

type RecordBlobDrafts = readonly RecordBlobDraft<unknown>[];

type RecordBlobErrors<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordBlobDraft<infer E> ? E : never;

interface RecordAttachmentBlobBuilder {
  readonly add: <E>(source: RecordBlobSource<E>) => RecordBlobDraft<E>;
}

interface RecordAttachmentBlobBuild<
  Payload,
  Blobs extends RecordBlobDrafts,
> {
  readonly payload: Payload;
  readonly blobs: Blobs;
}

interface RecordAttachmentValue<Payload> {
  readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
  readonly blobs: {
    readonly refs: () => readonly RecordBlobRef[];
    readonly bytes: (
      ref: RecordBlobRef,
    ) => Either.Either<Uint8Array, RecordBlobHandleInvalid>;
  };
}

declare const recordAttachmentVersionTokenTypeId: unique symbol;
declare const recordAttachmentTargetResultTypeId: unique symbol;

interface RecordAttachmentVersionToken<Owner, Payload> {
  readonly [recordAttachmentVersionTokenTypeId]: {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

interface RecordAttachmentTargetResult<Owner, E> {
  readonly [recordAttachmentTargetResultTypeId]: {
    readonly owner: Owner;
    readonly error: E;
  };
}

interface RecordAttachmentMigrationTarget<Owner, Payload> {
  readonly value: (
    payload: Payload,
  ) => RecordAttachmentTargetResult<Owner, never>;
  readonly create: <const Blobs extends RecordBlobDrafts>(
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<Payload, Blobs>,
  ) => RecordAttachmentTargetResult<
    Owner,
    RecordBlobErrors<Blobs>
  >;
}

type RecordAttachmentAdjacentMigration<Owner, From, To, E> =
  | {
      readonly to: RecordAttachmentVersionToken<Owner, To>;
      readonly migrate: (
        source: RecordAttachmentValue<From>,
        target: RecordAttachmentMigrationTarget<Owner, To>,
      ) => Effect.Effect<
        RecordAttachmentTargetResult<Owner, E>,
        E,
        never
      >;
      readonly unavailable?: never;
    }
  | {
      readonly to: RecordAttachmentVersionToken<Owner, To>;
      readonly unavailable: {
        readonly reason: string;
      };
      readonly migrate?: never;
    };
```

`RecordAttachmentPayloadSnapshot` 是 exact decoded、package-owned、deep-frozen 的 plain data。`blobs` 只包含该
Attachment 自己的 closure。`RecordAttachmentTargetResult` 是只能由 host 消费的 opaque target 值，不是 writer、draft、
path 或提交 capability。

`RecordBlobSource<E>` 可以流式失败，但其 Effect requirements 固定为 `never`；`migrate` 本身同样固定为 `R = never`。
SDK 必须在领域 open／seal 阶段取得 clock、network、device 或其它服务，再把 sealed source 交给 adapter。installation
因此不携带 Layer，maintenance runtime 也不会暗中补一个 converter environment。

`migrate` 的成功值必须由当前 edge 的 `target.value()` 或 `target.create()` 产生。若 source 的版本语义不能无损形成
next version，SDK 返回 `unavailable` edge；它不能返回 guessed payload。完整 chain 中任一 edge unavailable 时，planner
不会先执行可用的前半链，而是保留 exact source bytes，并形成 `migration-unavailable`。

`adapt` 只接收 sealed domain value 与 current target。它不采集事实，不读取 clock、network、root、path、owner lease
或另一个 Attachment。`project` 只解释已经 materialize 的 current value；它不选择 Sample、建立关系或聚合。

version key 必须是连续的 canonical `v[1-9][0-9]*`，`current` 必须是最大版本。每个非 current 版本恰好声明一个相邻
edge；不能缺边、跳边、倒序、分叉或从外部 registry 拼 edge。TypeScript 对 literal keys 保留穷尽推断，runtime
compiler 对 dynamic JavaScript 执行同样校验。

非法声明同步抛出稳定的 `RecordAttachmentAdapterDefinitionError`，并在任何 Record、Sandbox、Agent 或 owner 资源
创建前失败。公共 compiler 拒绝 `niceeval.*`；官方 overload 额外要求 package-private namespace token。

## 三种 opaque capability

adapter 返回值只暴露三项不能互相反推的 capability：

```ts
interface RecordAttachmentAdapter<Owner, DomainValue, View> {
  readonly installation: RecordAttachmentInstallation;
  readonly projector: RecordAttachmentProjector<Owner, View>;
  readonly [recordAttachmentAdapterTypeId]: {
    readonly owner: Owner;
    readonly domainValue: DomainValue;
  };
}
```

- `installation` 只供 application／maintenance host 安装读取与 migration trust；
- `projector` 只供 SDK 内部构造领域 Analysis API；
- exact adapter object 只供 SDK 构造 owner-specific binding。

`installation` 不能构造 binding，`projector` 不能反推 adapter，普通 consumer 也拿不到 writable definition。

## current target 与 blob closure

zero-blob adapter 使用 `target.value(payload)`。blob-backed adapter 使用 `target.create(builder)`：

```ts
adapt: (value, target) =>
  Effect.succeed(
    target.create((blobs) => {
      const output = blobs.add(value.bytes);
      return {
        payload: toPayload(value, output.ref),
        blobs: [output] as const,
      };
    }),
  ),
```

`value.bytes` 必须是 SDK 在领域边界构造的 `RecordBlobSource<BlobE>`，其内容由 Effect `Stream` 提供。没有 raw path、
file name、blob key、JSON、native bytes 或手写 ref overload。builder 为本次 adaptation mint refs，并要求 payload 的
`blobRefs`、显式 `blobs` 与捕获的 sources 完全相等。missing、extra、duplicate 或 foreign ref 都是 closure failure。

current target 返回 opaque target result。adapter 无法直接交给 draft，也不能选择 owner、name 或 schemaId。

## plain-data snapshot

每次 current adaptation 与 migration target 都执行：

```text
Schema encode → package-owned clone → Schema decode → plain-data guard → deep freeze
```

plain-data algebra 是：

```text
null | boolean | finite number | string
readonly PlainData[]
plain record<string, PlainData>
package-minted RecordBlobRef
```

guard 拒绝 `undefined`、function、symbol、非有限 number、Date、Map、Set、typed array、class instance 与自定义
prototype。package 不 freeze 或 mutation SDK 传入的对象；它拥有独立 snapshot。Blob ref 是唯一允许的 opaque object，
clone 必须保留其 exact identity。

## installation 只授予读取与迁移信任

Record host 显式安装 SDK 导出的领域命名 capability：

```ts
import { defineConfig } from "niceeval";
import { measurementRecordInstallation } from "@example/measurement/record";

export default defineConfig({
  recordAttachments: {
    install: [measurementRecordInstallation],
  },
});
```

`install` 的元素类型是 `RecordAttachmentInstallation`，不是 adapter 或 writable definition。安装允许 reader 解释
family，并允许 maintenance 执行 adapter 自有的相邻 migration。它不挂载 producer、不形成 binding，也不补齐 reuse
presence requirement。

Plugin mount 不自动安装。producer package 从项目移除后，application 仍可保留 installation 来读取和迁移历史事实。
CLI 不从 Record bytes、Plugin provenance、package metadata 或网络按 name 动态发现 adapter。

## owner-specific binding

binding 把 exact adapter、producer behavior identity 与一个 owner lifecycle 组合成 link declaration。它不是 live
capability，也不向 callback 提供 writer。

```ts
import {
  defineAttemptRecordAdapterBinding,
  defineRunRecordAdapterBinding,
} from "niceeval/record/adapter";

const attemptBinding = defineAttemptRecordAdapterBinding({
  adapter,
  behaviorIdentity,
  open: ({ attempt, signal }) => openProducer({ attempt, signal }),
  seal: (session, { attempt, exit, signal }) =>
    sealProducer(session, { attempt, exit, signal }),
  release: (session, { attempt, exit }) =>
    releaseProducer(session, { attempt, exit }),
});

const runBinding = defineRunRecordAdapterBinding({
  adapter: runAdapter,
  behaviorIdentity,
  open: ({ run, signal }) => openRunProducer({ run, signal }),
  seal: (session, { run, exit, signal }) =>
    sealRunProducer(session, { run, exit, signal }),
  release: (session, { run, exit }) =>
    releaseRunProducer(session, { run, exit }),
});
```

`attempt` 与 `run` 是领域可见的 nominal execution identity，不是 Record owner ref、path、lease 或 writer。三项 callback
都是 Effect-native，requirement 固定为 `never`。SDK 连接可能 reject 的 Promise provider 时，只在 provider 边界用
`Effect.tryPromise` 适配一次。

概念形状如下；实际类型保留各 callback 的 typed error：

```ts
interface AttemptRecordAdapterBindingInput<Session, DomainValue, OpenE, SealE, ReleaseE> {
  readonly adapter: RecordAttachmentAdapter<"attempt", DomainValue, unknown>;
  readonly behaviorIdentity: Readonly<Record<string, JsonValue>>;
  readonly open: (
    context: AttemptProducerOpenContext,
  ) => Effect.Effect<Session, OpenE, never>;
  readonly seal: (
    session: Session,
    context: AttemptProducerSealContext,
  ) => Effect.Effect<DomainValue, SealE, never>;
  readonly release: (
    session: Session,
    context: AttemptProducerReleaseContext,
  ) => Effect.Effect<void, ReleaseE, never>;
}
```

一个无需资源的 producer 也使用同一形状：`open` 返回 immutable unit session，`seal` 形成领域值，`release` 成功结束。
这避免另建 optional write 或 Promise writer。

## Plugin owner fragment

Plugin fragment 按 owner 明确挂载 binding：

```ts
interface EvalPluginFragment {
  readonly recordAdapters?: {
    readonly attempt?: readonly AttemptRecordAdapterBinding[];
  };
}

interface ExperimentPluginFragment {
  readonly recordAdapters?: {
    readonly attempt?: readonly AttemptRecordAdapterBinding[];
    readonly run?: readonly RunRecordAdapterBinding[];
  };
}
```

Experiment mount 共享一份 mount provenance，但 link 成两个 authority 独立的 occurrence：Run occurrence 持有 `run`
bindings，pair／Attempt occurrence 持有 `attempt` bindings。两边有各自 exact internal grant、open／closed 状态、
accepted events 与 behavior identity。Group 没有 owner，不接受 binding。

Hosted Hook context 保持只读，不增加 Record 方法。普通 Eval 与 Experiment definition 也没有 `recordAdapters`；第三方
事实通过领域 Plugin 或 NiceEval 自己拥有的内建 adapter 进入。

## total producer obligation

mounted binding 对每个 actual owner 是完整生产义务：

1. owner open 时按 `(owner, name)` reserve family，并登记 pending tracked producer；
2. producer lifecycle 必须形成恰好一个 sealed domain value；
3. host 调用 adapter `adapt` 并提交 canonical RecordAttachment command；
4. command 只能 accepted once 或令 owner 失败。

未产值、重复 binding、open／seal／release failure、defect、interruption与 adaptation failure 都不能降级为
Attachment 缺席。schema／plain-data／closure failure 与 durable write failure 也会令 owner 失败。正常无数据由领域值
表达 explicit empty、partial 或 unavailable。

binding behavior identity 进入其 owner 的 fingerprint、manifest 与 Plugin provenance。Attempt binding 进入 Eval pair
identity；Run binding 进入 Run identity。schema identity 只解释持久 payload，不能替代 producer behavior identity。

## Effect v3 release failure

仓库使用 Effect 3.22.1。`Effect.acquireRelease` 的 finalizer error 固定为 `never`，因此 host 不能假装 release 的 typed
failure 会自动从 Scope 传播。

host 在 owner child Scope 中持有 session，把 seal 与 release 的完整 `Exit`／`Cause` 收入 owner lifecycle
aggregation。finalizer 登记 failure 后自身收束为 `Effect<void, never, ...>`。typed failure、defect 与 interruption
保持可区分；它们不只写日志，也不被改成领域 unavailable。

内部不调用 nested `Effect.runPromise*`，不创建 detached fiber 或第二 runtime。公开领域 SDK 若提供 Promise API，只在
最外层宿主 facade 启动 Effect。

## Projection 与领域 Analysis API

adapter 的 projector 只在 Attachment 为 `available` 时解释 current value。SDK 把它作为 private dependency 收进
Analysis fields：

```ts
const measurementByAttempt = attemptSlotProjection(adapter.projector);

const measurementFields = defineAnalysisFields({
  id: "com.example.measurement",
  population: logicalSlots,
  dependencies: { measurement: measurementByAttempt },
  materialize: ({ population, dependencies }) =>
    population.rows((slot) =>
      measurementCells(slot, dependencies.measurement.at(slot.key)),
    ),
});

export const measurementValue = measurementFields.measure({
  id: "measurement-value",
  cell: "value",
  rollup: logicalSlotRollup({ withinEval: mean, acrossEvals: mean }),
  denominator: allLogicalSlots,
  evidence: allDenominatorAttemptRefs,
});

export const analyzeMeasurement = (sampleHandle: AnalysisSampleHandle) =>
  analyze({ sampleHandle, fields: { value: measurementValue } });
```

SDK 导出领域 Dimension／Measure 与 `analyzeMeasurement()`。它不导出 projection declaration、adapter、writable
definition 或 raw reader。fields 必须保留 Analysis Sample denominator、每 slot 穷尽状态、issues 与 refs。
它们也要保留 `migration-required | migration-unavailable | unsupported | invalid`，不能降成 available values 数组。

projector 不执行 migration。普通 Analysis／Report 看到 known old family 时得到 `migration-required`，由 maintenance
host 显式迁移。

## 相邻 migration

converter 只接收 exact decoded source value 与下一版本 target：

```ts
migrations: ({ v1, v2 }) => ({
  v1: {
    to: v2,
    migrate: (source, target) =>
      Effect.succeed(target.value(toV2(source.payload))),
  },
})
```

target 的 `value()`／`create()` 复用 current adaptation 的 Schema、plain-data 与 closure validators。converter 没有
Record root、clock、network、environment、当前 Eval、Plugin 或 producer session。requirement 为 `never` 只约束
Effect dependency，不构成 JavaScript sandbox；确定性仍是 SDK 作者契约。

不能无损迁移的 edge 明确声明：

```ts
v1: {
  to: v2,
  unavailable: {
    reason: "v1 did not retain the required measurement interval",
  },
}
```

`migrate` 与 `unavailable` 是穷尽联合。普通 read 不执行 converter；CLI 只使用 application 显式安装的完整 graph。

## official namespace 与中立性

官方 adapter 调用同一个 compiler、binding、total obligation、target、validators、tracked command、poison、reader 与
migration orchestration。差异只在：

- package-private constructor 持有 `niceeval.*` namespace token；
- official adapter、binding 与 installation 不导出；
- official installation 由产品组合层固定提供。

官方不保留 parallel Effect facade、raw draft、schema bypass 或 owner-wide writer。公共包只导出领域 projector／Analysis
API。第三方无法伪造 official namespace，官方也不能绕过中立机械路径。

## 相关契约

- [README](README.md) —— 身份、三种 capability 与普通领域 API 心智。
- [Architecture](architecture.md) —— authority、identity、canonical command 与官方中立性。
- [Lifecycle](lifecycle.md) —— total obligation、Scope、失败与 publication。
- [CLI](cli.md) —— installation registry、migration plan 与恢复语义。
- [Record → Analysis → Report](../record-analysis-report/README.md) —— 三层组合与完整领域用例。
