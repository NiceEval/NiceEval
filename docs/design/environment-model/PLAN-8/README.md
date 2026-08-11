# PLAN-8:唯一 Environment 与三层 Sandbox 准备（被 PLAN-9 取代）

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 方案摘要

每条 Attempt 先选择唯一 Environment，再由当前 Provider 把它规划成一个完整 Sandbox 实例。
Case 启动后，Experiment、Eval 与 Agent 按固定顺序准备同一个主 Sandbox。

```text
Eval Environment，或 SandboxConfig defaultEnvironment
  -> Provider 解析一个完整 Sandbox Case
  -> build / start / ready
  -> Experiment sandbox setup
  -> Eval setup
  -> Agent setup
  -> test(t)
```

这是一条分相位的层化管线，不是一套通用 `Layer` 协议。
Environment 决定启动前的拓扑与起点；三个 setup owner 只能在启动后的主 Sandbox 上操作。

## 对“只有一个 template”的修正

统一不变量不是“只有一个 template”，而是“只选择一个 Environment，并规划一个 Sandbox 实例”。
image、E2B template 与 snapshot 是单实例 Provider 的构建输出；Compose Case 还包含 service、网络、volume、ready 与整组销毁。

因此不能把 Compose 压成 template，也不能让普通 setup 新增 sidecar 或改写 service、网络与 volume 的拓扑。
Experiment 确实需要改变拓扑时，应提供该 profile 的完整预制 Case，而不是在运行中的主 Sandbox 上伪装合并。

## 起点与 owner 正交

“只选一个起点”不表示“提供起点的 owner 不再有 setup”。
Eval 可以同时声明 Compose Environment 与 Eval setup；Experiment 也可以同时声明 `defaultEnvironment` 与 sandbox setup。

三层准备始终存在，只是每层可以为空：

| Owner | 可以声明什么 | 不可以声明什么 |
|---|---|---|
| Eval | 可选 Environment、Eval setup、Fixture 与测试 | Provider、第二个起点 |
| Experiment | SandboxConfig、sandbox setup / teardown | 替换已有 Eval Environment 的普通默认起点 |
| Agent | Agent Ensure、鉴权、配置与 turn | Environment 或 Sandbox 实例 |

## 作者面

```typescript
import { defineEval } from "niceeval";
import { composeEnvironment } from "niceeval/environment";

export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

```typescript
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineExperiment({
  sandbox: dockerSandbox().setup(ensureGitForLedger),
});
```

普通 Experiment 不导入或注册 Compose materializer。
Docker Provider 对 Compose Environment 的支持属于 Provider 自己，支持声明与实现不能在两个调用点分离。

## 相对 PLAN-7 的改变

PLAN-8 保留 PLAN-7 的唯一 Case、三层 setup、普通文件传输与动态依赖内核，只重做公开语义边界：

- `composeSandbox()` 政名为 `composeEnvironment()`。
- `dockerSandbox()` 政名为 `dockerfileEnvironment()`。
- `SandboxSource` 政名为 `EnvironmentSource`。
- `SandboxSpec` 作为公开配置类型改名为 `SandboxConfig`；运行中的 `Sandbox` 名字不变。
- Docker Provider 内建 Compose Environment 支持，普通调用面没有 `dockerComposeMaterializer()`。
- image、template 或 snapshot fallback 进入 `defaultEnvironment`，明确它只在 Eval 没有 Environment 时使用。
- `mainService` 政名为 `workspaceService`，表达 Agent、文件 API、命令与 diff 的共同执行空间。

niceeval 仍处于 beta，本方案不保留旧名字的兼容别名。

## 代价

setup 是对运行中主 Sandbox 的命令与文件操作，不自动生成新的 image、template、snapshot 或 Compose Case。
昂贵且稳定的条件仍应在运行前预制；无法现场安装的组合仍需要 `environments[profile]` 提供完整 Case。

本方案也不引入通用 Requirement、Layer、依赖 DAG、资源锁或自动并行。
setup 顺序与 owner 生命周期保持显式，AgentProvisioner 继续保留 staged payload 与目标平台等专有义务。
