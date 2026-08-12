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

available Attachment 是 Record Library 唯一拥有的完整 `RecordAttachmentValue<Payload>`。它由 package 在读取完成时一次性构成，不存在部分读取形态；projector 同步消费它。blobs 的 package-owned snapshot 与只读访问语义由 Record Library 定义，Projection 不定义或复制该类型。

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

## Source navigation primitives

`niceeval/projection` 还导出 Assertions 源码导航所需的三个 fixed projector 和一个 pure assembler。
它们是普通 Projection API，不是 Report host 的特权入口。每个 projector 把已解码的 Attachment
深复制为当前的语义值；payload、blob ref、schema type 与 Record capability 不会向上泄露。
未来 Sources 或 source-sites 的持久格式变化，只在对应 decoder／adapter 收敛，调用者继续消费本节的
无版本值。

```ts
import type { SlotId } from "niceeval/record";

type AssertionSourceEntry =
  | {
      readonly state: "available";
      readonly entry: AssertionSourceEntryValue;
    }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionSourceEntryValue;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionSourceEntryValue;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };

type AssertionSourceEntryValue = {
  readonly entryId: AssertionEntryId;
  readonly display: {
    readonly key?: string;
    readonly label?: string;
    readonly groupPath: readonly string[];
  };
  readonly result: AssertionSourceResult;
};

type AssertionsSourceProjection = {
  readonly entries: readonly AssertionSourceEntry[];
};

type AssertionSourceResult =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: AssertionSourceScore;
    };

type AssertionSourceScore =
  | { readonly state: "not-scored" }
  | { readonly state: "earned"; readonly points: number; readonly earned: number }
  | {
      readonly state: "unavailable";
      readonly points: number;
      readonly reason:
        | "source-unavailable"
        | "evaluation-errored"
        | "not-applicable";
    };

type SourcePackageItemRef = {
  readonly kind: "package";
  readonly packageItemId: SourcePackageItemId;
};

type SourceFileItemRef = {
  readonly kind: "file";
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
};

type AssertionSourceSitesProjection = {
  readonly entries: readonly AssertionSourceSitesEntry[];
  readonly sendSites: readonly AssertionSourceSendSite[];
};

type SourcesProjection = {
  readonly packages: readonly SourcePackageProjection[];
};

type SourcePackageProjection = {
  readonly ref: SourcePackageItemRef;
  readonly label: string;
  readonly files: readonly SourceFileProjection[];
};

type SourceFileProjection = {
  readonly ref: SourceFileItemRef;
  readonly path: string;
  readonly text: string;
};

declare const assertionsProjector: RecordAttachmentProjector<
  "attempt",
  AssertionsSourceProjection
>;

declare const assertionSourceSitesProjector: RecordAttachmentProjector<
  "attempt",
  AssertionSourceSitesProjection
>;

declare const sourcesProjector: RecordAttachmentProjector<
  "run",
  SourcesProjection
>;
```

`assertionsProjector` 保留 entry 的 declaration order，以及 criterion 的 entry-local
available、unsupported 与 invalid 状态。
每条 entry 只携带源码导航所需的 identity、display 与 sealed result。

`assertionSourceSitesProjector` 深复制 source-site trace、occurrence、source item ref 和 coordinate，形成
`AssertionSourceSitesProjection`。它不是持久 document 的别名。

`AssertionSourceSitesEntry`、`AssertionSourceSite`、`AssertionSourceSendSite` 与
`AssertionSourceTrace` 是同一份无版本 view 的组成部分。
`SourceCoordinate`、`SourcePackageItemRef` 与 `SourceFileItemRef` 表达已 materialize snapshot 内的
join identity，不授予 blob、path 或另一个 Attachment 的读取能力。

`sourcesProjector` 只在 Sources Attachment available 后 materialize package label、file display path
和已验证的 canonical UTF-8/LF text。它不读取当前 worktree。三个 projector 都由包创建，不能被同形
object 或另一个 Attachment family 冒充。

