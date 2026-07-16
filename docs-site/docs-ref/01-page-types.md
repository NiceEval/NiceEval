# 第一步:判定页面类型

蒸馏自 [01-diataxis-divio.md](../dev-docs-dx-sources/01-diataxis-divio.md)、[06-good-docs-project.md](../dev-docs-dx-sources/06-good-docs-project.md)。

## 核心规则

动笔前先回答:**这页服务读者的哪种需求——学习、干活、查事实,还是理解?**

| 类型 | 读者需求 | 一句话定义 |
| --- | --- | --- |
| Tutorial | 学习 | 带用户安全地完成第一次成功,建立信心和心智模型 |
| How-to | 干活 | 帮已有基础的用户完成一个现实任务 |
| Reference | 查事实 | 准确、完整、低解释负担地描述字段、命令、类型 |
| Explanation (Concept) | 理解 | 解释概念边界、背景、取舍和"为什么" |
| Troubleshooting | 修复 | 按症状定位原因并给出解决步骤 |

如果一个页面同时承担两种以上主要目标,**优先拆页**,不要加小标题硬塞。

## NiceEval 中文目录映射

- `zh/tutorials/*`:Tutorial。当前只保留一条最短成功路径，不为凑结构增加教程。
- `zh/how-to/*`:How-to。一个页面解决一个现实任务。
- `zh/explanation/*`:Explanation。解释核心心智模型、概念边界和运行原理。
- `zh/reference/*`:Reference。只列当前实现支持的事实；API 签名、字段和 CLI flags 从源码生成。
- `zh/troubleshooting/*`:Troubleshooting。按用户可见症状组织排错。
- `zh/examples/*`:真实可运行案例。它是独立资源入口，不冒充 Tutorial，也不承担完整 How-to 或 Reference。

英文目录仍使用 `quickstart`、`guides/*` 和 `concepts/*`。中文是公开叙事的准绳，英文后续按中文结构翻译和同步。

## 每种类型的典型越界(写之前自查)

- Tutorial 不要变成 API 字段大全,不要展示全部选项和复杂边界。
- How-to 不要教零基础概念,不要写成长篇设计说明。
- Reference 不要混入 onboarding 叙事,不要写未实现字段或 roadmap。
- Explanation 不要伪装成操作步骤,不要写成内部设计流水账。
- Concept 页要写"它不是什么",防止用户把相邻层次混在一起(例如 Adapter 和 Sandbox)。

## 检查问题

- 这页是在服务学习、工作、查事实,还是理解?
- 页面是否同时承担了两种以上主要目标?
- 如果是 Tutorial,用户能否安全地拿到第一次成功?
- 如果是 How-to,读完能否完成一个具体任务?
- 如果是 Reference,信息是否完整、准确、无叙事打断?
- 如果是 Explanation,是否真的解释了边界和原因,而不是在重复操作步骤?
