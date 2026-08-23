---
format: niceeval.docs-node/v1
kind: engineering
relations: {}
---

# 仓库文档追溯

`pnpm docs:trace` 是 Feature、Roadmap、Design、Engineering、Use Case、E2E owner 与 Memory 的仓库维护入口。
它从各 owner 的正向关系动态形成 Trace Snapshot，不保存中央 Registry，也不改变 Nx affected graph。

设计取舍见[仓库文档追溯决策](../../design/docs-traceability/DECISION.md)。原生测试正文的边界继续服从[可读测试裁决](../../design/user-readable-testing/DECISION.md)。

## 使用心智

```text
Feature / Use Case contract
          ▲
          │ contract
engineering/testing owner anchor ◄── owner ── E2E test/spec
                                             └── regression ──► Memory

Roadmap ── buildsOn ──► Feature
Design ── decides ─────► Feature / Roadmap / Engineering
Engineering ── supports ► Feature / Roadmap / Engineering
cross-Feature Use Case ─ composes ─► leaf Use Cases
```

Feature 保存产品语义；testing owner anchor 保存长期测试结果身份；测试文件保存真实动作与 expected；Memory 保存历史证据。
Trace 只连接这些既有 owner。它不读取 `test()` 标题，不保存 coverage 状态，也不把 Use Case 变成可执行规格。

## 节点 Schema

节点 owner 文件在 frontmatter 中使用 `niceeval.docs-node/v1`。`kind` 声明“这是哪类节点”，canonical identity 仍是 repo-relative owner path。

```ts
type RepoRef = string; // 仅 repo-relative forward-slash path，可带一个 #anchor

type DocsNodeV1 =
  | { format: "niceeval.docs-node/v1"; kind: "feature"; relations: {} }
  | { format: "niceeval.docs-node/v1"; kind: "roadmap"; relations: { buildsOn?: readonly RepoRef[] } }
  | { format: "niceeval.docs-node/v1"; kind: "engineering"; relations: { supports?: readonly RepoRef[] } }
  | {
      format: "niceeval.docs-node/v1";
      kind: "design";
      relations: { selectedPlan?: RepoRef; decides?: readonly RepoRef[] };
    }
  | { format: "niceeval.docs-node/v1"; kind: "design-plan"; relations: {} }
  | { format: "niceeval.docs-node/v1"; kind: "use-case"; relations: { composes?: readonly RepoRef[] } };
```

数组非空且去重；未知字段直接失败。绝对路径、反斜杠、`.` / `..` traversal、重复 canonical ref、缺失 path/anchor 与非法 target kind 都是 finding。

qualified ref 是 `<kind>:<repo-relative-owner-path>`，例如 `feature:docs/feature/reports/README.md`。
它只是 path identity 的显式输入形式；节点不另存稳定 ID、title、adoption status 或 template version。

### Placement

| kind | 合法位置 | 不是节点的相邻对象 |
|---|---|---|
| `feature` | `docs/feature/**/README.md` 的功能 package root | `docs/feature/README.md`、reference、普通对象契约页 |
| `roadmap` | `docs/roadmap/**/README.md` 的方向 package root | `docs/roadmap/README.md`、普通对象契约页 |
| `engineering` | `docs/engineering/**/README.md` 的工程主题 root | `docs/engineering/README.md`、`_template/` |
| `design` | `docs/design/<name>/README.md` | `docs/design/README.md` 与决策正文页 |
| `design-plan` | `docs/design/<name>/PLAN-N/README.md` | Plan 内的普通契约页 |
| `use-case` | 各 package 的叶子 `.md`，或一个完整目标目录的 README | 只做分组与导航的 `use-case/README.md` |

`use-case-group` 不存在。跨 Feature 目标目录的 README 是完整 `use-case`；只列叶子篇目的普通分组 README 是索引。

Design 的 `selectedPlan` 在定稿时恰好一个，目标只能是该 Design 直接包含的 `design-plan`。
`create design` 产生的 scaffold 可以暂缺该字段，但 strict `check` 与 `pnpm lint` 必须报告 finding；不增加另一个 status 字段。

## 强关系

每种关系只由正向 source 拥有。Snapshot 动态计算反向边，不把 children、tests、regressions 或 promotions 回写到目标节点。

