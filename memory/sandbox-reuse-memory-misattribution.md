# Sandbox 复用失败诊断把有意持久记忆推断为污染

公开 Experiment 声明 sandboxReuse，并让同一 Sandbox 的首条 Attempt 成功、后两条在同一阶段失败时，结束诊断把 workdir 外状态称为 likely cause，要求不得依赖前题状态。

失败聚集只能证明时间与实例上的相关性，不能证明污染。记忆实验允许跨 Attempt 保留有意状态；诊断应报告实例、承接序号与失败阶段，建议检查预期状态、非预期残留和重复准备。

公开入口验收使用三个 Attempt 的 Experiment，在 workdir 外写入累积记忆，确认聚集诊断可见、原失败结果保留且没有无依据的因果归属。
