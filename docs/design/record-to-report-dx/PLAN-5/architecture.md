# PLAN-5 Architecture

## 边界不变量

| 层 | 拥有 | 禁止 |
|---|---|---|
| Record | Core、owner、physical package closure、schema/migration 与 frozen physical read | Report tables、population、跨包 join |
| Sample | selection、base population、logical slots 与 exact owner resolution | 读取业务 package、跨包 join、指标 |
| Projection | 一包到 local typed views、package collection/lineage | 读第二包、选择 Runs、改变 denominator |
| Relations | 同一 Sample 上的跨包对齐与 relation states | 猜 anchor、重写 durable facts、计算页面 |
| Derivation | 可选公式、aggregation、coverage、provenance 与 consumer-local failure | 静默替换 base population、打开 package |
| Report | routes、Pages/Downloads、closed output | Record I/O、私有 projector、legacy backfill |

Package 是满足 exact owner、同一事实权威、同一不可拆 completeness/failure/redaction transaction 的最大
事实集。只要某个子集能独立 complete/partial、失败或保留，就必须拆包。“独立演进”
限定为子集当前已拥有独立 schema generation、collection completeness、retention receipt 或
lossless migration contract。Run 的 `complete` 只发布整个 Run，不能替代这条 package 判据。

## Physical 不等于 raw

Physical 描述 package 的事实权威、owner 与不可拆 seal transaction，不表示把 provider 或 OTLP 原始 bytes 原样保存。Package
schema 仍必须是 neutral、exact、bounded、redacted 且不含 secrets、hidden chain of thought、任意 attribute
bag 或不安全 error。是否保留 sanitized OTLP protobuf、canonical JSON 或 normalized capture events，是
OTel package schema 的下一级候选，不由 Report 的字段需求决定。

每个 package 都是逻辑 schema；PLAN-5 不声称它“无语义”。区别只在 schema 是否跟随 capture authority 与
seal transaction，还是跟随当前 Report 想看到的列。

## 两种 identity

- Package-local entity identity 由 producer mint，在 package schema 内唯一。
- Cross-package durable anchor 由唯一 issuer 在事件发生时 mint，并通过 branded capture context 显式传递，
  双方保存相同 typed identity。

Relations 只能使用第二种建立 relation。两个 spans 时间接近、message 文本相同或数组 index 一致都不是
join evidence。一个 producer 无法获得 anchor 时应保留局部事实，并让 relation 返回 unmatched。

这是一种刻意保留的 capture-time coupling。它耦合的是 typed identity vocabulary，不是 package bytes、
schema version 或 migration。任何 observer 都不能自行从 local ID 重建 cross-package anchor。

## Failure taxonomy

- package missing/old/unsupported/invalid 保留 RecordAttachment 六态；
- local projector defect 是 projection execution problem；
- missing、dangling 或 ambiguous anchor 是 relation state；
- derivation defect 是依赖 consumers 的 execution problem；
- physical I/O、permission、closed reader 与 interruption 是 execution-wide Effect failure。

这些状态不能互相改名。例如跨包 anchor dangling 不会反向让两个独立有效 packages 变成 invalid。

具体顺序是：view/owner/token 混用形成 typed failure；package 六态作为成功数据进入 rows；仅在 packages
available 后，dangling/ambiguous anchor 才形成 relation state。

Capture Receipt 还决定 owner 的 representation profile。声明 `physical-v1` 时，reader 只激活
physical branch；没有 receipt 的 legacy/third-party owner 才走 legacy projectors。两种 representation
不自动 union。Official writer 在发布前拒绝双写，reader 不检查未选 branch 是否存在，因此不对历史或
第三方双写作出虚假的 read-time ambiguity 承诺。

## 读取成本

Host 可以在任何 I/O 前根据 requested fields 规划所需 packages，避免未请求 package。请求 OTel usage view
后，当前 reader 仍会 materialize 整个 OTel package closure。Projection 选择一个 local view 不等于 range
read。

Representation 是静态有限分支图。Receipt 与所有候选 families 在 definition 中闭合，执行时先读
Receipt。每个 owner 只激活一个 branch，未激活 branch 不读取。Receipt 非 unavailable 的读取状态
不允许 fallback。
每个 projection result 与 Sample logical slots 对齐。Excluded、not-recorded 与 core-invalid 不读
package。Included slot 保留 exact owner，并穷尽表达 package 六态、capture expectation 或
representation-unavailable。

Projection scheduler 按 encoded payload + closure 为 raw snapshot leases 预留加权并发 budget，总额
256 MiB。
同步 projector 返回后，host 释放 scheduler lease 与它持有的 raw reference。这不承诺 GC 已回收
内存。Projected views 与 Report model 有 entry-count limits，但没有可靠
heap byte 计量；256 MiB 不是整个 execution 的 memory guarantee，真实 fixture 必须单独 profile。

未来可以给 package 增加内部 manifest/index 与 chunk-addressed blobs，但必须保持 available value、验证、
Scope 和 failure 的契约一致。该能力需要独立 reader/storage 设计。

## 与 PLAN-1～4 的组合

PLAN-5 先固定 Record/Sample/Projection/Relations 的下半段。其上可以组合：

- PLAN-1：relations 进入 opaque query DAG，再由四层 managed Derivation 消费；
- PLAN-2：loader await relations，再用普通函数计算；完整责任有五个必需层；
- PLAN-3：relations 进入 semantic query planner，再由 managed Derivation 消费；
- PLAN-4：继续裁决 Derivation 是否独立，不再把 Projection/Relations 隐藏进 Analysis 的职责说明。

PLAN-5 若通过，PLAN-4 的计数应改成五层或六层，而不是三层或四层。