| 关系 | source | 合法 target | 约束 |
|---|---|---|---|
| containment | path placement | 直接子节点或本地 Use Case | 只派生，不写 frontmatter |
| `buildsOn` | Roadmap | Feature 或 Roadmap 节点/anchor | 无自环或 Roadmap cycle |
| `supports` | Engineering | Feature、Roadmap 或 Engineering 节点/anchor | 只表达直接维护机制 |
| `selectedPlan` | Design | 直接包含的 Design Plan | strict 状态下恰好一个 |
| `decides` | Design | Feature、Roadmap 或 Engineering 节点/anchor | 只表达该裁决的直接落点 |
| `composes` | 跨 Feature Use Case | 叶子 Use Case；确无叶子时为 Feature anchor | 至少一个 target |
| `owner` | E2E test/spec 第一行 | testing owner anchor | 文件与 anchor 一对一 |
| `contract` | testing owner anchor | Feature anchor 或叶子 Use Case | 每个 anchor 恰好一个 |
| `regression` | E2E metadata block | Memory 文件 | 零到多条；结构化目标必须为 Problem |
| promotion | structured Memory | Roadmap、Feature 或 Engineering anchor | 复用 current/history Schema |

普通 Markdown links 和自然语言 mentions 是弱导航，不升级为这些关系。默认 `show` 不展示它们，也不让它们满足任何 check gate。

## E2E owner contract link

测试仍用现有两跳 owner。测试文件第一行只指向 Engineering testing anchor：

```ts
// owner: docs/engineering/testing/e2e/report.md#show-json-pipe
// regression: memory/<slug>.md
```

owner heading 后的第一个非空内容是下列两行。marker 只声明格式；target 只在普通 Markdown link 中出现一次。

```md
#### show-json-pipe

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Reports CLI](../../feature/reports/cli.md#niceeval-show-json)
```

owner anchor 不是 docs-node kind，也不复制产品语义。owner 文档可以说明体裁和稳定结果，但不保存测试 path 的反向列表或 lane。
lane、areas 与 executor 的真相仍在所属 E2E Repo metadata；Trace 只在测试投影中读取并显示它们。

每个 test/spec 恰好一个 owner，每个 owner anchor 恰好被一个 test/spec 引用。一个 contract 可以拥有零到多个 owners；这不形成 coverage cardinality。

编译器只读取顶部连续 metadata block 中的 canonical `owner:`、`regression:` 与 `issue:`。标题、`.scenarios.ts`、fixture、步骤和正文注释不产生关系。

## Memory 分层

默认结果把 Memory 分成两种当前强关系：

- structured `promotions.current` 直接指向查询契约；
- test header 的 canonical `regression` 通过 owner/contract 链到达查询契约。

`--history` 才增加 `promotions.history` 与 supersession。普通 mentions 默认隐藏。

结构化 regression 必须指向 Problem。legacy regression 显示为 `legacy/unstructured`，不能称为 Problem、Bug 或具有结构化终态，也不能满足 Problem-only gate。
superseded Decision/Insight 不得保留 current promotion。`pnpm memory check` 复用同一 Snapshot 读取 regression/promotion，再应用 Memory 自己的状态门。

## 查询命令

```sh
pnpm docs:trace list [kind] [pattern] [--json]
pnpm docs:trace show <qualified-ref|repo-path> [--history] [--json]
pnpm docs:trace check [--changed] [--json]
```

### list

`list` 只做浅发现。kind 省略时返回全部节点；pattern 匹配 canonical path 或 H1，仅用于缩小列表，不隐式进入详情。

### show Feature

Feature 投影的闭包固定为：

1. 本节点页面与直接子 Feature；
2. 本地 Use Cases，以及 `composes` 反推的跨 Feature Use Cases；
3. contract 指向这些目标的 owner anchors，再到对应 tests；
4. 直接 `buildsOn` Roadmap、`decides` Design、`supports` Engineering 与 current promotions；
5. 经第 3 步 tests 到达的 regressions。

查询到此停止，不继续遍历相关节点的其它边。没有 tests 时输出显式空数组，并在人读结果中显示“无长期自动化 owner”；这不是 finding。

