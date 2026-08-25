---
format: niceeval.docs-node/v1
kind: engineering
relations: {}
---

# 仓库文档追溯

`pnpm feature` 与 `pnpm test` 是 Feature、Use Case、E2E owner、Feedback、Memory 与 Issue provenance 的日常查询入口。
可运行能力包括 `feature list/show` 与 `test list/show`；Feedback adoption 与 Memory promotion 由各自领域命令写入。

Roadmap、Design、Engineering 与 Use Case 使用各自同名命令创建、以及 `docs:trace check/move/recover`，仍是后续结构写入面的目标契约。
这些命令从各 owner 的正向关系动态形成同一份 Trace Snapshot，不保存中央 Registry，也不改变 Nx affected graph。

设计取舍见[仓库文档追溯决策](../../design/docs-traceability/DECISION.md)。原生测试正文的边界继续服从[可读测试裁决](../../design/user-readable-testing/DECISION.md)。

## 使用心智

```text
Feature / Use Case contract
       ▲       ▲
       │       ├── adoption ── Feedback ── source ── Issue
       │       └── promotion ─ Memory
       │ contract
engineering/testing owner anchor ◄── owner ── E2E test/spec
                                             └── regression ──► Memory

Roadmap ── buildsOn ──► Feature
Design ── decides ─────► Feature / Roadmap / Engineering
Engineering ── supports ► Feature / Roadmap / Engineering
cross-Feature Use Case ─ composes ─► leaf Use Cases
```

Feature 保存产品语义；testing owner anchor 保存长期测试结果身份；测试文件保存真实动作与 expected；Feedback 保存原始观察与采用关系；Memory 保存调查、裁决和历史证据。
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

Feature ID 是其 package path 去掉 `docs/feature/` 与结尾 `/README.md` 后的值，例如 `record` 或 `reports`。
它由 `pnpm feature list` 输出，并可直接传给 `pnpm feature show`。
节点仍以 repo-relative owner path 为 canonical identity，不另存稳定 ID、title、adoption status 或 template version。

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

### Package 页面与 formatter

页面角色不写进 frontmatter，也不另建 Feature sidecar JSON。它由 Feature package 内的 canonical placement 派生：

| placement | role |
|---|---|
| package root `README.md` | `overview` |
| `library.md` 或 `library/**` | `library` |
| `cli.md` 或 `cli/**` | `cli` |
| `architecture.md` 或 `architecture/**` | `architecture` |
| `lifecycle.md` 或 `lifecycle/**` | `lifecycle` |
| `reference/**` | `reference` |
| 其它不属于节点的 Markdown | `supporting` |

页面扫描在直接子 Feature 与 `use-case/**` 节点边界停止；子 Feature 自己拥有页面，Use Case 仍作为节点显示。
`node.kind` 与 `page.role` 是两条正交信息：例如一个 Use Case 可以放在 `library/` 下，但不会因此变成 Library 页面。
只有 placement 无法稳定表达新的语义角色时，才扩展这张表；renderer 的缩进、分组、图标或颜色永不进入 docs metadata。

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
| adoption | Feedback | Roadmap、Feature、Use Case 或 Engineering exact ref | 一个 Feedback 可采用到多个直接契约；current/history 由命令维护 |
| memory relation | Feedback | Memory | `investigation`、`root-cause`、`decision` 或 `delivery` |
| promotion | structured Memory | Roadmap、Feature、Use Case 或 Engineering exact ref | 每 kind 一个 current/history bucket |
| issue provenance | Feedback `source.kind=issue` 或 E2E `issue:` | repository + issue number + URL，或测试头原值 | 离线 Snapshot 只陈述 provenance，不猜测远端状态 |

普通 Markdown links 和自然语言 mentions 是弱导航，不升级为这些关系。默认 `show` 不展示它们，也不让它们满足任何 check gate。

exact contract ref 可以指向节点 owner，也可以指向该 Roadmap、Feature 或 Engineering package 内的 supporting page anchor。
后者按最长合法 package placement 取得 target kind；Use Case 必须精确命中自己的 docs node，不能靠目录继承制造场景身份。

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
人读测试树的 `Description` 来自 owner 文档：同文件有精确 anchor inventory 行时取其结果摘要，否则取 `Contract:` 后的第一段说明，最后才使用 anchor 的人读形式。它是 formatter 文本，不读取 `test()` 标题，也不产生新的关系 owner。
lane、areas 与 executor 的真相仍在所属 E2E Repo metadata；Trace 只在测试投影中读取并显示它们。