```ts
type AttemptSourceTreeAssemblyInput = {
  readonly assertions: ProjectedSample<
    "attempt-slot",
    AssertionsSourceProjection
  >;
  readonly sourceSites: ProjectedSample<
    "attempt-slot",
    AssertionSourceSitesProjection
  >;
  readonly sources: ProjectedSample<
    "attempt-origin-run",
    SourcesProjection
  >;
};

type AttemptSourceTreeAssemblyIssue =
  | { readonly code: "sample-mismatch" }
  | {
      readonly code: "slot-alignment-mismatch";
      readonly slotId: SlotId;
    };

type AttemptSourceTreeAssemblyResult =
  | {
      readonly state: "assembled";
      readonly value: AttemptSourceTreeSample;
    }
  | {
      readonly state: "input-invalid";
      readonly issues: readonly [
        AttemptSourceTreeAssemblyIssue,
        ...AttemptSourceTreeAssemblyIssue[],
      ];
    };

declare const assembleAttemptSourceTree: (
  input: AttemptSourceTreeAssemblyInput,
) => AttemptSourceTreeAssemblyResult;
```

输入的三个 `ProjectedSample` 必须来自同一个 `AnalysisSample`，并按同一 slot identity 对齐。
`assembleAttemptSourceTree` 不做 I/O、不接收 reader、path、blob、callback 或 Report object。若这两个
前提不成立，它返回 `input-invalid`，而不是把不相关的 Run、Attempt 或 array position 配对。

```ts
type AttemptSourceAssertionsAttachment = Extract<
  AttemptSlotProjectedEntry<AssertionsSourceProjection>,
  { readonly state: "attachment-result" }
>;

type AttemptSourceSitesAttachment = Extract<
  AttemptSlotProjectedEntry<AssertionSourceSitesProjection>,
  { readonly state: "attachment-result" }
>;

type AttemptSourcesAttachment = Extract<
  AttemptOriginRunProjectedEntry<SourcesProjection>,
  { readonly state: "attachment-result" }
>;

type AttemptSourceTreeSlot =
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
      readonly assertions: AttemptSourceAssertionsAttachment;
      readonly sourceSites: AttemptSourceSitesAttachment;
      readonly sources: AttemptSourcesAttachment;
      readonly tree: AttemptSourceTree;
    };

type AttemptSourceTreeSample = {
  readonly sample: AnalysisSample;
  readonly slots: readonly AttemptSourceTreeSlot[];
};
```

`slots` 与 input Sample 的 slot order 一一对应。它穷尽 `excluded`、`not-recorded`、`core-invalid` 与
`attachment-result`。

前三种 slot state 不触发 Attachment I/O。`attachment-result` 原样保留每份 Attachment 的
six-state result：`available`、`unavailable`、`migration-required`、`migration-unavailable`、
`unsupported` 或 `invalid`。一份附件不能读取时，不会伪装成 empty source tree 或改变另两份
Attachment 的状态。

```ts
type AttemptSourceUnavailableAttachment =
  | {
      readonly attachment: "assertions";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionsSourceProjection>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "source-sites";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionSourceSitesProjection>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "sources";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<SourcesProjection>,
        { readonly state: "available" }
      >;
    };

type AttemptSourceUnmappedReason =
  | {
      readonly code: "attachment-not-available";
      readonly attachment: AttemptSourceUnavailableAttachment;
    }
  | { readonly code: "source-sites-entry-missing" }
  | { readonly code: "source-sites-entry-orphan" }
  | { readonly code: "source-sites-entry-duplicate" }
  | { readonly code: "source-order-duplicate"; readonly sourceOrder: number }
  | {
      readonly code: "package-item-missing";
      readonly target: SourcePackageItemRef;
    }
  | {
      readonly code: "file-item-missing";
      readonly target: SourceFileItemRef;
    }
  | {
      readonly code: "file-digest-mismatch";
      readonly target: SourceFileItemRef;
    }
  | {
      readonly code: "coordinate-out-of-range";
      readonly coordinate: SourceCoordinate;
    }
  | { readonly code: "trace-malformed" };

type AttemptSourceUnmapped =
  | {
      readonly kind: "assertion-entry";
      readonly entry: AssertionSourceEntry;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSite;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "orphan-assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSite;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "send";
      readonly site: AssertionSourceSendSite;
      readonly occurrence: AssertionSourceSendOccurrence;
      readonly reason: AttemptSourceUnmappedReason;
    };

type AttemptSourceEntryUnmapped = Extract<
  AttemptSourceUnmapped,
  { readonly kind: "assertion-entry" | "assertion-site" }
>;

type AttemptSourceUnownedUnmapped = Extract<
  AttemptSourceUnmapped,
  { readonly kind: "orphan-assertion-site" | "send" }
>;

type AttemptSourceAnnotation =
  | {
      readonly kind: "assertion";
      readonly entryId: AssertionEntryId;
      readonly occurrence: AssertionSourceOccurrence;
    }
  | {
      readonly kind: "send";
      readonly occurrence: AssertionSourceSendOccurrence;
    };

type AttemptSourceTreeLine = {
  readonly line: number;
  readonly text: string;
  readonly annotations: readonly AttemptSourceAnnotation[];
  readonly calls: readonly AttemptSourceTreeNode[];
};

type AttemptSourceFileNode = {
  readonly kind: "file";
  readonly file: SourceFileProjection;
  readonly lines: readonly AttemptSourceTreeLine[];
};

type AttemptSourcePackageNode = {
  readonly kind: "package";
  readonly package: SourcePackageProjection;
  readonly calls: readonly AttemptSourceTreeNode[];
};

type AttemptSourceTreeNode =
  | AttemptSourceFileNode
  | AttemptSourcePackageNode;

type AttemptSourceTreeEntry = {
  readonly entry: AssertionSourceEntry;
  readonly mappedSites: readonly AssertionSourceSite[];
  readonly unmapped: readonly AttemptSourceEntryUnmapped[];
};

type AttemptSourceTreeSummary = {
  readonly entries: number;
  readonly results: {
    readonly matched: number;
    readonly mismatched: number;
    readonly unavailable: number;
    readonly errored: number;
    readonly notApplicable: number;
  };
  readonly score: {
    readonly earnedPoints: number;
    readonly earned: number;
    readonly unavailablePoints: number;
  };
};

type AttemptSourceTree = {
  readonly roots: readonly AttemptSourceTreeNode[];
  readonly entries: readonly AttemptSourceTreeEntry[];
  readonly unmapped: readonly AttemptSourceUnownedUnmapped[];
  readonly summary: AttemptSourceTreeSummary;
};
```

