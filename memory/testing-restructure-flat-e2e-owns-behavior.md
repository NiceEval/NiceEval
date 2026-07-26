# 测试体系合并统筹：e2e 平铺三域、行为验收整体归 E2E

**裁决（2026-07-21，用户逐条定案）**

1. `docs/engineering/{testing,unit-tests,e2e-ci}` 三个目录合并为 `docs/engineering/testing/{README.md,churn.md,unit/,e2e/}`：总纲一篇讲分层职责，子目录讲怎么做。
2. `e2e/` 物理布局平铺、目录名即验收域：`adapter/`（原 `repos/`，官方适配器协议验收）、`cli/`、`report/`（原 `mechanism/results`，含内建与自定义报告的用户操作回归）。`mechanism` collection 与 group 值取消，group 改为 `sdk|sandbox|cli|report`。
3. 层边界重划：单元层只测**数据语义**（判定、调度、聚合、装载校验、纯函数派生）；渲染产物（终端排版、DOM、快照、样式）、CLI 进程行为、协议归一整体归 E2E 功能/适配器仓库，对一次真实运行的产物做确定性断言。
4. adapters 单元测试维度整体取消：22 个 wire-fixture 协议归一测试与 `unit/adapters/` 登记表删除，协议正确性唯一验收面 = `e2e/adapter/` 真实运行；`cost.test.ts`、`execution-tree.test.ts` 属协议无关数据派生，改挂 reports 登记表保留。
5. 「对测试的测试」按一条判据取舍：**流程守护留**（`test/docs/cases-registry.test.ts` 登记表挂钩、索引/链接/生成区块守护——没有别的执行路径会报警）；**结构复检删**（`test/e2e-structure.test.ts` 整文件删除——仓库形状由编排器每次隔离运行 + 发现器 fail-fast 证明，离线复检是第二份会漂移的口径）。
6. unit 测试文档去列举化：每 Feature 的 README+cases 两页（逐场景表格）合并成单篇 `unit/<feature>.md`（观察面 / Fixture 规范 / 覆盖规范 / 反模式）——docs 只写体系与规范，**具体场景由测试代码枚举、测试名就是场景清单**。登记单位从「场景行」上升为「覆盖类别」（registry.md 重写为覆盖登记），`// cases:` 头注与守护改指单篇文档。

**曾选方案 / 否决理由**

- e2e 两 collection（repos/mechanism）：否决——「mechanism」不表意，用户要求目录名直接等于域名；单仓库域不需要再套一层 collection。
- 单元层保留 DOM「结构事实」断言（旧 reports 测试文档的划法）：否决——跟改率实测 `show.test.ts` 33 次变更 32 次是跟着 src 一起改，渲染断言在单元层就是变更税本体；渲染缺陷（无样式发货、滚动条裁字）在 DOM 断言全绿下照样逃逸过。
- wire fixture 归一测试：否决——fixture 是协议二手复制，只证明「与自己采的样本一致」，且保鲜义务与 SDK 升级绑定成持续维护税。代价（明知承担）：`undo/` 四个无官方工厂的 SDK 转换器在其 e2e 仓库落地前零覆盖。

**依据与后续**

跟改率度量方法落在 `docs/engineering/testing/churn.md`（git log --numstat 口径）；存量渲染/CLI 单元测试的迁移清单在 `plan/testing-layer-realignment.md`，头部热点即 churn 排行头部（show/view/report 四件套）。
