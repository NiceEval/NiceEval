# Projection Library

本页是 `niceeval/projection` 的公开契约 owner。它只导出 `RecordAttachment` 的解释器、三种逻辑访问、穷尽 `ProjectedSample` 与 direct Effect 入口。

## RecordAttachment projector

```ts
import { Effect } from "effect";
import type { RecordAttachmentValue } from "niceeval/record";

type RecordAttachmentOwner = "run" | "attempt";

declare const recordAttachmentProjectorTypeId: unique symbol;

interface RecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly owner: Owner;
  readonly [recordAttachmentProjectorTypeId]: (value: Value) => Value;
}

declare const defineRecordAttachmentProjector: <
  Owner extends RecordAttachmentOwner,
  Payload,
  Value,
>(input: {
  readonly attachment: RecordAttachmentFamily<Owner, Payload>;
  readonly project: (value: RecordAttachmentValue<Payload>) => Value;
}) => RecordAttachmentProjector<Owner, Value>;
```

available Attachment 是 Record Library 唯一拥有的完整 `RecordAttachmentValue<Payload>`。它由 package 在读取完成时一次性构成，不存在部分读取形态；projector 同步消费它。blobs 的可变性与访问方式由 Record owner 的 accessor 决定，Projection 不定义或复制该类型。

一个 projector 固定解释一个 owner 类型和一个 `RecordAttachmentFamily`。它没有 durable identity，也不能改换 family、owner 或 payload decoder。Library 以 definition 的 exact identity 取得 family，读取并 decode Attachment 后才调用 `project`。

callback 只在 Attachment `available` 时执行，接收完整 `RecordAttachmentValue`，并同步返回 view value。它不能执行额外 Record I/O；需要另一份 Attachment 时，作者声明另一条 projection。callback 的意外 throw 是 defect，不能被改写成 `invalid` 或 `Effect` 的 typed error。

`Value` 没有 JSON、index signature 或 `as` 的类型约束。普通 named interface 可以直接作为 view：

```ts
interface EnergyPayload {
  readonly joules: number;
  readonly label: string;
}

interface EnergyView {
  readonly joules: number;
  readonly label: string;
}

declare const energyAttachment: RecordAttachmentFamily<
  "attempt",
  EnergyPayload
>;

const energyProjector = defineRecordAttachmentProjector({
  attachment: energyAttachment,
  project: ({ payload }): EnergyView => ({
    joules: payload.joules,
    label: payload.label,
  }),
});
```

## 三种 projection 声明

```ts
type ProjectionAccess =
  | "attempt-slot"
  | "attempt-origin-run"
  | "selected-run";

declare const recordProjectionTypeId: unique symbol;

interface RecordProjection<Access extends ProjectionAccess, Value> {
  readonly access: Access;
  readonly [recordProjectionTypeId]: (value: Value) => Value;
}

declare const attemptSlotProjection: <Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
) => RecordProjection<"attempt-slot", Value>;

declare const attemptOriginRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"attempt-origin-run", Value>;

declare const selectedRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"selected-run", Value>;
```

`attemptSlotProjection()` 对每个 included slot 访问 `slot.attempt` 指向的 Attempt。`attemptOriginRunProjection()` 也对每个 included slot 访问一次，但 owner 是该 Attempt 精确的 origin Run。`selectedRunProjection()` 对每个 `sample.runs` 项访问一次 Run。

三个 constructor 都只接受 package-created `RecordAttachmentProjector`。调用方不需要实现 brand，也不需要把自己的 `Value` 扩展为字典类型。

## Attachment result 与 logical entry

```ts
type ProjectedRecordAttachmentResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
    }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "migration-unavailable";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly reason: string;
    }
  | {
      readonly state: "unsupported";
      readonly schemaId: RecordAttachmentSchemaId;
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyRecordIssues;
    };

interface AttemptAttachmentOwner {
  readonly kind: "attempt";
  readonly attempt: RecordAttemptRef;
}

interface RunAttachmentOwner {
  readonly kind: "run";
  readonly runId: RunId;
}

type ProjectedSlotEntry<Owner, Value> =
  | {
      readonly state: "excluded";
      readonly slot: ExcludedAnalysisSlot;
    }
  | {
      readonly state: "not-recorded";
      readonly slot: NotRecordedAnalysisSlot;
    }
  | {
      readonly state: "core-invalid";
      readonly slot: CoreInvalidAnalysisSlot;
    }
  | {
      readonly state: "attachment-result";
      readonly slot: IncludedAnalysisSlot;
      readonly owner: Owner;
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    };

type AttemptSlotProjectedEntry<Value> = ProjectedSlotEntry<
  AttemptAttachmentOwner,
  Value
>;

type AttemptOriginRunProjectedEntry<Value> = ProjectedSlotEntry<
  RunAttachmentOwner,
  Value
>;

interface SelectedRunProjectedEntry<Value> {
  readonly state: "attachment-result";
  readonly run: AnalysisRun;
  readonly owner: RunAttachmentOwner;
  readonly attachment: ProjectedRecordAttachmentResult<Value>;
}
```

