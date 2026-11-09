# 未封存的应用用量被误报为完整零费用

Adapter 创建成功但未能读取应用账本，没有上报调用时，当前 collector 自动封存 complete 空集合。独立 Judge 完整空账本加入后，Attempt totalCosts 被误报为 complete 且没有缺口。

消费者在 eafa10b4307fd1bcf67c9ba4f178f0edf73b586eef541ee162d47a0441c90488 通过正式 exp、query、show 复现。Eval 抛 JOURNAL_NOT_SEALED，@12RPWRTHJASH5 的 totalCosts 仍为 complete、values=[]、missingSources=[]。这不是从 errored 推断费用：根因是 Adapter 无法声明账本完整性，零个已登记调用被当作全量零调用。

修复目标是官方完整性封存能力，保存已知物理调用与费用，明确未封存、partial 与显式完整空账本。普通和实验费用读取同一声明，不读取业务 journal 或诊断字符串猜测。

契约见 [应用账本完整性](../docs/feature/inspection/architecture.md#实验总费用与应用完整性)。正式回归 usage-unsealed 已取得旧候选红灯及当前候选完整可靠性证明，包含隔离副本、同副本重复、默认并行和资源清理。sealUsage 将账本完整性与业务 Verdict 分开；历史 v1/v2/v3 金额保留，但新总费用不把旧自动完整声明视为生产者封存。
