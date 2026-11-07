# 仓库文档追溯

`concord list`、`concord show` 与 `concord test` 是 Feature、Use Case、E2E owner、Feedback、Memory 与 Issue provenance 的日常查询入口。
可运行能力包括 `concord list feature`、`concord show <id>` 与 `concord test list/show`；Issue 与 Memory 的关系由 `concord issue link` 与 `concord memory link` 写入，也可直接编辑。

Roadmap 与 Engineering 的结构写入走 Concord 基础 CLI，参数以各自 `--help` 为准：

- `concord new roadmap|engineering <name>`、`concord list roadmap|engineering`、`concord show <id>`
- `concord roadmap start <id>`（采用 Roadmap）

它们使用 Concord 基础发布 journal，中断后用 `concord recover` 恢复。

Feature 由 `concord new feature <name>` 创建，既有页面直接编辑。
叶子 Use Case 由 `concord new use-case <name> --feature <feature>` 独立发布。
Roadmap 采用只走 `concord roadmap start`。
Trace 的 `concord recover` 从各 owner 正向关系恢复 publication，不保存中央 Registry，也不改变 Nx affected graph。

设计取舍见[仓库文档追溯决策](../../design/docs-traceability/DECISION.md)。原生测试正文的边界继续服从[可读测试裁决](../../design/user-readable-testing/DECISION.md)。

## 使用心智

```text
Feature / Use Case contract
       ▲       ▲
       │       ├── adoption ── Feedback ── source ── Issue
       │       └── promotion ─ Memory
       │ @feature / @use-case
    E2E case ── regression ──► Memory

Roadmap ── buildsOn ──► Feature
Design ── decides ─────► Feature / Roadmap / Engineering
Engineering ── supports ► Feature / Roadmap / Engineering
cross-Feature Use Case ─ composes ─► leaf Use Cases
```

Feature 保存产品语义；测试源码的 `@feature` / `@use-case` 声明保存 case 到契约的关系；测试文件保存真实动作与 expected；Feedback 保存原始观察与采用关系；Memory 保存调查、裁决和历史证据。
Trace 只连接这些既有 owner。E2E 例外地只从 runner inventory 读取 title 末尾的 opaque case token 以见证身份，
不把可读标题当语义；它不保存 coverage 状态，也不把 Use Case 变成可执行规格。

## 节点 Schema

节点 owner 文件在 frontmatter 中使用 `concord.document/v1`。metadata 同时声明类型化的 `id`、标题与首次引入时间，canonical placement 仍由 kind 与 owner 关系决定。

```ts
type RepoRef = string; // 仅 repo-relative forward-slash path，可带一个 #anchor

type ConcordDocumentV1 =
  | { format: "concord.document/v1"; id: Slug; title: string; createdAt: string; kind: "feature"; origin?: RepoRef }
  | { format: "concord.document/v1"; id: Slug; title: string; createdAt: string; kind: "use-case"; feature: RepoRef }
  | { format: "concord.document/v1"; id: Slug; title: string; createdAt: string; kind: "roadmap"; state: "planned" | "adopted"; adoptedAs?: RepoRef }
  | { format: "concord.document/v1"; id: Slug; title: string; createdAt: string; kind: "engineering" }
  | { format: "concord.document/v1"; id: Slug; title: string; createdAt: string; kind: "design"; alternatives: readonly Slug[]; decision?: { selected: Slug; reason: string; at: string; targets: readonly RepoRef[] } };
```

数组非空且去重；未知字段直接失败。`id` 必须是小写 ASCII slug；绝对路径、反斜杠、`.` / `..` traversal、重复 canonical ref、缺失 path/anchor 与非法 target kind 都是 finding。Design Plan 与普通页面是 supporting Markdown，不是 Concord owner。

