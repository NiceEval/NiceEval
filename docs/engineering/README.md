# 工程文档

这里是 niceeval 这个仓库自己怎么被验证、维护、跑分的索引——不是能力说明,读者是维护这个仓库本身的人。
一个工程主题一个子目录,子目录里按需拆成几篇。

正文写工程机制应满足的目标、使用方式和验收方式，不写当前`实现进度`——同 [Feature](../feature/README.md) 的目标状态规则。

目标写入口使用 `pnpm engineering create <name> --title <title>`。
命令从 [`_template/`](_template/README.md) 创建最小结构，不手工复制模板。

公开、已脱敏且需要 maintainer 跟进的 Observation 从 [GitHub Issue 与 Memory](issues/README.md) 进入。
该入口定义 Issue 标签、分诊、关闭证据、授权和机器幂等规则。

子目录清单见 [`docs/README.md`](../README.md)。
