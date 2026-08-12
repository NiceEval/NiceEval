# Projection 子设计

**上游**：[Sample](sample.md) · **下游**：[Relations](relations.md) ·
**API 单源**：[Library](../library.md)

Projection 把 physical package 或保留的 legacy Attachment 解释为 local projection。它的最小安全
边界是“一个 projector 只读一份 package”，而不是“一个语义 view 只能来自一个字段”。

## 拥有的契约

Package projector 同步消费一份已验证、已 materialize 的 available value，可同时产生多个
typed local views。例如 OTel package 可产生 spans、operations、usage observations 与 timing
intervals，但它不读 Assertions。

Projection result 与 Sample slots 精确对齐。Included slot 保留 owner、representation、locator、
family、schema、collection 与 Attachment 读取状态。其它 slot states 直接穿透，不触发 package
I/O。

## Representation 有限分支

Definition 在 I/O 前闭合 Receipt、physical graph 与 legacy graph。Host 先读 Receipt：

- available `physical-v1` 只激活 physical graph；
- unavailable Receipt 只激活 legacy graph；
- Receipt 的其它读取状态形成 representation-unavailable，不 fallback；
- `unsupported` 与 `not-enabled` expectation 形成 capture-expectation，不读对应 package。

分支内可以声明多个 projector，但每个 node 仍只解释一份 family。因此 legacy usage 与
timing 必须是两个 nodes，不能伪装成一个 legacy OTel package。

## 不拥有的责任

- 不选择 Runs、改变 denominator 或读取第二份 package。
- 不建立 cross-package relation，不根据时间、文本或数组位置猜 anchor。
- 不计算 cost、duration、agreement 或页面 model。
- 不承诺 range read；当前 reader 仍会 materialize 整份请求的 closure。

## 失败与资源

Attachment 六态是 Sample-aligned result 中的数据。Projector defect、I/O、permission、scope closed 或
interruption 是 Effect failure。Scheduler 以 raw snapshot lease 管理加权并发预算；projector 返回后
host 释放 lease 和 raw reference，不承诺 GC 已回收 projected views。

## 验收条件

- 第三方只用 public access、projector 与 projection constructors 就能得到同等 result。
- 同一 Sample 可同时含 physical 与 legacy owners，每个 slot 保留自己的 provenance。
- 未激活 branch 不 I/O、不产生 problem，也不占 raw snapshot budget。
- 只请求 usage view 时不读 Commands，但会诚实读完已请求的 OTel package。
