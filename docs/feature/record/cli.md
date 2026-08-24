# Record CLI

CLI 通过 [Record Library](library.md) 打开 current root：

```json
{ "format": "niceeval.record.attachments", "recordId": "..." }
```

`show`、`view` 与 `exp` 只使用调用时显式 composition 的 session-local Attachment catalog。它们不自动迁移，
不加载 legacy decoder，也不调用 Git。读到 predecessor 时返回 `migration-required`，由用户显式运行
`niceeval migrate`。

CLI 是 Host composition SDK 的一个调用者。`exp` 经 Experiment Host，Record I/O 经 Record Host，lease 经
Coordination Host，Sample 经 Analysis Host。`show`、`view` 与 static export 经 Report Host。

## 命令与 lease

| 命令 | lease | 是否改变已发布事实 |
|---|---|---|
| `niceeval show` | shared read | 否 |
| `niceeval view` | shared read | 否 |
| `niceeval exp --dry` | shared read | 否 |
| `niceeval exp` | shared append | 只发布自己的新 Run |
| `niceeval clean` | exclusive maintenance | 删除重验后仍 incomplete 的 Run |
| `niceeval migrate` | exclusive maintenance | 显式提交相邻 Attachment steps，最后重建 Seal |

shared read 与 append 可以并存。每个 `exp` writer 只修改自己排他创建的 staging / destination。
maintenance 与 reader、writer、clean 互斥；冲突立即返回 `record-maintenance-busy`。

## `show` 与 `view`

`show` 和 `view` 打开一个 `RecordReadSession`，冻结当时已经发布的 RunId，并把 selection 交给 Analysis。
新的 Run 留给下一次 session。CLI 不读取当前 Eval、worktree、provider 或网络来补历史事实。

存在 incomplete Run 时，CLI 继续显示有效 Run，并输出：

```text
Warning: 2 incomplete Runs were ignored.
They are not readable or reusable.
details: niceeval clean
```

query 只读取自己的 definitions 与 reference closure。inventory 中出现未组合的第三方 family 时，无关官方 view
继续工作。query 直接需要该 family，或已知 Attachment reference 到它时，返回：

```text
family-definition-required
owner: attempt 01K...
family: acme.energy
revision: 1
next: enable the package or Plugin that defines this family
```

已知 family 的版本不是 current 时返回：

```text
migration-required
family: niceeval.assertions
found: 1
required: 2
next: niceeval migrate
```

ordinary command 不在错误后改盘，也不自动重开 session。用户运行 `migrate` 成功后，重新执行原命令。

`not-recorded` 表示 owner 没有请求的已知 family。`invalid` 表示 current definition 已找到，但 envelope、logical
value、reference 或 content closure 不合法。I/O、permission 与 budget 是 typed failure，不伪装成这两个状态。

完整发布、export 或调用方要求完整库存时，Host 调用 `requireComplete()`。未知 persistence、non-current revision、
Seal 与 envelope inventory 不一致、invalid closure 与超预算都 fail closed。局部 `show` 成功不等于整份 Record 已完整验证。

## `exp` 与 `exp --dry`

`niceeval exp` 在模型、Sandbox、外部命令、claim 或付费调用前打开 ordinary reader。若计划直接依赖的 family
需要 migration 或缺 definition，它会在昂贵工作前失败，不自动维护。

Experiment Host 把官方 definitions 与启用 Plugin 的 contributions 显式组成 writer catalog。它创建新 Run staging，
并给每个 producer 只发匹配 owner 的 writer：

```text
Adapter / Sandbox / Runner capture
            ↓ session callback
owner.attach(definition, ({ content, reference }) => ({
  report: content.text("..."),
  source: reference.to(exactDefinition, semanticValue),
}))
            ↓
Core reads source + digest + budget + envelope commit
```

producer 不调用逐 family Host API，也不写 raw JSON、path、content key 或 family string。第三方 package 只定义
family；只有启用该 Plugin 的 Host composition 才把 definition 与 capture lifecycle 接到 owner writer。

`seal()` 等待本 Run 的 Attempt 与 capture authority 停稳。它验证 Core、所有 committed envelopes、session catalog、
reference closure、content budget 与完整 Seal。缺 definition 或发现未解释 Attachment 时不发布。

Seal 与零字节 `complete` 在 staging 中形成后，Core 用 no-replace directory rename 发布。marker 前退出不会暴露
部分 Run；publish 后即使 receipt 尚未输出，Run 仍是 durable fact。

