# Limits

- Projection 不能选择 Run、改变 Sample、读取第二个 package、建立跨包 relation 或计算指标。
- 输入使用 Record 基础状态加 layout 参数，不能把 PLAN-2 的 Receipt 状态强加给所有 package：

```ts
type PackageReadResult<Value, LayoutState = never> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "attachment-result"; readonly result: NonAvailableRecordAttachmentRead }
  | LayoutState;

declare const PackageAccessBrand: unique symbol;

interface PackageAccess<OwnerKind, Payload, LayoutState = never> {
  readonly owner: PackageOwnerSelection<OwnerKind>;
  readonly family: RecordAttachmentFamily<OwnerKind, Payload>;
  readonly [PackageAccessBrand]: {
    readonly ownerKind: OwnerKind;
    readonly payload: Payload;
    readonly layoutState: LayoutState;
  };
}

type AccessLayoutState<Access> =
  Access extends PackageAccess<unknown, unknown, infer LayoutState> ? LayoutState : never;

type ProjectedSample<View, OwnerKind, Value, LayoutState> = {
  readonly view: View;
  readonly sample: AnalysisSample;
  readonly entries: readonly ProjectedEntry<OwnerKind, Value, LayoutState>[];
  readonly coverage: ProjectionCoverage;
  readonly provenance: ProjectionProvenance;
};

type ProjectedEntry<OwnerKind, Value, LayoutState> =
  | ExcludedProjectionEntry
  | NotRecordedProjectionEntry
  | CoreInvalidProjectionEntry
  | {
      readonly state: "included";
      readonly slot: LogicalSlot;
      readonly owner: OwnerRef<OwnerKind>;
      readonly result: PackageReadResult<Value, LayoutState>;
    };
```

Assertions、Verdict、Sources 与七-family layout 使用 `LayoutState = never`。Physical Observability layout
提供自己的封闭 state 联合；Projection 只传播该参数，不解释 Receipt 或 representation。
- available package 由 Record 完整验证并读取完整 payload；Projection 不承诺 partial/range read。
- 输出不得携带 reader、path、Stream、migration callback 或 live capability。
- facade、字段别名和把多个声明包进对象的语法糖不构成独立候选。
