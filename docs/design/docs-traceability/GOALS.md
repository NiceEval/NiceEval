# 目标与要求

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

## 目的与范围

本决策只处理仓库内设计文档、E2E owner 与 Memory 的可发现关系，以及这些对象的安全创建和迁移。
它不改变产品运行时、Nx affected 图、E2E 执行器或 Memory 的既有状态模型。

## 设计目标

### G1：从任一稳定入口得到有限答案

Feature 查询应列出直接子功能、本地与跨 Feature Use Case、直接相关的 Roadmap、Design、Engineering、E2E owner、测试文件和当前 Memory。
测试查询应列出 owner anchor、产品契约、所属 Features 与 regression Memory。
`feature list` 与 `test list` 输出的身份必须能原样交给各自的 `show`，不要求用户拼 qualified ref。

### G2：关系只在 owner 处声明

正向关系由源对象拥有，反向关系动态推导。Feature 不保存测试反向列表，Memory 不保存 E2E 反向列表，分类索引不成为编译输入。

### G3：产品契约保持单源

测试元数据只保存指针，不复制用户行为。Use Case 只串联目标，不复制 Feature 定义；Engineering 只描述仓库机制。

### G4：空自动化是完整状态

工具应显示某个契约没有长期自动化 owner。这个空集合不产生自动化完整度 finding，也不写入 `automation: none` 或缺少自动化的原因。

### G5：当前关系、历史关系与普通提及分层

默认查询只展示当前强关系。promotion history 与 supersession 单列；普通 Markdown 提及不升级为强边，也不默认混入结果。

### G6：结构变化通过工具完成

Feature、Roadmap、Design、Engineering 与 Use Case 从版本化模板创建。移动和采用必须重写强引用，并给出可恢复事务收据。

### G7：人和 Agent 得到同一个结果

人读输出与 JSON receipt 来自同一 Snapshot。JSON 必须版本化、稳定排序、使用 canonical path，并显式返回空数组。

### G8：不建立通用图平台

命令只提供浅发现与按 kind 固定的闭合投影。它不提供任意深度 traversal、Cypher、持久 graph cache 或行为到测试的映射数据库。

## 可验证要求

- 修改 `test()` 标题、scenario companion 或测试正文后，Trace Snapshot 与 digest 不变。
- selector 歧义时非零退出，并列出所有候选；不得静默选择第一个结果。
- `check --changed` 仍检查全仓，只增加影响标注，不过滤 finding。
- mutation 任一阶段中断后，只能恢复为完整旧状态或完整新状态。
- 470 条 legacy Memory 继续逐字节只读，查询不得猜测其 kind、state 或 resolution。
- 没有 E2E 的 Use Case 仍通过关系完整性检查。