每个 test/spec 恰好一个 owner，每个 owner anchor 恰好被一个 test/spec 引用。一个 contract 可以拥有零到多个 owners；这不形成 coverage cardinality。

编译器只在文件顶部连续 `//` comment block 中识别 canonical `owner:`、`regression:` 与 `issue:`；同一 block 的 `rerun`、`reliability` 等其它注释会被忽略，但不会截断后面的 canonical relation。标题、`.scenarios.ts`、fixture、步骤和正文注释不产生关系。

## Feedback、Memory 与 Issue 分层

默认结果按语义分开这些强关系：

- Feedback `adoptions.current` 直接表示原始观察已经进入查询契约；
- Feedback `memoryRelations` 表示该观察的调查、根因、裁决或交付 Memory；
- structured Memory `promotions.current` 直接表示当前 Problem、Decision 或 Insight 进入查询契约；
- test header 的 canonical `regression` 通过 owner/contract 链表示该测试守住的 Problem；
- Feedback issue source 与 test header `issue:` 分别保存契约 provenance 和测试 provenance，不相互冒充。

人读 `show` 默认把 current 关系放在对应 Use Case 下，把 history 与失效关闭凭据放进独立历史/发现区。普通 mentions 默认隐藏。

结构化 regression 必须指向 Problem。legacy regression 显示为 `legacy/unstructured`，不能称为 Problem、Bug 或具有结构化终态，也不能满足 Problem-only gate。
superseded Decision/Insight 不得保留 current promotion。`pnpm memory check` 复用同一 Snapshot 读取 regression/promotion，再应用 Memory 自己的状态门。

## 查询命令

```sh
pnpm feature list [pattern] [--json]
pnpm feature show <feature-id|repo-path> [--json]
pnpm test list [pattern] [--json]
pnpm test show <test-path> [--json]
pnpm feedback adopt <feedback-id> --to <repo-ref> [--dry-run] [--json]
pnpm feedback retire <feedback-id> --from <repo-ref> [--dry-run] [--json]
pnpm memory promote <memory-id> --to <repo-ref> [--dry-run] [--json]
pnpm memory retire <memory-id> --from <repo-ref> [--dry-run] [--json]
```

### list

两个 `list` 都只做浅发现。`feature list` 输出 Feature ID、标题与 canonical path。
`test list` 的测试叶子直接输出完整 test/spec path 与 Repo。第二行输出 owner-owned `Description`，其余子树展开 Feature/Use Case、Regression Memory 与直接 `issue:` provenance；没有关系时显式显示 `None`。

Feature pattern 匹配 ID、path 或标题；test pattern 还会匹配 owner/contract、Feature、Regression Memory 与 Issue。它们只用于缩小列表，不隐式扩大 Trace 闭包。
列表中的 ID 或 path 必须能原样传给同类 `show`。

人读 formatter 把 Feature 按父子 package、Test 按 E2E Repo 与目录渲染成树；树中的叶子显示可复制的完整测试路径，关系子树不写回测试或文档 metadata。
`--json` 保持 `niceeval.docs-trace/list-v1` 的稳定扁平数组，调用方不必拆解人读树，也不因 formatter 改版迁移。

### feature show

Feature 投影的闭包固定为：

1. 本节点的派生页面清单与直接子 Feature；
2. 本地 Use Cases，以及 `composes` 反推的跨 Feature Use Cases；
3. contract 指向这些目标的 owner anchors，再到对应 tests；
4. 各精确目标的 Feedback adoptions、Feedback→Memory relations、Memory promotions 与 Issue provenance；
5. 直接 `buildsOn` Roadmap、`decides` Design 与 `supports` Engineering；
6. 经第 3 步 tests 到达的 regressions 与 test issue provenance。

查询到此停止，不继续遍历相关节点的其它边。没有 tests 时输出显式空数组，并在人读结果中显示
`No long-term automated owner`；这不是 finding。
人读结果按 Use Case 分组列出页面、测试与具名 provenance；直接指向 Feature、但不属于某个叶子 Use Case 的关系单列为 Feature-level，不能伪装成用例关系。

