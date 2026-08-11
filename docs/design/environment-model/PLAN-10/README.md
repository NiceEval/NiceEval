# PLAN-10：统一 Sandbox Layer、固定 root-first 顺序与逐配对 root（推荐）

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md)

**方案正文**：[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 总纲

Eval、Experiment 与 Sandbox Agent 都向同一个主 Sandbox 贡献一层准备。
Eval 与 Experiment 使用完全相同的公开 `sandbox` 字段和 `SandboxLayer` 类型；Adapter 内部也拥有 Agent layer，但不能提供 template。

对每个实际选中的 `Eval × Experiment` 配对：

- 恰好一个 Eval / Experiment layer 是 root layer；
- root layer 由 `dockerComposeSandbox()`、`dockerSandbox()`、`e2bSandbox()`、`vercelSandbox()` 或自定义 root factory 构造；
- 另一方是 extension layer，只能在已经启动的主 Sandbox 中执行命令；
- Agent layer 始终是 extension，并且始终排在两方作者 layer 之后；
- root layer 总是先执行，另一方随后，Agent 最后；作者不能配置 priority、`dependsOn` 或另一套顺序。

```text
one linked pair
  = one root layer
  + one author extension layer
  + one Agent layer

prepare order
  = root owner -> other author owner -> Agent
```

template 的唯一性是 **pair-local**，不是整个 Run 只能出现一个 template。
同一 Experiment 可以选中分别使用 Compose、E2B 与 Docker image 的多个 Eval；Runner 为矩阵中的每个合法单元分别得到一个 root，再按物理 identity 共享 build 或分配 Case。

## 作者只学三个规则

1. `dockerComposeSandbox()` / `e2bSandbox()` 等具体 factory 声明 root；`sandboxLayer()` 只声明命令。
2. 一个配对只能有一个 root。两边都有是 conflict，两边都没有是 missing。
3. root 的命令先执行，另一方的命令后执行，Agent 安装最后执行；同一 layer 内按书写顺序执行。

PLAN-10 不把 Window / Attempt 两套普通 hook 暴露给作者。
`SandboxLayer.prepare()` 每条 Attempt 都执行；开启 Sandbox 复用后也先 reset，再重新执行完整准备链。
预装或昂贵工具由 prepare command 检查实际版本，命中后快速返回；缺失时安装并复检。这样作者不必判断一条准备应该放 `setup` 还是 `beforeEach`，也不会因为放错 scope 造成复用污染。

绑定 Sandbox 实例寿命的 service、ready、日志、volume、主 Sandbox 及伴随资源的 finalizer 与 retain/resume 仍由 Provider Case 管理。
跨 Attempt 外部状态仍由 State Feature 管理，不伪装成 Layer command。

## Layer 不是旧的通用安装协议

`SandboxLayer` 是顺序和 owner 的容器，不要求所有内容降格成同一种弱 `identity + install` 接口。

- Eval 与 Experiment 添加的是 `SandboxCommand`，只能使用主 Sandbox 的窄命令与文件 API。
- Agent Adapter 添加的是 `AgentProvisioner`。它仍保留宿主侧 payload prepare、目标平台探测、inspect / install / reinspect、安装模式、鉴权边界与安装事实。
- Runner 把二者放进同一条确定的准备时间线，但不把 AgentProvisioner 伪装成普通 command。

这与旧的“统一 Layer 安装池”不同：PLAN-10 保留完整的 Compose 主 Sandbox 实例及伴随资源、Provider 能力句柄、Agent staged payload 与真实复检，只统一作者看到的层和执行顺序。

`Sandbox Layer` 是逻辑生命周期层，不是 Docker image layer、OverlayFS layer 或可以单独构建的镜像增量。
普通 layer 不能创建第二个 Sandbox、替换 root、增加 sidecar 或停止 Case。

## 作者面

Terminal-Bench 的 Eval 提供 root：

```typescript
export default defineEval({
  sandbox: dockerComposeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

Experiment 没有额外命令时省略 `sandbox`；Runner 把它规范化为空 extension layer：

```typescript
export default defineExperiment({
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

MemoryBench 的 Experiment 提供 root，Eval 只准备题目：

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .prepare(mempalEnsure({ version: "0.9.0" })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: sandboxLayer().prepare(checkoutLockedRepository),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

归一后的顺序是：

```text
Experiment E2B root
  -> Experiment mempal ensure command
  -> Eval checkout command
  -> Adapter AgentProvisioner
  -> Agent runtime
```

## 为什么强制顺序

不强制顺序会把三件事重新交给作者：谁先执行、哪些命令能并行、失败后怎样逆序 cleanup。
自动从 shell、文件路径或 Provider 名推导依赖也不可靠。

PLAN-10 因而只有一个规则：root-first、other-second、Agent-last。
同一 layer 内就是源码顺序；cleanup 与运行时 teardown 按相反顺序。

依赖必须沿这个方向：

- root layer 只能依赖自己声明的 template 已经提供的能力；
- extension layer 可以依赖 root layer 的结果；
- AgentProvisioner 可以依赖两方作者准备；
- 任意反向依赖都不是调度提示，而是该配对不可组合。

不可组合时，作者必须移动命令所有权、拆分 Eval / Experiment selector，或让唯一 root factory 指向已经融合条件的完整 Case。Runner 不加入优先级、DAG 或第二 root 替换表。

## 多个 template 怎样存在

一次 Run 可以有任意多个 root template，只要每个实际 pair 恰好归一一个：

```text
Experiment X（extension-only）
  × Eval A（Compose root） -> Compose root A
  × Eval B（E2B root）    -> E2B root B
  × Eval C（image root）  -> image root C
```

反向也成立：同一个 command-only Eval 可以被多个 Experiment 分别放进不同 root：

```text
Eval Q（extension-only）
  × Experiment CPU（Docker root） -> Docker root
  × Experiment GPU（E2B root）    -> E2B root
```

若某个矩阵单元两边都有 root，该单元是结构冲突；相同 template identity 也不能去重，因为 owner 不同会改变命令顺序和归因。
若一个 root factory 根据目标平台选用不同 image digest 或 snapshot，那是同一个逻辑 root 的物理 variant，由 Provider planner 在 fingerprint 前确定，不算多个逻辑 root。

一个 Attempt 需要多个 service 时使用一个 Compose root 规划成完整 Sandbox 实例；“一个 root”从来不等于“一个容器实例”。

## 相对 PLAN-9 改了什么

| 问题 | PLAN-9 | PLAN-10 |
|---|---|---|
| 作者声明名 | SandboxRecipe | SandboxLayer |
| 普通命令频次 | Window 与 Attempt 两套 scope | 只有逐 Attempt `prepare()` |
| Eval / Experiment | 同一个 Recipe 类型 | 同一个 Layer 类型 |
| Agent 安装 | 排在两方 recipe 之后的专用 phase | 作为 extension-only Agent layer 排进同一固定时间线，协议仍专用 |
| template 唯一性 | 每个 pair 恰好一份 | 每个 pair 恰好一个 root；明确允许 Run 内多个 root |
| 顺序 | template owner 决定两个 scope 的 ownerOrder | root layer、另一 author layer、Agent，只有一条顺序 |
| cleanup | 四个正反向 lifecycle 方法 | command 成功取得资源后就地注册 cleanup，全局 LIFO |

PLAN-10 的简化不是删除完整 Case 或 AgentProvisioner，而是删除普通作者最容易选错的 Window command scope。

## 代价

- 所有普通 layer command 都在每条 Attempt 重新执行。昂贵命令必须自己做真实检查；PLAN-10 用额外检查换取单一频次心智。
- 某项动作若只能严格执行一次且不能幂等，它不能作为普通 Layer；应归 Provider Case、State Feature 或其它拥有整个复用周期生命周期的领域组件。
- 固定顺序不表达反向依赖。需要反向依赖的组合必须重构 owner 或使用融合 root。
- Agent 与 Eval / Experiment 共用时间线，但不共用弱化后的执行协议；Runner 内部仍要调度 SandboxCommand 与 AgentProvisioner 两类节点。
- matrix 中只要存在 conflict / missing，整个 Run 在 Provider I/O 前失败；合法单元不会先偷偷创建资源。