### show Test

测试投影返回 Repo、file、owner anchor、contract、所属 Feature、regressions，以及从 Repo metadata 读取的 lane/areas。
Journey contract 为跨 Feature Use Case 时，还返回 `composes` 涉及的 Features。Trace 不读取或返回测试标题、scenario companion 与正文。

这些内容变化后，Snapshot、digest、JSON 与人读 trace 输出都必须保持不变。

### selector 与 receipt

`show` 只接受精确 qualified ref 或 repo path。歧义 selector 非零退出，并按 canonical path 排序列出候选；不得挑选第一个匹配。

所有 JSON 结果包含 `format`、`operation`、`snapshotDigest`、`generation` 与 canonical paths。
数组稳定排序并显式保留 `[]`；人读 renderer 与 JSON 使用同一结构化 receipt。

```json
{
  "format": "niceeval.docs-trace/show-v1",
  "operation": "show",
  "snapshotDigest": "sha256:...",
  "generation": 12,
  "subject": { "kind": "feature", "path": "docs/feature/reports/README.md" },
  "useCases": [],
  "owners": [],
  "tests": [],
  "roadmaps": [],
  "designs": [],
  "engineering": [],
  "currentMemory": [],
  "regressions": []
}
```

## 创建命令与模板

```sh
pnpm docs:trace create <feature|roadmap|engineering|design|use-case> <slug> \
  --title <title> [--parent <ref>] [--pages <list>] [--plans <n>] [--cases] \
  [--dry-run] [--json]
```

Feature、Roadmap 与 Design Plan 使用 Feature Design Package；Design 外层使用 Design Decision；Engineering 使用工程主题模板。
模板目录各有 `niceeval.docs-template/v1` manifest，声明适用 kind、必备文件和可选文件。receipt 保存 manifest digest；节点不保存 template version。

默认只创建必备文件。`--pages` 选择 `library`、`cli`、`architecture`、`lifecycle` 或 `use-case`；工具不留下未选择的空页。
`create design` 默认建立决策外层与两个自包含 Plan，`--cases` 增加共同 Cases。`create use-case` 要求合法 parent，或显式选择跨 Feature 目标入口。

命令不创建 E2E 测试、fake owner、测试完整度状态、源码进度状态或空契约页。路径冲突、未知页面、非法 parent 与模板 digest 不一致都在写入前失败。

分类 README 的以下区块是只供人读的生成投影：

```md
<!-- niceeval.docs-index/v1:start -->
...stable generated links...
<!-- niceeval.docs-index/v1:end -->
```

compiler 永不读取该区块。`check` 从节点重算 exact bytes；create/move/adopt 在结构锁内更新它。

## move 与 adopt

```sh
pnpm docs:trace move <ref> --to <repo-path> [--dry-run] [--json]
pnpm docs:trace adopt prepare <roadmap-ref> --to <feature-ref> [--json]
pnpm docs:trace adopt apply --manifest <git-private-path> [--dry-run] [--json]
pnpm docs:trace recover [--json]
```

`move` 只允许 kind 不变；`adopt` 把 Roadmap 身份替换为 Feature 身份。两者不创建稳定 alias，也不留下 Roadmap/Feature 双真源。

自动改写限于 typed refs、生成区，以及随整个 package 移动且 referent 明确不变的内部相对链接。
外部普通 Markdown links 只进入 `linkUpdateCandidates` receipt，不自动修改。legacy Memory 保持逐字节只读。

### 两阶段 adoption manifest

目标 Feature 已存在时，工具不得自动合并 Markdown 语义。`adopt prepare` 在 Git-private 目录生成 `niceeval.docs-adoption-plan/v1` manifest：

- source、target 与 pre-move commit；
- 所有 source/target page 和强引用 owner 的 preimage digest；
- 每个源页面的 `move`、预渲染 `merge` 或带理由 `drop` disposition；
- 预渲染 merge bytes 的独立 digest；
- typed ref、promotion 与生成区的预期变化。

`apply` 要求每个源页面都有 disposition。缺失 manifest、遗漏页面、非法 target 或任一 base digest 变化时，命令零写入失败。

