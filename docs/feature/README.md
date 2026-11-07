# 功能文档

这里是 niceeval 已经采用的当前目标功能索引。
一个功能一个子目录，子目录按需拆成功能说明、Library 用法、CLI 反馈和架构。
正文写产品最终满足的契约，不描述实现过程；代码不满足时属于实现缺口。

跨 Run、Inspection 与 Delivery 的数据边界由
[Run → Inspection → Delivery](run-inspection/README.md) 统一说明。Inspection 关闭读取语义，再由固定
query 或 View 交付；它不是作者可扩展的中间层。

已经定稿但尚未被产品采用为当前契约的方向放 [`../roadmap/`](../roadmap/)。
Feature 身份不声明同一时刻的源码状态；它表示后续实现与评审只能以这里的唯一目标为准。
文档先行产生的 gap 只允许暂时存在，后续代码必须与 Feature 一致。

查询入口是 `concord list feature` 与 `concord show <id>`；新建 Feature 用 `concord new feature <name>`，既有页面直接编辑。布局与写法见 `concord --skill document`。

## 创建与编辑

`concord new feature <name> [--pages <list>]` 用 Concord 内置模板创建 Feature package，`concord new use-case <name> --feature <feature>` 在既有 Feature 下创建叶子 Use Case。既有页面与用例索引直接编辑。Roadmap 采用用 `concord roadmap start <id>`。

Roadmap 与 Design 候选也使用这套正文文件；Feature 与 Roadmap 的正文都是已裁决的目标契约。

- `README.md`：用户为什么需要它、核心心智和入口。
- `library.md`：用户怎样 import、调用和组合，涵盖主要场景；公开形状遵守[API 设计](../api-design.md)。
- `cli.md`：命令怎样调用，各种 case 的期望输出与错误反馈。
- `use-case/`：CLI 的每个位置参数与 flag——或 Library 的每组公开 API——配一组用例文档。

  - 一篇只讲一个最小用户用例：一个问题、一次主要调用、对应反馈、边界与替代模式。
  - `use-case/` 不嵌套：同一个 flag、API 或功能有两个以上独立用途时，在 `use-case/README.md` 里为它建一节，解释选择哪篇；叶子文件平级放在 `use-case/` 下，各讲一个用途。
  - 契约单源仍在 `cli.md` / `library.md` 与对应功能页，用例篇只做叙事串联。
  - Feature 的 `use-case/README.md` 按 flag 或 API 分组列出各篇。
    Library 用例另附 API → 篇目对照表。
- [`guides/`](../guides/README.md)：跨 Feature 的用户目标入口，例如“提高评估速度”与“调试评估”。
  每个目标使用一个中文子目录；目录 `README.md` 只做选择路径，把读者送到能力所属 Feature 的最小用例，不在这里复制缓存、Sandbox 或报告契约。
- `reference/`：这个功能的形状从哪些外部系统学来——逐条记「是什么、学了什么、哪里有意没跟」。
  它承载的是**选型依据**，不是当前契约，所以不进 `README.md` / `library.md` / `architecture.md` 正文；正文只在需要交代出处时链过来。
  被否决的**自家**历史方案仍归 `memory/`：`reference/` 写别人的做法，`memory/` 写我们自己的弯路。
- `architecture.md`：实现应满足的模块边界、数据建模、数据流和不变量。
  数据建模先定实体关系，再给每个公开配置与结果类型的穷尽形状；未列出的字段即不存在。
- `architecture/lifecycle.md`：跨 owner 展开运行起点选择、build / start / install、Fixture、复用与收尾。
  需要描述 fresh / reuse 差异时,给出每 Invocation、每 Sandbox 实例或复用周期、每 Attempt 的次数表。

除 `README.md` 外都按功能形态选用，不为凑固定结构创建空文档。

`use-case/` 下的叶子文件使用简短的目标名，让路径本身能回答“为什么读这一篇”。
代码标识、CLI flag 与 API 名不翻译；需要用它们分类时写在 `use-case/README.md` 的小节标题和索引中。

## 当前 Feature

- [Adapter](adapters/README.md)：连接 AI / Agent，各 SDK 契约由 `adapters/sdk/` 继续索引。
- [Assertion](assertions/README.md)：检查、作用域、证据与 `AssertionResult`。
- [Compile-time Contracts](compile-time-contracts/README.md)：作者输入与派生事实的阶段边界。
- [Error Classification](error-classification/README.md)：Turn 级有界重试与 Eval / Experiment 级停止派发。
- [Error Assistance](error-assistance/README.md)：安全错误说明、源码位置、迁移指南与同类聚合。
- [Eval](eval/README.md)：评估定义与 `defineEval`。
- [Eval Groups](eval-groups/README.md)：封闭成员集内的 Sandbox 复用与组间并行。
- [Eval Trajectory](eval-trajectories/README.md)：有向依赖路径上的分段执行、暂停与恢复。
- [Experiments](experiments/README.md)：运行配置与 `defineExperiment`。
- [Insight](insight/README.md)：受保护的本机 SPA、Snapshot 与人读审阅。
- [Inspection](inspection/README.md)：固定 query、闭合结果与机器查看。
- [Judge](judge/README.md)：裁判模型配置、调用与 unavailable。
- [Plugins](plugins/README.md)：带稳定身份的生命周期组合语法。
- [Run](run/README.md)：Run 生命周期、Attempt publication 与精确引用。
- [Run → Inspection → Delivery](run-inspection/README.md)：运行事实到机器或人读交付的数据边界。
- [Sandbox](sandbox/README.md)：隔离的执行资源。
- [State](state/README.md)：Cohort、精确 checkpoint 与状态生命周期。
- [跨 Feature 用户目标](../guides/README.md)：从完整用户路径导航到所属 Feature 的最小 Use Case。
- [Verdict](verdict/README.md)：显式 gate 与四态折叠。
