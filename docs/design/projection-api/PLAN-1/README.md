# PLAN-1（推荐）：runtime direct projection calls

作者先用三种 logical-access factory 构造 `RecordProjection`，再在普通 TypeScript / Effect 控制流中调用唯一的
direct execution primitive。host 在调用发生时读取，并返回 closed `ProjectedSample`。

```ts
const assertionsByAttempt = attemptSlotProjection(assertionsProjector);
const assertions = yield* projectAnalysisSample({
  sampleHandle,
  projection: assertionsByAttempt,
});

if (needsSources(assertions)) {
  const sources = yield* projectAnalysisSample({
    sampleHandle,
    projection: attemptOriginRunProjection(sourcesProjector),
  });
}
```

三种 declaration factory 固定 logical access：

```ts
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

公开执行面只有：

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

`sampleHandle.project(access, projector)` 不作为第二入口。projector 先绑定只读 Attachment family；
`RecordProjection` 再绑定 logical access；执行入口只消费这份 declaration identity。

`ProjectedSample` 保存 frozen Sample identity、logical entries、coverage 与 projection provenance。available entry
保存同步 projector 返回的 typed view；projector 不能返回 Effect、reader 或延迟 callback。

依赖可以由普通控制流动态决定。host 可以按 declaration identity 做 execution-local memoization，但不能在 I/O 前
声称知道任意 Analysis 程序的完整 projection closure，也不能按未来调用提供全图预算或预取。

Report 可以用自己的 `reportInputs()` 枚举一个 consumer-local 的有限 declaration 集合。这个清单没有公共 node、
edge、`dependsOn`、graph brand 或全图调度保证，因此不把通用 Projection API 变成 PLAN-2。

输出对全部 logical slots 穷尽对齐。excluded、not-recorded 与 core-invalid 不读 Attachment。
included 保留 exact owner，也保留完整的 Attachment 六态。

本候选的优势是心智模型与普通函数一致。代价是通用 host 的规划能力受限；跨 consumer 共享只能靠显式 declaration
复用或透明 memoization，不能依赖静态 graph 保证。

## 生命周期与失败

`AnalysisSampleHandle` 绑定 outer `withSnapshot()` 已经取得的 shared maintenance lease 与 generation。selection
和全部 direct projection calls 复用同一个 frozen view；单次 `projectAnalysisSample()` 不新建 snapshot、不 mint
generation，也不重新取得另一份 maintenance lease。

调用只在 live handle 的 Scope 内合法。projector 完成后 raw Attachment reference 不外泄；closed
`ProjectedSample` 可以在 snapshot 关闭后继续使用。

Record I/O、permission、closed handle 与 limit 是 typed Effect error。Attachment 六态是 entry data。projector
throw 是 defect，interruption 保持 Cause；两者都不能伪装成 Attachment invalid。

## Cases

- P1：按 owner locator 去重读取，但复制成十个 slot entries。
- P2：只为 included entry 读取 Attachment，并原样保留其它 Sample states。
- P3：普通控制流可以在运行中跳过 Sources；host 因而不承诺预知任意 Analysis 闭包。
- P4：Report manifest 可预列自己的 finite declarations，但不获得通用 graph guarantee。

## Limits 与扩展

单 package closure、entry count、同一 generation 内的并发读取与 execution budget 由 Record 和 Projection limits
共同约束。第三方只通过 typed `RecordAttachmentProjector`、三种 factory 与唯一 direct primitive 扩展；不能注册
reader callback。官方 API 不提供 `projectGraph`。
