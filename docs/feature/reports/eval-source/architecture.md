# 源码证据与调用树

源码调用树由 Record 中已经 snapshot 的事实产生。
采集端保存声明位置、调用路径、源码正文和捕获限制；Reports 只通过 SourceProjector 读取这些事实。

## 位置与调用路径

```ts
interface SourceLoc {
  file: string;
  line: number;
  column?: number;
  callers: readonly SourcePathFrame[];
}

type SourcePathFrame =
  | { kind: "project"; file: string; line: number; column?: number }
  | { kind: "package"; package: string };
```

`SourceLoc` 与 `SourcePathFrame` 的唯一 owner 是本页；它们描述已 snapshot 的源码定位值，不是 Record event 的替代 schema。

Projector 不从当前 `process.cwd()`、文件系统或 stack text 推断这条路径。
它只读取 snapshot 进固定 RecordGraphRef 的 provenance 与 evidence，并由 `ProjectionReadContext` 收集 basedOn。

## SourceProjection

```ts
type SourceTreeNodeKind =
  | "source"
  | "package"
  | "unavailable"
  | "detached"
  | "unmapped";

interface SourceAnnotation {
  readonly kind: "assertion" | "score" | "send" | "abort" | "unavailable";
  readonly label: string;
}

interface AnnotatedSourceLine {
  readonly line: number;
  readonly text?: string;
  readonly annotations: readonly SourceAnnotation[];
}

interface AnnotatedSourceNode {
  readonly kind: SourceTreeNodeKind;
  readonly label: string;
  readonly lines: readonly AnnotatedSourceLine[];
  readonly children: readonly AnnotatedSourceNode[];
}

interface AnnotatedEvalSource {
  readonly roots: readonly AnnotatedSourceNode[];
}

interface SourceProjection {
  attempt: AttemptRef;
  tree: EvidenceValue<AnnotatedEvalSource>;
}
```

`SourceTreeNodeKind`、`SourceAnnotation`、`AnnotatedSourceLine`、`AnnotatedSourceNode`、`AnnotatedEvalSource` 与 `SourceProjection` 的唯一 owner 是本页。
`AttemptRef` 与 `EvidenceValue` 由 [Record Library](../../record/library.md#attempt-与-attemptref) owner。

`AnnotatedEvalSource` 是面无关的完整树。
它可以包含 entry、detached 片段、unmapped 条目、调用摘要和已知的捕获缺口。
text/web 的上下文半径、行预算与展开策略只作用于该树的显示值。

## 读取与 identity

SourceProjector 由 Record-owned `defineAttemptProjector<Input, Params, T>()` 构造。
它使用对象形 `id`、parameters schema 与只接收 `(ctx, parameters)` 的 `projectNormalized`，不接收 raw Attempt。

parameters 的 `defaults` 是完整规范化 Params，可选 input 省略时按空对象规范化；
`dependencies` 只声明实际 Projector object，省略时 runtime 使用冻结的空数组。

`projectNormalized()` 只返回 raw `T`，作者不能构造 available/unavailable。
runtime 冻结规范化参数与结果，并由 tracked read 形成 `EvidenceValue`。

它的完整 identity 包含 namespace、name、version、参数 schema、JCS 参数、RecordGraphRef、attemptId 和 adopted NodeRef。
SourceProjection 不会写回 Record，也不会被另一个 renderer 当成事实 provenance。

## 导出

当 ReportPlan 请求源码时，exporter 收集 SourceProjector 的全部 basedOn 闭包。
目标 Report Store 用 `RecordEvidenceProofIndexV1` 分页引用本次消费的 event、object、Claim 与 authenticated absence proof，保存源 Graph、inert 原始 bytes 与 canonical path。
它不会把源 stream 或 Claim 变成目标 Store 的活动对象。

采集时本来没有源码可供读取，Projector runtime 根据 tracked read 形成 unavailable
`EvidenceValue`；author function 仍只返回 raw `AnnotatedEvalSource`。
源中有 evidence 而 exporter 无法复制或验证时，导出失败。
Report wrapper 把 source reader 与 proof closure failure 统一归为
`report-evidence-closure-failed`。
它按 phase 完整保留 `RecordSourceFailure` 或 `RecordEvidenceProofFailure`，不把 typed owner cause
改成 message。
