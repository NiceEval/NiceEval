# PLAN-2 Lifecycle:单 template 与统一 Layer

**本方案**:[README](README.md) · [Library](library.md) · [Architecture](architecture.md) ·
[Use Cases](use-case/README.md)

**决策主题**:[CASES](../CASES.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md)

本篇只把 PLAN-2 的单 template 与统一 Layer 放进一条时间线。
这里的 template 不是后续方案的完整 Sandbox Case,Layer 也不是带依赖、资源和宿主侧 prepare 的 Requirement。

## Owner

| Owner | 拥有什么 | 在统一协议中丢失什么 |
|---|---|---|
| Eval | 可选 `environment`;可选 Eval Layer | 完整 Compose 资源组无法稳定归一成单 template |
| Experiment | 普通 template;Experiment Layer | template 与实验条件没有“条件基底”绑定关系 |
| Agent | Adapter 把内部 Agent Layer 投影到池内;池后仍负责鉴权与配置 | staged payload、目标平台、安装模式和 Agent 专属事实 |

SandboxSpec / Provider 负责默认 template、按 profile 的 `templates` 表与单实例创建,但不是第四个条件 owner。
Sandbox Hook 承载 template / Layer 就位后的外部状态,Fixture 承载每 Attempt 的 workdir 输入;两者都不进入统一 Layer owner 集合。

Experiment、Eval 与 Agent 的 Layer 都被归一成 `identity + install`。
`owner` 只参与身份与诊断,不改变执行协议;因此 Agent 并不保留一套独立 AgentProvisioner 生命周期。

## 选择运行起点

每条 Attempt 只有一个 template 槽位:

```text
Eval 是否声明 environment?
├─ 否
│  ├─ Experiment 声明普通 template → 使用 Experiment template
│  └─ 未声明 → 使用 Provider 默认 template
└─ 是
   ├─ templates[environmentProfile] 命中
   │  └─ 使用 map 指定的预制 template
   ├─ Experiment 同时声明普通 template
   │  └─ 启动期双 template 冲突
   └─ 只声明 Eval environment
      ├─ Provider 能归一成单 template → 使用归一结果
      └─ 不能归一 → 明确 Provider 能力缺口
```

`templates[profile]` 只消解单槽位选择。
Runner 不验证其内容分别满足 Eval 与 Experiment 条件,也没有第二份 Base 或完整融合 Case 的概念。

## Build、Start、Install 与 Fixture

```text
规划期
  → 选择唯一 ResolvedTemplate
  → 一次穷举 template 冲突、缺失 profile 与 Provider 能力缺口

每个 fresh Sandbox 或复用窗口
  → Provider 从 ResolvedTemplate 创建一个 Sandbox

每条 Attempt
  → 合并 Experiment、Eval 与 Agent Layer
  → 读取受管 manifest,或调用自定义 inspect
  → 收集所有 miss
  → 无依赖、无资源锁地并行 install 全部 miss
  → 默认路径写入受管 manifest

每个 Sandbox 或复用窗口
  → Sandbox setup 状态 Hook

每条 Attempt
  → 建立或恢复 workdir baseline
  → Adapter 鉴权、配置与会话初始化
  → turn 前 Eval Fixture
  → 完成所有 Agent turn
  → 挂载 turn 后 verifier / criteria
  → 评分并清理 verifier
  → Eval / Agent teardown

每个 fresh Sandbox 或复用窗口收尾
  → Sandbox teardown 状态 Hook
  → 销毁 Sandbox
```

四类动作的实际能力是:

| 动作 | PLAN-2 含义 | 固定缺口 |
|---|---|---|
| build | Provider 在 template 解析或启动准备中构建、拉取或定位起点 | 没有独立 BuildKey / 构建协调契约;Compose 不能完整归一时无表达位 |
| start | 从单个 `ResolvedTemplate` 创建单实例 Sandbox | 没有完整多 service Sandbox Case、ready 能力句柄和整组清理 |
| install | 所有 owner 的 Layer miss 后并行执行 `install` | 没有宿主侧 `prepare`、依赖 DAG、资源锁或强制全组真实复检 |
| Fixture | turn 前写题目材料,最后一次 turn 后才挂载隐藏 verifier | 每 Attempt 重建;本方案沿用 `test(t)` 内作者自管 verifier,不参与 Layer manifest |