Feature-level 与每个 Use Case 的测试叶子都显示完整 file path；下一行显示同一个 owner-owned `Description`。所在分组已经表达 exact target，因此人读树不重复输出 owner 与 exact-target 调试字段；JSON receipt 仍保留它们。

每条反向边都保留 `target`、`scope` 与 `via`，因此一个 Feature 不会因为包含某个 Use Case 就被错误显示为“直接采用”。

### test show

测试投影返回 Repo、file、owner anchor、contract、所属 Features、regressions、Issue provenance，以及从 Repo metadata 读取的 lane/areas/executor。
Journey contract 为跨 Feature Use Case 时，Features 从 `composes` 推导。Trace 不读取或返回测试标题、scenario companion 与正文。

这些内容变化后，Snapshot、digest、JSON 与人读 trace 输出都必须保持不变。

### selector 与 receipt

`feature show` 只接受 `feature list` 输出的精确 ID 或 canonical repo path；不做前缀猜测。
`test show` 只接受 `test list` 输出的精确 repo path。缺失 selector 非零退出；任何歧义都按 canonical path 排序列出候选，不得挑选第一个匹配。

所有 JSON 结果包含 `format`、`operation`、`snapshotDigest`、`generation` 与 canonical paths。
数组稳定排序并显式保留 `[]`；人读 renderer 与 JSON 使用同一结构化 receipt。
digest 纳入所有可见的规范化节点、页面、owner、测试 metadata、Feedback metadata 与 Memory metadata；不读取正文的字段就不会偷偷影响 digest。

```json
{
  "format": "niceeval.docs-trace/show-v2",
  "operation": "feature-show",
  "snapshotDigest": "sha256:...",
  "generation": 0,
  "subject": {
    "kind": "feature",
    "id": "reports",
    "path": "docs/feature/reports/README.md",
    "title": "③ Report（报告层）"
  },
  "pages": [],
  "children": [],
  "useCases": [],
  "relationsByTarget": [],
  "tests": [],
  "feedbackAdoptions": [],
  "feedbackMemoryRelations": [],
  "memoryPromotions": [],
  "regressions": [],
  "issueProvenance": [],
  "adoptionHistory": [],
  "findings": [],
  "roadmaps": [],
  "designs": [],
  "engineering": []
}
```

Issue 使用 discriminated union：Feedback provenance 包含 `repository`、`number`、`url` 与 `via: "feedback"`；测试头 provenance 保留原值并带
`via: "test"`。离线查询不访问 GitHub，也不输出 `open` / `closed` 等未验证远端字段。

## 关系写命令

Feedback adoption、Feedback→Memory relation 与 Memory promotion 是现有 owner 的单文件 mutation，不属于 docs-node frontmatter。目标关系命令直接接受 exact RepoRef，
目标 kind 从 Trace Snapshot 验证，不让用户提交整个 current/history bucket：

```sh
pnpm feedback adopt <feedback-id> --to docs/feature/eval/use-case/first-single-turn.md
pnpm feedback retire <feedback-id> --from docs/feature/eval/use-case/first-single-turn.md
pnpm memory promote <memory-id> --to docs/feature/eval/use-case/first-single-turn.md
pnpm memory retire <memory-id> --from docs/feature/eval/use-case/first-single-turn.md
```

`adopt/promote` 要求 current 中尚无 exact ref；`retire` 要求 exact 命中，并把 ref 与当前 Git commit 追加到 immutable history。
`--dry-run` 与实际写入返回同形 receipt，包含 planned bytes digest、preimage digest、target kind 与 generation；历史只能由工具生成。

所有会改变 Trace 可见 Feedback/Memory metadata 的 mutation 都取得 repo-wide exclusive advisory lease，并在发布前写一笔 Git-private journal。journal 只保存当前 publication 的恢复材料，不保存关系反向索引。

命令在 journal durable 前后各完成一次全量输入捕获。两次 generation、Snapshot digest、owner/target/dependency preimage、HEAD、Git index、mode 与 directory manifest 全等后，才用同文件系统临时文件或目录 fsync + atomic rename 发布。generation durable replace 是唯一 commit point。

