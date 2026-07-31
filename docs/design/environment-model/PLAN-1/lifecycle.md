# PLAN-1 Lifecycle:Environment 与 Provision

**本方案**:[README](README.md) · [Library](library.md) · [Architecture](architecture.md) ·
[Use Case](use-case/README.md)

**决策主题**:[CASES](../CASES.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md)

本篇只把 PLAN-1 已有协议放进一条时间线。
Environment、Provision、Agent 安装、状态 Hook 与 Fixture 仍是五个不同生命周期,不会改写成后续方案的 Requirement 或 Base Case 模型。

## Owner

| Owner | 拥有什么 | 不拥有什么 |
|---|---|---|
| Eval | 一个可选 Environment;Eval setup 与 Fixture | Provision、Sandbox Provider、Agent CLI |
| Experiment | Sandbox 配置;有序 `provisions` 数组 | Eval Environment;与实验条件绑定的独立 Base |
| Agent | Adapter 持有 Agent CLI 的平台探测、准备、安装、复检、鉴权与配置 | Experiment Provision |

SandboxSpec / Provider 负责默认起点、Environment 解析、BuildKey 构建以及 Running Environment 启停与 ready,但不是第四个条件 owner。
Sandbox Hook 承载每个 Sandbox 或复用窗口的外部状态,Fixture 承载每 Attempt 的 workdir 输入;两者也都不是安装 owner。

Experiment 的普通 sandbox 起点不是第二套实验 Environment。
PLAN-1 没有“条件基底”概念,也不允许 Eval 只贡献可移植安装条件:Eval 侧固定为 Environment,Experiment 侧固定为 Provision。

## 选择运行起点

PLAN-1 只有一条 Environment 解析链。
Provision 和 AgentProvisioner 都不参与起点选择:

```text
Eval 是否声明 environment?
├─ 否
│  └─ 使用 SandboxConfig 的普通默认起点
└─ 是
   ├─ profile 或 folder-local profile 命中 environments[profile]
   │  └─ 使用该预制 image / template / snapshot
   └─ 未命中覆盖
      ├─ Provider 支持该 Environment kind
      │  └─ Provider 解析 folder-local Environment
      └─ Provider 不支持
         └─ 该 Eval 计划期 skipped

起点 ready
└─ 按 Experiment provisions 顺序 Ensure
   └─ Adapter 独立 Ensure Agent
```

`environments[profile]` 是同一 Eval Environment 的预制替代实现。
它不表示“Eval Base + Experiment Base”的融合,也不证明预制产物兑现了两份独立 Requirement。

## Build、Start、Install 与 Fixture

```text
Run 规划
  → 解析 Eval Environment 与 Provider
  → 按 BuildKey 协调所需构建

每个 fresh Sandbox 或复用窗口
  → create Running Environment
  → 等待 workspace service 与伴随服务 ready

每条 Attempt
  → 按数组顺序 inspect Provision
  → 对 miss 项懒 prepare / install / re-inspect
  → 发生过 install 时重新 inspect 整组 Provision
  → Adapter check / prepare / install / recheck Agent CLI

每个 Sandbox 或复用窗口
  → Sandbox setup 状态 Hook

每条 Attempt
  → 建立或恢复 workdir baseline
  → Agent 鉴权、配置与 MCP 注册
  → turn 前 Eval setup 与 Fixture
  → 完成所有 Agent turn
  → 挂载 turn 后 verifier / criteria
  → 评分并清理 verifier
  → Eval / Agent teardown

每个 fresh Sandbox 或复用窗口收尾
  → Sandbox teardown 状态 Hook
  → stop Running Environment
```

四类动作不能互换:

| 动作 | PLAN-1 含义 | 身份或复用 |
|---|---|---|
| build | 把 Dockerfile、Compose build context 等变成 Provider 构建产物 | BuildKey,Run 级 single-flight;Provider cache 可跨 Run 命中 |
| start | 从已解析 Environment 创建完整 Running Environment 并等待 ready | EnvironmentKey 分组;默认每 Attempt 新实例 |
| install | Provision 或 Adapter 在已启动的主 Sandbox 中收敛安装状态 | Provision 与 Agent 各有 identity 和检查协议 |
| Fixture | baseline 后写 turn 前材料,最后一次 turn 后才挂载隐藏 verifier | 每 Attempt 重建;本方案沿用 `test(t)` 内作者自管 verifier,不归安装 |

Provision 只能写 workdir 外的系统路径、用户 home 或受管 cache。
Dockerfile `RUN` 属于 Environment build,不是 Provision install;Fixture 也不能伪装成 Provision。

