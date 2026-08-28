# E2E case 关系、证据与生命周期

本篇是 E2E case 身份、Trace 关系、正式证据和迁移的唯一契约。测试正文仍由
[E2E 测试正文](authoring.md)约束；候选注入与执行仍由[本地与 CI](execution.md)约束。

## Case 是关系 subject

关系 subject 是 Vitest 或 Playwright 实际 collection 后交给 runner 的 case，不是源码文件、AST 节点、
`describe`、fixture 或参数化模板。每个 live case 有一个全仓唯一且永久不复用的 opaque ID：

```text
necase_7J4M2N6Q8R3T5V9X
```

ID 匹配 `^necase_[0-9A-HJKMNP-TV-Z]{16}$`（80 bit CSPRNG Crockford 大写字母数字，排除易混字符）。
全仓 current、history 与 tombstone 中任一重号都失败。ID 不编码 Repo、路径、框架、标题、contract 或创建时间，
case move/rename 后保持不变，retire 后永不回收。

ID 必须作为 runner-visible title 的最后一个 token：

```ts
test("query run 经 pipe 交付完整文档 [necase_7J4M2N6Q8R3T5V9X]", async () => {})
```

canonical token 是 ` [<caseId>]`；每个 collected title 恰好出现一次且位于末尾。title token 是 runner 见证身份的载体，
不是 relation owner。参数化 case 的每个展开实例必须有不同的稳定字面 ID；否则不得登记为 relation-bearing case。

canonical selector 是 `<repo-relative-path>#<caseId>`。caseId 是身份，path 是旧路径防护：工具按 ID 定位
current entry 后要求 selector path 完全相等；不自动跟随旧路径，不用 title 消歧。`CasePathStale` 返回 current selector。

## Inventory adapter 边界

Trace 禁止扫描 TypeScript AST、正则猜测 `test()`、导入测试模块自行求值，或从 source map/snapshot 推导 case。
每个 executor 提供薄 inventory adapter，调用原生 runner collection 并输出：

```ts
interface CollectedCaseV1 {
  executor: "vitest" | "playwright";
  repo: string;
  path: string;
  project?: string;
  titlePath: readonly string[];
  caseId: `necase_${string}`;
}
```

- Vitest adapter 使用正式 collection/list 接口。若当前版本没有独立 list API，可启动 runner collection mode 并在
  body 执行前由 reporter 停止；任何 test body/hook 已执行都使 receipt 失败。
- Playwright adapter 使用 `--list` 对应的 programmatic/reporting collection，不得启动 browser、webServer、global
  setup、project dependency 或 test body。只能执行框架 collection 必需且无产品副作用的 config evaluation。
- adapter 只见证 caseId/title/path，不读写 sidecar、不验证业务关系、不执行 expected，也不是第二套 runner。

inventory receipt 为 `niceeval.e2e-case-inventory/v1`。它包含 executor/version、repo、argv、checkout、files、cases、
`bodyExecutions: 0`、`forbiddenSetupExecutions: 0`、exit/signal 与 digest。非零计数、重复/非法 token 或 collection
失败都 fail closed；缓存 inventory 不得用于 mutation preflight。

## Git-tracked sidecar owner

每个 test/spec 文件旁只有一个 Git-tracked `<test-file>.cases.json`。它拥有该文件 case 的
current/history/tombstone；测试源码只携带 title token。一个 case 在全仓恰好由一个 sidecar current entry 拥有。

```json
{
  "format": "niceeval.e2e-case-relations/v1",
  "testFile": "e2e/report/test/query.test.ts",
  "current": {
    "necase_7J4M2N6Q8R3T5V9X": {
      "owner": "docs/engineering/testing/e2e/report.md#inspection-query",
      "regressions": ["memory/query-run-pipe-truncated-at-128k.md"],
      "issues": [{
        "repository": "github.com/niceeval/niceeval",
        "number": 123,
        "url": "https://github.com/niceeval/niceeval/issues/123",
        "nodeId": "I_kw...",
        "titleDigest": "sha256:...",
        "checkedAt": "2026-08-28T00:00:00Z",
        "provenance": "direct"
      }]
    }
  },
  "history": [{
    "caseId": "necase_7J4M2N6Q8R3T5V9X",
    "atCommit": "0123456789abcdef0123456789abcdef01234567",
    "transactionId": "netxn_...",
    "action": "owner-set",
    "from": {"owner": "docs/engineering/testing/e2e/report.md#old"},
    "to": {"owner": "docs/engineering/testing/e2e/report.md#inspection-query"}
  }],
  "tombstones": []
}
```

