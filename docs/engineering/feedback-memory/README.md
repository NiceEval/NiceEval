# Feedback 与 Memory

Feedback 保存从外部或开发现场收到的原始观察，Memory 保存调查过程中形成的问题、根因、思考与裁决。两者都进入 Git，供人和 Agent 通过正式命令读取；命令不依赖第三方问题库。

```text
issue / dogfood / dev
          │
          ▼
       Feedback ── 调查、归因 ──▶ Memory
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  E2E regression       Roadmap / Feature / Engineering
```

Feedback 可以在没有 Memory 时存在。Memory 也可以直接来自开发过程，不必伪造一条 Feedback。Feedback 只保存对 Memory 的正向关系；反向关系由命令扫描得出，避免两个文件分别维护同一事实。

## Feedback

每条 Feedback 是 `feedback/<feedback-id>/README.md`。附件只放在同目录的 `artifacts/`，条目关闭后仍永久保留。

```ts
interface FeedbackV1 {
  format: "niceeval.feedback/v1";
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
  adoptedContract?: { path: string; anchor: string };
  memoryRelations: readonly {
    kind: "investigation" | "root-cause" | "decision" | "delivery";
    memory: string;
  }[];
  duplicateOf?: string;
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

`source`、`subject` 与 `claim` 是互相独立的分类。`dogfood` 可以发现产品缺陷，也可以提出仓库体验问题；`dev` 也可以描述依赖行为。是否进入产品 Bug 门由 `adoptedContract` 与 Problem Memory 共同决定，不再增加一个可随意填写的 `bug` 标签。

### 关闭规则

Feedback 的人读状态只显示“未处理”与“已处理”。关闭原因决定它是否真的修复、交付，或只是停止处理。

| 原因 | 适用条件 | 关闭凭据 |
|---|---|---|
| `fixed` | 已确认的 product / repository defect 或 friction | 指向 `resolved` Problem Memory，并重新执行原观察步骤；带 `adoptedContract` 的产品缺陷还须通过 E2E 门 |
| `delivered` | request 已进入采用后的目标，且交付结果仍适用于原 observation | 指向交付 Decision / Problem Memory、path 与 anchor 均可定位的当前目标和原观察场景验收 |
| `duplicate` | 观察与另一条 Feedback 相同 | 只指向 canonical Feedback；不得自指、形成环或删除原条目 |
| `declined` | 明确决定不采纳 request 或 friction | 指向 adopted Decision Memory；界面不得显示为“已修复” |
| `invalid` | 观察的事实前提无法成立 | 保存可重新执行的反证；界面不得显示为“已修复” |
| `external-fixed` | dependency 行为已由上游版本修复 | 保存依赖名、版本和原观察步骤的再次执行结果 |

`feedback close --via <memory>` 在写入前验证整张表。`memoryRelations` 只接受表中列出的关系，不能自指或重复。被引用的 Problem Memory 后续重新打开时，`pnpm feedback check` 报关闭凭据失效，不静默修改 Feedback。

### 下游导入

下游只生成一个只读导入包，不直接写本仓库：

```ts
interface FeedbackEnvelopeV1 {
  format: "niceeval.feedback-envelope/v1";
  origin: { repository: string; originId: string; commit: string };
  candidate?: { version?: string; commit?: string; sha256?: string };
  source: "issue" | "dogfood" | "dev";
  observation: string;
  impact: string;
  artifacts: readonly { path: string; byteLength: number; sha256: string }[];
  digest: string;
}
```

`feedback import` 以 `origin.repository + origin.originId` 作为幂等键。同一 digest 重复导入返回既有 ID；不同 digest 使用同一幂等键时失败并显示冲突，不替换历史。

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
  kind: "roadmap" | "feature" | "engineering";
  current?: { path: string; anchor: string };
  history: readonly { path: string; anchor: string; commit: string }[];
}
```

Problem 保存可验证的问题、根因与修法；Decision 保存明确采用的取舍；Insight 保存仍成立的 know-how。Decision 与 Insight 的 `supersededBy` 只指向同 kind Memory，不得自指或形成环。Problem 重新打开时保留旧 resolution 作为正文历史，但结构化当前状态不再携带已生效的 resolution。

Memory 可以提升到 Roadmap、Feature 或 Engineering，不能直接成为这些目录的契约 owner。`promotions.current` 的 path 与 anchor 必须能定位当前目标；目标移动或删除时，同一操作先把旧 path、anchor 与 commit 追加进 history，再更新或清空 current。既有 history 项不可改写。

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
4. 通过该 owner 的可靠性与接管检查，再把 E2E 路径和收据写进 Problem resolution。

`pnpm memory check` 从 E2E 测试头反向扫描 `regression: memory/...`，验证引用、owner、路径和 `resolved` Problem 的收据。Memory 不保存另一份 E2E 反向列表。

只有无法固定的外部条件、安全限制或 Provider 才允许例外。例外必须在 resolution 中具名阻塞、公开入口人工验收和复查条件。仓库 DX 问题使用真实仓库命令或 lint 的红绿凭据，不伪造产品 E2E。

## 命令与一致性

正式入口属于同一个 `@niceeval/repo-tools` runtime：

```text
pnpm feedback add|import|export|list|show|link|close|reopen|check
pnpm memory   add|list|show|search|resolve|reopen|supersede|promote|check
```

所有写命令先解码现状与请求，再在条目级锁内完成校验。新条目先写到同一文件系统的临时路径，完成 fsync 后原子 rename；修改单文件时采用同样的临时文件替换。稳定 ID 在取得锁后分配，失败重试不会产生第二个条目。

`check` 聚合报告 Schema、引用、状态、环、promotion、关闭凭据和 E2E 门问题，不遇到第一项就停止。命令失败只留下原始文件或完整新文件，不留下临时条目、半复制附件或部分更新的关系。

## Legacy Frog provenance

`feedback/migration-receipt.json` 把旧 `.agents/friction-log/` 条目一对一映射到 Feedback。收据保存旧目录、Feedback ID、原始时间、severity、完整正文、附件摘要与 provenance；机器检查每个旧 ID 恰好出现一次，并以正文摘要核对迁移后的内容。

相似条目只建立 `duplicateOf` 或共同的 Memory 关系，不物理合并。每条 legacy Feedback 还声明 Memory disposition：连接既有 Memory、创建 Problem / Insight，或明确 `none` 及理由。仓库不安装 Frog，不保留 Frog Skill、配置或入口；Git 历史继续保存旧文件。
