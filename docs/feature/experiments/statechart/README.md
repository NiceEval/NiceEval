# Experiments 的状态

并发运行的 Experiment 会争用共享状态，进程可能在任意一步退出，恢复也可能再被打断。这里的页面用模型检查器穷举这些交错，核对 Experiments 声明的规则；每页先写规则，再给模型与检查结果。

- [共享状态租约](shared-state-lease.md)：整组取得、正常释放、显式恢复与 after 补偿，规则来自[数据模型](../data-model.md)。
- [用例占用](case-claim.md)：跨 Invocation 的用例占用、等待、接手与释放。
