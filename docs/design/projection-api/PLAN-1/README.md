# PLAN-1：runtime direct projection calls

作者在普通 TypeScript / Effect 控制流中调用 live Sample handle。每次调用明确给出 package access 与同步
projector；host 在调用发生时读取并返回 closed `ProjectedSample`。

```ts
const otel = yield* sample.project(otelAccess, otelProjector);
if (needsAssertions) {
  const assertions = yield* sample.project(assertionsAccess, assertionsProjector);
}
```

公开调用面只有 direct call：

```ts
interface AnalysisSampleHandle<View> {
  project<OwnerKind, Payload, Value, LayoutState>(
    access: PackageAccess<OwnerKind, Payload, LayoutState>,
    projector: (available: RecordAttachmentValue<Payload>) => Value,
  ): Effect.Effect<
    ProjectedSample<View, OwnerKind, Value, LayoutState>,
    RecordReadError | ProjectionLimitError
  >;
}
```

`ProjectedSample` 的 included entry 保存 `PackageReadResult<Value, LayoutState>`。整体结果还保存 frozen
Sample identity、logical entries、coverage 与 projection provenance。projector
同步消费一个已验证 available value；它不能返回 Effect、reader 或延迟 callback。

依赖可以由普通控制流动态决定。host 可以按 access identity 做 execution-local memoization，但不能在 I/O 前
声称知道完整 projection closure，也不能基于未来调用做全图预算或预取。

输出对所有 logical slots 穷尽对齐。excluded、not-recorded 与 core-invalid 不读 package。
included 保留 exact owner，以及 available、attachment-result、capture-expectation 或 representation-unavailable。

本候选的优势是心智模型与普通函数一致。代价是 host 的规划能力受限。跨 consumer 共享依赖必须靠显式复用
或透明 memoization，不能依赖静态图保证。

## 生命周期与失败

调用只在 live `AnalysisSampleHandle` 的 Scope 内合法。host 在每次调用时取得 snapshot lease，完成 projector 后
释放 raw reference；closed `ProjectedSample` 可以在 reader 关闭后继续使用。

Record I/O、permission、closed handle 与 limit 是 typed Effect error。Attachment 六态是 entry data。
projector throw 是 defect，interruption 保持 Cause；两者都不能伪装成 Attachment invalid。

## Cases

- P1：按 owner locator 去重读取，但复制成十个 slot entries。
- P2：只为 included entry 调用 package access，并原样保留其它 Sample states。
- P3：普通控制流可以在运行中跳过 Sources；host 因而不承诺预知完整闭包。

## Limits 与扩展

单 package closure、entry count、并发 lease 与 execution budget 由 Record 和 Projection limits 共同约束。
第三方只通过 typed `PackageAccess` 与同步 projector 扩展；不能注册 reader callback。官方 API 不提供
`projectGraph`，否则会产生无法兑现的静态闭包保证。
