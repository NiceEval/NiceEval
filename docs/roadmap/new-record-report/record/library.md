# Record Library（持久事实库）

本页同时说明 NiceEval 内部 definition API（定义接口）和 `niceeval/record/host` 的宿主操作。内部接口用于统一实现和版本迭代，不是 npm export（npm 导出），也不是第三方 SPI（服务提供者接口）。

## 对外没有 Record Definition API

以下入口不存在：

```ts
import { defineRecordAttachment, defineRecordMigration } from "niceeval";
import { RecordWriter, RecordReader } from "niceeval/record";
```

Eval 作者写断言，Adapter 作者调用 NiceEval 已发布的 collector：

```ts
await t.check("answer is grounded", grounded(answer));
otelBridge.emit(span);
eventCollector.append(event);
diffCollector.capture(workspaceChange);
```

这些 API 提交领域值，不赋予调用者 attachment identity（附件身份）、schema、文件路径、锁或 migration 权限。

## 内部 Definition API

下面的伪代码表达 NiceEval 仓库内部模块契约。它不从 package root（包根入口）或子路径导出。

```ts
interface InternalRecordAttachment<Value> {
  readonly kind: "internal-record-attachment";
  readonly id: InternalRecordAttachmentId;
  readonly owner: "run" | "attempt";
  readonly cardinality: "one" | "many";
  readonly currentVersion: number;
  readonly currentSchema: Schema.Schema<Value>;
}

interface InternalRecordMigration<From, To> {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly fromSchema: Schema.Schema<From>;
  readonly toSchema: Schema.Schema<To>;
  readonly migrate: (value: From) => To;
}

declare function defineInternalRecordAttachment<Value>(options: {
  readonly id: InternalRecordAttachmentId;
  readonly owner: "run" | "attempt";
  readonly cardinality: "one" | "many";
  readonly current: {
    readonly version: number;
    readonly schema: Schema.Schema<Value>;
  };
  readonly limits: RecordAttachmentLimits;
  readonly migrations: readonly InternalRecordMigration<unknown, unknown>[];
}): InternalRecordAttachment<Value>;

declare function defineInternalRecordMigration<From, To>(options: {
  readonly from: { readonly version: number; readonly schema: Schema.Schema<From> };
  readonly to: { readonly version: number; readonly schema: Schema.Schema<To> };
  readonly migrate: (value: From) => To;
}): InternalRecordMigration<From, To>;
```

只有 NiceEval 代码库可以向编译时 registry（注册表）加入定义。ID 使用 `niceeval.*` 保留空间；不做运行时 package discovery（包发现），不加载项目代码提供的 migration。

definition 固定 payload shape（载荷形状）、owner、基数、限制和语义。显示名、颜色、图表格式与统计口径不属于 Record definition。

### 内部 OTel 定义示例

```ts
const OTelV1 = Schema.Struct({
  spans: Schema.Array(SpanV1),
});

const OTelV2 = Schema.Struct({
  spans: Schema.Array(SpanV2),
  limitations: Schema.Array(CollectionLimitation),
});

const otelAttachment = defineInternalRecordAttachment({
  id: InternalRecordAttachmentId("niceeval.otel"),
  owner: "attempt",
  cardinality: "one",
  current: { version: 2, schema: OTelV2 },
  limits: otelLimits,
  migrations: [
    defineInternalRecordMigration({
      from: { version: 1, schema: OTelV1 },
      to: { version: 2, schema: OTelV2 },
      migrate: old => ({ spans: upgradeSpans(old.spans), limitations: [] }),
    }),
  ],
});
```

`migrate` 必须是 pure function（纯函数）。它只能读取旧值，不能访问文件、网络、当前时间、另一 attachment 或运行中的 Adapter。

## 内部 Capture API

Runner 按当前 Run / Attempt 与 producer 签发 owner-bound capture（归属者绑定采集器）。领域 API 的实现才能取得它：

```ts
interface InternalRecordCapture {
  put<Value>(
    definition: InternalRecordAttachment<Value> & { readonly cardinality: "one" },
    value: Value,
  ): Effect.Effect<RecordAttachmentRef, RecordCaptureError>;

  append<Value>(
    definition: InternalRecordAttachment<Value> & { readonly cardinality: "many" },
    value: Value,
  ): Effect.Effect<RecordAttachmentItemRef, RecordCaptureError>;
}
```

```ts
// OTel bridge 内部实现；Adapter 作者只调用 otelBridge.emit(span)
yield* capture.put(otelAttachment, closeOtelBatch(collectedSpans));
```

写入时立即验证 current schema（当前格式）、owner、producer、cardinality 和大小限制。重复写入、越界、解码失败或跨 owner 使用都返回具名 `RecordCaptureError`。

大型内容先写成 Artifact，再把 `ArtifactRef` 作为内部 definition 字段。调用者不能提供 blob key（材料键）或磁盘路径。