Feature ID 是其 package path 去掉 `docs/feature/` 与结尾 `/README.md` 后的值，例如 `reports` 或
`reports/cost-projections`。它由 `concord list feature` 输出，并可直接传给 `concord show`。
节点的 `id` 是同 kind 下的稳定全局标识，owner path 仍是精确引用与 placement 的 canonical identity；创建时间取自文件首次进入 Git 的时间。

### Placement

| kind | 合法位置 | 不是节点的相邻对象 |
|---|---|---|
| `feature` | `docs/feature/**/README.md` 的功能 package root | `docs/feature/README.md`、reference、普通对象契约页 |
| `roadmap` | `docs/roadmap/**/README.md` 的方向 package root | `docs/roadmap/README.md`、普通对象契约页 |
| `engineering` | `docs/engineering/**/README.md` 的工程主题 root | `docs/engineering/README.md`、`_template/` |
| `design` | `docs/design/<name>/README.md` | `docs/design/README.md` 与决策正文页 |
| `use-case` | `docs/feature/<feature-id>/use-case/<id>.md` | `use-case/README.md` 与跨 Feature 目标导航页 |
| supporting | `docs/design/<name>/PLAN-N/**` 等普通 Markdown | Design Plan 候选与 package 页面 |

`use-case-group` 不存在。跨 Feature 目标目录的 README 是完整 `use-case`；只列叶子篇目的普通分组 README 是索引。

缺失 `decision` 合法，表示 Design 尚未裁决。字段一旦存在，就表示已经裁决，且 `selected` 必须命中 alternatives；候选 Plan 通过 supporting 页面保留，不再拥有独立节点 metadata。

### Package 页面与 formatter

页面角色不写进 frontmatter，也不另建 Feature sidecar JSON。它由 Feature package 内的 canonical placement 派生：

| placement | role |
|---|---|
| package root `README.md` | `overview` |
| `library.md` 或 `library/**` | `library` |
| `cli.md` 或 `cli/**` | `cli` |
| `architecture.md` 或 `architecture/**` | `architecture` |
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
| `selectedPlan` | Design | 直接包含的 Design Plan | 缺失表示未裁决；存在时恰好一个 |
| `decides` | Design | Feature、Roadmap 或 Engineering 节点/anchor | 只表达该裁决的直接落点 |
| `composes` | 跨 Feature Use Case | 叶子 Use Case；确无叶子时为 Feature anchor | 至少一个 target |
| `feature` / `use-case` | E2E 声明注释 | Feature README 或 leaf Use Case 路径 | 每声明恰好一个；多个 cases 可关联同一契约 |
| `regression` | E2E case 源码关系 current | Memory 文件 | 每 case 零到多条；结构化目标必须为 Problem |
| adoption | Feedback | Roadmap、Feature、Use Case 或 Engineering exact ref | 一个 Feedback 可采用到多个直接契约；current/history 由命令维护 |
| memory relation | Feedback | Memory | `investigation`、`root-cause`、`decision` 或 `delivery` |
| promotion | structured Memory | Roadmap、Feature、Use Case 或 Engineering exact ref | 每 kind 一个 current/history bucket |
| issue provenance | Feedback `source.kind=issue` 或 E2E case 源码关系 | repository + issue number + canonical URL | case relation 必须经只读 direct-provenance 验证；离线 Snapshot 不猜远端状态 |

普通 Markdown links 和自然语言 mentions 是弱导航，不升级为这些关系。默认 `show` 不展示它们，也不让它们满足任何 check gate。

exact contract ref 可以指向节点 owner，也可以指向该 Roadmap、Feature 或 Engineering package 内的 supporting page anchor。
后者按最长合法 package placement 取得 target kind；Use Case 必须精确命中自己的 docs node，不能靠目录继承制造场景身份。

## E2E 与契约关联

真实声明上方的 `@feature` 或 `@use-case` 直接指向仓库中的产品契约。
标记规则服从 [E2E case 关系契约](../testing/architecture/e2e/case-relations.md)。
测试标题描述用户结果；工具从 native path、声明路径和标题派生引用，不要求手写 ID。

