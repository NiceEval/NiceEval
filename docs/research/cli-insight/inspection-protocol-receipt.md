# Inspection protocol spike receipt

> 观察日期：2026-08-25
>
> 文档性质：PLAN-3 `CONDITIONAL` 的 semantic protocol 证据，不是 Feature 验收

可复现实验：[`inspection-protocol-spike.mjs`](inspection-protocol-spike.mjs)。

```bash
node docs/research/cli-insight/inspection-protocol-spike.mjs
```

脚本只使用 Node 标准库和纯 fixture。
它成功时只输出一个 canonical JSON document，断言失败则非零退出。

## 协议收据

下方 JSON 由同一脚本生成。
SHA-256 身份来自 canonical `InspectionResult` bytes，不包含 physical storage revision。

```json
{"assertions":{"boundedDomainPage":true,"closedComparisonModes":true,"logicalContinuationBinding":true,"previousResultRestartCorrection":true,"progressiveDiscovery":true,"revisionCutoffRefresh":true,"singleCanonicalDeliveryResult":true,"storageRevisionNeutrality":true},"delivery":{"consumers":["query-machine-document","show-human-formatter","insight-private-view-model","deterministic-static-view-model"],"factReads":0,"semanticExecutionsAfterDelivery":2,"semanticExecutionsBeforeDelivery":2},"identities":{"canonicalInspectionResultSha256":"0963ea6b819098c2400f4161d8718d6e39786711157d8f52f437b18a97cddc73","storageRevisionOneResultSha256":"0963ea6b819098c2400f4161d8718d6e39786711157d8f52f437b18a97cddc73","storageRevisionTwoResultSha256":"0963ea6b819098c2400f4161d8718d6e39786711157d8f52f437b18a97cddc73"},"limits":{"bootstrapByteCeiling":2048,"bootstrapBytes":693,"bytePressurePageItems":1,"pageByteCeiling":1000,"pageBytes":690,"pageItemCeiling":2,"pageItems":2},"notProven":["loopback-authentication","real-browser-ui","macos","windows"],"protocol":"niceeval.inspection-protocol-spike-receipt/v1","revisions":{"afterPublicationBeforeRefresh":{"identity":"insight-revision-1","sealedCutoff":1},"afterRefresh":{"identity":"insight-revision-2","sealedCutoff":2},"before":{"identity":"insight-revision-1","sealedCutoff":1}},"status":"passed"}
```

## 收据解释

1. Discovery 按 bootstrap、operation detail、domain page 三步展开。Bootstrap 有独立 byte ceiling，不复制完整 schema；page 同时受固定 item 与 byte ceiling 约束。
2. Continuation 只保存逻辑绑定。脚本解码并核对 operation ID、behavior version、Inspection revision、sealed cutoff、selector 与最后一个 logical item，且拒绝物理位置词进入 token。
3. `side-by-side` 两端各自关闭 denominator、missing 与 Evidence，不包含 `delta`。`exact` 对 member domain 和 exact member set 分别设准入失败。`paired` 在一个 result 内返回左右与 pair 三份 denominator，以及 pairs、unmatched、excluded 与 Evidence。
4. Storage revision 1 使用 row-shaped fixture，storage revision 2 使用 segment-shaped fixture。两个 adapter 先恢复同一 logical facts，再由唯一 Inspection operation 关闭 canonical result；两份 bytes 和 SHA-256 完全相同。
5. 四种 delivery consumer 都接收同一个 canonical result。Fact source 被故意设成调用即抛错，最终 read count 为零；delivery 前后 semantic execution count 不变。
6. 新 Seal publication 后只产生 pending。旧 revision 的惰性 detail 仍返回原 identity 与 cutoff；refresh 后 active revision 才切到新 cutoff。

deterministic static ViewModel 只是消费边界的 fixture。
它不是 static export、公开 Page 或组件 ABI。

## 未证明的边界

本收据明确不证明 loopback authentication、真实 UI、真实浏览器 session、macOS 或 Windows 行为。
它也不证明真实 SQLite transaction、浏览器并发、取消或资源回收。

这些内容进入 Feature 后必须由公开入口 E2E 验收。
在此之前，收据只补齐 PLAN-3 的候选证据，不能用来声明 `selectedPlan` 或生产可用性。