结构化 promotion 的旧 current 先以 pre-move commit 追加到 immutable history，再建立新 current。
source package、所有 typed ref owner、相关 structured Memory 与生成区必须通过 scoped-clean preflight；无关工作树修改不阻断。

## 可恢复事务与一致读取

结构 mutation 共用 repo-wide docs lock，并在 Git-private 目录保存 journal 与 generation。journal 是可恢复事务，不是“多文件原子 rename”。

每次写入前重新核对全部 preimage digest。每个 phase 保存已 durable 的旧/新 bytes 与下一步；中断后 `recover` 只能完成新状态或恢复完整旧状态。
实现必须对每个 journal phase 注入 interruption，证明没有半旧半新终态。

`list`、`show`、`check` 与 lint 在 active mutation/recovery 期间等待、重试或返回具名失败。
编译前后还要核对 generation 与已读取文件 digest；变化时重试或失败，不得返回混合 Snapshot。

不同 Agent 可以并行编辑互斥正文，但所有 create、move、adopt 和生成区更新必须串行经过结构锁。

## check 与 lint

`check` 聚合全部 finding，不在第一项停止：

- frontmatter Schema、kind/placement、canonical ref 与 target kind；
- path/anchor 存在性、关系 cardinality、重复 ref 与 Roadmap cycle；
- Design 的唯一 direct `selectedPlan`；
- owner anchor 的唯一 contract link、test/owner 一对一与 canonical metadata block；
- regression Problem gate、Memory promotion current/history 与 supersession；
- template manifest/digest 与生成区 exact bytes；
- active journal、`base-digest-changed` adoption manifest 与 recovery conflict。

`check --changed` 仍编译并验证全仓，只在 receipt 增加 `changedSubjects` 与 `impactedSubjects`。它不能隐藏未改文件的 finding，也不能形成较弱成功。

`packages/repo-tools/src/docs/trace/**` 是 Schema、pure compiler、Snapshot、投影与 findings 的唯一 owner。Effect 层拥有文件系统、lock、journal、recovery 与 receipt。
`lint/docs/**` 只是直接调用 pure checker 的薄 adapter，不复制 parser，也不通过子进程调用 CLI。

## 错误语义

输入和一致性错误使用具名类型，并在 JSON 中保留 tag、subject 与 next step。至少区分：

- selector missing / ambiguous；
- schema / placement / target-kind invalid；
- owner or contract cardinality conflict；
- mutation active / lock conflict；
- dirty affected path / preimage changed；
- adoption manifest incomplete / `base-digest-changed`；
- recovery conflict / mixed snapshot prevented。

所有读命令离线、只读。所有写命令有同形 `--dry-run` receipt；失败不留下部分 docs diff。

## 切换与验收

目标 Schema 一次切换，不保留 doc-node legacy reader：

1. 给真实 package roots、Design Plans 与叶子 Use Cases 补 node frontmatter；普通分组和 category README 保持非节点。
2. 给每个 testing owner anchor 补唯一 contract block；5 个直接 Feature owner 迁移到新 anchor，78 个既有 owner identity 不变。
3. 把 canonical regressions 收拢到 test/spec 顶部 metadata block；自由文本只保留为普通解释，不冒充关系。
4. 给所有定稿 Design 补唯一 `selectedPlan`，并让 Design 写作规则以它为机器真源。
5. 给模板补 manifest，把分类索引切为生成区，再启用 strict `check` 与 lint adapter。

470 条 legacy Memory 不转换、不改写，继续由既有兼容契约读取。

验收至少包括：

- 修改测试标题、scenario 或正文不改变 Trace JSON/digest；
- contract 可关联零到多个 owners，但 test/owner 必须一对一；
- 无 E2E Use Case 返回空数组且通过 check；
- legacy Memory digest 在 move/adopt 前后不变；
- 外部普通链接只进入候选 receipt；
- 既有 Feature 没有完整 adoption manifest 时，命令具名失败且 Git diff 为空；
- selected Plan 缺失、多个、跨 Design 或不存在时失败；
- 每个 journal phase 中断后只得到完整旧状态或完整新状态；
- 并发读取不返回混合 Snapshot；
- `pnpm typecheck` 与 `pnpm lint` 通过。
