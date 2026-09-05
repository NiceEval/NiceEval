# 工程文档

这里是 niceeval 这个仓库自己怎么被验证、维护、跑分的索引——不是能力说明,读者是维护这个仓库本身的人。
一个工程主题一个子目录,子目录里按需拆成几篇。

正文写工程机制应满足的目标、使用方式和验收方式，不写当前`实现进度`——同 [Feature](../feature/README.md) 的目标状态规则。

工程主题尚无受管创建命令。[`_template/`](_template/README.md) 保留目标形状，不把它手工复制成新主题或伪造结构收据。

公开、已脱敏且需要 maintainer 跟进的 Observation 从 [GitHub Issue 与 Memory](issues/README.md) 进入。
该入口定义 Issue 标签、分诊、关闭证据、授权和机器幂等规则。

## 主题入口

- [随包 Agent 文档](agent-docs/README.md)：打包、发现与索引守护。
- [Benchmark](benchmark/README.md)：阶段耗时与安装 benchmark。
- [文档追溯](docs-traceability/README.md)：文档节点、测试 owner、Memory 与结构写入的追溯入口。
- [并行文档工作](docs-work/README.md)：文档切片、收据与 finalizer。
- [示例 tier 同步](example-tier-sync/README.md)：相邻示例层的同步与冲突处理。
- [Feedback 与 Memory](feedback-memory/README.md)：存量 Feedback、Memory 与 E2E regression 的提升工作流。
- [GitHub Issue 与 Memory](issues/README.md)：公开 Observation 的分诊、授权和远程生命周期。
- [Repository Tools](repository-tools/README.md)：仓库维护领域、动态发现与脚本退役边界。
- [任务编排](task-orchestration/README.md)：Nx 项目图、affected E2E 与 fail-open 管理。
- [测试](testing/README.md)：测试体系总纲与 Unit / E2E 子体系。
