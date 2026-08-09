# Sample —— 固定 source 集合上的已定选择

[Record](../record/README.md) 回答一个不可变 Graph 保存了什么；Sample 回答一个或多个固定 source Graph 的 Run membership 选中了哪些 Attempt，以及 denominator 中哪些成员属于 included、excluded 或 unavailable。

```ts
import { resolve } from "node:path";
import { openRecord, openRecordStore } from "niceeval/record";
import { createSampleBundleStore, materializeSample } from "niceeval/sample";

const root = resolve(process.cwd(), ".niceeval", "record");
await using store = await openRecordStore(root);
await using record = await openRecord(store);
const sample = await materializeSample(record, {
  runs: ["compare/candidate"],
});

// create requires an absolute local root that does not exist yet.
const bundleRoot = resolve(process.cwd(), ".niceeval-sample-bundle");
await using bundleStore = await createSampleBundleStore(bundleRoot);
```

`record` 是 [Record Library](../record/library.md#打开-record) 提供的固定 revision 读取 capability；生成值中的 `sources` 保存它的完整 `record.ref`。一次 `materializeSample()` 产生只含这一项的 `sources`；writer 推进 head 后，调用方必须重新打开 Record 并生成另一份 Sample。

本地 Record Store 的 Library root 必须是绝对路径。bundled CLI 把项目的 `.niceeval/record` 转换为相对
`process.cwd()` 的绝对路径，再把这个实际 Store root 传给 `openRecordStore()`。
Sample 不另设接受相对 root 的入口，也不把 `.niceeval` 当 Store root。

## 唯一心智

Sample 不是目录、时间或“最新结果”的惰性查询。
它是已经生成的值，保存 identity、规范化 sources、成员、denominator、coverage、provenance 与 Record-owned membership proof。

每个 Run revision 先以 durable `expectedMembershipSlots` 定义分母，再以 strong edge 列出已有 slot 的
current Record-owned `RunContributionHandle`。Sample 逐个 expected slot 交代 included 或
`unavailable / not-recorded`；已有 contribution 的 `executed`、`carried`、`accepted` 与 `renamed` 都是
同一种成员事实。Attempt 始终属于 origin Run，当前 Run 只通过 Contribution 采用它。

每个成员直接保留 Record-owned `AttemptRef` 与 `RunContributionHandle`。后者含 node、contributionId、revision、runId、evalId、membershipSlot 与 mode；Sample 和 Reports 都不能自行重建它，或只用 locator 代替。

## 成员、证据与范围

成员读数使用 Record-owned `EvidenceValue` 的两轴形状。available/unavailable、verification、全部 causes、issues 与 basedOn 随 Sample 保留；图表、Calculation 与 renderer 不重算它们。

coverage 精确保存 denominator、included、excluded 与 unavailable。收窄会生成新的固定 Sample，并保留 parent sources；它不会把 predicate 留给后续读取或 renderer。

Sample coverage 只证明 expected membership slot 与 Contribution 的事实。它不调用或模拟 Verdict Projector。
真实 `builtins.verdict` 的 smoke 只验证 durable Verdict Claim 的 lookup、anchor 与投影，两者是独立职责。

| 用户目标 | 入口 |
|---|---|
| 从一个固定 Record 生成可复核总体 | `materializeSample(record, selection)` |
| 从该总体收窄实验、Eval 或成员 | `narrowSample(sample, selector)` |
| 合并多份已定 Sample | `unionSamples(samples, conflictPolicy)` |
| 交付独立、可验证的样本包 | `exportSample(sample, { sources, target })` |
| 打开收到的样本包 | `openSampleBundle(source, ref, input?)` |
| 呈现固定样本 | [Reports](../reports/README.md) |

## 多 source union 与交付

跨 Record 只能合并已经生成的 Sample。`unionSamples()` 把 input sources 按完整 `RecordGraphRef` 的 JCS bytes 去重并排序，得到非空 `sources` 集合。它不会留下单数 graph，也不会猜主 Graph。

每个 denominator row 的 slot identity 含完整 source Graph、结构化 address、Run node、experimentId 与
evalId；已有 member 再纳入完整 Record-owned Contribution 与 AttemptRef。address 固定为 recordId、
runId、membershipSlot。不同 address 永不折叠；同一 address 的 slot/source、Contribution revision 或
adopted node 不同默认 conflict。

`exportSample()` 返回公开 `SampleBundleRef`，并写入独立、可保存多个 immutable Bundle 的 `SampleBundleStore`。导出时显式传入由固定 Record handle 构造的 `RecordSourceSet`；纯 `MaterializedSample` 不隐藏 Store、reader 或 registry。导出只继承 SourceSet 捕获的 registry instance，不另按 Store 或全局状态查找。

`SampleBundleStore` 只能由 create/open 取得，是 runtime-branded `AsyncDisposable` capability。close 幂等且只释放自己的 retain；已经开始的 child export/read retain 可以独立完成。真实 closed capability 与伪造或其它 Store kind 的 invalid handle 使用互斥 typed failure。

`openSampleBundle(source, ref, { evidenceRegistry }?)` 可以显式接收 registry，并把传入的 exact instance 捕获到打开的 Bundle capability；省略时使用 builtin instance。纯结构 proof parse/verify 不运行 registry callback。

`MaterializedSample` 也不是结构相同就可信的普通 object。`exportSample()` 与 Reports 在读取字段前都使用
Sample-owned `validateMaterializedSample()`。
伪造或被篡改的值直接给出 `SampleValidationError`，不能被当成空 Sample、零 coverage 或 unavailable。

Bundle durable payload 是精确定义的 `SampleBundleDigestPreimageV1 { schema, manifest }`，调用方只通过
`SampleBundleRef` 打开它。分页的 `RecordEvidenceProofIndexV1` 交付 event、object、Claim 与
authenticated absence proof。

Bundle 不会把源 Claim 或 stream GraphNode 当作自身活动节点。
导出先校验 caller-supplied Sample。source set 的失败直接传播 Record-owned `RecordSourceError`。
固定 source 的 membership/proof prerequisite read 直接传播 `RecordReadError`。
proof 构建、递归闭合、archive、验证或写入统一 index 的失败直接传播 `RecordEvidenceProofError`。
这些 owner error 都不包装成 Bundle Store failure。

## 相关阅读

- [Library](library.md) —— sources、选择、coverage、union、Bundle 与成员 identity 的完整形状。
- [局部补跑](use-case/partial-rerun.md) —— 一个 Run revision 怎样形成固定成员。
- [收窄样本](use-case/收窄样本.md) —— 将范围收窄为新的固定值。
- [参考方案](reference/README.md) —— 固定选择与可验证交付的取舍。
- [Record](../record/README.md) —— Sample 所读取的不可变事实图。
