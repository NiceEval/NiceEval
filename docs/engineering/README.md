# 工程文档

这里是 niceeval 这个仓库自己怎么被验证、维护、跑分的索引——不是能力说明,读者是维护这个仓库本身的人。
一个工程主题一个子目录,子目录里按需拆成几篇。

正文写工程机制应满足的目标、使用方式和验收方式，不写当前`实现进度`——同 [Feature](../feature/README.md) 的目标状态规则。

新工程主题由 Concord 受管入口 `concord new engineering <name>` 创建，`concord list engineering`、`concord show <id>` 与 `page` 查询和维护既有主题；参数以 `concord new --help` 为准，不手工复制模板。

公开、已脱敏且需要 maintainer 跟进的 Observation 从 [GitHub Issue 与 Memory](issues/README.md) 进入。
该入口定义 Issue 标签、分诊、关闭证据、授权和机器幂等规则。

## 主题入口

- [随包 Agent 文档](agent-docs/README.md)：打包、发现与索引守护。
- [Benchmark](benchmark/README.md)：安装基准、采样与比较。
- [源码格式与静态检查](code-style/README.md)：Biome 格式、未使用项检查与首次接入方式。
- [文档追溯](docs-traceability/README.md)：文档、实现、Issue 与 Memory 的关系。
- [并行文档工作](docs-work/README.md)：文档切片、收据与 finalizer。
- [示例 tier 同步](example-tier-sync/README.md)：相邻示例层的同步与冲突处理。
- [Feedback 与 Memory](feedback-memory/README.md)：问题观察、性质回归与 Memory。
- [GitHub Issue 与 Memory](issues/README.md)：公开 Observation 的分诊、授权和远程生命周期。
- [Repository Tools](repository-tools/README.md)：仓库维护领域、动态发现与脚本退役边界。
- [Nx 项目图与维护任务](task-orchestration/README.md)：构建、静态检查与依赖更新。
- [测试体系](testing/README.md)：性质、两层与技术方案。
