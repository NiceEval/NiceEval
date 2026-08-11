# Projection：解释已选 Sample 上的 RecordAttachment

Projection 位于 [AnalysisSample](../sample/README.md) 与 [Report](../reports/README.md) 之间。它从仍然存活的 `AnalysisSampleHandle` 读取已选 owner 的 `RecordAttachment`，并形成自包含的 `ProjectedSample`。

```text
AnalysisSampleHandle + RecordAttachment projector
                         │
                         ▼
                   ProjectedSample
                    │            │
                    ├─ script     └─ Report
```

Projection 不选择 Run、不重建 Sample 分母、不计算通过率，也不决定 reuse。Analysis selection 拥有 Sample 分母；RecordAttachment projector 只解释一个明确 owner 上的一类 Attachment；Projection 负责把两者按逻辑访问对齐。

## 三种逻辑访问

- `attemptSlotProjection(projector)`：对 `sample.slots` 的每一项形成 entry。included slot 读取它精确引用的 Attempt Attachment。
- `attemptOriginRunProjection(projector)`：仍对每个 slot 形成 entry。included slot 沿精确 Attempt 的 `originRunId` 读取该 Run Attachment。
- `selectedRunProjection(projector)`：对 `sample.runs` 的每一项形成 entry，并读取该 Run Attachment。

前两种访问不会丢掉 excluded、not-recorded 或 core-invalid slot。十个 slot 即使引用同一个 Attempt 或 origin Run，`ProjectedSample` 仍保留十条按 slot 对齐的 entry。`selectedRunProjection` 不把 reference 的 origin Run 加入 selected Runs，也不从 slot 推导额外 Run。

## 穷尽结果与错误边界

slot projection 的每条 entry 恰为下列一种状态：

- `excluded`：Sample 已明确排除该 slot；
- `not-recorded`：expected slot 没有 Member，因而不读取 Attachment；
- `core-invalid`：Member、Attempt 或引用的 Core 不能可靠读取，因而不读取 Attachment；
- `attachment-result`：included slot 已找到 owner，并保留该 `RecordAttachment` 的完整读取状态及 projector value。

`selectedRunProjection` 的 Run entry 都是 `attachment-result`。它的 Sample 仍随结果保留，因此 Report 可以同时展示原 Sample 的 slot 分母与每个 Run 的 Attachment 读数。

RecordAttachment 的 unavailable、migration-required、unsupported、invalid 与 collection partial 都是成功结果中的数据状态。它们不会把整个 Sample 改成 core-invalid，也不会变成 Effect failure。

真实 I/O、permission、closed reader、invalid reader-owned handle 与 projection limit 留在 `Effect` 的 typed error channel。projector callback 只在 Attachment available 时执行；callback 意外 throw 是 defect，interruption 保持 Effect Cause。Projection 不把两者伪装成 Attachment invalid 或数据 warning。

## Coverage 不冒充分母

`ProjectedSample.coverage` 分开报告 Sample 的 slot 状态、逻辑 entry 数与 Attachment result 状态。Sample 的 `denominator` 只表示 Sample-wide 的 slot denominator。每个 Calculation 的 `observed` 与 `denominator` 都是作者返回的 domain value；host 不得从 transport coverage、entry 数或 access count 推导它们。

## 范围

Projection 包含：

- RecordAttachment projector 与三种固定逻辑访问；
- 穷尽 `ProjectedSample`、entry 与 coverage；
- script 和 Report 共用的读取语义；
- typed reader failure 与 limit。

Projection 不包含：

- Analysis selection、Sample 构造或从 pure Sample 恢复 I/O；
- Report 页面、Calculation 或 reuse planning；
- 持久 projector identity；
- reader、path、Stream 或 callback 在 `ProjectedSample` 中的外泄。

## 入口

- [Library](library.md)：公开 TypeScript 与 Effect 契约。
- [Sample](../sample/README.md)：Run 选择、expected-slot 分母与 live handle。
- [Record](../record/README.md)：Attachment schema、owner 与读取状态。
- [Reports](../reports/README.md)：怎样声明 projection 并形成 ReportExecution。
