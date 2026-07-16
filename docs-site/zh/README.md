# 中文公开文档信息架构

`zh/` 按读者此刻的需求组织，不按 NiceEval 的内部模块组织。判断一页放在哪里时，先问读者是在学习、完成任务、查事实、理解原理，还是修复问题。

## 五个正文分区

| 目录 | 页面类型 | 读者要什么 | 本站边界 |
| --- | --- | --- | --- |
| `tutorials/` | Tutorial | 跟着一条安全路径拿到第一次成功 | 当前只有 `quickstart.mdx`。不为凑齐目录增加第二条入门路径 |
| `how-to/` | How-to | 完成一个现实任务 | 标题用任务表述；步骤、验证方式和失败后的下一步要清楚 |
| `explanation/` | Explanation | 理解概念、边界和运行原理 | 不承担完整操作步骤或字段罗列 |
| `reference/` | Technical Reference | 快速查准确、完整的事实 | API 签名、字段、类型和 CLI flags 以源码为权威来源 |
| `troubleshooting/` | Troubleshooting | 从可见症状定位并修复问题 | 按症状组织，不按内部模块组织 |

`index.mdx` 和 `introduction.mdx` 是站点入口，不硬归入正文类型。`examples/` 是独立资源入口，不属于 Diátaxis 的四种正文类型。

## Examples 的收录标准

`examples/` 只收录有真实可运行源码的项目。一个案例页只回答四件事：被测对象是什么、这个项目证明什么、源码在哪里、怎么运行。操作步骤的通用版本链接 How-to，字段和配置全集链接 Reference，不在案例页复制。

- 接入前后能从仓库源码计算时，由生成器产出 diff 页面，不手抄代码。
- 同一个可运行项目只保留一张案例页。Skill、Plugin 等相邻主题共享实验设计时合并，不复制两份近似正文。
- 只有一个条目的 Showcase 不单独成页，真实项目直接列在 `examples/index.mdx`。
- 没有可运行源码、只有片段或设想的内容不进 Examples。片段进入对应 How-to，未实现方向留在 Roadmap。

## Reference 的生成边界

Technical Reference 不等于整页都由生成器拼出来。页面仍可手写短导语、最小示例和去往 How-to 的链接，但代码形状不能手抄：

- `{/* GENERATED:BEGIN ... */}` 与 `{/* GENERATED:END ... */}` 之间的 API 成员、字段和 CLI flags 由 `pnpm docs:reference` 从源码紧邻注释生成。
- 新增需要穷举的接口字段、函数、联合类型或 CLI flag 时，扩展 `scripts/generate-reference.ts` 的 region 映射，不在 MDX 里另写一份字段全集。
- 能力矩阵、选择表和行为约束暂时由手写 Reference 承担；它们必须只描述当前实现，并避免重复已经生成的类型签名。
- `reference/` 中没有生成区块的页面不因此成为 API 事实的第二来源。出现代码形状时，优先链接已有生成页；确实缺少生成入口时先补生成器。

运行 `pnpm docs:reference` 后，生成器只改 `zh/reference/` 中已登记的 region。`test/reference-consistency.test.ts` 会拦截源码与生成区块的漂移。

## 当前页面归类

- `explanation/runner.mdx` 解释执行引擎如何发现、调度、缓存和产出结果，不是一步一任务的操作指南。
- `reference/official-adapters.mdx`、`reference/report-components.mdx` 和 `reference/results-data.mdx` 用于查能力、组件或数据 API，不能留在 How-to。
- `troubleshooting/debugging.mdx` 与 `troubleshooting/debug-sandbox.mdx` 从失败症状出发，目录独立，在导航中归入 How-to Guides。
- `how-to/sandbox-providers.mdx` 目前保留在 How-to，因为主问题是选择并配置 Provider；若以后字段表继续增长，再拆出独立 Provider Reference。

新增或移动页面时，同时更新 `docs-site/docs.json` 和旧路径 redirect。校验命令以 [`../AGENTS.md`](../AGENTS.md) 为准。
