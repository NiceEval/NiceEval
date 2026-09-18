# E2E case 关系、证据与生命周期

本篇是 E2E case 身份、Trace 关系、正式证据和迁移的唯一契约。测试正文仍由
[E2E 测试正文](authoring.md)约束；候选注入与执行仍由[本地与 CI](execution.md)约束。

## Case 与产品契约

真实测试声明上方直接写一个仓库相对路径：

```ts
// @feature docs/feature/inspection/README.md
test("query run 经 pipe 交付完整文档", async () => {})
```

精确验证一个 Use Case 时改用 `// @use-case docs/feature/<feature>/use-case/<name>.md`。
每个声明恰好一个 Feature 或 Use Case；多个测试可以关联同一契约。标题只描述用户结果。
关系沿 `case → contract` 推导，不从目录、文件名或标题猜测，也不经 testing owner anchor 中转。

工具使用 `concord.test-reference/v1` 从 native test path、声明文件路径、完整静态标题派生
`neref_` 加 32 位十六进制引用。引用供 selector 与证据使用，不写进标题或注释。
改标题或任一身份路径会产生新引用。selector 是 `<repo-relative-path>#<caseId>`，从当前 list/inventory 取得。

## Inventory adapter 边界

可执行 inventory 只能来自 Vitest 或 Playwright 原生 collection。AST 定位源声明与注释，不能证明测试被收集或执行。
原生结果必须唯一绑定到固定执行副本中的静态声明，再用 Concord 的共同算法派生引用。
无注释声明也参与歧义判断；无法唯一绑定、动态展开或不支持的调用不能静默选择第一个。

Vitest 使用正式 collection/list 接口；Playwright 使用 list collection，不启动 browser、webServer、global setup、
project dependency 或 test body。只允许框架 collection 必需的 config evaluation。

原生收集保留 executor、Repo、native path、project、titlePath，以及用于绑定声明的位置。
声明模块用 `// @test-file e2e/<repo>/test/<entry>.test.ts` 明示 runner 的 native path；同文件无需重复。
Host 通过 `caseIdentity: "concord.case-contracts/v1"` 声明实现本契约，marker 本身不是执行证明。

inventory 是当前 CLI 生成并消费的短期 Git-private 证据，用户只取得 `neinv_...` ID。
内部严格校验 executor/version、Repo、argv、checkout、files、cases、body/setup 零执行、exit/signal 与 digest。
collection 或绑定失败必须报告 finding；实现变化后重新 collection，不手写或修补 inventory JSON。
单 Repo inventory 与全仓 audit 共用隔离复制、candidate/Testkit 注入、安装和原生 collection。
源码 `e2e/<repo>` 不是已安装消费项目。

## Git-tracked 源码注释与历史

current relation 只保存在真实声明紧邻的注释中：一个 `@feature` 或 `@use-case`，零到多个
`@regression <Problem Memory path>` 和 `@issue <strict JSON CaseIssue>`。
Issue 保存验证得到的 repository、number、url、nodeId、titleDigest、checkedAt 和 provenance。
字符串或模板中的伪注释不构成关系。

`e2e/concord-history.ts` 只含历史与退役注释，不保存第二份 current registry。
`@concord-history` 保存原始事件，`@concord-tombstone` 保存退役事件。迁移前的原始事件保存在 `docs/migrations/case-history-before-path-annotations.txt`。
历史事件与 receipts 保留原始字节，
不通过改写旧引用或补字段把旧证据转换成当前证明。

## 按需命令指引

`pnpm exec concord --skill repository` 输出此 profile 的操作入口。`concord --skill` 是简短路由，
`concord --skill <topic>` 按任务读取，`concord --skill all` 才展开全部指引。
帮助和 skill 阅读不加载产品 host、不执行测试，也不修改仓库。

## CLI 与具名生命周期

```text
pnpm run repo docs test
├── list [pattern] [--json] [--history]
├── show <path#caseId> [--json] [--history]
├── inventory --repo <id> [--json]  # returns neinv_...
├── case retire <path#caseId> --reason <text> [--json]
├── regression add <path#caseId> --memory <ref> --red <nered_...> --takeover <netake_...> --inventory <neinv_...> [--json]
│   ├── refresh <path#caseId> --memory <ref> --reason <text> --red <nered_...> --takeover <netake_...> --inventory <neinv_...> [--json]
│   └── retire <path#caseId> --memory <ref> --reason <text> [--json]
├── issue add <path#caseId> --url <canonical-url> --provenance direct [--json]
│   └── retire <path#caseId> --url <canonical-url> --reason <text> [--json]
└── audit [--json]
```

直接编辑声明旁的契约路径维护关联；不需要分配 ID 或 attach。改动后重新 collection 与 audit。
`case retire` 和 relation `retire` 保留历史；不通过任意 patch 或 history rewrite 改写证据。

存量 current regression 可以没有正式 evidence index。`regression add` 保持原有已登记关系的去重规则。

已有关系需要更新 legacy 或内容已变化的 proof 时，使用 `regression refresh`，提供非空 reason、新 red/takeover/inventory，
且目标必须是 open Problem。已有有效 current v2 proof 的重复 refresh 被拒绝。

