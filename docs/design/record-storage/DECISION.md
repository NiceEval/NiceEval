**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md)

# Decision

## 状态

本决策保持开放，不声明 `selectedPlan`。
三个候选可以进入文档评审和 spike；任何候选都不能据此改写 Feature 或开始 storage migration。

独立设计挑战对 [PLAN-2](PLAN-2/README.md) 给出 `CONDITIONAL`。
它已经通过逻辑/物理边界挑战，但尚未通过 single-file publication、hostile ordinary read、actor fairness、exact exporter 与 seal 资源成本证明。

rolling pack 与 aggregate Content budget 的独立挑战也给出 `CONDITIONAL`。
它允许取消旧的 128 MiB aggregate cap，但共同结构 ceiling 的具体数字、RS13/RS14 与相邻 storage converter 收据尚未通过。

## 已经排除

全 JSON 不进入 PLAN。
它无法同时兑现 RS2、RS3 与 RS8，并会把 physical split 泄漏成 family array 或 base64 字段。

整个 Record root 共用一份 SQLite 也不进入 PLAN。
它让全部并行 Run 竞争同一个 writer，并把一个 Run 的 publication/migration 扩大成 root-wide transaction。

## 候选差距

- [PLAN-1](PLAN-1/README.md) 延续 whole-Run directory rename 与 blob Roadmap，最少改变 Record 的信任边界。
  它必须自行拥有 framed item log、rolling Content pack set、index、orphan 与完整性协议。
- [PLAN-2](PLAN-2/README.md) 为 collection rows、unique inventory、transaction 与单文件 packing 提供最完整的统一 substrate。
  它额外承担 hostile SQLite、同步 actor、final exporter、O(run bytes) seal 与二进制 Git diff。
- [PLAN-3](PLAN-3/README.md) 保留 SQLite 的 collection/index 收益，并让大 Content 直接走 file I/O。
  它同时拥有 database 与 pack 两套 closure protocol，只有 RS2 的实测反转 PLAN-2 时才有独立价值。

## 选择证据

进入最终裁决前必须补齐：

1. RS2/RS3/RS6/RS13/RS14 的 RSS、throughput、fairness、rollover 与取消对比；
2. RS7/RS11 的进程终止、disk full、competing destination 与 fsync fault matrix；
3. PLAN-2 在 `VACUUM INTO` 和 fixed exporter 中选出的唯一 final-file path；
4. PLAN-2 ordinary open 在 full `integrity_check` 前的安全审查；
5. 三个方案对 unknown family storage migration 的 byte-preservation receipt；
6. seal wall time、临时磁盘、rollover file count、Git/copy 与 reader latency 的共同 benchmark；
7. hostile-input spike 确定并写回 L16/L19 的共同结构 ceiling，并把 RS3 实测的 item、encoded bytes、nodes 与 depth 写回 L18；
8. 同一 storage revision 的不同 Host 对同一 published closure 得到相同 validity。

## 暂定选择规则

- public contract 保持完整 collection read，且 PLAN-1 的 framed log/pack 协议可被完整验证时，优先 PLAN-1。
- item-level lazy reader 或一 Run一 application file 被提升为明确产品目标，并且 PLAN-2 通过全部采用门时，重新比较 PLAN-2。
- PLAN-2 的 Content chunk row 或 final snapshot 失败，但 SQLite collection/index 收益已经必要时，才比较 PLAN-3。

挑战过程、crash matrix 输入和反转条件见
[SQLite 独立设计挑战](../../research/record-storage/design-challenge.md)与
[Attachment aggregate Content budget 挑战](../../research/record-storage/aggregate-content-budget-challenge.md)。
