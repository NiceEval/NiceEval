**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md)

# Decision

## 状态

本决策保持开放，不声明 `selectedPlan`。
PLAN-1 可以进入文档评审和 spike；任何候选都不能据此改写 Feature 或开始 storage migration。

独立设计挑战对 [PLAN-2](PLAN-2/README.md) 给出 `CONDITIONAL`。
它已经通过逻辑/物理边界挑战，但尚未通过 single-file publication、hostile ordinary read、actor fairness、exact exporter 与 seal 资源成本证明。

rolling pack 与 aggregate Content budget 的独立挑战也给出 `CONDITIONAL`。
它允许取消旧的 128 MiB aggregate cap，但共同结构 ceiling 的具体数字、RS13/RS14 与相邻 storage converter 收据尚未通过。

取消单 logical Content 64 MiB 上限后的独立挑战同样给出 `CONDITIONAL`。
它允许 Design 与 blob Roadmap采用无 Core Content byte cap、真实 stream 与 rolling metadata，但不允许在采用门完成前声明 `selectedPlan`。

## 已经排除

全 JSON 不进入 PLAN。
它无法同时兑现 RS2、RS3 与 RS8，并会把 physical split 泄漏成 family array 或 base64 字段。

整个 Record root 共用一份 SQLite 也不进入 PLAN。
它让全部并行 Run 竞争同一个 writer，并把一个 Run 的 publication/migration 扩大成 root-wide transaction。

[PLAN-2](PLAN-2/README.md) 退出 live 比较，但保留为历史候选。
一 Run 一 final SQLite 同时是一个 durable member；保留共同 member ceiling 会形成 Run byte cap，取消 ceiling 又会形成无界 hostile 单文件。
两者都不能兑现当前共同目标。

## 候选差距

- [PLAN-1](PLAN-1/README.md) 延续 whole-Run directory rename 与 blob Roadmap，最少改变 Record 的信任边界。
  它必须自行拥有 framed item log、rolling Content packs、authenticated catalog/index/Seal pages、orphan 与完整性协议。
- [PLAN-2](PLAN-2/README.md) 保存 SQLite row、transaction 与单文件 packing 的收益，也保存它与无 Run cap 冲突的原因；本轮选择不再考虑它。
- [PLAN-3](PLAN-3/README.md) 保留 SQLite 的 collection/index 收益，并让 Content 直接走 external rolling packs。
  它同时拥有 database 与 pack 两套 closure protocol，只有 PLAN-1 framing/RS3 失败且 item-level lazy reader 成为产品目标时才重开。

## 选择证据

进入最终裁决前必须补齐：

1. RS2/RS3/RS6/RS13–RS17 的 RSS、throughput、fairness、rollover、whole-value read admission 与取消收据；
2. RS7/RS11 的进程终止、disk full、competing destination、fsync 与 copy matrix；
3. PLAN-1 authenticated catalog/range/Seal framing 与 extra-member verifier；
4. digest-file 到 rolling storage 对 known/unknown family 的 byte-preservation receipt；
5. seal wall time、临时磁盘、rollover file count、Git/copy 与 reader latency benchmark；
6. hostile-input spike 确定并写回 L16/L19 的共同结构 ceiling，并把 RS3 实测的 item、encoded bytes、nodes 与 depth 写回 L18；
7. 同一 storage revision 的不同 Host 对同一 published closure 得到相同 validity。

## 暂定选择规则

- public contract 保持完整 collection read，且 PLAN-1 的 framed pack、rolling metadata 与 verifier 通过全部采用门时，选择 PLAN-1。
- PLAN-2 只有在产品重新接受 Run 级单文件容量边界时才可作为新决策重开，不能在本 Design 中豁免共同 Case。
- PLAN-3 只有在 PLAN-1 framing 或 RS3 失败，且 item-level lazy reader成为明确产品目标时才重开比较。

挑战过程、crash matrix 输入和反转条件见
[SQLite 独立设计挑战](../../research/record-storage/design-challenge.md)与
[Attachment aggregate Content budget 挑战](../../research/record-storage/aggregate-content-budget-challenge.md)、
[无固定 logical Content 容量挑战](../../research/record-storage/unbounded-logical-content-challenge.md)。