refresh 在同一事务归档旧索引指针并替换当前指针，保留旧 receipts、Memory 和 relation history，
不追加重复的 regression-added。校验失败零写入；不能通过 retire/re-add 或修改旧 JSON 冒充刷新。
每一代 evidence 发布到独立不可变目录，历史指针保持可读。

`list` 叶子是 selector；默认只列 current，`--history` 另列 history/tombstone。pattern 可匹配 selector、title、
contract、Feature/Use Case、Memory 和 Issue；输出 selector 均可原样传给 `show`。`show` 重新 collection 并验证
path guard，返回 runner title、executor、contract、精确 Feature/Use Case、relations、正式 certificate 与 findings。

JSON 成功 receipt 共享下列字段：

- `format`、`operation`、`transactionId`、`snapshotDigest`、`inventoryDigest`；
- `generationBefore/After`、`subject`、`preimages` 与 `plannedDigests`；
- `historyAppends`、`findings: []` 与 `committed`。

失败必须区分无法绑定的声明、未收集 case、路径失效、重复引用与契约数量错误。
还要区分 ContractTargetInvalid、RelationAlreadyCurrent、RelationNotCurrent、EvidenceMismatch 和 IssueVerificationFailed。
事务错误分为 PreimageChanged、RecoveryRequired 与 RecoveryConflict。

## 正式 evidence 与 takeover certificate

只有根 runner 正式 receipt 可成为 red、green 或 reliability evidence；`e2e diagnose` 永不合格。

新登记与新 fixed 使用 v2 formal receipt 和 takeover certificate。证据绑定：

- caseId 与 native testFile；
- 固定执行副本中的源码投影：所属 E2E Repo 的 JS/TS 源文件路径集合及每文件 raw/code SHA；
- source identity v3 的 direct-contract binding：contractRef 与完整契约 Markdown SHA；
- candidate、inventory、runner argv/version、结果、cleanup 和唯一 invocation identity。

源码投影采用 concord.repository-source-projection/v2，源码身份采用 concord.repository-source-identity/v3。范围包括 `.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts`，排除依赖、Git、
工具结果及隔离复制明确排除的目录；它不证明完整依赖闭包。

code 投影只剥除语法识别成功的 feature/use-case/regression/issue 注释；标题、test-file 映射、普通注释、字符串、模板和断言仍参与校验，
源码新增或删除也改变投影。根 runner 必须执行被签名的同一固定副本，并在复制/执行前后检查漂移，
不能先对源目录求 hash，再执行稍后复制出的不同字节。

Concord 与 root runner 共用严格投影协议。

red 是同一 caseId 在旧 candidate 或最小逆补丁上的 formal regression；green 是修复 candidate 的 formal pass。
certificate 包含三次 isolated copy、两次 same-copy、default-parallel、single-case 观察与 cleanup。
全部 observation 绑定同一 candidate 与 relation/source snapshot。invocation ID 唯一且没有 test retry。
selector 不匹配、diagnostic mode、缺项或 digest 分叉均失败。

当前校验要求 code 投影与 contract 字节仍一致；添加合法 regression 注释或历史不会使刚登记的
证据自失效，声明模块中的断言、普通源码、路径集合或 contract 的变化会使旧 proof 陈旧。
旧 v1 receipts、既有 `.cases.evidence.json` 和 fixed Memory 原样保留为历史；读取与审阅明确显示
`legacy` / `stale` / `unavailable`，不自动 reopen，也不得将 v1 用于新的 fixed 判定。

root runner 成功生成 red 后，把 candidate bytes 与 formal receipt 复制进 Git-private bundle，并返回 `nered_...`。完整 takeover 矩阵通过后，同样复制 candidate bytes、七份 formal receipt 与 certificate，并返回 `netake_...`。bundle 绑定当前实现指纹；实现变化、文件缺失或字节 digest 分叉时 ID 失效。调用方不传 artifact 路径、不编辑 JSON，也不能只重算自校验 digest 冒充 runner provenance。

`regression add` 只接收 `nered_...`、`netake_...` 与 `neinv_...`，内部读取受管 bundle 并验证 open Problem、red/green 配对、candidate bytes 与 certificate。`memory resolve --kind fixed` 必须从
当前源码关系找到指向该 Problem 的 live case，并验证该 case 的 red+green+certificate。自由文本 proof、retired case、
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

case relation mutation 可能同时改声明注释、历史归档和 certificate index。
声明所在文件和声明模块的完整 preimage 一并进入 CAS，不能只保护局部注释。它们与 Trace 共用 repo-wide
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

## 已授权迁移与验收

一次性迁移由协调 agent 在明确授权的范围完成。逐 case 沿原有关系定位真实 Feature 或 Use Case，
保留 regression/Issue 的精确归属。迁移对照只放 Git-private 工作材料，不增加版本控制下的第二份登记表。
移除旧标题 token 和旧关系注释，不保留运行时兼容分支；历史归档和 receipts 不改写。

验收比较迁移前后的真实声明、标题正文与关系集合，运行新的原生 collection 和 audit。
测试验证当前绑定、契约路径查找、证据漂移与事务恢复；不为已删除的旧语法新增拒绝测试。