`testFile`、owner、Memory path 与 Issue URL 都 canonical；key/array 稳定排序，未知字段失败。current entry 恰好
一个 owner、零到多个不重复 Problem Memory、零到多个不重复 Issue。一个 testing owner contract 可由零到多个 cases
复用；每个 owner anchor 恰好指向一个 Feature 或 leaf Use Case。Feature/Use Case 只沿
`case → owner → contract` 推导，禁止从 Repo、目录、文件名或标题猜测。

history 只追加，保存具名 action、old/new relation、Git commit 与 transaction ID。tombstone 保存 retired caseId、
最后 selector、最后 relation snapshot、retiredAtCommit、transactionId 与 reason。retired ID 仍参与全仓唯一性。

## CLI 与具名生命周期

```text
pnpm run repo docs test
├── list [pattern] [--json] [--history]
├── show <path#caseId> [--json] [--history]
├── inventory [--repo <id>] [--json]
├── owner create <path#caseId> --contract <ref> --description <text> [--json]
│   ├── set <owner-ref> --contract <ref> [--json]
│   └── retire <owner-ref> --reason <text> [--json]
├── case attach <path#caseId> --owner <owner-ref> [--json]
│   ├── move <old-path#caseId> --to <new-path> [--json]
│   └── retire <path#caseId> --reason <text> [--json]
├── regression add <path#caseId> --memory <ref> --red <receipt> --green <receipt> [--json]
│   └── retire <path#caseId> --memory <ref> --reason <text> [--json]
├── issue add <path#caseId> --url <canonical-url> --provenance direct [--json]
│   └── retire <path#caseId> --url <canonical-url> --reason <text> [--json]
└── migrate plan [<test-path>] [--json]
    └── apply --manifest <git-private-path> [--json]
```

这些是生命周期，不是 CRUD。`owner create` 建 owner anchor 与唯一 contract；`owner set` 改 contract 并留 history；
`owner retire` 要求没有 live case。`case attach` 只接受 inventory 已见证且尚无 current 的 case；`case move` 同事务
移动源码/sidecar ownership 并保持 ID；`case retire` 要求 inventory 已不再包含它，或同事务包含删除计划。relation
retire 只移出 current 并追加 history。无 physical delete、任意 patch、bulk replace 或 history rewrite。

`list` 叶子是 selector；默认只列 current，`--history` 另列 history/tombstone。pattern 可匹配 selector、title、
owner/contract、Feature/Use Case、Memory 和 Issue；输出 selector 均可原样传给 `show`。`show` 重新 collection 并验证
path guard，返回 runner title、executor、owner、contract、精确 Feature/Use Case、relations、正式 certificate 与 findings。

JSON 成功 receipt 共享下列字段：

- `format`、`operation`、`transactionId`、`snapshotDigest`、`inventoryDigest`；
- `generationBefore/After`、`subject`、`preimages` 与 `plannedDigests`；
- `historyAppends`、`findings: []` 与 `committed`。

失败至少区分 InvalidCaseToken、CaseNotCollected、CasePathStale、DuplicateCaseId 与 OwnerCardinality。
还要区分 ContractTargetInvalid、RelationAlreadyCurrent、RelationNotCurrent、EvidenceMismatch 和 IssueVerificationFailed。
事务错误分为 PreimageChanged、RecoveryRequired 与 RecoveryConflict。

## 正式 evidence 与 takeover certificate

只有根 runner 正式 receipt 可成为 red、green 或 reliability evidence；`e2e diagnose` 永不合格。

```ts
interface FormalCaseReceiptV1 {
  format: "niceeval.e2e-case-receipt/v1";
  mode: "formal";
  observation: "red" | "green" | "reliability";
  selector: string; caseId: string;
  inventoryDigest: string;
  candidate: { gitSha: string; sha256: string; sri: string };
  source: { checkout: string; testFileSha256: string; sidecarSha256: string };
  runner: { executor: "vitest" | "playwright"; version: string; argv: readonly string[] };
  result: { disposition: "regression" | "pass"; stage: string; exitCode: number | null; signal: string | null };
  cleanup: { ok: boolean; resources: readonly object[] };
  invocationId: string; receiptSha256: string;
}

interface TakeoverCertificateV1 {
  format: "niceeval.e2e-takeover-certificate/v1";
  selector: string; caseId: string; candidateSha256: string; greenReceipt: string;
  observations: {
    isolatedCopies: readonly [string, string, string];
    sameCopy: readonly [string, string];
    defaultParallel: string; singleCase: string; cleanup: readonly string[];
  };
  certificateSha256: string;
}
```

red 是同一 caseId 在旧 candidate 或最小逆补丁上的 formal regression；green 是修复 candidate 的同一 caseId
formal pass。certificate 全部 observation 绑定同一 candidate、case/sidecar、fixture/seed/lockfile/image 策略，
cleanup 全 true、invocation ID 唯一且没有 test retry。path 不匹配、diagnostic mode、缺项或 digest 分叉均失败。