可执行 inventory 来自原生 runner；AST 只定位声明和注释。原生结果必须唯一绑定到固定执行副本中的声明。
声明模块的 `@test-file` 明示 native path。lane、areas 与 executor 仍来自 E2E Repo metadata。
testing 文档中的结果说明可以保留为阅读材料，不再承担 current relation 中转或反向登记。

## Feedback、Memory 与 Issue 分层

默认结果按语义分开这些强关系：

- Feedback `adoptions.current` 直接表示原始观察已经进入查询契约；
- Feedback `memoryRelations` 表示该观察的调查、根因、裁决或交付 Memory；
- structured Memory `promotions.current` 直接表示当前 Problem、Decision 或 Insight 进入查询契约；
- E2E case 源码关系的 current `regressions` 通过直接 contract 关系表示该 case 守住的 Problem；
- Feedback issue source 与 E2E case 源码关系的 current `issues` 分别保存契约 provenance 和测试 provenance，不相互冒充。

人读 `show` 默认把 current 关系放在对应 Use Case 下，把 history 与失效关闭凭据放进独立历史/发现区。普通 mentions 默认隐藏。

Regression 必须指向当前 schema 的 Problem Memory。captured、superseded 或 attested 声明不能代替新的 fixed 执行证据。
superseded Decision/Insight 不得保留 current promotion。`concord check` 复用同一 Snapshot 读取 regression/promotion，再应用 Memory 自己的状态门。

## 查询命令

```sh
concord list feature [--json]
concord show <feature-id|repo-path> [--json]
concord test list [--json]
concord test show <reference> [--json]
concord issue link <issue-id> <repo-ref> --role spec [--dry-run] [--json]
concord issue unlink <issue-id> <repo-ref> --role spec [--dry-run] [--json]
concord memory link <memory-id> <repo-ref> [--dry-run] [--json]
```

输出格式、选择器与关系推导以 `concord --skill trace` 和各命令 `--help` 为准。

## 关系写命令

Issue 与 Memory 的关系写在各自文件的 `relations` 中，可以直接编辑，也可以用下列命令写入：

```sh
concord issue link <issue-id> docs/feature/eval/use-case/first-single-turn.md --role spec
concord issue unlink <issue-id> docs/feature/eval/use-case/first-single-turn.md --role spec
concord memory link <memory-id> docs/feature/eval/use-case/first-single-turn.md
```

## 当前 Design 生命周期

Design 的创建与裁决按 `concord --skill document`：用 `concord new design <name>` 创建，定下后把规则写进 Spec 并删除该页。Design 不能替代当前产品或工程契约。

## Feature 结构写入与后续目标

Feature 用下列命令创建，既有页面直接编辑；精确 flags 一律以 `--help` 为准：

```sh
concord new feature <slug> --title <title> [--pages <list>] [--dry-run] [--json]
```

`concord new use-case <name> --feature <feature> --title <title> --body <file|->` 接收完整正文、标题与既有 Feature parent。

Roadmap 与 Engineering 的结构写入由 Concord 基础 CLI 拥有，repo-tools 不提供同名包装。
入口与参数分别见 `concord new --help` 和 `concord roadmap --help`。

Feature、Roadmap 与未来 Design Plan 使用 Feature Design Package；当前 Design 外层和 Plan 由 Design domain 创建。Engineering 使用工程主题模板。
模板目录各有 `concord.templates/v1` manifest，声明适用 kind、必备文件和可选文件。receipt 保存 manifest digest；节点不保存 template version。

Feature create 默认只创建必备文件。`--pages` 选择 `library`、`cli`、`architecture`、`lifecycle` 或 `use-case`；工具不留下未选择的空页。页面正文是自由 Markdown，直接编辑。Use Case create 只接受已有 Feature parent，跨 Feature 的创建仍由后续具名入口拥有。

