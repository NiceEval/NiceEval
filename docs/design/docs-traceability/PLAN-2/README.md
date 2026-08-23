---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-2：owner-local typed links 与动态编译（推荐）

## 解决的问题

本方案在现有 owner 处补最少的类型信息。`pnpm docs:trace` 每次从 Git 工作树形成只读 Trace Snapshot，再输出固定投影。

## 核心心智

节点、关系与人读索引分开：

```text
Doc node frontmatter ─┐
owner contract link ──┼──► pure Trace compiler ──► immutable Snapshot ──► list/show/check
test owner/regression ┤
Memory frontmatter ───┘

generated README blocks ◄── create/move/adopt
        human navigation only; compiler never reads them
```

Snapshot 不写入 Git、不跨 invocation 缓存，也不接受任意查询语言。所有反向关系由正向 owner 边推导。

## 节点与 placement

`niceeval.docs-node/v1` frontmatter 只声明节点类别及该节点拥有的强关系。canonical ref 永远由 repo-relative path 产生；不手填 ID、title 或 status。

| kind | 合法 owner | 允许的关系 |
|---|---|---|
| `feature` | `docs/feature/**/README.md` 的 package root | 无；直接子 Feature 由 placement 推导 |
| `roadmap` | `docs/roadmap/**/README.md` 的 package root | `buildsOn` |
| `engineering` | `docs/engineering/**/README.md` 的主题 root | `supports` |
| `design` | `docs/design/<name>/README.md` | `selectedPlan`、`decides` |
| `design-plan` | `docs/design/<name>/PLAN-N/README.md` | 无 |
| `use-case` | Feature/Roadmap/Design Plan 的叶子 `.md` 或目标目录 README | 跨 Feature 目标可用 `composes` |

Category README、普通分组 README、reference、模板和普通契约页不标节点。它们归最近节点所有，仍可用 path+anchor 定位。
`use-case-group` 不存在；跨 Feature 目标 README 与真正叶子文件才是 `use-case`。

Design 的 `selectedPlan` 恰好一个，且只能指向直接包含的 `design-plan`。scaffold 可以暂缺，但 strict `check` 与 lint 必须失败，不增加 status 字段。

未知关系字段、非法 target kind、绝对路径、反斜杠、dot traversal、重复 canonical ref 与 kind/placement 不一致全部失败。

## 关系所有权

| 关系 | 正向 owner | 目标 | 反向用途 |
|---|---|---|---|
| structural containment | placement | 直接子节点与本地 Use Case | 列出子功能和本地用例 |
| `buildsOn` | Roadmap | Feature 或 Roadmap 的精确节点/anchor | Feature 显示直接相关 Roadmap |
| `supports` | Engineering | Feature、Roadmap 或 Engineering 节点/anchor | 目标显示直接工程机制 |
| `selectedPlan` | Design | 直接包含的 Design Plan | 显示唯一裁决 |
| `decides` | Design | Feature、Roadmap 或 Engineering 节点/anchor | 目标显示直接 Design |
| `composes` | 跨 Feature Use Case | 一到多个叶子 Use Case；确无叶子时为 Feature anchor | 各 Feature 反查完整目标 |
| `owner` | E2E test/spec 首行 | Engineering testing owner anchor | 测试定位长期结果 owner |
| `contract` | testing owner anchor | Feature anchor 或叶子 Use Case | 契约反查 owners/tests |
| `regression` | E2E 顶部 metadata block | Memory 文件 | 测试显示历史回归证据 |
| promotion | structured Memory | Roadmap、Feature 或 Engineering anchor | 目标显示 current/history 关系 |

owner anchor 不是 docs-node kind，只是固定投影的 relation endpoint。每个 anchor 紧邻一个版本化 `contract` link，每个 test/spec 恰好指向一个 anchor。
每个 owner anchor 恰好对应一个 test/spec；一个 contract 可以关联零到多个 owners。lane 只从 E2E Repo metadata 读取，不在 owner 文档复制。

编译器只读取 test/spec 文件顶部的连续 metadata block。`test()` 标题、scenario companion、fixture 和正文注释不产生边。

## 查询面

```sh
pnpm docs:trace list [kind] [pattern] [--json]
pnpm docs:trace show <qualified-ref|repo-path> [--history] [--json]
pnpm docs:trace check [--changed] [--json]
```

`list` 只做浅发现。`show` 精确选择一个 Doc node 或 test/spec；歧义非零退出并列出候选。

