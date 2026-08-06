# Unit 与结构证明

本目录放主 Behavior 无法稳定制造或直接定位的机制矩阵，以及纯计算、schema、静态 census 和可控 barrier
竞态。每个机制矩阵只有一个 owner，并必须声明 `wrongAlgorithms` 与 `whyPrimaryCannotCatch`。

Unit 不按源码函数、分支或 DTO 字段增殖。覆盖率下降不能阻止删除没有独有错误算法的测试；同一决策矩阵已经由
一个 owner 穷举后，其它层最多保留一个接线代表。详细准入与删除规则见 [Proof Portfolio](../portfolio.md)。

目标迁移样例见 [Carried 测试组合迁移](use-case/carried-proof-migration.md)。