命令不创建 E2E 测试、fake owner、测试完整度状态、源码进度状态或空契约页。路径冲突、未知页面、非法 parent 与模板 digest 不一致都在写入前失败。

分类 README 的以下区块是只供人读的生成投影：

```md
...stable generated links...
```

compiler 永不读取该区块。未来 Trace check 会从节点重算 exact bytes；结构写入命令在结构锁内更新它。

## Roadmap 采用

Roadmap 采用走 `concord roadmap start`，把 Roadmap 身份替换为 Feature 身份，不留下 Roadmap/Feature 双真源；采用语义与恢复由 Concord 拥有。

## 可恢复事务与一致读取

结构 mutation 与关系 mutation 共用一个持久 lock inode、advisory lease、journal 和 generation。支持边界是同一内核、同一本地 flock-compatible 文件系统；NFS、跨主机或 `flock` 命令执行器不可用时 fail closed。

读命令从取得 shared lease到编译结束不修改任何 Trace owner、journal 或 generation；首次读取可以在 Git-private coordination directory 初始化持久 lock inode。发现 journal 时返回 `TraceRecoveryRequired` 并提示 `concord recover`。显式 recover 与非 dry-run 写命令取得 exclusive lease，先保守恢复旧 journal，再开始新 publication；compiler 在既有 lease 下运行，不重新 open 或升级锁。

file publication 的 journal 以 mode `0600` 保存不超过 32 MiB 的 preimage、planned digest 与 mode。

本地 Issue 统一写入 `docs/issues/<id>.md`，由共享 publication lease 与 journal 发布。普通操作不再创建旧 Feedback owner 目录。

directory rollback 先把 target 原子移回 stage，再把 journal durable 切到 `discarding-stage`；重复恢复只删除原 manifest 的精确剩余子集。额外路径、symlink、特殊文件、identity/generation/HEAD/index/mode/digest 变化都保留 owner、stage 与 journal并返回 recovery conflict。

generation commit point 已完成而首次 journal cleanup 失败时，写命令在同一 exclusive lease 内执行保守恢复。恢复若证明 planned owner、new generation 与 publication manifest 完整并成功清除 journal，原 mutation 返回成功 receipt；只有回滚/丢弃或证据仍不确定时才返回失败，禁止出现“已经提交但报告未提交”的重试歧义。

compiler 连续枚举并读取两次全部 Trace 输入；集合和 bytes 相同后只从第二次内存捕获编译，变化最多重试三次后返回 `TraceInputChanged`。这证明两次完整捕获一致，不宣称线性 Snapshot或识别 ABA。

不使用 Trace lease 的编辑器在最终 precondition 检查之后、atomic rename 之前仍有极窄保存竞态。契约只保证已经观察到的并发编辑会阻止 publication。恢复路径绝不改写与 journal 状态不符的 owner。

不同 Agent 可以并行编辑互斥正文，但当前 recovery、关系 mutation 与未来结构写入都必须串行经过 exclusive lease。

## 未来 Trace check 与当前 lint

未来公开 Trace `check` 会聚合全部 finding，不在第一项停止：

- frontmatter Schema、kind/placement、canonical ref 与 target kind；
- path/anchor 存在性、关系 cardinality、重复 ref 与 Roadmap cycle；
- 已存在 `selectedPlan` 的唯一 direct target；
- case 源码声明的唯一 contract、inventory token、源码 current 与历史归档 history/tombstone；
- Feedback v2 adoption current/history、closure、Memory relation 与 Issue source；
- regression Problem gate（`resolved(fixed)` 必须由真实 E2E metadata 反向拥有，自由文本 proof 不算）、Memory promotion current/history 与 supersession；
- template manifest/digest 与生成区 exact bytes；
- active journal、`base-digest-changed` adoption manifest 与 recovery conflict。

