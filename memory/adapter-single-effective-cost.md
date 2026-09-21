---
format: niceeval.memory/v1
id: adapter-single-effective-cost
title: 每次物理调用只选择一个有效成本
createdAt: 2026-09-21
kind:
  type: decision
  state: adopted
promotions: []
---
## 决策

2026-09-21，外部 Adapter 的真实调用同时带有网关 cost、marketCost、gatewayCost 与 surchargeCost。初稿将这些值扩成多金额汇总，又尝试按 receipt namespace 跨 callId 去重。用户指出复杂度超出需求；消费者已经以物理请求 callId 合并最终快照，不需要框架重复推断请求身份。

采用每次物理调用一个有效 cost：amount、currency 与 reported/estimated 标记。Adapter 只提交可验证的 reported 金额；明确零值优先于任何估算。没有 reported 金额时，框架可按封存的价格与已知 token 桶生成估算。其它供应商金额保留在原始附件，不加入通用成本轴。

金额由谁报告或估算，与覆盖是否完整是两个维度。未知 token、缺失价格及未覆盖调用不能补零；混合汇总必须标明含估算，部分和不能称完整账单。非 USD 回执不能被 USD 估算替换，币种不自动换算。

旧持久事实只读投影，不用当前价格或当前 endpoint 配置倒填历史。callId 的幂等与冲突检查仍限定在 origin Attempt 内，不把协议名、模型名或网关 generationId 当跨账户身份。

当前规范由 docs/observability.md 与 Adapter 的公共类型拥有；此处只保存收缩方案的原因。
