# Feedback 与 Memory

Feedback 保存从外部或开发现场收到的原始观察，Memory 保存调查过程中形成的问题、根因、思考与裁决。两者都进入 Git，供人和 Agent 通过正式命令读取；命令不依赖第三方问题库。

```text
issue / dogfood / dev
          │
          ▼
       Feedback ── 调查、归因 ──▶ Memory
          │                           │
          └── adoption ──▶ contract ◀┘ promotion
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  E2E regression       Roadmap / Feature / Use Case / Engineering
```

Feedback 可以在没有 Memory 时存在。Memory 也可以直接来自开发过程，不必伪造一条 Feedback。Feedback 只保存对 Memory 的正向关系；反向关系由命令扫描得出，避免两个文件分别维护同一事实。

## Feedback

每条 Feedback 是 `feedback/<feedback-id>/README.md`。附件只放在同目录的 `artifacts/`，条目关闭后仍永久保留。

```ts
type RepoRef = string; // canonical repo-relative path，可带一个 #anchor

interface FeedbackV2 {
  format: "niceeval.feedback/v2";
  id: string;
  title: string;
  state: "open" | "closed";
  reportedAt: string;
  source:
    | { kind: "issue"; repository: string; number: number; url: string }
    | { kind: "dogfood"; repository: string; originId: string; commit: string }
    | { kind: "dev"; repository: string; commit?: string };
  subject: "product" | "repository" | "dependency";
  claim: "defect" | "friction" | "request";
  observation: string;
  impact: string;
  adoptions: {
    current: readonly RepoRef[];
    history: readonly { target: RepoRef; commit: string }[];
  };
  memoryRelations: readonly {
    kind: "investigation" | "root-cause" | "decision" | "delivery";
    memory: string;
  }[];
  closure?: FeedbackClosure;
}

type FeedbackClosure =
  | { kind: "fixed"; memory: string; proof: readonly string[] }
  | { kind: "delivered"; memory: string; target: string; proof: readonly string[] }
  | { kind: "duplicate"; canonical: string }
  | { kind: "declined"; memory: string }
  | { kind: "invalid"; evidence: readonly string[] }
  | { kind: "external-fixed"; dependency: string; version: string; proof: readonly string[] };
```

`source`、`subject` 与 `claim` 是互相独立的分类。`dogfood` 可以发现产品缺陷，也可以提出仓库体验问题；`dev` 也可以描述依赖行为。是否进入产品 Bug 门由 `adoptions.current/history` 与 Problem Memory 共同决定，不再增加一个可随意填写的 `bug` 标签。
一个 Feedback 可以采用到多个 Roadmap、Feature、Use Case 或 Engineering exact ref；Feedback 不保存目标的反向列表。

### 关闭规则

Feedback 的人读状态只显示“未处理”与“已处理”。关闭原因决定它是否真的修复、交付，或只是停止处理。

| 原因 | 适用条件 | 关闭凭据 |
|---|---|---|
| `fixed` | 已确认的 product / repository defect 或 friction | 指向 `resolved(fixed)` Problem Memory，且仓库中真实 E2E owner 的顶部 metadata 必须以 canonical `regression: memory/...` 指回该 Memory；`proof` 只补充红绿收据，不能代替这条关系 |
| `delivered` | request 已进入采用后的目标，且交付结果仍适用于原 observation | 指向交付 Decision / Problem Memory、path 与 anchor 均可定位的当前目标和原观察场景验收 |
| `duplicate` | 观察与另一条 Feedback 相同 | 只指向 canonical Feedback；不得自指、形成环或删除原条目 |
| `declined` | 明确决定不采纳 request 或 friction | 指向 adopted Decision Memory；界面不得显示为“已修复” |
| `invalid` | 观察的事实前提无法成立 | 保存可重新执行的反证；界面不得显示为“已修复” |
| `external-fixed` | dependency 行为已由上游版本修复 | 保存依赖名、版本和原观察步骤的再次执行结果 |

`feedback close --closure <json>` 在写入前验证整张表。`memoryRelations` 只接受表中列出的关系，不能重复。
`duplicate` 的 canonical 只存在 closure 中，不再另存 `duplicateOf`。被引用的 Problem Memory 后续重新打开时，
`pnpm feedback check` 报关闭凭据失效，不静默修改 Feedback，也不隐藏既有 adoption/promotion。

adoption 状态满足以下不变量：

- current exact ref 唯一；retire 必须 exact 命中；
- closed Feedback 不得新增 current；要继续采纳必须先 reopen；
- history 只追加，当前 Git commit 由工具写入；
- `declined`、`invalid` 与 `duplicate` closure 要求 current 为空；
- `delivered` 要求目标出现在 current 或 history；
- reopen 只移除 closure，绝不从 history 恢复 current。