未来 `check --changed` 仍会编译并验证全仓，只在 receipt 增加 `changedSubjects` 与 `impactedSubjects`。它不能隐藏未改文件的 finding，也不能形成较弱成功。

RepoRef、关系 target validation、pure compiler、Snapshot、投影、presentation、lock/generation 与 findings 由 vendored `concord-sdlc` 的 Trace 拥有。
`packages/repo-tools` 只组合这些 contribution，不另行实现。
Feedback 与 Memory codec/state 仍归各自领域；它们复用 Trace RepoRef/target checker，不复制 path/anchor parser。

`packages/repo-tools/src/cli.ts` 只把 `feature`、`test` 与维护命令接进同一个 `effect/unstable/cli` 根和 Node runtime。
Effect 层拥有文件系统、lock、journal、recovery 与 receipt。


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

所有读命令离线、只读。Feature 与 Test domain 不是独立 runtime，也不各自保存缓存或 parser。每个写 domain 自己定义 `--dry-run` 或 `check` receipt；失败不留下部分 docs diff。

迁移保真、旧分支合并与复杂图示的写作方式见 [Concord 迁移与图示实践](architecture.md)。

## 切换与验收

目标 Schema 一次切换，不保留 doc-node legacy reader：

1. 给真实 package roots、Design Plans 与叶子 Use Cases 补 node frontmatter；普通分组和 category README 保持非节点。
2. 经明确授权的一次性整理，把 runner-collected cases 的身份与关系落到真实声明注释，保留全部历史和退役 ID；不存在产品 migration 命令，regular codec 不读旧关系 JSON 或 legacy 文件 metadata。
3. 让每个已裁决 Design 有唯一 `selectedPlan`，并让 Design 写作规则以它为机器真源；未裁决 Design 合法地缺失该字段。
4. 给模板补 manifest，把分类索引切为生成区，再启用 strict `check` 与 lint adapter。
5. Research、Memory 和 Issue 通过一次性迁移切换到 concord.document/v1；收据逐条保存原路径、目标路径、metadata 与正文摘要。旧 Feedback owner 移除，当前关系和历史保留。

551 条 Memory 全部转换到最新模型；没有常规旧格式 reader。明确历史事实保留，未知状态不伪造为当前裁决。

验收至少包括：

- 修改可读标题、scenario 或正文不改变关系；删除/复制 case token、改变 collection 或 case path 会被 inventory/path guard 检出；
- `concord list feature` 输出的每个 ID 都能原样交给 `concord show`；
- overview/library/cli/architecture/lifecycle/reference 页面边界由 placement 正确派生，且不要求页面 metadata；
- Feedback issue source 与 E2E case 源码关系 `issues` 两条 provenance 边都进入 discriminated union，且不猜测远端状态；
- Feedback v2 migration receipt 包含全部 ID，正文/附件 digest 不变，regular codec 不再读取 v1；
- contract 可关联零到多个 owners，owner 可由零到多个 cases 复用，但每 live case/owner 必须一对一；
- 无 E2E Use Case 返回空数组且通过相应的 current 或未来 owner 检查；
- 迁移 Memory 作者正文摘要保持，metadata 变换有逐条审计；
- 外部普通链接只进入候选 receipt；
- 既有 Feature 没有完整 adoption manifest 时，命令具名失败且 Git diff 为空；
- selected Plan 存在多个、跨 Design 或不存在时失败；缺失表示未裁决；
- 每个 journal phase 中断后只得到完整旧状态、完整新状态或保留 owner+journal 的具名 conflict；
- shared reader 可并行、exclusive writer 互斥；两次输入捕获不一致时不返回 Snapshot；
- journal 前后、owner 后 generation 前、generation 后 journal 前、`discarding-stage` 删除中、`flock` 命令执行器故障与外部编辑冲突均有公开 CLI 故障收据；
- `pnpm typecheck` 与 `pnpm lint` 通过。