前两种 projection 的 entry 必须穷尽 `excluded`、`not-recorded`、`core-invalid` 与 `attachment-result`。前三种状态不触发 Attachment I/O；第四种状态保留 `RecordAttachmentRead` 的完整数据状态，并在 available 时保存 callback value。

`available` 状态保存 projector 从完整 `RecordAttachmentValue` 同步返回的 view value。unavailable、migration-required、migration-unavailable、unsupported 与 invalid 同样是 `attachment-result` 内的成功值。只有文件、permission、closed reader 或错误的 reader-owned capability 才进入 `Effect` error channel。

## ProjectedSample 与 coverage

```ts
type ProjectedEntry<Access extends ProjectionAccess, Value> =
  Access extends "attempt-slot"
    ? AttemptSlotProjectedEntry<Value>
    : Access extends "attempt-origin-run"
      ? AttemptOriginRunProjectedEntry<Value>
      : SelectedRunProjectedEntry<Value>;

interface ProjectionCoverage {
  readonly sample: {
    readonly denominator: number;
    readonly totalSlots: number;
    readonly included: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
  readonly entries: {
    readonly total: number;
    readonly attachmentResult: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
  readonly attachments: {
    readonly available: number;
    readonly unavailable: number;
    readonly migrationRequired: number;
    readonly migrationUnavailable: number;
    readonly unsupported: number;
    readonly invalid: number;
  };
}

interface ProjectedSample<Access extends ProjectionAccess, Value> {
  readonly sample: AnalysisSample;
  readonly access: Access;
  readonly entries: readonly ProjectedEntry<Access, Value>[];
  readonly coverage: ProjectionCoverage;
}
```

`ProjectedSample` 只保存 pure `sample`、entry、Attachment result 与派生 coverage；它不保存 reader、handle、path 或 callback。结果形成后可以显示或交给 Report，但不能用它再次读取 Attachment。

`coverage.sample.denominator` 是 Sample-wide 的 slot denominator，不因 Attachment 状态改变。`coverage.entries` 只统计本次逻辑访问；`coverage.attachments` 只统计 `attachment-result` 中的 Attachment 数据状态。它们都不是 Calculation denominator。

Calculation 的 `observed` 与 `denominator` 由作者返回 domain value，host 不从 transport coverage、entry 数或 access count 推导。`selected-run` 没有 slot entry，因此它的 entry slot-state 计数全为零。

## Direct Effect 入口

```ts
declare const projectAnalysisSample: <
  Access extends ProjectionAccess,
  Value,
>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: RecordProjection<Access, Value>;
}) => Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReadError | ProjectionLimitError
>;
```

Library 从 `sampleHandle` 取得它所绑定的同一个 frozen reader。pure `AnalysisSample` 不在这个入口的输入类型中，因此不能在 reader 关闭后伪装成可继续 I/O 的对象。

```ts
declare const sampleHandle: AnalysisSampleHandle;

const energyBySlot = attemptSlotProjection(energyProjector);

const program = Effect.gen(function* () {
  const projected = yield* projectAnalysisSample({
    sampleHandle,
    projection: energyBySlot,
  });

  for (const entry of projected.entries) {
    switch (entry.state) {
      case "excluded":
      case "not-recorded":
      case "core-invalid":
        break;
      case "attachment-result":
        if (entry.attachment.state === "available") {
          entry.attachment.value.joules;
        }
        break;
    }
  }

  return projected;
});
```

`RecordAttachment` 的数据状态是成功输出。`RecordReadError` 与 `ProjectionLimitError` 是预期的 Effect failure；callback throw 是 defect，interruption 继续保留在 Effect Cause。Report host 使用同一边界，不能把 callback defect 填成 `attachment-result` 或伪造数据 warning。

## Limits

```ts
type ProjectionLimitError = {
  readonly code: "projection-limit-exceeded";
  readonly limit: "logical-entries";
  readonly maximum: number;
  readonly observedAtLeast: number;
};
```

一个 `ProjectedSample` 最多有 250,000 条 logical entry。Library 在分配 entry 或发起 Attachment read 前检查 count；超过上限时返回 `ProjectionLimitError`，不生成部分 `ProjectedSample`。

## 相关阅读

- [Projection README](README.md)：职责、逻辑访问与错误边界。
- [Sample Library](../sample/library.md)：Sample、slot 状态与 live handle。
- [Record Library](../record/library.md)：Attachment family、读取状态与 `RecordReadError`。
- [Reports Library](../reports/library.md)：怎样声明 projection 并消费 `ProjectedSample`。