`niceeval exp --dry` 不创建 Run、Attempt 或 append lease。它只用 read session 形成计划。局部无关 family 可以
不影响计划；被 reuse dependency 直接需要的 definition 仍必须存在并 current。

## `clean`

```sh
niceeval clean [--record <root>] [--yes]
```

默认模式列出 incomplete Run，并要求确认。取得 maintenance lease 后再次检查 publication marker，只删除仍未
发布的目录。已发布但 Core invalid 的 Run 不属于 clean。

非交互调用必须传 `--yes`。content orphan 只在 migration 已经验证 full current Seal 后删除，不属于 `clean`
命令的独立模式。

## `migrate`

```sh
niceeval migrate [--record <root>] [--yes]
```

命令处理 current `niceeval.record.attachments` 的 Attachment revisions，也处理受支持的
`niceeval.record.source-receipts` predecessor。它先形成只读确定性 plan：

```text
Record migration plan
format: niceeval.record.attachments
steps: 12
pending seals: 3
resume: 4 committed steps already current
```

plan 按 RunId、owner kind、owner id、family 与 source version 排序。每个 definition 必须提供严格相邻、无分叉的
完整单链。缺 step、跳步、分叉、unknown definition 或 invalid source 在首个 commit 前失败。

交互命令展示 steps、retained / dropped facts 与 budget 后要求确认。非交互调用必须传 `--yes`。命令不要求 Git
worktree、tracked bytes 或 clean index，也不读取 HEAD。

执行时，每个相邻 step 先生成 target content，再 atomic replace `attachment.json`。envelope 是该 step 唯一
commit record。全部 targets current 后，命令才重建并 atomic replace Seal manifest。

被 kill、断电或 I/O failure 后，下一次同一命令从 durable envelopes 续跑：

- 旧 envelope 仍在时，确定性重跑该 step；未引用 target content 是 orphan candidate。
- 新 envelope 已提交时，跳过该 step并继续下一项。
- 所有 envelope current、Seal 尚旧时，只重建 Seal。
- Seal 已 current 但上一进程没输出 receipt 时，返回 `already-current`。

命令不写 migration sentinel、journal、backup、restore commit 或 rollback metadata。失败输出只列 committed steps、
pending identity、Seal 状态与 orphan candidates；它不声称某次 Git restore 安全。

## 错误与下一步

| code/state | 含义 | 下一步 |
|---|---|---|
| `already-current` | envelopes 与 full Seal 都 current | 不修改 Record |
| `family-definition-required` | direct / closure / complete operation 缺 session definition | 启用定义该 family 的 package / Plugin，再重试 |
| `record-migration-required` | ordinary command 遇到受支持 predecessor root | 运行 `niceeval migrate` |
| `migration-required` | direct read 遇到已知 family predecessor | 运行 `niceeval migrate` |
| `migration-chain-invalid` | definition 有缺口、跳步、分叉、环或重复版本 | 修正 definition package |
| `record-migration-invalid` | predecessor bytes、content、reference 或 migration 输出不能形成目标 | 检查该 owner/family；命令不猜测修复 |
| `record-format-unsupported` | root 或 family version 不受当前 composition 支持 | 安装支持该格式的 NiceEval 或 definition package |
| `record-maintenance-busy` | maintenance 与 reader/writer/clean 冲突 | 关闭占用命令后重试 |
| `resource-budget-exceeded` | value、reference 或 content 超过 family budget | 缩小 capture 或调整 definition budget |
| `incomplete-run` | Run 未完成原子 publish | 用 `niceeval clean` 检查 |
| `not-recorded` | owner 没有请求的已知 family | 让 query 按 missing policy 处理 |
| `invalid` | current envelope、value、reference 或 content closure 无效 | 检查该 Attachment；无关 family 仍可局部读取 |
| `record-seal-incomplete` | full Seal 缺 definition、current envelope 或 closure | 先组合 definition 或显式续跑 migration |

## Git、复制与分享

Git 只由用户用于历史、diff、restore 与 rollback。NiceEval 不执行 Git preflight，不修改 index，也不保存 commit
identity。用户希望 migration 可回退时，应先自行 commit、复制或快照 Record；这不是 migration 的执行前提。

只分享 portable Record root。`.niceeval/coordination/` 下的 claim、lease、session 与 writer staging 都不能提交、
复制或分享。Record 可能包含源码、prompt、conversation 与 content；提交前由用户确认权限、脱敏和保留策略。