assembler 对每个可定位 trace 建立 file／package tree。file line 的 annotation 按 unique
`sourceOrder` 排序。send annotation 的 label、terminal status 与 duration 全部来自
`AssertionSourceSendOccurrence`；不从 source-order gaps 或其它 Attachment 补值。

`entries` 对每个 Assertions `entryId` 恰有一项。一个 entry 可在多个 mapped site 出现，也可同时有
mapped site 与 locally unmapped site；line annotation 因而可以出现多次。`summary` 只遍历这份 unique
entry list：每条 sealed result 与 score contribution 按 `entryId` 计一次，不把多 site、role 或
occurrence 变成额外 check 或分值。send 不参与 Assertions summary 或 score。

`entries[].unmapped` 保留归属 entry 的 local mapping failure 及其 reason。`tree.unmapped` 保留没有
可归属 entry 的 row，以及 send failure。两者都不会把整个 slot 降格。只有 attachment own decode 或
closure 错误才使用对应的 six-state Attachment result。未知、重复或无法 join 的 source-sites row
不会让其它 entry、site 或 send 消失。

官方 Report 与第三方 consumer 都调用这三个 exported projector 和同一个 pure assembler。Report、page
或 Calculation 可以消费 `AttemptSourceTreeSample`，但不存在私有 host reader 或额外 owner lookup
作为替代输入。

## Evaluation plan primitive

`evaluationPlanProjector` 是 Run-owned 的中立语义投影。它只回答某个已选 Slot 在这份 Run 的
evaluation plan 中对应哪组 experiment、eval 与 attempt 坐标；它不复制持久 plan 的数组结构，也不从
Attempt、当前 worktree 或其它 Attachment 补值。

```ts
type EvaluationPlanCoordinate = {
  readonly experimentId: ExperimentId;
  readonly evalId: string;
  readonly attempt: number;
  readonly kind: "pass" | "score";
};

type EvaluationPlanView = {
  readonly coordinateForSlot: (
    slotId: SlotId,
  ) => EvaluationPlanCoordinate | undefined;
};

declare const evaluationPlanProjector: RecordAttachmentProjector<
  "run",
  EvaluationPlanView
>;
```

`coordinateForSlot()` 返回 `undefined` 表示 available plan 没有这条 Slot 的语义坐标；Report 必须把它作为
可见的 partial 输入，而不是猜测或静默省略。history 一类 Report 通过 `selectedRunProjection` 取得当前
selected Run 的 plan，再和 attempt-slot projection 按 `(runId, slotId)` 做纯 join。这个 join 不触发另一次
owner lookup、不读取当前 worktree 或其它 Attachment，也不把 reference Member 变成另一份 physical Attempt。

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
