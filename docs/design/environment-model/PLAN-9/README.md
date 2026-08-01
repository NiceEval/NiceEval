# PLAN-9:单一 Sandbox Recipe 与 template owner 顺序（推荐）

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 结论

作者侧不再区分 Environment 与 SandboxConfig。
Eval 与 Experiment 都声明“在同一个 Sandbox 上盖什么”：具体 recipe factory 可选声明 template 输入，共享协议把同一种 SandboxCommand 放进两个显式 scope。`setup` / `teardown` 随 Sandbox Case 或复用窗口执行，`beforeEach` / `afterEach` 随 Attempt 执行。

每条 Attempt 恰好激活一个 template。template owner 在两个 scope 中都排在另一个 owner 前面，收尾则按相反顺序执行。

```text
one active Sandbox template
  -> Provider builds / starts one Sandbox Case
  -> window scope: template owner setup -> other owner setup
  -> establish reset anchor
  -> each Attempt:
       reset -> template owner beforeEach -> other owner beforeEach
       -> workspace baseline -> Agent -> test(t)
       -> other owner afterEach -> template owner afterEach
  -> window scope: other owner teardown -> template owner teardown
  -> Provider Case finalizer
```

Terminal-Bench 由 Eval 提供 template：

```text
Eval Compose template
  -> Eval setup
  -> Experiment setup
  -> reset anchor
  -> Eval beforeEach
  -> Experiment beforeEach
  -> Agent
```

MemoryBench 由 Experiment 提供 template：

```text
Experiment E2B template
  -> Experiment setup
  -> Eval setup
  -> reset anchor
  -> Experiment beforeEach
  -> Eval beforeEach
  -> Agent
```

## 只保留一个必要区分

作者声明与运行资源不能使用同一个类型。
`SandboxRecipe` 是可签入、可组合的 command stack 声明；`Sandbox` 是启动后执行命令和文件操作的句柄。

PLAN-9 删除的是 Environment / SandboxConfig 两套作者概念，不是规划值与运行值的类型边界。
Provider 仍把一个 template 解析成完整 Sandbox Case，Compose 仍保留 service、网络、volume、ready 与整组清理。

## Recipe 形状

Eval 与 Experiment 都使用 `sandbox` 字段：

```typescript
interface SandboxRecipe<Self = SandboxRecipe> {
  setup(command: SandboxCommand): Self;
  teardown(command: SandboxCommand): Self;
  beforeEach(command: SandboxCommand): Self;
  afterEach(command: SandboxCommand): Self;
}
```

四个方法使用同一种 SandboxCommand，只显式选择生命周期频次：

- `.setup()` / `.teardown()` 属于 Window scope。fresh 时随唯一 Case 各执行一次；复用时随窗口各执行一次。
- `.beforeEach()` / `.afterEach()` 属于 Attempt scope。无论 fresh 或复用，每条 Attempt 都执行。

共享协议只统一 command stack，不公开一个同形的 `template` 属性。
template 由具体 factory 的 options 声明。
`composeSandbox()` / `dockerfileSandbox()` / `profileSandbox()` 声明 Eval 起点；`dockerSandbox()` / `e2bSandbox()` / `vercelSandbox()` 声明 Provider 与 fallback。Runner 再把这些输入归一成内部 SandboxTemplate。

这避免要求 `e2bSandbox({ template: string })` 的原生参数符合 `SandboxRecipe.template?: SandboxTemplate`，也避免作者绕过 factory 手写一个看似通用、实际缺少 Provider 语义的 template 对象。
Eval recipe 不能选择 Provider；Agent 的 stack contribution 由 Adapter 内部提供，不进入普通作者配置，也不伪装成 SandboxRecipe。

同一个具体 factory 产物可以同时声明 template 输入和两种 scope 的 command。
“谁有 template 谁先”不表示 template owner 没有运行时检查；预装工具、真实版本、PATH 与权限仍需 command 验证。

layer 只是 command 在 stack 里的位置和归属，不是另一种执行原语，因此 PLAN-9 不公开 Layer 对象或 DSL。
普通 command 最终只能调用运行中 Sandbox 的 `runCommand` / `runShell` 与文件 API；它不是 image layer，不产生新 template，也不能创建第二个 Sandbox。

## 作者面

Terminal-Bench Eval：

```typescript
import { composeSandbox } from "niceeval/sandbox";

export default defineEval({
  sandbox: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

Terminal-Bench Experiment：

```typescript
export default defineExperiment({
  sandbox: dockerSandbox().setup(ensureGitForLedger),
});
```

MemoryBench Eval：

```typescript
export default defineEval({
  sandbox: defineSandboxRecipe().beforeEach(checkoutLockedRepository),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

MemoryBench Experiment：

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .setup(mempalSetup({ version: "0.9.0" }))
    .teardown(mempalTeardown),
});
```

四个调用点都声明 Sandbox recipe，不出现 `environment` 字段、EnvironmentSource、defaultEnvironment 或 materializer 注册表。

## Template 不是单实例产物同义词

SandboxTemplate 是“启动完整 Case 的唯一 recipe”，不是 Docker image 或 E2B template 的公共最小结构。
它是穷尽联合：Compose template 可以描述完整资源组，Dockerfile template 可以触发构建，Provider-native template 可以引用 image、E2B template 或 snapshot。

这些 template 只共享“解析成一个 Sandbox Case”的结果，不要求结构同构，也不能互相合并。

## 顺序约束

Window scope 与 Attempt scope 分别使用同一 ownerOrder。
template owner 的 setup 必须只依赖自己的 template 已经兑现的能力；另一个 owner 的 setup 可以依赖前面 owner 的结果。
进入 Attempt scope 时，两方 setup 都已完成。template owner 的 beforeEach 不能依赖另一个 owner 尚未执行的 beforeEach，后一个 owner 则可以依赖前一个 owner 的本次准备。

若 Eval template owner 的 setup 需要 Experiment setup 先存在，说明两者不是可按该顺序叠加的独立 recipe。
项目必须把依赖放进完整预制 template，或明确该组合不支持，Runner 不引入依赖 DAG 猜顺序。

## Sandbox 复用

开启 `sandboxReuse` 时，Provider Case 与两方 setup/teardown 都是每窗口一次。
Runner 在两方 setup 完成后建立 reset anchor；每条 Attempt 先恢复到该 anchor，再按 ownerOrder 执行两方 beforeEach。Agent diff 的 workspace baseline 在 beforeEach 全部完成后建立。

因此 mempal 安装与检查可以留在 Experiment `.setup()`，不会因复用而重复；checkout、依赖和 Fixture 放在 Eval `.beforeEach()`，每条 Attempt 都从相同窗口起点重新准备。
ready、日志、伴随 service 与 finalizer 继续归 Provider Case。

## 代价

- `sandbox` 在定义里表示 SandboxRecipe，在回调里表示运行中的 Sandbox；类型名必须保留差异。
- 两种 scope 的 owner 相对顺序都随 active template owner 改变；`--dry` 必须逐 Eval 展示解析后的 owner stack 与频次。
- 作者必须明确选择窗口级或 Attempt 级。放错 scope 会造成复用污染、重复安装或题目准备缺失。
- AgentProvisioner 仍保留 staged payload、平台探测与安装事实，不降格成通用 setup function。
- 双方不可叠加的 template 仍需完整 profile 覆盖，Runner 不做镜像或拓扑合并。