## Record Host SDK

Application Host 从 `niceeval/record/host` 取得三个窄 facet（分权接口）：

```ts
interface RecordHostSDK {
  snapshot(request: RecordSnapshotRequest): Effect.Effect<
    CurrentRecordSnapshot,
    RecordSnapshotOpenError,
    Scope.Scope
  >;

  write(request: RecordWriteRequest): Effect.Effect<
    RecordWriteSession,
    RecordWriteOpenError,
    Scope.Scope
  >;

  maintenance(request: RecordMaintenanceRequest): Effect.Effect<
    RecordMaintenanceSession,
    RecordMaintenanceOpenError,
    Scope.Scope
  >;
}
```

| facet | 自动取得的资源 | 能做什么 |
|---|---|---|
| `snapshot()` | shared maintenance lock（共享维护锁） | 读取当前 schema 的 sealed Run，并向 Analysis host 提供冻结快照 |
| `write()` | shared maintenance + writer lock（共享维护锁 + 写入锁） | 读取会话打开时的 frozen view（冻结视图），写草稿并原子 seal Run |
| `maintenance()` | exclusive maintenance lock（独占维护锁） | 检查格式、规划迁移、应用迁移和恢复维护状态 |

调用者不取得 `LockSDK`，也不手动 release（释放）锁。Effect Scope（Effect 资源作用域）关闭时释放资源。

`CurrentRecordSnapshot` 是 opaque capability（不透明能力）。它没有公共 `get(attachment)` 或 `list(table)`；只有 Analysis host 中 NiceEval 发布的 input projector（输入投影器）可以消费它。这阻止 Analysis 作者绕过稳定输入面读取内部 payload。

## 写会话与原子发布

```ts
interface RecordWriteSession {
  readonly view: CurrentRecordSnapshot;

  run(input: RunExecutionInput): Effect.Effect<
    InvocationReceipt,
    RecordWriteError
  >;

  sealReferenceRun(input: ReferenceRunSealInput): Effect.Effect<
    RecordSealReceipt,
    RecordWriteError
  >;
}
```

`view` 只包含 write session 打开时已经发布的 Run，不包含本次草稿。`run()` 把内部 Capture 只授予 runner、Assertion 和 collector 实现；调用者不能直接取得 Capture。发布前等待全部 collector 停稳，并验证 Core、required attachment（必需附件）、owner、基数和引用闭包。

## 物理保存合同

Record 不承诺某张公共数据库表。它只承诺可整体复制的 root 与逻辑关系：

```text
Record root
├─ Core：Run / Slot / Attempt / completion / reference membership
├─ Internal attachment envelope：definition ID / version / owner / producer
├─ typed payload bytes
└─ Artifact blobs：content-addressed immutable bytes
```

verified cache、索引和 lock file（锁文件）都可删除后重建；staging 未发布时也可直接丢弃。它们不属于 Record schema，Analysis 不能查询这些物理对象。

## 相邻 Migration 操作

只允许 `to.version === from.version + 1`。同一个内部 definition 的 migration graph（迁移图）必须从每个受支持旧版本唯一到达 current version（当前版本），不能分叉、跳级或按 reader 猜路径。

```ts
interface RecordMaintenanceSession {
  inspect(): Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  planMigrate(): Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  applyMigrate(
    plan: RecordMigrationPlan,
    authorization: RecordMigrationAuthorization,
  ): Effect.Effect<RecordMigrationReceipt, RecordMigrationError>;
}
```

执行顺序固定为：decode vN → migrate vN→vN+1 → validate vN+1 → 继续下一步。全部 attachment 完成后再验证整份 Record，并从 staging 原子发布。任一步失败都不修改 source Record（原事实集）。

| error code | 含义 | 下一步 |
|---|---|---|
| `migration-required` | 当前 NiceEval 已知旧版本且有完整相邻链 | 运行 `niceeval migrate` |
| `migration-definition-missing` | 当前 NiceEval build 的内部迁移链不完整 | 升级到修复版本；不要求安装第三方 package |
| `migration-step-failed` | converter 抛错或下一 schema 校验失败 | NiceEval 修复该具名 migration；source Record 保持不变 |
| `migration-plan-changed` | root、build 或 migration 集合已变化 | 重新形成计划并再次授权 |
| `migration-interrupted` | staging 尚未发布时中断 | 从维护恢复点继续，或丢弃未发布 staging |

普通 `snapshot()` 不运行 migration。`show`、`view` 与 `exp` 遇到旧格式时返回 `migration-required`，不做 reader compatibility（读取兼容转换）。

## Cache（缓存）归属

Record Host SDK 只拥有按精确内容身份建立的 verified cache。Analysis query cache 属于 Analysis；Report execution 与 Web revision cache 属于 Report。任何 cache 都不能携带 writer、lock 或 migration authority（迁移权限）。
