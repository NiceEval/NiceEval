# PLAN-9:单一 Sandbox Recipe 与 template owner 顺序（推荐）

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 结论

作者侧不再区分 Environment 与 SandboxConfig。
Eval 与 Experiment 都声明“在同一个 Sandbox 上盖什么”：recipe 可选带 template，其 setup hooks 就是顺序 layer。每条 Attempt 恰好激活一个 template，template owner 的 layer 先执行，另一个 owner 和 Agent 再依次叠加。

```text
one active Sandbox template
  -> Provider builds / starts one Sandbox Case
  -> template owner setup
  -> other owner setup
  -> Agent Ensure and setup
  -> test(t) uses the same primary Sandbox
```

Terminal-Bench 由 Eval 提供 template：

```text
Eval Compose template
  -> Eval setup
  -> Experiment setup
  -> Agent setup
```

MemoryBench 由 Experiment 提供 template：

```text
Experiment E2B template
  -> Experiment setup
  -> Eval setup
  -> Agent setup
```

## 只保留一个必要区分

作者声明与运行资源不能使用同一个类型。
`SandboxRecipe` 是可签入、可组合的声明；`Sandbox` 是启动后执行命令和文件操作的句柄。

PLAN-9 删除的是 Environment / SandboxConfig 两套作者概念，不是规划值与运行值的类型边界。
Provider 仍把一个 template 解析成完整 Sandbox Case，Compose 仍保留 service、网络、volume、ready 与整组清理。

## Recipe 形状

Eval 与 Experiment 都使用 `sandbox` 字段：

```typescript
interface SandboxRecipe {
  readonly template?: SandboxTemplate;
  readonly setupHooks?: readonly SandboxSetup[];
  readonly teardownHooks?: readonly SandboxTeardown[];
}
```

Experiment recipe 额外选择 Provider，并可提供 profile 覆盖与 fallback template。
Eval recipe 不能选择 Provider；Agent 的 stack contribution 由 Adapter 内部提供，不进入普通作者配置，也不伪装成 SandboxRecipe。

owner 可以同时提供 template 与 setup。
“谁有 template 谁先”不表示 template owner 没有运行时检查；预装工具、真实版本、PATH 与权限仍需 setup helper 验证。
这里的 layer 不是 image layer，也不产生新 template；它只能通过运行中的 Sandbox 手动执行命令、上传文件并检查结果。

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
  sandbox: defineSandboxRecipe().setup(checkoutLockedRepository),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

MemoryBench Experiment：

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .setup(mempalSetup({ version: "0.9.0" })),
});
```

四个调用点都声明 Sandbox recipe，不出现 `environment` 字段、EnvironmentSource、defaultEnvironment 或 materializer 注册表。

## Template 不是单实例产物同义词

SandboxTemplate 是“启动完整 Case 的唯一 recipe”，不是 Docker image 或 E2B template 的公共最小结构。
它是穷尽联合：Compose template 可以描述完整资源组，Dockerfile template 可以触发构建，Provider-native template 可以引用 image、E2B template 或 snapshot。

这些 template 只共享“解析成一个 Sandbox Case”的结果，不要求结构同构，也不能互相合并。

## 顺序约束

template owner 的 setup 必须只依赖自己的 template 已经兑现的能力。
另一个 owner 可以依赖前面 owner 的结果，反向依赖不成立。

若 Eval template 的 setup 需要 Experiment 条件先存在，说明两者不是可按该顺序叠加的独立 recipe。
项目必须把依赖放进完整预制 template，或明确该组合不支持，Runner 不引入依赖 DAG 猜顺序。

## Sandbox 复用

Eval 与 Experiment recipe setup 都是逐 Attempt 层。
开启 `sandboxReuse` 时，Provider Case 每窗口只启动一次；每次 reset 后仍按当前 template owner 顺序重跑两条 recipe setup，再运行 Agent setup。

这避免首条 Attempt 是“Eval → Experiment”，后续 Attempt 却因 Experiment hook 已经跑过而变成“Experiment → Eval”的顺序漂移。
真正绑定资源组寿命的 ready、日志、伴随 service 与 finalizer 归 Provider Case，不放普通 recipe setup。

## 代价

- `sandbox` 在定义里表示 SandboxRecipe，在回调里表示运行中的 Sandbox；类型名必须保留差异。
- setup 相对顺序随 active template owner 改变，`--dry` 必须逐 Eval 展示解析后的 owner stack。
- 所有普通 recipe setup 每 Attempt 重跑；昂贵安装必须使用可检查 helper 或预制 template。
- AgentProvisioner 仍保留 staged payload、平台探测与安装事实，不降格成通用 setup function。
- 双方不可叠加的 template 仍需完整 profile 覆盖，Runner 不做镜像或拓扑合并。
