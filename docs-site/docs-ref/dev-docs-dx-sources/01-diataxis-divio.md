# 来源提取：Diátaxis 与 Divio Documentation System

来源：

- [Diátaxis](https://diataxis.fr/)
- [Diátaxis in five minutes](https://diataxis.fr/start-here/)
- [Divio Documentation System](https://docs.divio.com/documentation-system/)

## 读取到的核心主张

Diátaxis 的核心不是“文档分类法”本身，而是把用户需求、内容形式和信息架构绑定起来。它认为技术文档有四类根本需求，对应四种文档形式：

- Tutorial：学习。带用户经历一次被指导的实践。
- How-to guide：工作。帮助已经有基础的用户完成现实任务。
- Reference：查事实。提供准确、完整、可靠、低解释负担的技术描述。
- Explanation：理解。提供背景、上下文、原因和概念关联。

Divio 的 Documentation System 与 Diátaxis 同源，强调“没有一种叫 documentation 的单一东西，文档实际上有四种”。它把这件事作为改善软件文档的基本前提。

## 对文档结构的启发

Diátaxis 不是要求所有项目都照搬四个目录，而是要求每个页面知道自己服务哪种需求。

可迁移规则：

- 新手路径不要变成 API 字段大全。
- 任务指南不要塞太多原理解释。
- API reference 不要混入 onboarding 叙事。
- 概念解释不要伪装成操作步骤。
- 页面边界模糊是文档难用的主要来源。

## 四类文档的写法差异

### Tutorial

目标是让用户通过做事获得技能和信心。文档作者承担“缺席教师”的职责，所以要尽量保证路径安全、步骤可执行、反馈明确。

适合：

- 第一次使用。
- 从零跑通。
- 形成基本心智模型。

不适合：

- 展示全部选项。
- 讨论复杂边界。
- 做字段级查阅。

### How-to guide

目标是帮助用户完成一个现实问题。读者通常已经具备基础能力，正在工作中寻找可执行方案。

适合：

- “如何连接远程 Agent”
- “如何接入 CI”
- “如何排查某类失败”

不适合：

- 教零基础概念。
- 写成长篇设计说明。
- 列完整 API 字典。

### Reference

目标是提供事实。它应当准确、完整、可靠，并且尽量中立。好的 reference 结构通常贴近它所描述对象的结构。

适合：

- API 字段。
- CLI 参数。
- 配置项。
- 类型、默认值、返回值。

不适合：

- 叙事化教学。
- 隐含未实现能力。
- 用大量解释打断查阅。

### Explanation

目标是理解。它回答“为什么”，允许讨论背景、取舍、上下文和相邻概念边界。

适合：

- 概念边界。
- 架构取舍。
- 术语解释。
- 常见误解。

不适合：

- 直接替代 How-to。
- 写成内部设计流水账。

## 对 NiceEval 的直接映射

- `quickstart` 应按 Tutorial 写，只保留一条最小成功路径。
- `guides/*` 应按 How-to 写，一个页面解决一个任务。
- `reference/*` 应按 Reference 写，严禁写未实现字段。
- `concepts/*` 应按 Explanation 写，解释 `Eval`、`Experiment`、`Adapter`、`Sandbox`、`Turn`、`Judge` 等概念边界。

## 可直接采用的检查问题

- 这页是在服务学习、工作、查事实，还是理解？
- 页面是否同时承担了两种以上主要目标？
- 如果是 Tutorial，用户是否能安全地完成第一次成功？
- 如果是 How-to，用户是否能完成一个具体任务？
- 如果是 Reference，信息是否完整、准确、低解释负担？
- 如果是 Explanation，是否真的解释了边界和原因，而不是在重复操作步骤？

