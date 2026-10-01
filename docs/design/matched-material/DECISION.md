# Decision

## 定案

主 agent 选择 [PLAN-1](PLAN-1/README.md)，以 source-bound selector 和 closeQA 唯一验收问题入口 连接整组材料。
用户纠正后不采用 select 或新增 handle.judge；[PLAN-2](PLAN-2/README.md) 保留用于评估第三类可变 handle 的成本。

## 依据

核对名称与两种问答语义是否清楚、source 绑定生命周期、缺失与空材料决策、Match 三值扩展、ID/citations 和材料容量边界。
GPT-6 Astra 独立审查及集中修订复核已通过，材料与官方统计读取方案均无剩余阻断。采用 PLAN-1，并同步 Feature 契约与实现。

用户明确项目没有历史包袱；移除旧 closeQA 对象调用和工厂，同步 docs、示例及回归，不引入兼容层。

## GPT-6 Astra 独立 Review

首次审查提出 4 项 P1 与 2 项 P2：快照桥接、Attempt 所有权、零调用收据、严格引用审计、容量准入和陈旧目标。
主 agent 已在 Architecture 写入具体两类快照、私有 owner token、绑定事务、封口收据、审计 reader 与四类容量，并修正 G5/C6。
仅复核这些修订和未解决问题，核心消费签名保持 source-bound check 与 closeQA。

用量扩展审查纠正精确十进制比较、账本深度隔离与作者阶段关闭、Agent显式 unavailable和NumericMaterial provenance；最终复核通过。

## 否决项

不采用 select 组合、handle.judge 链或旧 closeQA 材料答案格式。材料输入与 predicate 由selector表达，消费入口只负责存在性或整组问答。

## 遗留风险

Agent未绑定逐物理调用owner时 usageSnapshot 明确 unavailable；保持Agent现有usage与预算语义。材料和用量需从安装后候选验证公共入口与读回。