Feature 投影只走固定闭包。它包含本节点页面、直接子 Feature、本地 Use Cases 与反向 composed Use Cases。
它还包含这些契约的 owner anchors/tests、直接 Roadmap/Design/Engineering、current promotions，以及这些 tests 的 regressions。
它不继续遍历相关对象的其它边。`--history` 另加 promotion history 与 supersession；普通 mentions 不进入默认结果。

测试投影返回 Repo/file、owner anchor、contract、所属 Feature、regressions，以及从 Repo metadata 读取的 lane/areas。
Trace 不读取或返回测试标题、scenario companion 与正文。没有 owner 的 Use Case 显示空数组和“无长期自动化 owner”，仍成功退出。

JSON receipt 使用独立 format/version、canonical path、稳定排序与显式空数组。人读输出只是同一 receipt 的 renderer。

## 创建与模板

```sh
pnpm docs:trace create <feature|roadmap|engineering|design|use-case> <slug> --title <title> [--pages <list>] [--plans <n>] [--cases] [--dry-run] [--json]
```

模板 manifest 声明 format、适用 kind、必备/可选文件与自身 digest。template version 只进入 manifest 与 create receipt，不写入节点生命周期状态。

`create design` 默认创建决策外层与两个自包含 Plan；`--cases` 增加共同 Cases。新 scaffold 未选择 Plan 时会产生预期 strict finding。
`create` 不创建 E2E 正文、fake owner、测试完整度状态或空契约页。

分类 README 的 marker 区是机器生成的人读导航。compiler 永不读取它；`check` 从节点重算 exact bytes 并报告漂移。

## move、adopt 与恢复事务

`move` 只改变同 kind path。`adopt` 把 Roadmap 身份替换为 Feature 身份，不建立稳定 alias 或双真源。

```sh
pnpm docs:trace move <ref> --to <repo-path> [--dry-run] [--json]
pnpm docs:trace adopt prepare <roadmap-ref> --to <feature-ref> [--json]
pnpm docs:trace adopt apply --manifest <git-private-path> [--dry-run] [--json]
pnpm docs:trace recover [--json]
```

自动改写只处理 typed refs、生成区，以及随整个 package 移动且 referent 不变的内部相对链接。
外部普通 Markdown links 只进入 `linkUpdateCandidates`，不自动修改；legacy Memory bytes 永远不变。

目标 Feature 已存在时，`prepare` 生成 Git-private 两阶段 manifest。manifest 绑定 source/target 与每份 preimage digest，并为每个源页面声明 `move`、预渲染 `merge` 或带理由的 `drop`。
遗漏页面、缺少 manifest 或任一 digest 变化时，`apply` 零写入失败；工具不自动合并 Markdown 语义。

结构化 promotion 的旧 current 先连同 pre-move commit 追加到 immutable history，再写新 current。source package、typed ref owners 与 promotion 文件必须通过 scoped-clean preflight；无关工作树改动不阻断。

mutation 使用 repo-wide docs lock、Git-private journal 与 generation。journal 提供可恢复事务，不宣称多文件瞬时原子 rename。
写入前重新核对全部 preimage digest；read/check/lint 在 active mutation 或 recovery 期间等待、重试或具名失败。
读取前后 generation 变化时不得返回混合 Snapshot。每个 journal phase 的 interruption 验收必须只得到完整旧状态或完整新状态。

## Memory 分层

默认强关系只有 `promotions.current` 与 canonical `regression`。promotion history 与 supersession 只在 history 区域显示；普通 mentions 默认隐藏。

结构化 regression 必须指向 Problem。legacy regression 继续显示为 `legacy/unstructured`，不能称为 Problem、Bug 或具有结构化终态，也不能满足 Problem-only gate。
superseded Decision/Insight 不得保留 current promotion。

## 实现 owner

`packages/repo-tools/src/docs/trace/**` 拥有纯 compiler、Schema、findings 与 Snapshot 投影。Effect 层只拥有文件系统、lock、journal、recovery 和 receipt。

`lint/docs/**` 是直接调用 pure checker 的薄 adapter，不启动 CLI 子进程，也不复制 parser。`pnpm memory check` 复用 Snapshot 的 regression/promotion 关系，再追加 Memory 自己的状态门。

## Cases

本方案完整兑现 [T1–T9](../CASES.md)。它用固定投影换取可解释边界，不追求开放图查询。
