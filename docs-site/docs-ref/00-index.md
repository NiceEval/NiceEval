# 给 Agent 的 docs 写作指南

整理日期:2026-07-04。蒸馏自 [`../dev-docs-dx-sources/`](../dev-docs-dx-sources/00-index.md) 的来源级提取(Diátaxis、Divio、Google / Microsoft / GitHub 风格指南、Write the Docs、The Good Docs Project、MDN、I'd Rather Be Writing、GetDX / Twilio / Phodal 的 DX 资料)。

这套指南回答"怎么写好一页用户文档",按写作流程组织。仓库特定的术语表、目录职责和校验命令以 [`docs-site/AGENTS.md`](../../AGENTS.md) 为准,本指南不重复维护;两者冲突时以 AGENTS.md 为准。

## 使用顺序

写任何 `docs-site/` 页面前,按顺序过一遍:

1. [01-page-types.md](./01-page-types.md):先判定这页是 Tutorial、How-to、Reference、Explanation 还是 Troubleshooting。这是最重要的一步,页面类型错了后面全错。
3. [03-style-rules.md](./03-style-rules.md):行文、步骤、可扫描性、标题与搜索意图。
4. [04-code-examples.md](./04-code-examples.md):代码示例的写法和维护义务。
5. [05-dx-failure-paths.md](./05-dx-failure-paths.md):失败路径覆盖和"文档是 DX 的一部分"视角。
6. [06-checklists.md](./06-checklists.md):动笔前、按类型、发布前三层检查清单。

## 三条最高原则

如果只记三件事:

1. **一页只服务一种需求。** 学习、干活、查事实、理解,四选一。页面边界模糊是文档难用的首要原因。(Diátaxis)
2. **"刚好足够"胜过"全面覆盖"。** 更多内容会让所有内容更难找;优先写高频高价值路径,不为完整性堆低频分支。(GitHub Docs)
3. **错误的文档比没有文档更糟。** 每个声明的命令、字段、路径、能力,写之前先对当前代码或真实运行结果核实;未实现的能力不进正式文档。(Write the Docs / MDN)
