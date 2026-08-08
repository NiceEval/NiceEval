# PLAN-9:单一 Sandbox Recipe 与 template owner 顺序（被 PLAN-10 取代）

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 总纲

作者侧不再区分 Environment 与 SandboxConfig。
Eval 与 Experiment 都声明“在同一个 Sandbox 上盖什么”：具体 recipe factory 可选声明 template 输入，共享协议把同一种 SandboxCommand 放进两个显式 scope。`setup` / `teardown` 随 Sandbox 实例或复用周期执行，`beforeEach` / `afterEach` 随 Attempt 执行。

对 Sandbox Agent，每个实际选中的 Eval × Experiment 配对恰好只有一方声明 template。template 同时选择能兑现它的 Provider；两方都声明是冲突，两方都不声明是缺失，Runner 必须在创建任何资源前一次列全。
link 成功后，每条 Attempt 恰好激活一个 template。template owner 在两个 scope 中都排在另一个 owner 前面，收尾则按相反顺序执行。

```text
all-pair link -> one active Sandbox template
  -> read-only physical planning / Provider network
  -> fingerprint
  -> Provider build / create one Sandbox Case
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
Provider 仍把一个 template 规划成完整 Sandbox 实例，Compose 仍保留 service、网络、volume、ready 与整组 cleanup。

## Recipe 形状

Eval 与 Experiment 都使用 `sandbox` 字段：

```typescript
declare const recipeKind: unique symbol; // 模块私有

interface SandboxRecipe<Kind extends "command-only" | "template-bearing"> {
  readonly [recipeKind]: Kind;
  setup(command: SandboxCommand<"setup">): SandboxRecipe<Kind>;
  teardown(command: SandboxCommand<"teardown">): SandboxRecipe<Kind>;
  beforeEach(command: SandboxCommand<"beforeEach">): SandboxRecipe<Kind>;
  afterEach(command: SandboxCommand<"afterEach">): SandboxRecipe<Kind>;
}
```

四个方法使用同一种 SandboxCommand 执行原语，同时把 phase 静态写进 context：

- `.setup()` / `.teardown()` 属于 Window scope。fresh 时随唯一 Sandbox 实例各执行一次；复用时随复用周期各执行一次。
- `.beforeEach()` / `.afterEach()` 属于 Attempt scope。无论 fresh 或复用，每条 Attempt 都执行。

Window context 没有 `attempt` 字段，Attempt context 的 `attempt` 必填。command 只取得没有 `stop()` 的 SandboxCommandTarget；其中 `runCommand` / `runShell` 非零默认失败，预期非零的探测才显式使用 `tryCommand` / `tryShell`。直接传入的 callback 一律 opaque；只有纯数据 `command()` / `shell()` 或显式登记 identity / revision / inputs 的 `defineSandboxCommand()` 能命中跨 Run carry。

共享协议只统一 command stack，不公开一个同形的 `template` 属性。
template 由具体 factory 的 options 声明。
`composeSandbox()` / `dockerfileSandbox()` / `dockerImageSandbox()` / `e2bSandbox()` / `vercelSandbox()` 都声明完整起点并同时选定 Provider。它们可以出现在 Eval 或 Experiment；所在字段决定 template owner。`defineSandboxRecipe()` 只声明 command stack，不声明起点。

这避免要求 `e2bSandbox({ template: string })` 的原生参数符合 `SandboxRecipe.template?: SandboxTemplate`，也避免作者绕过 factory 手写一个看似通用、实际缺少 Provider 语义的 template 对象。
Agent 的 stack contribution 由 Adapter 内部提供，不进入普通作者配置，也不伪装成 SandboxRecipe。Adapter 不能暗中提供 template 或 Provider；Agent 若要求特殊起点，必须由 Eval 或 Experiment 显式拥有并在 link 阶段校验兼容性。

同一个具体 factory 返回的定义值可以同时声明 template 输入和两种 scope 的 command。
“谁有 template 谁先”不表示 template owner 没有运行时检查；预装工具、真实版本、PATH 与权限仍需 command 验证。

layer 只是 command 在 stack 里的位置和归属，不是另一种执行原语，因此 PLAN-9 不公开 Layer 对象或 DSL。
普通 shell layer 可以直接写 `command(...)` / `shell(...)`，复杂逻辑才用 callback。它不是 image layer，不产生新 template，也不能创建、替换或停止 Sandbox 实例。

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
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

这里 Experiment 不选择 Docker 或 E2B。每条 Eval 的 template 自己选择 Provider，所以同一 Experiment 可以同时选中 Compose 多容器题与 E2B 单机题。NiceEval ledger 所需的 Git 属于 Runner 自身前置条件，Agent CLI 安装属于官方 Adapter；普通 Experiment 不重复安装两者。

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

Eval 与 Experiment 若需要 template 或 command，都只使用同一个可选 `sandbox` 字段；没有 contribution 就省略。调用面不出现 `environment`、EnvironmentSource、defaultEnvironment 或 materializer 注册表。

## Template 约束在何时失败

独立文件里的 Eval 与 Experiment、字符串或 predicate 形式的 `evals` 选择，以及 CLI filter 形成的最终配对，不可能由普通 TypeScript 编译单独看穿。PLAN-9 不用要求 Experiment 静态 import 每个 Eval 的巨型泛型伪造这种保证。

正确边界是 discovery 后、资源动作前的同步 link planning：

```text
加载定义与 config
  -> 解析每个 Experiment 实际选中的 Eval
  -> 穷举 Eval × Experiment template contribution
  -> 聚合 template conflict / missing / Agent 形状错误
  -> 只读 physical planning / Provider network
  -> fingerprint
  -> build / Sandbox create