## 后续创建命令与模板

以下命令定义未来写入面，本次可运行查询切片不接受 `create`：

```sh
pnpm feature create <slug> --title <title> [--pages <list>] [--dry-run] [--json]
pnpm roadmap create <slug> --title <title> [--pages <list>] [--dry-run] [--json]
pnpm engineering create <slug> --title <title> [--pages <list>] [--dry-run] [--json]
pnpm design create <slug> --title <title> [--plans <n>] [--cases] [--dry-run] [--json]
pnpm use-case create <slug> --title <title> --parent <ref> [--dry-run] [--json]
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
pnpm roadmap adopt prepare <roadmap-ref> --to <feature-ref> [--json]
pnpm roadmap adopt apply --manifest <git-private-path> [--dry-run] [--json]
pnpm trace recover [--json]
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

结构 mutation 与关系 mutation 共用一个持久 lock inode、advisory lease、journal 和 generation。支持边界是同一内核、同一本地 flock-compatible 文件系统；NFS、跨主机或 `flock` 命令执行器不可用时 fail closed。

读命令从取得 shared lease到编译结束不修改任何 Trace owner、journal 或 generation；首次读取可以在 Git-private coordination directory 初始化持久 lock inode。发现 journal 时返回 `TraceRecoveryRequired` 并提示 `pnpm trace recover`。显式 recover 与非 dry-run 写命令取得 exclusive lease，先保守恢复旧 journal，再开始新 publication；compiler 在既有 lease 下运行，不重新 open 或升级锁。

file publication 的 journal 以 mode `0600` 保存不超过 32 MiB 的 preimage、planned digest 与 mode。

新 Feedback 统一用 worktree 内 `feedback/.stage-<token>` 的 directory publication。manifest 包含根、全部目录与普通文件的 path/size/digest/mode；walker 在递归前剪枝 stage。任何点开头 Feedback ID 都非法，coordination directory 为 `0700`。

directory rollback 先把 target 原子移回 stage，再把 journal durable 切到 `discarding-stage`；重复恢复只删除原 manifest 的精确剩余子集。额外路径、symlink、特殊文件、identity/generation/HEAD/index/mode/digest 变化都保留 owner、stage 与 journal并返回 recovery conflict。

generation commit point 已完成而首次 journal cleanup 失败时，写命令在同一 exclusive lease 内执行保守恢复。恢复若证明 planned owner、new generation 与 publication manifest 完整并成功清除 journal，原 mutation 返回成功 receipt；只有回滚/丢弃或证据仍不确定时才返回失败，禁止出现“已经提交但报告未提交”的重试歧义。

compiler 连续枚举并读取两次全部 Trace 输入；集合和 bytes 相同后只从第二次内存捕获编译，变化最多重试三次后返回 `TraceInputChanged`。这证明两次完整捕获一致，不宣称线性 Snapshot或识别 ABA。

不使用 Trace lease 的编辑器在最终 precondition 检查之后、atomic rename 之前仍有极窄保存竞态。契约只保证已经观察到的并发编辑会阻止 publication。恢复路径绝不改写与 journal 状态不符的 owner。

不同 Agent 可以并行编辑互斥正文，但所有 create、move、adopt、关系 mutation 和生成区更新必须串行经过 exclusive lease。

## check 与 lint

`check` 聚合全部 finding，不在第一项停止：

- frontmatter Schema、kind/placement、canonical ref 与 target kind；
- path/anchor 存在性、关系 cardinality、重复 ref 与 Roadmap cycle；
- Design 的唯一 direct `selectedPlan`；
- owner anchor 的唯一 contract link、test/owner 一对一与 canonical metadata block；
- Feedback v2 adoption current/history、closure、Memory relation 与 Issue source；
- regression Problem gate（`resolved(fixed)` 必须由真实 E2E metadata 反向拥有，自由文本 proof 不算）、Memory promotion current/history 与 supersession；
- template manifest/digest 与生成区 exact bytes；
- active journal、`base-digest-changed` adoption manifest 与 recovery conflict。

`check --changed` 仍编译并验证全仓，只在 receipt 增加 `changedSubjects` 与 `impactedSubjects`。它不能隐藏未改文件的 finding，也不能形成较弱成功。

`packages/repo-tools/src/docs/trace/**` 是 RepoRef、关系 target validation、pure compiler、Snapshot、投影、presentation、lock/generation 与 findings 的唯一 owner。
Feedback 与 Memory codec/state 仍归各自领域；它们复用 Trace RepoRef/target checker，不复制 path/anchor parser。

`packages/repo-tools/src/cli.ts` 只把 `feature`、`test` 与维护命令接进同一个 `@effect/cli` 根和 Node runtime。
Effect 层拥有文件系统、lock、journal、recovery 与 receipt。

`lint/docs/**` 只是直接调用 pure checker 的薄 adapter，不复制 parser，也不通过子进程调用 CLI。

## 错误语义

输入和一致性错误使用具名类型，并在 JSON 中保留 tag、subject 与 next step。至少区分：

- selector missing / ambiguous；
- schema / placement / target-kind invalid；
- owner or contract cardinality conflict；
- mutation active / lock conflict；
- recovery required / recovery conflict / cleanup failure；
- dirty affected path / preimage changed；
- adoption manifest incomplete / `base-digest-changed`；
- Trace input changed / quiescent snapshot not obtained。

所有读命令离线、只读。`feature` 与 `test` 不是独立 runtime，也不各自保存缓存或 parser。
所有写命令有同形 `--dry-run` receipt；失败不留下部分 docs diff。

## 切换与验收

目标 Schema 一次切换，不保留 doc-node legacy reader：

1. 给真实 package roots、Design Plans 与叶子 Use Cases 补 node frontmatter；普通分组和 category README 保持非节点。
2. 给每个 testing owner anchor 补唯一 contract block；5 个直接 Feature owner 迁移到新 anchor，78 个既有 owner identity 不变。
3. 把 canonical regressions 收拢到 test/spec 顶部 metadata block；自由文本只保留为普通解释，不冒充关系。
4. 给所有定稿 Design 补唯一 `selectedPlan`，并让 Design 写作规则以它为机器真源。
5. 给模板补 manifest，把分类索引切为生成区，再启用 strict `check` 与 lint adapter。
6. 用独立 `niceeval.feedback/v1 → v2` migration 一次转换全部 Feedback；收据逐 ID 保存 v1/v2 metadata digest、正文 digest 与附件 digest，证明正文和附件字节不变，并验证 v1 数量归零。470 条 legacy Memory 必须逐字节不变。

470 条 legacy Memory 不转换、不改写，继续由既有兼容契约读取。

验收至少包括：

- 修改测试标题、scenario 或正文不改变 Trace JSON/digest；
- `pnpm feature list` 输出的每个 ID 都能原样交给 `pnpm feature show`；
- `pnpm test list` 输出的每个 path 都能原样交给 `pnpm test show`；
- 两个 list 的人读输出是树，`--json` 仍是稳定扁平 list-v1；
- overview/library/cli/architecture/lifecycle/reference 页面边界由 placement 正确派生，且不要求页面 metadata；
- Feedback issue source 与 test `issue:` 两条 provenance 边都进入 discriminated union，且不猜测远端状态；
- adoption/promotion 的 add、重复 add、exact retire、重复 retire、dry-run、关闭/重开与 supersede 状态矩阵均通过公开命令；
- Feedback v2 migration receipt 包含全部 ID，正文/附件 digest 不变，regular codec 不再读取 v1；
- contract 可关联零到多个 owners，但 test/owner 必须一对一；
- 无 E2E Use Case 返回空数组且通过 check；
- legacy Memory digest 在 move/adopt 前后不变；
- 外部普通链接只进入候选 receipt；
- 既有 Feature 没有完整 adoption manifest 时，命令具名失败且 Git diff 为空；
- selected Plan 缺失、多个、跨 Design 或不存在时失败；
- 每个 journal phase 中断后只得到完整旧状态、完整新状态或保留 owner+journal 的具名 conflict；
- shared reader 可并行、exclusive writer 互斥；两次输入捕获不一致时不返回 Snapshot；
- journal 前后、owner 后 generation 前、generation 后 journal 前、`discarding-stage` 删除中、`flock` 命令执行器故障与外部编辑冲突均有公开 CLI 故障收据；
- `pnpm typecheck` 与 `pnpm lint` 通过。
