# Vercel `design.md` 适格性审查

> 观察日期：2026-08-14
>
> 研究判断：不适合继续作为 Record → Report 产品样本
>
> 建议归属：报告设计或报告作者面研究

## 证据范围与快照

本页只使用 Vercel 官方页面、官方样式资产和官方 GitHub 仓库。
`design.md` 的服务端实现没有公开时，本页明确写“未公开”，不推测数据库或内部流程。

2026-08-14 读取的公开资源快照如下。
URL 是可变入口，SHA-256 只标明本次核对的 bytes，不是 Vercel 发布的 schema version。

| 资源 | 本次快照 | 核对用途 |
|---|---|---|
| [`https://vercel.com/design.md`](https://vercel.com/design.md) | `07ed2923294aa326f65f9d9d4094b6e97bf7de10c39acd8be935f2045c5a688f` | 身份、四段工作流、VBG API、calculator 与验收行为 |
| [`https://vercel.com/geist/vercel-brand.css`](https://vercel.com/geist/vercel-brand.css) | `8ad94ba0750ecea6c9464ff9267c972c22dab68d2aa934ac88f13aa2e8c797b7` | 样式 asset、token、class 与内嵌 upstream 快照说明 |
| [`vercel/eve-examples` commit `850671f`](https://github.com/vercel/eve-examples/commit/850671ff88a74d637b361df64ff258779e51e1d8) | 2026-08-11；完整 SHA `850671ff88a74d637b361df64ff258779e51e1d8` | 核对 VBG 呈现与 Eve session/run 职责分离 |

Vercel 没有在这些材料中给出 `/design.md` 发布路由、VBG bundle 生成器或 release history 的 repo path。
服务端持久化、发布事务和内部 migration 因而属于**未公开**边界，不能反推为不存在。

## 适格性门槛

Record → Report 研究要求产品先保存 Run、Trace、Experiment 或 Evaluation 的事实，再让用户重开、查询、比较和展示。
Vercel `design.md` 只满足最后一项中的页面呈现部分。

| 入选问题 | `design.md` 的公开行为 | 判定 |
|---|---|---|
| 是否有可命名的运行对象 | 只命名 report website、caller project、VBG 与 calculator | 否 |
| 是否有 CLI/API 发起、调度、执行和完成顺序 | 只有 agent 的设计与实现步骤 | 否 |
| 是否持久化运行结果 | 只编辑宿主网页文件并引用或复制 CSS | 否 |
| 是否能重开历史运行 | 没有 ID、历史列表、revision 或 query 入口 | 否 |
| 是否能筛选、对齐、分组和比较历史结果 | 只有当前页面的视觉组织与比较 | 否 |
| 是否公开 schema/version/compatibility/migration | 只有未版本化的指令与 CSS API | 否 |
| 是否具有报告呈现研究价值 | 有信息架构、证据几何、视觉系统与验收规则 | 是 |

因此，本对象应移出 [Record → Report 研究](../README.md)。
若仓库不建立报告设计研究方向，则应删除本目录及上级索引项。
本任务不能修改上级文件，所以只在本目录写明处置建议。

## 公开工作顺序不是实验执行

[`design.md`](https://vercel.com/design.md) 没有调用命令、HTTP experiment endpoint、job、queue、worker 或 run identifier。
它也没有 `queued`、`running`、`completed` 等状态机。
调用者怎样把这份 Markdown 提供给 agent，取决于外部 agent 产品。

它公开的真实顺序是：

```text
调用者材料 + 宿主项目
        ↓
agent 检查材料并识别读者问题
        ↓
Frame the reader's job
        ↓
Choose the composition
        ↓
Authoritative Vercel visual system
        ↓
实现页面并加载或复制 VBG foundation
        ↓
Inspect and revise privately
        ↓
交付宿主项目中的网页实现
```

四段流程都来自 [`design.md`](https://vercel.com/design.md)：

1. `Frame the reader's job` 识别读者、问题、最强可支持答案、证据和会改变解释的限制。
2. `Choose the composition` 按证据关系选择页面几何；table 用于精确查阅，chart 只用于更快看懂关系。
3. `Authoritative Vercel visual system` 把 authorship shell、grid、typography、surface、evidence 与 interaction 规则落实到页面。
4. `Inspect and revise privately` 检查首屏、整页、明暗主题、响应式、语义、焦点和文字替代，再修正重要缺陷。

文档使用“completed page”描述作者感，并要求最后交付 requested implementation。
这是人工可见的完成条件，没有 completion resource、完成时间、状态字段或可 query 标识。

## 没有持久结果模型

`design.md` 没有数据库 table/model、磁盘目录约定、序列化 envelope 或 Report API resource。
它公开的是指令、宿主文件编辑约束和页面呈现 API。

| 公开对象 | shape 或位置 | owner | 数据性质 |
|---|---|---|---|
| 指令资源 | `https://vercel.com/design.md`；frontmatter 只有 `name` 与 `description` | Vercel 发布 | 指令，不是用户结果 |
| 宿主网页源码 | 不指定文件名；沿用 caller's project 的目录、route、component 和 build 约定 | 调用者项目；agent 写入 | 页面 artifact |
| VBG foundation | `https://vercel.com/geist/vercel-brand.css`，或复制、inline 相同 bytes | Vercel 发布；宿主选择引用方式 | 样式 asset |
| standalone shell | `.vbg-report` → `.vbg-shell` → header / main / footer | 生成页面 | DOM 呈现约束，不是 envelope |
| 页面扩展 | 语义 HTML 加 `vbg-custom-*` / `vbg-viz-*` | 宿主页面 | 局部布局与 mark |
| 输入事实 | facts、formula、unit、qualifier 与 privacy constraint | 调用者材料 | 写入宿主源码或输出后才留下 |
| calculator state | canonical state model；默认结果预渲染，交互后重算 | 浏览器页面 | 短生命周期派生状态 |

调用者提供的事实、公式、单位、限定条件与隐私要求是内容的权威输入。
[`design.md`](https://vercel.com/design.md) 把保留它们列为最高优先级，并要求区分 observation、derivation、projection、recommendation 与 causation。

图形位置、长度、格式化值、响应式重排和 calculator output 是派生呈现。
重要 chart data 还要有 semantic table 或文字替代，但两者仍属于同一网页，不是两套事实 store。

公开文本没有命名 domain cache 或 index。
VBG CSS 可以经网络缓存或复制进宿主项目，但这只是 asset 交付方式。
class 清单是 CSS API 目录，不是历史结果 index。

## 写入 owner、原子性与失败

[`design.md`](https://vercel.com/design.md) 指示 agent 编辑“naturally own the experience”的宿主文件。
宿主项目拥有文件路径、framework、route、build 和 deployment。
Vercel 公开资源只拥有指令文本与 VBG CSS，没有远端 Report create/update API。

页面事实的 owner 仍是调用者材料。
agent 不得制造 intent、owner、deadline、approval、future behavior、confidentiality 或 certainty。
材料缺少非关键事实时应省略或诚实标注；可能改变实质含义时，才集中提问一次。

公开指令没有文件事务、数据库事务、两阶段提交、原子 rename 或回滚保证。
多文件编辑能否原子提交，由外部工具和版本控制决定。

唯一明确的“atomic”行为属于 calculator UI。
dependent output 要从 full-precision state 一起更新，再格式化显示。
这不是持久数据事务，也不产生 checkpoint。

| 情况 | 指令要求 | 不具备的能力 |
|---|---|---|
| VBG URL 不是 CSS 或加载失败 | 复制相同 bytes 或 inline | 不恢复实验运行 |
| calculator input 无效 | 保留无效输入和最后一个有效结果 | 不保存 scenario history |
| 材料有关键歧义 | 集中提问一次 | 没有 persisted blocked state |
| 材料不支持判断 | 省略未知，或明确写限制与未解决问题 | 不形成 partial Run |
| 页面仍有重要缺陷 | 修复、重新 render、继续复查 | 没有 retry resource |

公开材料没有 partial artifact 状态、resume token、retry count、幂等键或 crash recovery。
agent turn 中断后能否继续，取决于宿主 agent 和代码库，不能归因给 `design.md`。

## 当前页面阅读不是历史读取

生成网站可以经宿主 route、preview 或 deployment 打开。
[`design.md`](https://vercel.com/design.md) 不规定 artifact ID、永久 URL、revision picker 或 archived report list。
用 Git 查看旧源码也是宿主仓库能力，不是该资源提供的读取入口。

| 研究动作 | 能力 | 公开语义 |
|---|---|---|
| reopen 历史运行 | 无 | 没有 Run ID、Report ID 或历史列表 |
| query | 无 | 没有 query language、SDK、REST resource 或 row API |
| filter | 无历史筛选 | 页面可有普通交互，但没有跨运行筛选契约 |
| align | 仅当前构图 | 对齐 peer row、column、baseline 与 common scale |
| group | 仅当前构图 | 用 spacing、section、surface 或重复结构表达分组 |
| compare | 仅当前材料 | 以 comparison table、共同尺度或对照 column 展示 alternatives |
| render | 有 | semantic HTML、table、inline SVG、calculator、light/dark 与 responsive page |
| audit | 仅当前页面 | exact table、assumption、method、caveat 与引用出处 |

`design.md` 的 compare 不会寻找两次历史实验、对齐样本、处理 missing row 或计算组间统计。
数据选择、聚合和可比性必须在调用它之前由其它系统解决。

缺测也没有独立 shape。
材料不支持某项判断时，页面只能省略未知，或把限制和尚未回答的问题写进内容。
没有 `missing`、`partial`、`unsupported` 等可 query 状态。

## 没有 schema、兼容 reader 与 migration

[`design.md`](https://vercel.com/design.md) 的 YAML frontmatter 没有 `version` 字段。
VBG class、token 和 DOM child relationship 是页面 API 约束，但没有 semantic version、deprecated list 或 compatibility reader。

[`vercel-brand.css`](https://vercel.com/geist/vercel-brand.css) 的 bundle 注释包含一个 GeistCN source snapshot 和两个源文件 SHA-256。
这些值说明 bundle 的构建输入，不是报告对象版本，也没有 old-to-current reader。
公开 CSS URL 本身不带版本段。

公开材料没有 migration table、migration file、升级命令、相邻版本转换链或 destructive-change 提示。
它也没有需要迁移的用户 Run、Trace、Experiment 或 Report resource。
因此，“migration 是否改写用户保存的数据”在这个产品模型中没有对象可答。

若宿主复制 CSS，未来更新只能由宿主普通改文件。
若宿主链接未版本化 URL，未来 bytes 可能变化；这是从 URL 形态得出的风险推论，不是 Vercel 兼容承诺。
`design.md` 没有把任一种情况定义为 migration。

`/design.md` 发布源码、VBG 生成器、内部数据库和正式变更流程都未公开。
所以不能声称 Vercel 内部没有 migration，只能说公开的 `design.md` 没有向使用者提供 migration 契约。

## 哪些 derived value 会生成资源

[`vercel-brand.css`](https://vercel.com/geist/vercel-brand.css) 把 Geist color、type 与 spacing 语义整理成 VBG token 和 primitive。
它把 upstream snapshot 与 source hash 放进 bundle 注释。
这是预先生成的派生样式 asset，不是用户实验结果。

Calculator 的 default result 必须 pre-render。
一个可由 formula 计算的值因而会进入初始 HTML，确保脚本交互开始前就可读。
它在 request time 预渲染，或在 build time 生成；指令没有要求另存 durable row。

用户改变 calculator input 后，页面从 canonical full-precision state 重算 dependent output，再按显示精度格式化。
响应式重排、theme 选择和 CSS layout 也在浏览器读取页面时生效。
文档没有保存 calculator scenario、interaction event 或每次计算结果的行为。

这套边界减少页面作者重复实现视觉 token 的成本，也让 derived display 不需要后端列。
但它没有 durable fact schema，不能证明报告演进不会改变实验事实 schema。
VBG API churn 只影响宿主源码与渲染兼容性，不能类比为 Record schema migration。

## 官方源码怎样证明边界

Vercel 官方 `vercel/eve-examples` 仓库有一个同时使用 Eve runtime 与 VBG 的公开样本。
它不是 `design.md` 的实现源码，只用于判断职责落点。

在 commit [`850671f`](https://github.com/vercel/eve-examples/commit/850671ff88a74d637b361df64ff258779e51e1d8) 中：

- `eve-llm-council-template/app/layout.tsx` 的 `RootLayout` 通过 `<link>` 加载 [`vercel-brand.css`](https://github.com/vercel/eve-examples/blob/850671ff88a74d637b361df64ff258779e51e1d8/eve-llm-council-template/app/layout.tsx#L16-L23)。
- `eve-llm-council-template/app/council-app.tsx` 的 `CouncilApp` 创建 Eve `Client`，`streamMember` 再 attach session。
  `handleEvent` 接收 `result.completed`，`useEveAgent` 负责发送请求。[源码行 44–187](https://github.com/vercel/eve-examples/blob/850671ff88a74d637b361df64ff258779e51e1d8/eve-llm-council-template/app/council-app.tsx#L44-L187)
- 同一 `CouncilApp` 到 render 阶段才套上 `.vbg-report` 与 `.vbg-shell`。[源码行 191–192](https://github.com/vercel/eve-examples/blob/850671ff88a74d637b361df64ff258779e51e1d8/eve-llm-council-template/app/council-app.tsx#L191-L192)
- 示例 README 把 durable session、session stream 和 structured output 归给 Eve。[README 行 14–31](https://github.com/vercel/eve-examples/blob/850671ff88a74d637b361df64ff258779e51e1d8/eve-llm-council-template/README.md#L14-L31)

因此，样本中的 session、stream、result 和完成事件属于 Eve。
VBG 只拥有 authorship shell 与视觉呈现，不能为 `design.md` 补出实验生命周期或持久结果。

## 处置建议

本对象有报告设计研究价值，但不应继续占用 Record → Report 产品样本名额。
建议把精简研究包移到报告设计或报告作者面方向，并从上级产品索引删除 Vercel。

迁移归属时应保留三类可吸收约束：读者任务与双阅读路径、证据几何与就近限定、真实渲染与访问性复查。
不应把 Vercel 品牌 shell、Geist、固定 grid 或 VBG API 变成 NiceEval 产品契约。