`regression add` 验证 open Problem 与 red/green 配对；它不代替 certificate。`memory resolve --kind fixed` 必须从
current sidecar 找到指向该 Problem 的 live case，并验证该 case 的 red+green+certificate。自由文本 proof、retired case、
旧文件 metadata 或 diagnose receipt 均不满足。Problem reopen 不删历史，但使 fixed gate 失效。

## Issue verification

`issue add` 是本地 relation mutation；只读访问 GitHub，不执行远端 mutation，也不继承远端授权。preflight 必须：

1. 从当前仓库 identity 求 canonical `<host>/<owner>/<repo>`，不接受调用方另填 repository；
2. URL 必须 canonical `https://<host>/<owner>/<repo>/issues/<positive-number>`，拒绝 query/fragment/短链/跨仓；
3. API 验证存在、repository 相同且对象没有 `pull_request` 字段；
4. 验证 direct provenance：Issue 的公开 observation/reproduction 直接产生或要求 exact case，普通链接、同 Feature 或
   间接讨论不够；保存 immutable node ID、URL、title digest 与 checkedAt；
5. publication 前用 ETag/node ID CAS 复查。删除、转移、变 PR 或无法完整读取时零写入。

offline `list/show` 只陈述已验证 provenance，不猜 open/closed。刷新是独立 read-only verify，不自动改 relation。

## 多文件 transaction、commit 与 recovery

case relation mutation可能同时改 title token、sidecar、owner 文档和 certificate index。它们与 Trace 共用 repo-wide
exclusive lease、Git-private `0700` coordination root、`0600` journal 和 durable generation。

命令先做完整 inventory+Snapshot，再把所有 preimage（absent 也算）、planned bytes/mode、HEAD、Git index、worktree
identity、manifest 与 Issue CAS 写 journal 并 fsync。所有 files 同文件系统 stage+fsync，再逐个 atomic rename+parent fsync。
只有全部 planned bytes 可复算且 generation durable replace 成功才 committed；history 共享 transactionId/commit。

阶段为 `prepared → publishing → generation-committed → cleanup`。读命令见 journal 返回 RecoveryRequired。
显式 `pnpm run repo docs trace recover` 在 exclusive lease 下执行恢复。

generation 未提交时，只有 bytes/preimages/HEAD/index/mode/manifest 全匹配才能恢复完整旧状态。
generation 已提交时，只有全部 planned digest 匹配才能完成新状态。额外 path、symlink、外部编辑、缺失 preimage 或
identity 分叉均保留 owner+stage+journal，并返回 RecoveryConflict。恢复幂等。cleanup 失败不能把已 commit mutation
报成可安全重试。

## Legacy 文件 metadata 迁移

旧文件头 `owner:/regression:/issue:` 仅为只读迁移输入；regular current codec 不再读取。迁移严格两阶段：

- `migrate plan` 通过 runner inventory 分配/验证 token，并读取 legacy metadata/owner/Problem/Issue。
  它生成 Git-private `niceeval.e2e-case-migration-plan/v1`，绑定全部 preimage、inventory、HEAD/index/generation，
  并逐 relation 列 caseId。
- 单 case 文件的 owner 可自动映射；regression/issue 只在 direct provenance 能证明唯一 exact case 时自动映射。
  多 case 文件的每条 regression/issue 必须显式逐项映射；禁止复制到全部 case、按标题猜或选第一个。遗漏、重复、
  无 live target 都使 plan incomplete。
- `migrate apply` 只接受未过期、未使用、完整 manifest，以同一多文件事务写 token/sidecar并移除 legacy canonical lines。
  任一 digest、inventory、Issue verification 或 case 集变化都零写入并要求重新 plan。

迁移 history 保存 legacy source digest/mapping。切换验收要求 legacy canonical lines 为零且 regular compiler 不再读取。

## 最小公开 E2E 与故障注入

实现至少用真实 CLI 验收下列路径：

- Vitest/Playwright collection 且 body=0，单 case attach/list/show，owner 被两个 cases 复用；
- 旧路径防护与 move，regression red/green/certificate/fixed；
- Issue canonical/不存在/PR/跨仓/direct provenance；
- 单 case 自动迁移、多 case 显式映射，以及 case/owner/relation retire 与 tombstone。

事务注入包含 journal durable 前后、每个 owner rename 后、generation 前后、journal cleanup 与 recovery 再中断。
还要注入外部编辑、HEAD/index 变化、symlink/额外文件、Issue ETag 与 plan/apply 间 inventory 变化。
每处只能得到完整旧状态、完整新状态或保留证据的 RecoveryConflict。Memory/Trace check 与 list/show 不得读到半状态。
