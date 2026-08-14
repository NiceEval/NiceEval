# ① Record

```text
┌────────────────────────────────────┐
│ Record = 运行事实账本              │
│ 运行时追加，完成后封口             │
└────────────────────────────────────┘
```

## 心智模型

Record 回答“这次运行实际发生了什么”。它保存不可重新计算的事实，不保存对事实的统计解释，也不保存某个 Report 的展示结果。

Record 在运行期间由一个 owner 追加。完成、失败或中止后形成 sealed snapshot。Analysis、Report 和 CLI 只使用 sealed snapshot，不观察半写入状态。

## 解决的问题

- 保存 Run、Attempt、Event、评价结果、Evidence 与 Artifact。
- 固定事实 identity、producer identity、发生顺序与完成状态。
- 保证写入、封口、blob closure 和崩溃恢复的一致性。
- 校验当前 Record schema 与完整引用图。
- 通过显式 migration 把旧格式升级为当前格式。

Record 不保存 pass rate、平均值、比较排名、denominator、missing 汇总或图表数据。这些内容能够从事实与 Analysis 定义重新计算。

## 输入与输出

```text
Capture events
      ↓
Record write session
      ↓
Current sealed Record
```

Record 对 Analysis 输出当前版本的 frozen snapshot：

```ts
interface CurrentRecord {
  readonly identity: RecordIdentity;
  readonly schemaVersion: CurrentRecordVersion;
  readonly runs: readonly RunFact[];
  readonly attempts: readonly AttemptFact[];
  readonly events: readonly EventFact[];
  readonly evaluations: readonly EvaluationFact[];
  readonly evidence: readonly EvidenceDescriptor[];
  readonly artifacts: readonly ArtifactDescriptor[];
  readonly completion: RecordCompletion;
}
```

这是平台内部形状。application、Analysis package 和 Report package都不能 import `CurrentRecord`。

## Capture capability

领域 API 产生 typed facts，Record host 拥有实际写入 authority：

```ts
interface RecordWriteSession {
  append(event: CaptureEvent): Promise<void>;
  complete(result: RecordCompletion): Promise<void>;
  abort(problem: CaptureProblem): Promise<void>;
}
```

普通 Eval 作者拿到领域 Plugin、Capture token 或 `TestContext`，拿不到 Record root、writer、schema version 或文件路径。

## 当前版本访问

平台内部只提供当前版本访问：

```ts
declare function openCurrentRecord(
  locator: RecordLocator,
): Promise<CurrentRecordSnapshot>;

declare function validateCurrentRecord(
  locator: RecordLocator,
): Promise<RecordValidation>;
```

`openCurrentRecord()` 遇到旧版本时返回 `migration-required`。它不调用历史 converter，也不返回 `RecordV1 | RecordV2 | CurrentRecord`。

版本探测只读取稳定的最外层格式标识：

```ts
declare function inspectRecordVersion(
  locator: RecordLocator,
): Promise<RecordVersionInspection>;
```

版本探测不能枚举或解释旧版本事实。

## Migration capability

Migration 是 Record 层内部的格式升级：

```text
Old Record
   ↓ inspect + plan
RecordMigrationPlan
   ↓ authorize
staging snapshot
   ↓ adjacent converters
current validation
   ↓ atomic publication
Current Record + RecordMigrationReceipt
```

平台内部 capability：

```ts
declare function planRecordMigration(
  locator: RecordLocator,
): Promise<RecordMigrationPlan>;

declare function applyRecordMigration(
  plan: RecordMigrationPlan,
  authorization: MigrationAuthorization,
): Promise<RecordMigrationReceipt>;
```

普通用户只调用 CLI：

```console
niceeval migrate
niceeval migrate --yes
```

第一次调用执行只读 preflight 并打印计划。`--yes` 只批准 source identity 与 converter set 均未变化的计划。转换、全图校验与 blob closure 检查都在 staging 中完成，任一步失败都不替换 source。

## Schema 升版门槛

只有以下变化可以升 Record schema：

- 新增无法从现有事实恢复的 Capture 事实。
- 现有持久字段语义错误，旧事实无法按原 schema 正确解释。
- 现有结构无法表达必须原子提交的新事实关系。
- 完整性、安全性或 blob closure 要求必须改变持久格式。

以下变化不能升 Record schema：

- 新增 Dimension、Measure 或 relation。
- 修改 retry、missing、denominator 或比较算法。
- 新增 Table、Chart、Page 或领域组件。
- 新增 terminal、Web 或 static 展示能力。
- 保存可以从 Record 重新计算的缓存或摘要。

## 禁止跨出的边界

- 不向 Report 暴露文件、目录、blob path 或 schema family。
- 不把历史版本联合交给 Analysis。
- 不允许 application 注册 converter。
- 不通过 migration 修正已发布的领域事实；事实修正使用具名 correction 或新 identity。
- 不让普通 `show`、`view` 或 Report execution 静默迁移。
