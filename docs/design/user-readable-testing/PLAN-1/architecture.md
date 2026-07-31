# 方案 1：Architecture

**相关文档**：[README](README.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 边界

本方案只增加两个测试基础设施能力：

1. 静态 Behavior 身份与派生 Registry；
2. 每种媒介独立的语义 parser / matcher。

它不改变产品运行时，不新增执行层，也不接管 E2E 仓库的候选包注入与真实适配器配置。

## 组件关系

```text
Feature 契约链接 ─┐
                  ├─▶ Registry guard ─▶ 派生行为索引
测试静态元数据 ──┘

fixture / 真实 E2E ─▶ 命名 evidence ─▶ 媒介 parser ─▶ matcher ─▶ 诊断
测试独立预期 ────────────────────────────────────────┘
```

## Behavior 声明

`behavior(meta)` 是 Vitest 与 Effect 测试入口的薄封装：

- `.it` 委托给 Vitest `it`；
- `.effect` 委托给 Effect 测试执行器；
- 元数据必须是静态字面量；
- 原生标题带稳定 Behavior ID，`-t` 仍能筛选单个测试；
- wrapper 不创建 fixture、clock、browser 或 model。

Behavior ID 描述稳定用户结果，不编码测试文件、执行层或媒介。
例如使用 `reports.filter.by-experiment`，不使用 `browser.case-17`。
只有主证明调用 `behavior()`；`supportingProof()` 与 `boundaryProof()` 各自声明唯一 Proof ID，并引用已有 Behavior。

## Registry Guard

守护读取：

- `src/**/*.test.ts` 与 `test/**/*.test.ts` 中的 Behavior / Proof 元数据；
- 各 `e2e/` 仓库中的同形声明；
- 元数据引用的 Feature 契约和 bug；
- 迁移期保留的 `// cases:`。

守护只验证身份与连接关系。
它不复制标题、前置和期望，也不把派生索引签入为产品文档。

每个 E2E 仓库签入自己的 wrapper 与 matcher。
根 Registry 只能只读扫描共同元数据，不能成为该仓库 `pnpm e2e` 的依赖，也不能注入共享测试语义。
各仓生成只含声明与引用的本地 Manifest；独立 checkout 只校验本仓，完整 checkout 再聚合解析跨仓引用与必需边界。

## Evidence 所有权

unit evidence 来自可区分 fixture、受控 clock、barrier 与 fake boundary。
fake 可以证明确定性转换，但不能成为外部协议兼容性的唯一证据。

E2E evidence 来自真实候选包、CLI、SDK、provider、外部 cwd 或浏览器。
一次真实运行供多个读面使用时，所有写操作先在 prepare 完成，再把结果发布为命名且不可变的 world。

需要迁移、修复或追加记录的场景使用独立派生 world。
断言阶段不能原地修改共享根。

## 媒介适配器

| 适配器 | 输入 | 只解释什么 |
|---|---|---|
| JSON | 公开机器出口 | schema、字段、身份与结果语义 |
| JUnit | 公开 XML | suite、case、failure 与 error |
| plain stdout | 非 TTY 捕获 | 承诺的文字、顺序与无框结构 |
| PTY | 显式 screen capture | 宽度、折行、降级与显示宽度 |
| HTML | 导出文件 | 稳定语义和可访问结构 |
| browser | 真实页面 | role、accessible name、交互与可见状态 |

plain stdout 不能靠框线字符推断 section。
PTY parser 也不能替代 JSON 读取精确身份。

适配器不得复用候选代码的 renderer、schema normalizer 或私有 parser。
否则实现与测试可能一起产生同一个错误。

## 数据流

1. 主证明声明 Behavior ID、契约链接、观察面与必需边界。
2. 其它 proof 用独立 Proof ID 引用该 Behavior。
3. 各仓 docs guard 生成本地 Manifest，根 guard 聚合全局 Registry。
4. fixture 或真实系统生成 evidence。
5. 媒介 parser 产出该媒介的最小语义模型。
6. matcher 用测试侧独立预期和具体对象身份断言结果。
7. 失败消息带回 Behavior ID、媒介、阶段、身份和 evidence 位置。

## 不变量

- 每个 Behavior 恰有一个主证明。
- 每个声明为必需的边界 proof 都存在；supporting proof 不能替代它。
- Parser 只读取事实，不计算产品应得结果。
- 标题声称的具体对象必须在 matcher 中以身份出现。
- E2E prepare 是普通验收前最后一个可写阶段。
- unit 与 E2E 不共享 setup、时钟、清理或协议模拟语义。

## 生命周期与错误

Registry 失败表示契约与证明关系不完整，测试主体不执行。
Parser 失败表示 evidence 不符合声明媒介；Matcher 失败表示 evidence 合法，但用户结果不符合预期。

Producer 没有产生可判断 evidence 时，测试必须报告 prepare 或 invocation 失败。
它不能退回更宽松的字符串包含，也不能把缺失结果解释成用户行为失败。

## 变化预算

- 内部重构只影响机制测试时，不应改 Behavior 元数据和主证明。
- renderer 表示变化只影响对应媒介 adapter。
- 用户行为变化时，先改 Feature 契约，再更新同一个 Behavior 的主证明。
- 外部协议变化必须由真实 E2E 暴露，不能只更新本地 fixture 令测试重新变绿。
