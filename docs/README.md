# ⚡ NiceEval 设计文档

`docs/` 保存 NiceEval 的最终功能契约、形成这些契约的设计材料，以及带日期的外部产品研究。
Feature 和未归类的产品页描述已经采用的唯一当前目标，Roadmap 描述已定稿但尚未被产品采用为当前契约的方向。
Design 保存多方案比较与裁决存档，Research 只提供决策输入而不构成目标契约。

因此：

- Feature 与 Roadmap 中的 API、CLI、目录或行为都可以先于代码存在。
- Feature 与代码不一致时属于暂时的实现缺口，后续代码必须收敛到 Feature；Roadmap 不约束当前产品实现。
- 把契约写进 Feature 同时建立实现义务，不能把 gap 当作可选方向或长期双真源。
- 文档正文不写 `已实现` / `未实现` / `目前代码还是` / `之后再做` 等实现状态。
- 只有设计本身改变时才改契约；`实现进度`、变更审计和历史过程不改变契约措辞。

讨论或修改设计时，目标状态一律以 docs 的声明为准；docs 未声明的行为视为未定稿，先在对话或 Design 中裁决，不从源码反推。
只有进入实现与核对阶段，才使用 [Source Map](source-map.md) 定位源码并直接检查实现。
要写入实现踩坑或设计翻案，进入 [`memory/INDEX.md`](../memory/INDEX.md)。

## 按意图进入

