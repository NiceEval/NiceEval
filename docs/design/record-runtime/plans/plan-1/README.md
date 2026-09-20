# PLAN-1：各 open 独立拥有资源

`openRecordReader(root)` 与 `openRecordWriteSession(root)` 分别建立自己的 Scope、lock lease、registry 与读取
资源。它们都暴露同一个 `FrozenRecordView` contract，但不同 open 之间不承诺共享 root authority、generation
allocator 或 verified read cache。

## 调用面

```ts
declare const openRecordReader: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordReader,
  RecordOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock
>;

declare const openRecordWriteSession: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock | RecordWriterLock | RecordEntropy
>;
```

`RecordReader extends FrozenRecordView`，`RecordWriteSession.view` 也是完整 `FrozenRecordView`。reuse planner
与 Analysis selection 因而共享读取语义，但各自的 host 必须打开或传入所需 capability。

## 生命周期与锁

- reader open 取得 shared maintenance lease，并在同一 Scope 内冻结 view。
- write session open 依次取得 shared maintenance 与 exclusive writer lock，再冻结 `session.view`。
- Scope 关闭时释放 handles 与 locks。
- publish 不刷新 `session.view`；需要看见新 Run 时重新 open reader。

每次 open 自己执行 current-format 与 migration sentinel 检查。多个 open 依赖 filesystem locks 保证正确，
不承诺在同一进程内去重 canonical root 或共享 cache。

## Cache 与错误

实现可以在单次 open 内 memoize，但没有跨 open 的官方保证。consumer 不能观察 cache。

Core/Attachment 问题保留成功 ADT；I/O、permission、busy、closed Scope、旧 Core 与错误 handle 保持既有 typed
error。独立 open 不新增另一套错误分类。

## Cases

- RR1：关闭 write session 后重新 open reader，Report 才看到刚发布 Run。
- RR2：每次 rebuild 重新 open reader；每个 reader 自己持有 lease。
- RR3/RR4：跨 open cache 不受契约保证，正确性仍由完整读取与验证提供。
- RR5/RR6/RR7：沿用现有 complete marker、Scope 与 locks 规则。

## 取舍

本方案的资源 ownership 简单，Library 调用点直接。代价是同一 host operation 的多个 open 没有统一 root-level
authority，也不能正式共享 verified package material；“Runner 与 Report 共用 `FrozenRecordView`”只成立于接口层。