省略 `inspect` 时,manifest 只证明框架曾执行安装。
它不证明二进制、PATH、权限或动态库现在仍满足目标;install 成功后也没有全组真实复检。

turn 后 verifier 仍由 Eval 作者在 `test(t)` 内自行挂载和 cleanup。
Runner 没有独立的 materialization handle、cleanup 注册或活动,因此不能强制清理 workdir 外路径、mount 与进程,也不能据此自动退休复用窗口。

## Fresh 与 Reuse

| 生命周期节点 | 默认 fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| template 解析与冲突检查 | Run 规划期 | Run 规划期 |
| template 构建 / 拉取 | Provider 自己决定;候选无统一频次契约 | 相同 |
| Sandbox create | 每 Attempt | 每复用窗口 |
| 全部 Layer manifest / inspect 检查 | 每 Attempt | 每 Attempt |
| Layer install | 每个 miss,同批并行 | 每个 miss,同批并行 |
| Sandbox setup / teardown 状态 Hook | 每 Attempt各一次 | 每复用窗口各一次 |
| baseline / reset、前置 Fixture、Agent turn、作者自管隐藏 verifier 与评分 | 每 Attempt | 每 Attempt |
| Eval / Agent teardown | 每 Attempt | 每 Attempt |
| Sandbox stop | 每 Attempt末尾 | 复用窗口末尾 |

复用模式会再次读取 Layer 检查,但默认路径只读持久化 manifest。
前一 Attempt 删除二进制、覆盖 PATH 或破坏权限时,下一条 Attempt 可能假命中并直接进入 Agent。

统一 Agent Layer 也遵守这项弱检查语义。
本方案没有 Agent 专属的目标平台探测、staged payload 或逐 Attempt实际安装事实来补回缺口。

活 Sandbox 只允许在同一 Experiment、同一 ResolvedTemplate identity 与同一 environment profile 的窗口内复用。
窗口应有独立 identity 和承接序号;但本候选的 Library 与记录形状都没有定义这两个字段,这是 C7 的额外缺口。

## Case 选择图

场景输入与验收条件以根 [CASES](../CASES.md) 为准。
下表忠实展示单槽位解析结果;`△` 不表示已经具备完整 Sandbox Case 或 Requirement 语义。
`△` 表示执行路径存在但至少缺一条共同验收,`✕` 表示候选规则拒绝该合法输入。

| Case | 状态 | 选中的 template | 后续生命周期与缺口 |
|---|---|---|---|
| [C1](../CASES.md#c1评估环境较重) | △ | Eval environment 的单 template 归一结果,或 `templates[profile]` | Eval / Agent Layer 池;完整 Compose Case 可能无法归一,且没有统一 BuildKey 契约 |
| [C2](../CASES.md#c2实验环境较重) | △ | Experiment 普通 template | Experiment / Agent Layer 池;manifest 不证明实际状态,无强制真实复检 |
| [C3](../CASES.md#c3评估与实验环境都较重) | △ | Eval environment template | 三方 Layer 池;没有宿主侧 prepare,断网 payload 无法按平台共享 |
| [C4](../CASES.md#c4组合多个条件) | △ | 既有 Eval、Experiment 或 Provider template | 所有 miss 无条件并行 install;依赖或资源冲突只能合并 Layer |
| [C5](../CASES.md#c5预装稳定条件) | △ | 预制 Experiment template 或 `templates[profile]` | manifest / inspect 命中则跳过 install;过期 manifest 会假命中 |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | △ | 每 Attempt 一个新的已解析 template | Layer 池后 load,收尾 save;状态载入后没有三方真实最终屏障 |
| [C7](../CASES.md#c7复用-sandbox-活状态) | △ | 每复用窗口一个 template | 每 Attempt 重读 Layer;manifest 会假命中,且 Library 未定义 reuse key / window identity |
| [C8](../CASES.md#c8experiment-提供条件基底) | △ | Experiment 普通 template | Eval Layer 只能 install;没有“只验证且无法补齐”的明确不兼容分支 |
| [C9](../CASES.md#c9双方都有不可叠加基底) | △ | `templates[profile]` 指定的替代 template | map 不是完整融合 Case,也不分别验证双方条件 |
| [C10](../CASES.md#c10混合批次) | ✕ | 无 Environment 的 Eval 可选 Experiment template;有 Environment 的 Eval 与它冲突 | 规划期整批报双 template 冲突;普通默认起点不会让位 |