| 现在要做什么 | 从哪里开始 |
|---|---|
| 建立产品心智 | [Concepts](concepts.md) → [Architecture](architecture.md) |
| 组合或替代 CLI / Web host | [Architecture](architecture.md#公开-host-composition-sdk) → 对应 Feature Library |
| 从用户价值审视完整产品范围 | [用户故事地图](user-story.md) |
| 理解 Run 与 Attempt 怎样经过 Inspection 到 Insight | [Run → Inspection → Insight](feature/run-inspection/README.md) |
| 查什么改动会重跑，或两个 Run 凭什么可比 | [缓存与携带](feature/experiments/cache.md)（eligibility identity 与 domain） |
| 让记忆库或累积笔记跨 Attempt 延续 | [Sandbox 复用](feature/sandbox/reuse.md) 与 [Sandbox 生命周期](feature/sandbox/lifecycle.md) |
| 让 Agent 在 Sandbox 内使用 Docker / Compose | [Nested Docker](feature/sandbox/nested-docker/README.md) |
| 从零理解使用路径 | [Getting Started](getting-started.md) |
| 设计或修改一个用户功能 | [Feature Skill](../.agents/skills/feature/SKILL.md) → [Feature](feature/README.md) → 对应功能目录 |
| 从 Feature 或测试反查 Use Case、E2E、Roadmap、Design 与 Memory | [仓库文档追溯](engineering/docs-traceability/README.md) |
| 设计或评审公开 API | [API 设计](api-design.md) |
| 查看或修改已经定稿、等待采用的方向 | [Roadmap Skill](../.agents/skills/roadmap/SKILL.md) → [Roadmap](roadmap/README.md) |
| 对比多个候选方案、给出架构 / 技术选型裁决 | [Design](design/README.md) |
| 研究外部产品及其对 NiceEval 的启发 | [Research](research/README.md) |
| 查询、设计或评审测试 | [Testing Skill](../.agents/skills/testing/SKILL.md) → [Testing](engineering/testing/README.md) |
| 设计仓库其它维护或 benchmark | [Engineering](engineering/README.md) |
| 查仓库命令、维护 Skill 与对应守护 | [Repository Tools](engineering/repository-tools/README.md) |
| 跟进公开、脱敏且需 maintainer 处理的 Observation | [GitHub Issue 与 Memory](engineering/issues/README.md) |
| 沉淀调查后的 Problem、Decision 或可复用 know-how | [Memory Skill](../.agents/skills/memory/SKILL.md) |
| 切分互斥的多 Agent 文档工作 | [并行文档工作](engineering/docs-work/README.md) |
| 给文档画一张 SVG | [SVG 图示的视觉契约](SVG-DESIGN.md) |
| 从契约找到实现 | [Source Map](source-map.md) |
| 查一处设计从哪个系统学来 | [Research](research/README.md)；RFC、OWASP 等基础规范仍见对应 Feature 的 `reference/` |
| 查过去的坑或被否决方案 | [`memory/INDEX.md`](../memory/INDEX.md) |
| 写公开用户文档 | [`apps/docs-site/AGENTS.md`](../apps/docs-site/AGENTS.md) |

## 目录索引

根索引只负责路由到所有直接入口。进入二级目录后，从它自己的 `README.md` 发现完整主题清单。

- [Feature](feature/README.md)：已采用的唯一当前目标契约。
- [Roadmap](roadmap/README.md)：已定稿、尚未采用为当前契约的方向。
- [Design](design/README.md)：多候选方案的比较与裁决存档。
- [Research](research/README.md)：带观察日期的外部产品研究。
- [Engineering](engineering/README.md)：仓库自身的测试、维护、同步与 benchmark 机制。
- [文档模板](_template/README.md)：Feature Design Package 与 Design Decision 的受管创建材料。

根目录的产品与共用设计页仍由本入口直接拥有：

- [Concepts](concepts.md)、[Architecture](architecture.md)、[Getting Started](getting-started.md) 与 [用户故事地图](user-story.md)。
- [API 设计](api-design.md)、[Origin 接入](origin-integration.md)、[Observability](observability.md)、[Runner](runner.md) 与 [CLI](cli.md)。
- [错误反馈](error-feedback.md)、[外部参考](references.md)、[Source Map](source-map.md) 与 [SVG 视觉契约](SVG-DESIGN.md)。
- [`writing-rules.json`](writing-rules.json)：句长、段长与禁用写法的受管裁决。

## 文档的唯一归属

写之前先判断内容是什么：

| 内容 | 归属 |
|---|---|
| 已采用的当前功能、API、CLI、语义与架构理由 | `docs/feature/` 或 `docs/` 对应设计页 |
| 已裁决但尚未采用为当前契约的方向 | `docs/roadmap/` |
| 需要对比多个候选方案的架构 / 技术选型决策 | `docs/design/` |
| 带日期的外部产品事实、竞品映射与产品启发 | `docs/research/` |
| 仓库自身如何测试、维护、同步或 benchmark | `docs/engineering/` |
| 用户如何完成任务 | `apps/docs-site/zh/` |
| 设计翻案、被否决方案、踩坑与反直觉修法 | `memory/` |
| 本次修改了什么、为什么 | commit message |

同一事实只在一个入口完整定义。
其它页面用链接建立关系，不复制一份容易漂移的规则。

## 共用 Feature Design Package

Feature、Roadmap 与 Design 的每个候选使用同一套 [`_template/feature-design/`](_template/feature-design/README.md):

- `README.md`:问题、核心心智、范围与正文入口。
- `library.md`:公开 Library 形状。
- `cli.md`:CLI 输入输出与反馈。
- `architecture.md`:数据建模、内部边界、时序和不变量。
- `lifecycle.md`:跨 owner 的起点选择、build/start/install、Fixture、复用与收尾时序。
- `use-case/`:按用户目标组织的完整路径。

只有 `README.md` 必备,其余页面按功能形态选用。
三类目录区分采用状态与裁决职责：Feature 是当前唯一目标，Roadmap 是已定稿但尚未采用的方向。
Design 的 `PLAN-N/` 是参与同一裁决的自包含候选。
Design 主题外层另用 [`_template/design-decision/`](_template/design-decision/README.md) 保存 Goals、Limits、Cases 与 Decision。

## 写目标状态

每一段都应让从未读过旧稿的人独立理解最终契约。

- 用声明句写产品应当是什么、输入输出是什么、错误如何反馈。
- 可以写稳定理由，例如为什么使用组件树；理由帮助约束实现。
- 不写时间线或差分句，例如 `之前是`、`现已改为`、`删除 X 后`、`新版不再`。
- 不在 Feature 或 Roadmap 正文保留“要不要”“再议”等开放问题。
  未裁决内容留在 Design 或对话中。
- 设计变化时重写受影响小节，不在旧段落后追加修正说明。
- 不用当前类型或当前输出反向限制目标设计。
  示例展示的是期望 API 与期望反馈。
- 数据建模先于字段罗列：先写清实体之间谁从属于谁、靠什么关联，再给每个实体的精确形状。
- 公开配置与结果的数据结构以穷尽形状定稿——TS interface 代码块或字段表，未列出的字段即不存在。
  「有没有某字段」这类问题以形状声明为准，不以源码为准。

Feature、Roadmap 与 Design 候选的正文体裁由共用 Feature Design Package 定义。
各入口只补充自己的成熟度与迁移规则。
Engineering 文档的组织方式由 [`engineering/README.md`](engineering/README.md) 定义。
Design 文档的组织方式由 [`design/README.md`](design/README.md) 定义。

## 写给人读

`docs/` 的读者是照着它做设计决策、写实现的人，不是只被 grep 的语料。
`apps/docs-site/zh/` 的读者要边读边完成任务，同样需要短句和可扫读的段落。
契约再准确，段落读不动也等于没写：读者会转去翻源码，`docs/` 就失去唯一现状出处的地位。
句长、段长和禁词检查只负责拦住明确的退化，不负责证明文案好读。通过 lint 后仍要逐段朗读，确认主语、动作和结果都能一次听懂。

因此正文按下面三条写。

| 规矩 | 上限 | 超了怎么办 |
|---|---|---|
| 单句长度 | 140 字 | 拆成两句，或把并列内容改写成列表 / 表格 |
| 一段长度 | 320 字 | 一段只说一件事；罗列条件、字段或状态用表格和列表，不用长句串联。列表项各算一段 |
| 括号嵌套 | 1 层 | 第二层插入语提成独立句子，或变成表格的一列 |

句长与段长量在软换行拼接之后：在句子中间敲个回车渲染结果一个字不变，不算把长句拆开。
只有句末标点算断句，分号和破折号串起来的分句仍是同一句——长难句正是这么长起来的。
一行有多长不受限：句子写完再换行，中途要不要断行按 diff 好不好读自己定。

用词只有一处出处：[Concepts](concepts.md)。

- 同一概念在正文里始终写同一个词，不换同义词，也不临时造中文译名。
- 要用总表里没有的概念，先在 concepts.md 立词，再在正文使用。
- 已裁决不许出现的写法登记在 [`writing-rules.json`](writing-rules.json) 的 `bannedTerms`，一条带 `term` / `use` / `why`；裁决新术语时同批加一条。只有同时登记在 `siteBannedTerms` 的通用禁词才作用于公开中文站。只针对用户文档内部口吻的写法登记在 `siteOnlyBannedTerms`，不强加给设计契约。
- 要在正文里引用某个禁用写法本身（例如说明为什么不写它），把它写成行内代码：检查会先剥掉行内代码与代码块。

## 体裁分工:契约页薄,用例页厚

一个 Feature Design Package 里,每种文件只承担一种体裁,场景叙事不挤进契约页:

| 文件 | 体裁 | 代码示例的尺度 |
|---|---|---|
| `README.md` | 为什么要这个功能、核心契约总纲 | 只到说明概念所需的最小片段 |
| `library.md` / `cli.md` | API 面 / CLI 面:导出什么、参数与返回、约束与错误 | 只到最小调用形状,一个 API 一段 |
| `architecture.md` | 模块边界、数据建模、内部不变量 | 类型与数据形状为主 |
| `lifecycle.md` | 跨 owner 的完整运行时序与 fresh/reuse 次数 | 顺序图、次数表与状态转移为主 |
| `use-case/` | 场景叶子文档:一篇讲一个用户目标的完整路径 | 完整可抄的代码示例住这里 |

两条纪律:

- **契约单源不迁移。** 定义只写在 `library.md` / `cli.md`;`use-case/` 只做搭配与叙事,引用契约页,不复制定义——各 use-case README 开头那句「契约单源始终在…」就是这条的落点。
- **契约页要场景时引用,不展开。** `library.md` 讲到某个参数的典型场景(断网、并发临界区这类),一句话点到,链接 `use-case/` 对应叶子;完整代码不进契约页。

## 从设计到实现

一次设计迭代按以下顺序完成：

1. 在对话或 Design 中裁决分歧；未裁决内容不写进 Roadmap 或 Feature。
2. 已定稿但尚未成为当前产品目标的方向写入 Roadmap。
3. 产品采用该方向时，把完整契约并入 Feature，并删除被取代的 Feature 与 Roadmap 入口。
4. 修改代码、验证与公开文档，使实现满足 Feature；偏差作为实现缺口处理。
5. 按 [Source Map](source-map.md) 和对应功能入口验收；翻案或反直觉修法写入 `memory/`。

文档先于实现并不表示可以留下永久漂移。
目标一旦定稿，后续工作应以完成实现和验证为终点。

## 校验与同步

修改 `docs/`、`apps/docs-site/` 或根 README 后统一运行：

```sh
pnpm lint
```

文档与文档站的全部 lint 都挂在这一条命令上：

- `lint/docs/docs-consistency.lint.ts` 检查索引涵盖与相对链接。
  新增设计页必须从本索引或所属二级目录的 `README.md` 可发现。
- `lint/docs/docs-writing.lint.ts` 检查 `docs/` 与 `apps/docs-site/zh/` 的句长、段长，并按各自作用域检查禁用写法与两条立词纪律。MDX 的 frontmatter 元数据、代码、JSX 实现和明确的生成区块不算手写正文。
  括号嵌套靠人读，没有守护。
- `lint/docs-site/**/*.lint.ts` 检查参考区块、随包索引与站点迁移，再运行 Mintlify 校验和断链检查。

`pnpm install` 会把仓库的 Git hook 路径配置为 `.githooks`。
`pre-push` 调用同一条 `pnpm lint`，不单独维护另一份规则清单。

超标时这条命令直接打出每一处该怎么改——文件:行号、超了多少字、命中哪个禁用写法及为什么。
没有第二条命令要记。

两条立词纪律都读 [`concepts.md`](concepts.md) 的术语总表，术语因此只在那一张表里裁决一次：

- **死词**：一个词条声明的写法（中文名、English 名、括号里的代码标识）在 `docs/` 与 `apps/docs-site/` 正文一次都没出现，说明立了没人用。
  删掉那一行，或者让正文改用它。
- **非首选同义词**：一格里并列多个写法、其中一个加粗时，粗体那个是首选，其余出现在正文即提示改用首选。
  没有粗体的多写法格是几个并列词条，不是同义词，不产生裁决。

写作规则零容忍：正文一次命中都不许有，不存在存量上限，也没有 `-u` 收紧这一说。
新增规则时，存量正文当场改写，让「放宽」这个动作留在 diff 里接受检查。

如果设计同时改变公开 API、CLI、结果格式或用户任务路径，还要沿对应入口完成同步：

- 公开参考区块：修改源码 TSDoc / CLI flag JSDoc 后运行 `pnpm run repo docs reference`。
- 公开中文文档：按 [`apps/docs-site/AGENTS.md`](../apps/docs-site/AGENTS.md) 更新并运行 `pnpm run repo docs site validate`、`pnpm run repo docs site links`。
- 示例：按 [`examples/README.md`](../examples/README.md) 与对应示例目录说明验证。