```

正常运行和 `--dry` 必须先消费同一份 linked matrix，再进入同一个只读 physical planner。该 planner 可以读取 Provider 网络元数据，但不 build、不创建 Sandbox。
任一配对有 template 结构错误时，整个 Run 在 physical planning 前失败；不能只在创建到那条 Attempt 时才报错，也不能把 `--dry` 当成唯一检查入口。

`niceeval check <experiment>` 只执行 discovery、selector 与全矩阵 link，并在 linker 返回后立即结束。
它不调用 physical planner、不访问 Provider 网络，也不计算 fingerprint、build 或创建 Sandbox；它与正常运行、`--dry` 复用同一个 linker，不是另一套宽松校验。

TypeScript 仍负责单个声明内能静态确定的约束：factory option 的互斥形状必须合法，template-bearing recipe 只能由 factory 产生，command 链也不能再添加 template。Eval 与 Experiment 故意接受同一个 SandboxRecipe 类型；template 由哪一侧拥有只能在实际配对已知后检查。

## Template 不是单实例同义词

SandboxTemplate 是“选择 Provider 并启动完整 Case 的唯一 recipe”，不是 Docker image 或 E2B template 的公共最小结构。
它是穷尽联合：Compose template 可以描述完整的主 Sandbox 实例及伴随资源，Dockerfile template 可以触发构建，Provider-native template 可以引用 image、E2B template 或 snapshot。

这些 template 只共享“规划成一个 Sandbox 实例”的结果，不要求结构同构，也不能互相合并。

## 顺序约束

Window scope 与 Attempt scope 分别使用同一 ownerOrder。
template owner 的 setup 必须只依赖自己的 template 已经兑现的能力；另一个 owner 的 setup 可以依赖前面 owner 的结果。
进入 Attempt scope 时，两方 setup 都已完成。template owner 的 beforeEach 不能依赖另一个 owner 尚未执行的 beforeEach，后一个 owner 则可以依赖前一个 owner 的本次准备。

若 Eval template owner 的 setup 需要 Experiment setup 先存在，说明两者不是可按该顺序叠加的独立 recipe。
项目必须把依赖放进完整预制 template，或明确该组合不支持，Runner 不引入依赖 DAG 猜顺序。

## Sandbox 复用

开启 `sandboxReuse` 时，Provider Case 与两方 setup/teardown 都是每复用周期一次。
Runner 在两方 setup 完成后建立 reset anchor；每条 Attempt 先恢复到该 anchor，再按 ownerOrder 执行两方 beforeEach。Agent diff 的 workspace baseline 在 beforeEach 全部完成后建立。

因此 mempal 安装与检查可以留在 Experiment `.setup()`，不会因复用而重复；checkout、依赖和 Fixture 放在 Eval `.beforeEach()`，每条 Attempt 都从相同复用周期起点重新准备。
ready、日志、伴随 service 与 finalizer 继续归 Provider Case。

## 代价

- `sandbox` 在定义里表示 SandboxRecipe，在回调里表示运行中的 Sandbox；类型名必须保留差异。
- 两种 scope 的 owner 相对顺序都随 active template owner 改变；`--dry` 必须逐 Eval 展示确定的 owner stack 与频次。
- template 不具有静默 fallback 语义；混合批次中出现 1×1 或 0×0 配对时，作者必须拆分 Experiment 或让恰好一方提供 template。
- 作者必须明确选择 Window 级或 Attempt 级。放错 scope 会造成复用污染、重复安装或题目准备缺失。
- AgentProvisioner 仍保留 staged payload、平台探测与安装事实，不降格成通用 setup function。
- 一份 template 与另一方 command 无法现场组合时必须改用已经融合条件的完整 template，Runner 不做镜像或拓扑合并。
