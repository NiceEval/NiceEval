# 来源提取：DX 资料中的文档观

来源：

- [GetDX: Developer documentation impact](https://getdx.com/blog/developer-documentation/)
- [Twilio: The Spectrum of DX](https://www.twilio.com/en-us/blog/company/inside-twilio/developer-experience-spectrum)
- [开发者体验：探索与重塑](https://dx.phodal.com/)

## 读取到的核心主张

这些 DX 来源的共同点是：文档不是孤立内容资产，而是开发者体验系统的一部分。文档质量会影响学习、集成、排错、协作、上线速度和支持成本。

## GetDX：文档影响工程效率

GetDX 把开发者文档定义为帮助开发者理解、使用和集成软件系统的所有书面材料，包括 API 文档、架构指南、代码注释、教程和 runbook。

它强调文档问题的组织信号：

- Slack 或邮件里反复出现同样问题。
- PR review 因缺上下文变慢。
- 新人 onboarding 慢。
- 生产事故中缺少 runbook 或系统行为说明。
- 团队重复造已有方案。
- 文档没人明确负责。
- 文档散落在多个系统里不可发现。
- 文档随代码衰减。

它建议用调查、问题统计、PR cycle time、新人访谈、帮助他人的时间估算来诊断文档影响。

## Twilio：DX 有成熟度光谱

Twilio 把 DX 体验分成不同阶段。对文档最有用的是这几个判断：

- Broken：合法请求失败、API 行为不一致、文档与产品实际行为不一致。
- Working：用户照着文档最终能跑通，但需要大量阅读和试错。
- Predictable：API、错误、工具、文档在产品之间保持一致，熟悉一个产品后能低成本迁移到另一个产品。
- Seamless：工具融入开发者已有工作流，不需要改变心智模型。

对文档而言，目标不只是“能用”，而是减少认知切换，让用户能预测在哪里找信息、如何套用已有经验。

## Phodal：DX 六要素

《开发者体验：探索与重塑》把 DX 拆成六个要素：

- 错误呈现。
- 文档体验。
- 易用性。
- 交互式。
- 触点。
- 支持。

其中与文档直接相关的点：

- 报错即文档：错误信息链接到可操作说明。
- 报错即修改建议：错误中提供下一步。
- 开发者门户承载知识体系。
- CHANGELOG 和迁移指南是文档体验的一部分。
- 测试用例也是理解用法的资料。
- 一键安装、自动迁移工具、自助式搭建会降低文档负担。
- 可交互文档、Playground、沙盒可以降低学习成本。

## 对 NiceEval 的直接映射

NiceEval 文档不能只写 API。DX 还包括：

- 错误信息能不能告诉用户下一步。
- CLI 输出能不能指向具体 artifact。
- 报告页能不能解释失败分类。
- 文档是否说明 setup/runtime/assertion 三类失败差异。
- Quickstart 是否降低 time to first success。
- 示例是否能被复制运行。
- 文档和示例是否跟当前实现同步。
- Agent / Adapter / Sandbox 的概念是否让用户预测系统行为。

## 可直接采用的 DX 指标

- Time to first successful eval。
- 新用户第一次失败后能否自助修复。
- 反复出现的问题是否有对应文档页。
- PR review 中是否因为 docs/API 语义不清反复讨论。
- 文档链接是否能从错误、报告、CLI 输出、README 到达。
- 用户是否能从一个 adapter 的文档迁移到另一个 adapter。

## 可直接采用的检查问题

- 这篇文档降低了哪类开发者摩擦？
- 用户失败时是否知道下一步？
- 文档是否和产品实际行为一致？
- 同类页面是否结构一致，让用户能预测信息位置？
- 是否能用 CLI、错误信息、report、examples 分担文档压力？