PLAN-1 只在 Provision 安装后复检 Provision 全组。
Adapter 安装、状态载入或 Fixture 若破坏 Environment 或已通过的 Provision,没有跨 Owner 最终验证屏障再次发现。

turn 后 verifier 仍由 Eval 作者在 `test(t)` 内自行挂载和 cleanup。
Runner 没有独立的 materialization handle、cleanup 注册或活动,因此不能强制清理 workdir 外路径、mount 与进程,也不能据此自动退休复用窗口。

## Fresh 与 Reuse

| 生命周期节点 | 默认 fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Environment 解析与 BuildKey 构建 | Run 级共享 | Run 级共享 |
| Running Environment create / ready | 每 Attempt | 每复用窗口 |
| Provision inspect | 每 Attempt | 每 Attempt |
| Provision prepare | 首个同 identity + 平台的 miss;Run 内共享 | 相同 |
| Provision install / re-inspect | 每个 miss | 每个 miss |
| Provision 全组复检 | 本 Attempt 发生过 install 时 | 本 Attempt 发生过 install 时 |
| Agent CLI Ensure | 每 Attempt | 每 Attempt重新 check,命中可跳过 install |
| Sandbox setup / teardown 状态 Hook | 每 Attempt各一次 | 每复用窗口各一次 |
| baseline / reset、前置 Fixture、Agent turn、作者自管隐藏 verifier 与评分 | 每 Attempt | 每 Attempt |
| Eval / Agent teardown | 每 Attempt | 每 Attempt |
| Running Environment stop | 每 Attempt末尾 | 复用窗口末尾 |

复用只允许发生在同一 EnvironmentKey 分组内。
它会保留 workdir 外的 `$HOME`、`/tmp`、全局安装、后台进程与状态 Hook 载入的活状态;因此只能由实验显式开启,不能由 Provision 安装慢自动推出。

每条复用 Attempt 仍重新 inspect Provision 和 Agent。
不过 PLAN-1 没有在 Agent Ensure 与状态载入之后重验 Environment 和 Provision,所以这项共同验收缺口在复用模式下仍然存在。

## Case 选择图

场景输入与验收条件以根 [CASES](../CASES.md) 为准。
下表只说明 PLAN-1 实际选择什么 Environment,以及后续走哪条本方案路径。
`△` 表示执行路径存在但至少缺一条共同验收,`∅` 表示本方案没有声明入口。

| Case | 状态 | 选中的 Environment / template | 后续生命周期与缺口 |
|---|---|---|---|
| [C1](../CASES.md#c1评估环境较重) | △ | Eval folder-local Environment,或命中的 `environments[profile]` | Provider 兑现完整 Environment;Agent Ensure 后不重验 Environment |
| [C2](../CASES.md#c2实验环境较重) | △ | SandboxConfig 普通默认起点 | 顺序 Ensure Provision 和 Agent;缺跨 Owner 最终屏障 |
| [C3](../CASES.md#c3评估与实验环境都较重) | △ | Eval Environment | staged Provision 在题目主 Sandbox 中 Ensure,无需 template 矩阵;Agent 后不重验前置条件 |
| [C4](../CASES.md#c4组合多个条件) | △ | Eval Environment 或普通默认起点 | Provision 按数组顺序执行;没有依赖 DAG、资源锁或 Agent 跨图屏障 |
| [C5](../CASES.md#c5预装稳定条件) | △ | 预装默认起点,或 `environments[profile]` 覆盖 | Provision inspect 可命中或补装;仍没有跨 Owner 最终验证 |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | △ | 每 Attempt 使用新的默认起点或 Eval Environment | Provision 与 Agent 就位后 load,收尾 save;状态载入后不重验三方条件 |
| [C7](../CASES.md#c7复用-sandbox-活状态) | △ | 每复用窗口一个同 EnvironmentKey 的 Running Environment | 每 Attempt 重查 Provision / Agent;窗口边界 load / save;缺最终屏障 |
| [C8](../CASES.md#c8experiment-提供条件基底) | ∅ | 只能选择普通默认起点 | Eval 没有只声明可移植条件的入口 |
| [C9](../CASES.md#c9双方都有不可叠加基底) | ∅ | `environments[profile]` 最多替换 Eval Environment | 没有两份条件集合或融合 case 的选择与分别验证 |
| [C10](../CASES.md#c10混合批次) | △ | 有 Environment 的 Eval 选自身;无 Environment 的 Eval 选普通默认起点 | 普通默认起点会让位,但没有 Experiment 条件基底与融合分支 |
