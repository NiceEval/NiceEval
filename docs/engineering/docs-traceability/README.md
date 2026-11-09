# 仓库文档追溯

`concord list`、`concord show` 与 `concord test` 是 Feature、Use Case、E2E、Memory 与 Issue provenance 的日常查询入口。
可运行能力包括 `concord list feature`、`concord show <id>` 与 `concord test list/show`；Issue 与 Memory 的关系由 `concord issue link` 与 `concord memory link` 写入，也可直接编辑。

Roadmap 与 Engineering 的结构写入走 Concord 基础 CLI，参数以各自 `--help` 为准：

- `concord new roadmap|engineering <name>`、`concord list roadmap|engineering`、`concord show <id>`
- `concord roadmap start <id>`（采用 Roadmap）

它们使用 Concord 基础发布 journal，中断后用 `concord recover` 恢复。

Feature 由 `concord new feature <name>` 创建，既有页面直接编辑。
叶子 Use Case 由 `concord new use-case <name> --feature <feature>` 独立发布。
Roadmap 采用只走 `concord roadmap start`。
Trace 的 `concord recover` 从各 owner 正向关系恢复 publication，不保存中央 Registry，也不改变 Nx affected graph。

文档身份、页面职责与 Design 生命周期以 `concord --skill document` 为准；原生测试正文服从[测试正文约束](../testing/README.md#测试正文约束)。

## 使用心智

```text
Feature / Use Case contract
       ▲       ▲
       │       ├── spec ─────── Issue ── root-cause ──► Memory
       │       └── supports ── Memory
       │ @feature / @use-case
    E2E case ── @issue ───────► Issue
```

Feature 保存产品语义；测试声明保存到契约的关系，测试文件保存真实动作与 expected。
Issue 保存待处理的观察及外部对象 provenance，Memory 保存可复用的调查经验。
Trace 连接这些既有 owner，不度量测试涉及范围，也不把 Use Case 变成可执行规格。

## 文档身份与页面

Spec、Roadmap 与 Design 不写 frontmatter。canonical 仓库相对路径是身份，正文唯一的一级标题是名称，所属关系由目录派生。
Use Case 位于所属 Feature 的 `use-case/` 下，跨 Feature 目标导航归 `docs/guides/`。

| 文档 | 位置 |
|---|---|
| Feature | `docs/feature/<name>/README.md` |
| Roadmap | `docs/roadmap/<name>/README.md` |
| Engineering | `docs/engineering/<name>/README.md` |
| Design | `docs/design/<name>.md` |
| Use Case | `docs/feature/<name>/use-case/<case>.md` |

Feature、Roadmap 与 Engineering 的页面种类由文件名决定。
README 写功能总览，Library 与 CLI 页写输入、可观察结果和错误，Architecture 与 Data Model 页写内部职责和不变量。
具体布局与可选页面通过 `concord --skill document` 查询。

## 强关系

每种关系只由正向 source 拥有。Concord 动态编译反向关系，不把 tests、实现或 Memory 列表回写到目标契约。

- 测试声明的 `@feature` 或 `@use-case` 直接指向产品契约。
- 源码声明的 `@concord-implements` 指向实现所兑现的 Spec 页面或 anchor。
- Issue 与 Memory 在各自 frontmatter 的 `relations` 中保存指向 Spec 或调查材料的关系。
- 普通 Markdown 链接用于阅读导航，不能代替测试或实现声明。

路径与 anchor 必须存在。移动文件会改变身份，相关引用随之更新；页面标题、正文或呈现变化不能自行制造新的契约关系。
关系字段、目标种类与查询投影以 `concord --skill trace`、`concord --skill feedback` 和 `concord --skill memory` 为准。

## E2E 与契约关联

真实声明上方的 `@feature` 或 `@use-case` 直接指向仓库中的产品契约。
标记规则服从 [E2E case 关系契约](../testing/architecture/e2e/case-relations.md)。
测试标题描述用户结果；工具从 native path、声明路径和标题派生引用，不要求手写 ID。

可执行 inventory 与测试结果来自原生 runner；声明标记只关联契约，不代替真实执行结果。
lane、areas 与 executor 来自 E2E Repo metadata。testing 文档中的结果说明只承担阅读导航，不中转测试关系。

## Feedback、Memory 与 Issue 分层

本地与外部导入的观察都由 `docs/issues/<id>.md` 拥有。外部对象 provenance 保存在 `source` 中，不另建 Feedback owner。
Issue 的 `relations` 用 `spec` 指向相关契约，用 `investigation` 或 `root-cause` 指向 Memory。
Memory 的 `relations` 用 `supports` 指向它支持的 Spec。

回归测试在真实声明旁用 `@issue` 关联待修复的 Issue；核验规则服从 `concord --skill fix`。
历史事件或自由文本证明不能代替当前候选从公开入口获得的 E2E 红灯与绿灯。

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

## 文档创建与编辑

Feature、Roadmap 与 Engineering 通过 `concord new` 创建，既有页面直接编辑。
用 `concord new --help` 选择正文页；README 必需，其余页面只在确有内容时创建。

```sh
concord new feature <name> --pages cli,library,use-case
concord new use-case <name> --feature <feature>
concord new roadmap <name>
concord new engineering <name>
```

命令不创建 E2E 测试、测试完整度状态或源码进度状态。分类 README 只维护主题入口，反向关系由 Concord 从各 owner 文件派生。

## Roadmap 采用

Roadmap 采用走 `concord roadmap start`，把 Roadmap 身份替换为 Feature 身份，不留下 Roadmap/Feature 双真源；采用语义与恢复由 Concord 拥有。

## 可恢复事务与一致读取

文档创建、关系写入与 Roadmap 采用由 Concord 的 Git-private 发布租约和 journal 协议拥有。
写入失败时保留可恢复现场，发现并发修改时拒绝发布；中断后用 `concord recover` 恢复。
NiceEval 不复制一套锁、发布或恢复实现。

读取与关系投影以当前 Concord 的输入文件快照为准。
`trace show`、`trace gaps` 和 `review` 可以读取带时间的历史投影并请求后台刷新；需要当前结果时使用 `--fresh`。
历史投影不能授权写入或证明修复核验成立。

## Trace check 与 lint

`concord check` 与 `concord trace check` 检查当前文档的放置、引用、重复、循环、术语与写作规则。
`trace gaps` 只列出缺少显式 code/test 关系的契约，不证明测试涉及范围，也不发现从未建档的命令。
这些命令不执行 NiceEval 测试。

Concord 拥有文档语法 parse、关系推导、投影与 finding；NiceEval 统一用 `pnpm lint` 组合仓库检查。
完整命令和输出以 `concord --skill trace` 与各命令的 `--help` 为准。

## 错误语义

输入与一致性错误返回具名 finding，并指出问题对象和后续动作。
selector 歧义、路径或 anchor 不存在、关系目标错误、并发输入变化、恢复冲突与 journal 删除失败必须能相互区分。
遇到失败保留具体输出；不通过重写历史证据、修改生成物或停用 Concord 服务绕过检查。

迁移保真、旧分支合并与复杂图示的写作方式见 [Concord 迁移与图示实践](architecture.md)。

## 切换与验收

文档身份、测试关系与采用动作遵守当前 Concord 模型。
迁移保留作者正文与历史证据；过时的身份字段不能成为第二套现行规则。

验收至少包括：

- `concord list feature` 输出的每个路径都能原样交给 `concord show`；
- 页面种类与 Use Case 所属关系由路径派生，Spec、Roadmap 与 Design 无 frontmatter；
- 每个测试声明直接关联一个契约，契约可由多个测试声明共同守护；
- Issue、Memory 与测试的正向关系可动态反查，不另存反向登记表；
- 文档移动和删除后，全部有效引用仍能到达对应契约；
- Design 裁决写入对应 Spec 并删除原页；
- 历史证据保持原始语义，不能被当作当前候选的运行证明；
- `concord --fresh check` 与 `pnpm lint` 通过。
