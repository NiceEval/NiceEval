# CLI Insight protocol spike

> 观察日期：2026-08-25
>
> 文档性质：open Design 的采用证据，不是 NiceEval 目标契约或生产实现

本目录验证 [PLAN-3](../../design/cli-insight/PLAN-3/README.md) 的固定 Inspection Operations 能否关闭 machine query、Human show 与 Insight 共用的语义。
实验使用纯、确定性的 fixture，不读取当前生产 Record，也不实现 CLI、浏览器 UI 或公开 transport。

## 可复现实验

运行：

```bash
node docs/research/cli-insight/inspection-protocol-spike.mjs
```

脚本成功时只向 stdout 写一个 canonical JSON receipt，并以 0 退出。
完整解释与本次收据见 [inspection-protocol-receipt.md](inspection-protocol-receipt.md)。

## 验证范围

| 证据 | fixture 断言 |
|---|---|
| 渐进发现与有界分页 | compact bootstrap 只列 operation 摘要；detail 再交付完整 schema；domain page 同时执行固定 item ceiling 与 byte ceiling。 |
| 逻辑 continuation | token 绑定 operation ID、behavior version、Inspection revision、sealed cutoff、selector 与最后一个 logical item；它不携带数据库位置。 |
| 旧结果纠正 | operation、behavior version、Inspection revision 或 sealed cutoff 变化时返回 `previous-result`，并交付完整 restart correction。 |
| 比较闭包 | `side-by-side`、`exact` 与 `paired` 分别断言独立分母、missing、Evidence、exact 准入、pair denominator、unmatched 与 excluded。 |
| storage neutrality | 两个不同 physical storage revision adapter 对同一 logical fixture 产生 byte-equivalent canonical `InspectionResult`。 |
| 单一语义 owner | query document、show formatter、Insight 私有 ViewModel 与 deterministic static ViewModel 只读取同一 result；不可用 fact source 的读取计数保持为零。 |
| revision 固定 | 新 Seal publication 只设置 pending；旧 revision detail 继续读取旧 cutoff，refresh 后才原子切换到新 revision。 |

deterministic static ViewModel 是协议一致性测试替身，只证明 plain-data result 可以被确定性投影。
它不增加 static export、用户 Page 或组件 ABI。

## 未证明的边界

本 spike 不证明 loopback authentication、真实浏览器 UI、浏览器并发、资源回收或真实 SQLite 行为。
它也不证明 macOS 与 Windows 的 server、浏览器启动或 filesystem 语义。

这些边界必须在 PLAN-3 被采用并进入 Feature 后，由公开入口的 Feature E2E 验收。
当前 receipt 不能据此声明 `selectedPlan`、修改 Feature 或开始生产 migration。