`feedback close` 不会暗中移除 adoption。若 `declined`、`invalid` 或 `duplicate` 仍有 current，命令具名失败并要求先逐条 retire；
`delivered.target` 必须 exact 命中 current 或 history。close/reopen 与 adopt/retire 共用 Trace 锁，状态检查不会和关系 mutation 竞态。

### 下游导入

下游只生成一个只读导入包，不直接写本仓库：

```ts
interface FeedbackEnvelopeV1 {
  format: "niceeval.feedback-envelope/v1";
  origin: { repository: string; originId: string; commit: string };
  candidate?: { version?: string; commit?: string; sha256?: string };
  source: "dogfood";
  observation: string;
  impact: string;
  artifacts: readonly { path: string; byteLength: number; sha256: string }[];
  digest: string;
}
```

`feedback import` 以 `origin.repository + origin.originId` 作为幂等键。同一 digest 重复导入返回既有 ID；不同 digest 使用同一幂等键时失败并显示冲突，不替换历史。
Envelope 只承载下游 dogfood；Issue 与本仓库开发观察由 `feedback add` 写入各自的 `source`，导入器不会把 `source.kind` 静默改写成 dogfood。

导入只接受 manifest 中声明的普通文件。绝对路径、`..`、symlink、超出大小上限、摘要不匹配或未登记文件都在写入前失败。导入器只复制字节，不执行、不按语法读取，也不渲染附件中的主动内容。

## Memory

Memory 继续使用 `memory/<slug>.md`。新条目在 frontmatter 中声明结构化版本；现有无 frontmatter 条目是只读历史，仍可被 `list`、`show`、`search` 与 `check` 读取，也继续满足既有 E2E 的 `regression: memory/<file>.md` 引用。`resolve`、`reopen`、`supersede` 与 `promote` 只修改结构化条目；旧条目要改变状态时先显式转换并保留原始正文。

```ts
interface MemoryV1 {
  format: "niceeval.memory/v1";
  id: string;
  title: string;
  createdAt: string;
  kind:
    | { type: "problem"; state: "open" | "resolved"; resolution?: ProblemResolution }
    | { type: "decision"; state: "adopted" | "superseded"; supersededBy?: string }
    | { type: "insight"; state: "current" | "superseded"; supersededBy?: string };
  promotions: readonly Promotion[];
}

interface ProblemResolution {
  kind: "fixed" | "not-a-bug" | "wont-fix" | "external-fixed";
  proof: readonly string[];
}

interface Promotion {
  kind: "roadmap" | "feature" | "use-case" | "engineering";
  current: readonly RepoRef[];
  history: readonly { target: RepoRef; commit: string }[];
}
```

Problem 保存可验证的问题、根因与修法；Decision 保存明确采用的取舍；Insight 保存仍成立的 know-how。Decision 与 Insight 的 `supersededBy` 只指向同 kind Memory，不得自指或形成环。Problem 重新打开时，工具把旧 resolution 和当前 Git commit 追加到正文的 `Resolution history`，结构化当前状态不再携带已生效的 resolution。

Memory 可以提升到 Roadmap、Feature、Use Case 或 Engineering，不能直接成为这些目录的契约 owner。
每个 kind 最多一个 promotion bucket；current exact ref 去重，retire 必须 exact 命中；目标移动或删除时，同一操作先把旧 target 与 commit 追加进 history，再更新或清空 current。既有 history 项不可改写。

`memory supersede` 在同一次单文件 mutation 中把 Decision/Insight 的全部 current 以当前 Git commit 追加到对应 history，再清空 current。
Problem reopen 不删除 relation，只会让依赖 `resolved(fixed)` 的 Feedback closure 变成 finding。

结构化 Memory 由 `pnpm memory list` 动态发现。`memory/INDEX.md` 为结构化条目提供一个稳定的命令入口，不逐条双写索引；旧条目继续由现有逐条索引发现。这样创建 Memory 只原子写一个文件，不会留下“正文成功、索引失败”的半状态。

## E2E regression

E2E owner 只引用 Problem Memory，并沿用测试头的既有格式：

```ts
// regression: memory/<slug>.md
```

`problem.open → problem.resolved(fixed)` 必须经过以下门：

1. 从安装后的 Library、CLI、HTTP、浏览器或真实 adapter 取得旧候选或最小逆补丁的红灯收据。
2. 加强拥有同一长期用户结果的既有 E2E owner；没有合格 owner 时才新增最小 owner。
3. 证明失败出现在最早公开边界，修复后同一 candidate、fixture 与原生 runner 转绿。
4. 通过该 owner 的可靠性与接管检查；测试文件中的 canonical `regression:` 是门的机器凭据，Problem resolution 的 `proof` 只保存红绿收据与解释。

