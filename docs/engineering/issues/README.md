# GitHub Issue 与 Memory

GitHub Issue 跟踪公开、已脱敏且需要 NiceEval maintainer 后续处理的工作项。
Memory 保存调查后形成的 Problem、Decision 与可复用 know-how。
Observation 是两者的事实起点，不是第三种长期 owner。

本页是 Issue 创建、分诊、关闭和机器重试的唯一工程契约。
实际操作先读 [Issue Skill](../../../.agents/skills/issue/SKILL.md)。

## Owner 边界

Observation 只陈述 provenance、实际观察、期望与影响。
它不要求 reporter 推断 root cause，也不要求 reporter 给出 solution。

符合以下全部条件的 Observation 才进入 Issue：

- 内容可以公开，且已经脱敏；
- NiceEval maintainer 仍需调查、裁决、修复或交付；
- 标题与正文足以支持搜重和下一步分诊。

调查确认的问题、根因、取舍或可复用 know-how 进入 Memory。
临时讨论、已经当场解决且没有长期价值的操作摩擦不创建 owner。

现有 Feedback 只保留迁移、审计和既有关系维护，不是另一条 Observation intake。新的公开工作项只进入 Issue；不能公开的材料进入对应私密渠道。

公开 Issue 不接收 secret、credential、未公开客户资料、私有仓库内容或漏洞细节。
疑似安全问题只走 GitHub [Private Vulnerability Reporting](https://github.com/NiceEval/NiceEval/security/advisories/new)。

## Issue 内容

Bug 使用仓库的 `bug.yml`，至少包含以下内容：

- actual Observation 与 expected behavior；
- 对用户或工作流的 impact；
- 从已安装 Library、CLI、HTTP、浏览器或真实 Adapter 公开入口执行的最小复现；
- 精确的 NiceEval package version、commit 或 candidate identity；
- OS、runtime、package manager 与相关 Adapter、provider 或浏览器运行条件；
- provenance，以及适用时的 source repository 与 stable origin ID；
- 已脱敏且不包含安全漏洞的确认。

Feature 使用 `feature.yml`，至少包含 expected workflow、current gap、impact、usage example、NiceEval identity 与 provenance。
Feature 只要求描述期望行为，不强迫 reporter 设计实现。

## 标签表

Type、area 与 status 是彼此独立的分类轴。
每个 open Issue 恰好有一个 type、至少一个 area，并且恰好有一个 status。

### Type

| 标签 | 使用条件 |
|---|---|
| `bug` | 公开可观察行为违反已采用契约，或同一受支持输入产生错误结果 |
| `enhancement` | 请求新的能力、行为或工作流改进 |
| `documentation` | 只需修改说明、示例或发现入口，不改变产品行为 |

Issue 表单先添加 `bug` 或 `enhancement`。
分诊确认是纯文档工作时，移除原 type 并添加 `documentation`。

### Area

| 标签 | 主要 owner |
|---|---|
| `area:library` | 公开 TypeScript API、类型与 Library 行为 |
| `area:cli` | CLI 参数、输出、交互与命令入口 |
| `area:runner` | 调度、执行、并发、重试与生命周期 |
| `area:record` | Record、持久事实、读取、写入与迁移 |
| `area:report` | Analysis、Report、Insight 与浏览器呈现 |
| `area:adapter` | Agent、Adapter、provider 与第三方接入 |
| `area:repository` | 本仓库文档、测试、CI、Skill 与维护工作流 |
| `area:dependency` | 外部 package、runtime、服务或上游工具 |

跨 area 的 Issue 可以有多个 area 标签。
分诊仍应指出负责推进的主要 area，不能用 `area:dependency` 把 NiceEval 的剩余责任交给上游。

### Status

| 标签 | 含义 | 离开条件 |
|---|---|---|
| `needs-triage` | 新建后尚未完成搜重、公开入口复现与分类 | 完成分诊后改为其它 status，或带证据关闭 |
| `needs-info` | 缺少一个具名事实，当前无法复现或裁决 | reporter 补齐事实后回到 `needs-triage` |
| `accepted` | 证据足够，NiceEval 已接受后续责任 | 完成、转为外部阻塞或证据被反驳 |
| `blocked` | 外部条件阻止推进，但 NiceEval 仍有未完成责任 | 阻塞解除后回到 `accepted` |

新建 Issue 自动带 `needs-triage`。
`accepted` 表示责任与证据已经确认，不承诺发布日期或优先级。
关闭 Issue 时移除 active status；关闭原因和证据保存在 closing comment 与 GitHub state reason 中。

### Resolution

`duplicate`、`invalid` 与 `wontfix` 只表达关闭理由，不充当 status。
仓库已有对应 resolution 标签时使用该标签；否则使用 GitHub `not planned` state reason，并在 closing comment 写明理由。

## 分诊流程

分诊按以下顺序进行：

1. 检查内容是否公开且已脱敏。安全或隐私内容停止公开处理，并引导 reporter 使用私密入口。
2. 同时检查 open 与 closed Issue，搜索相同 Observation、期望结果和 provenance。
3. 从公开入口复现 Bug，或确认 Feature 的 expected workflow 与 current gap 足够具体。
4. 选择唯一 type、至少一个 area，并指出主要 area。
5. 缺少具名证据时改为 `needs-info`，并只询问解除阻塞所需的最小事实。
6. NiceEval 接受责任时改为 `accepted`。外部条件阻塞但责任仍在 NiceEval 时改为 `blocked`。

纯上游责任不保留为 `blocked`。
它应链接 canonical upstream Issue，并按 `wontfix` 或 GitHub `not planned` 关闭。

## 关闭证据

有 PR、commit 或实现 diff 不自动等于完成。
关闭前必须从公开入口证明原 Observation 已不再成立，或按下表给出其它可复查理由。

| 关闭结果 | 必须留下的证据 |
|---|---|
| completed | 链接公开入口的修复验证，说明 NiceEval identity、命令或场景及结果 |
| duplicate | 只链接一个 canonical Issue，并说明两者为何是同一工作项 |
| invalid | 给出可重复执行的反证，说明原 Observation 的哪个事实前提不成立 |
| wontfix | 给出明确理由与影响取舍，不把“已有 PR”或“暂时没排期”当作理由 |
| upstream-only | 链接 upstream Issue，说明 NiceEval 已无剩余责任，并使用 `not planned` |
| external fixed | 给出 dependency 版本，并重新执行原公开入口场景后说明结果 |

产品 Bug 如果关联 Problem Memory，该 Memory 必须是 `resolved(fixed)`。
对应 E2E owner 还必须保留公开入口红灯、candidate 转绿与可靠性接管收据。
完整门槛见 [Bug 修复的 E2E TDD](../testing/README.md#bug-修复的-e2e-tdd)。

## Issue 与 Memory

Issue 可以在没有 Memory 时存在；Memory 也可以直接来自开发调查。
调查产出 Memory 后，只在 Issue 保存指向 Memory 的正向关系。
Memory 不维护 Issue back-reference，也不复制 Issue 的 open、closed、label 或 priority。

Issue 的 open 或 closed 是协作状态，Memory 的 status 是工程事实。
两者不做双向自动同步。
Problem Memory 重新打开不会自动重开 Issue；Issue 关闭也不会自动把 Memory 改为已解决状态。

## 下游与 Agent 授权

下游仓库和 Agent 可以准备已脱敏的 Issue draft，并保留原 Observation 与 provenance。
它们不能把推断改写成 Observation 事实，也不能替 reporter 补写 root cause。

创建、编辑、评论、加减标签、关闭或重开远端 Issue 都是 remote mutation。
Agent 只有取得用户对本次目标仓库与具体动作的明确授权后才能执行。
过去的授权、创建 draft 的请求、普通开发任务或本地 Memory mutation 都不构成远端授权。

授权不确定时只交付 draft、建议标签与搜重结果。
不得创建 Issue、修改仓库标签或更改 GitHub 设置。

## 脱敏与 provenance

公开前删除 token、cookie、credential、私有 URL、客户资料、原始对话和私有仓库内容。
复现需要这些材料时，改用最小 synthetic fixture；无法安全替换时停止公开提交。

Provenance 至少说明 Observation 是直接使用、下游 dogfood、agent-assisted run 还是 upstream report。
机器提交还要保留 source repository 与 stable origin ID，不能用标题、时间戳或可变路径代替稳定 provenance。

## 去重与机器幂等

人工搜重比较 Observation、expected behavior、公开入口和 impact，并同时检查 open 与 closed Issue。
相似但不相同的 Observation 不合并；无法判断时停止并请 maintainer 选择 canonical Issue。

机器提交必须把以下 marker 放在正文末尾：

```text
<!-- niceeval.issue-origin/v1
origin-key: github.com/example/repository#stable-origin-id
payload-sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
-->
```

`origin-key` 来自 source repository 与 stable origin ID。
Source repository 采用小写的 `<host>/<owner>/<repository>`，移除末尾 `.git`；stable origin ID 保留上游系统的不可变字面值。
两者以 `#` 连接，不能包含临时 run 序号、当前标题或提交时间。

`payload-sha256` 是 canonical title 与 canonical body 的 SHA-256 小写十六进制摘要。
Canonical body 不含 marker。
Canonical title 与 body 先做 Unicode NFC，再把换行统一为 LF，并删除每行末尾空格与首尾空行。
摘要输入是 UTF-8 compact JSON，固定 key 顺序为 `{"title":<title>,"body":<body>}`。

每次机器提交前都必须通过 GitHub API 分页枚举目标仓库的全部 open 与 closed Issue。
枚举必须读每条 Issue body，过滤 Pull Request，并按 marker 的完整 `origin-key` 匹配。
不能依赖 GitHub search index、标题搜索或单页列表证明不存在。

匹配结果只有以下处理：

- 同一 `origin-key` 与同一 digest：返回既有 Issue URL，不做 mutation；
- 同一 `origin-key` 与不同 digest：停止并询问，不自动更新或创建；
- 同一 `origin-key` 出现多次：停止并报告数据冲突；
- 完整枚举后没有匹配：完成语义搜重，并在授权仍有效时创建一次。

创建响应超时、断线或结果不确定时不得直接重发。
先重新分页枚举 open 与 closed Issue，再按同一规则处理。
枚举不完整时停止并报告 unknown；确认没有匹配后，每次明确授权最多重发一次。
第二次结果仍不确定时停止，交由 maintainer 处理。
