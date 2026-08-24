# 约束与候选

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

## 共同约束

### L1：文档类别承担不同语义

Feature 是已经采用的当前目标；Roadmap 是已定稿但尚未采用的方向；Design 保存候选与裁决历史；Engineering 保存仓库机制。
Roadmap 被采用后并入 Feature 并删除旧入口，不能长期保留两个当前真源。

### L2：节点不能只靠 README 深度猜测

Feature、Roadmap 与 Design 都有嵌套 package，普通契约页、reference 和分类 README 也可能处在同样深度。
叶子 Use Case 既可能是 `.md`，也可能是目录 `README.md`。

### L3：测试身份是文件与 owner anchor

仓库有 83 个 E2E test/spec 文件，首行各有一个唯一 `owner:`。其中 78 个指向 Engineering testing owner anchor，5 个直接指向 Feature。
现行[测试组合契约](../../engineering/testing/portfolio.md)把产品契约与测试组合 owner 分开；较早 Design 存档不能取代这项较新的目标。

### L4：测试正文不是追溯 Schema

83 个文件注册的测试标题多于文件数，部分标题来自 `.scenarios.ts`。标题、步骤、fixture 与 expected 会随测试组织变化，不是稳定 graph identity。

### L5：原生 E2E 裁决否决影子行为模型

[原生 E2E 决策](../user-readable-testing/DECISION.md)否决全仓 Behavior、Proof、Recipe 与 Registry。
历史上手写场景表也曾因重复产品语义而删除；新工具只能索引现有指针。

### L6：Memory 同时存在结构化目标与 legacy 事实

[Memory 契约](../../engineering/feedback-memory/README.md)定义 Problem、Decision、Insight、promotion current/history 与 supersession。
当前 470 条 Memory 均为 legacy；它们可以被显式 regression 引用，但不能被称为 Problem、Bug 或具有结构化终态。

### L7：普通 Markdown 链接没有关系类型

路径能定位的链接只能证明导航目标存在，不能证明 `builds-on`、`contract`、`decides`、`supports` 或 promotion。
自动改写外部普通链接也无法证明作者仍想表达相同意图。

### L8：Nx graph 只负责执行选择

E2E Repo ID、areas、`implicitDependencies` 与产品 Feature 是不同维度。Trace 不修改 Nx graph，也不从 affected 关系推导产品契约。

### L9：分类索引是人读投影

目录 README 与根索引方便人导航，但它们会与节点集合重复。生成区可以被校验，不能作为 Trace compiler 的节点或边输入。

### L10：跨文件写入不是瞬时原子 rename

创建、移动与采用会同时触碰 package、强引用、Memory promotion 和生成区。文件系统不能把这些 rename 变成一次全仓瞬时切换。

### L11：Repository Tools 只有一个 runtime

正式命令应进入 Docs domain。纯 compiler 只能有一个 owner；CLI、lint adapter 与 Memory check 不得分别实现关系 parser。

### L12：页面角色不等于关系 metadata

README、Library、CLI、Architecture、Lifecycle 与 Reference 可由 Feature package placement 稳定辨认。为了树形展示把这些角色写进 frontmatter 或 sidecar 会复制目录事实，并把 formatter 变成持久 Schema。

### L13：Feedback、Memory 与 Issue 各有事实 owner

Feedback 保存原始观察、Issue source 与 adoption；Memory 保存调查/裁决与 promotion；test/spec 保存 regression 与测试 Issue header。
Use Case 只保存自己的产品语义和 `composes`，不能反向抄写这些 provenance 边。

## 候选清单

- [PLAN-1：中央 Trace Registry](PLAN-1/README.md) —— 以签入 Registry 保存节点、边和反向索引。
- [PLAN-2：owner-local typed links 与动态编译](PLAN-2/README.md)（推荐）—— 从节点、owner anchor、测试头与 Memory 动态形成 Snapshot。