`pnpm memory resolve --kind fixed` 与 `feedback close --kind fixed` 都从同一 Trace Snapshot 反查真实 E2E owner；没有 canonical regression 时零写入失败。`pnpm memory check` 也反向扫描并报告既存的无 owner `resolved(fixed)` Problem。Memory 不保存另一份 E2E 反向列表，`proof` 中出现 “e2e” 或路径文本都不算通过。

无法固定的外部条件、安全限制或 Provider 可以暂停自动化，但在专门的结构化例外凭据落地前不能冒充 `fixed`；保持 Problem open，并在 `proof`/正文保存公开入口人工验收和复查条件。dependency 已由上游修复时使用 `external-fixed`。仓库 DX 问题仍使用真实仓库命令或 lint 的红绿凭据，不伪造产品 E2E。

## 命令与一致性

正式入口属于同一个 `@niceeval/repo-tools` runtime：

```text
pnpm feedback add|import|export|list|show|link|adopt|retire|close|reopen|check
pnpm memory   add|list|show|search|resolve|reopen|supersede|promote|retire|check
pnpm trace    recover
```

普通读取与 dry-run 持有 Trace shared lease，且不执行恢复。首次读取可以初始化 Git-private 的持久 lock inode，但不修改 owner、journal 或 generation。

所有条目写命令持有 exclusive lease，先恢复旧 journal，再完成两次 Snapshot/preimage 校验与单 owner publication。所有新 Feedback 无论有无附件，都先写 `feedback/.stage-<token>`，再以整个目录的 manifest、journal 与同文件系统 atomic rename 发布。

既有 Feedback 与 Memory 使用 file publication，Memory add 使用 absent-preimage file publication。generation durable replace 是唯一 commit point。

崩溃恢复只有在 worktree identity、HEAD、Git index、mode、digest 与 manifest 全部匹配时才回滚。其它状态保留 owner、stage 与 journal，并具名失败。

所有会改变 Trace 可见 Feedback/Memory metadata 的发布步骤都经过同一结构锁，并在成功后递增 generation。
`feedback add` 只接受空 adoptions。输入携带的 `memoryRelations` 必须去重、逐项命中真实 Memory，并把这些 owner 纳入 publication preimage。
`memory add` 只接受空 promotions。新条目只能从 `problem/open`、`decision/adopted` 或 `insight/current` 初态创建；terminal state 必须走具名 transition，不能借创建入口绕过 fixed E2E 门、supersession 或 history。

`check` 聚合报告 Schema、引用、状态、环、promotion、关闭凭据、E2E 门、unknown stage 与 recovery 问题，不遇到第一项就停止。正常命令失败只留下原始文件或完整新文件；进程崩溃后的 journal/stage 是显式恢复证据，不冒充已发布 Feedback。

`adopt`、`retire`、`promote`、Memory `retire`、Feedback `close/reopen` 与 Memory `supersede` 均提供 `--dry-run` 和结构化 receipt。
调用方只传 exact ref，不传完整 current/history bucket，也不手填 history commit。

## Feedback v2 migration

`niceeval.feedback/v2` 一次切换，不在 regular codec 保留 v1 reader。迁移器是独立、可重复校验的受控入口；它逐条解码 v1，
把 `adoptedContract` 转成 `adoptions.current`，把 `duplicateOf` 收敛到 duplicate closure，并保持 observation、impact、正文和附件字节不变。

`feedback/schema-v2-migration-receipt.json` 逐 ID 保存 v1/v2 metadata digest、正文 digest 与附件 path/size/digest，顶层写明迁移前的 `sourceCommit` 与迁移前后数量。
验收从该 commit 重新读取并迁移全部 35 条历史 v1，逐条复算两个 metadata digest，且要求当前 v1=0；本轮新增的 2 条 Feedback 直接以 v2 创建，不伪装成历史迁移输入。470 条 legacy Memory 以迁移前后 digest 证明逐字节不变。

v2 metadata digest 是迁移时刻的历史审计值；后续合法 mutation 不会反过来改写收据，也不会因当前 metadata 已变化而失败。
长期 `feedback check` 仍核对 ID 完整性、当前 v2 Schema/状态，以及不可改写正文与附件的 digest。

## Legacy Frog provenance

`feedback/migration-receipt.json` 把旧 `.agents/friction-log/` 条目一对一映射到 Feedback。收据保存旧目录、Feedback ID、原始时间、severity、完整正文、附件摘要与 provenance；机器检查每个旧 ID 恰好出现一次，并以正文摘要核对迁移后的内容。

相似条目只建立 duplicate closure 或共同的 Memory 关系，不物理合并。每条 legacy Feedback 还声明 Memory disposition：连接既有 Memory、创建 Problem / Insight，或明确 `none` 及理由。仓库不安装 Frog，不保留 Frog Skill、配置或入口；Git 历史继续保存旧文件。
