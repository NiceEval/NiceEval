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

## Case 起点选择

场景输入与验收条件以根 [CASES](../CASES.md) 为准。
下表在每行写全 PLAN-2 的输入分支、单个 template 选择和冲突结果,无需回到前文推导。

| Case | 输入中的起点 | PLAN-2 实际选择 | 没有被采用或无法表达的部分 | 结论 |
|---|---|---|---|---|
| [C1](../CASES.md#c1评估环境较重) | Eval 自带题目 Environment;Experiment 不声明普通 template | profile 有预制替代项时使用 `templates[profile]`;否则由 Provider 把 Eval Environment 归一成单 template | Provider 普通默认 template 不参与;无法归一完整 Compose 时没有其它起点 | 可以运行部分 Environment,但没有完整 Sandbox Case 与统一 BuildKey 契约 |
| [C2](../CASES.md#c2实验环境较重) | Eval 没有 Environment;Experiment 声明普通 template | 使用 Experiment 普通 template | Provider 普通默认 template 不参与;实验工具仍是启动后安装的 Layer | 可以运行,但 manifest 不证明实际状态,也没有强制真实复检 |
| [C3](../CASES.md#c3评估与实验环境都较重) | Eval 自带 Compose Environment;Experiment 用 Layer 加入共享工具 | profile 有预制替代项时使用该替代项;否则由 Provider 归一 Eval Environment | 共享工具不会产生第二个起点;若 Experiment 另声明普通 template 且 profile 未命中,启动期发生双 template 冲突 | 可以运行部分路径,但没有宿主侧 prepare,断网 payload 也无法按平台共享 |
| [C4](../CASES.md#c4组合多个条件) | 多个实验条件都是 Layer;Eval 和 Experiment 仍可能各自声明起点 | Eval 有 Environment 且 profile 命中时选预制替代项;Eval 有 Environment、profile 未命中且 Experiment 有 template 时冲突;只有 Eval Environment 时归一它;Eval 没有 Environment 时选 Experiment template 或 Provider 默认 template | 多个 Layer 都不参与起点选择;双 template 也不能自动合并 | 可以运行无冲突分支,但 Layer 无依赖、资源锁和最终验证屏障 |
| [C5](../CASES.md#c5预装稳定条件) | 稳定条件预装在 Experiment template 或某个 profile 的预制 template 中 | Eval 有 Environment 且 profile 命中时选预制替代项;Eval 没有 Environment 时选预装的 Experiment template;Eval 有 Environment、profile 未命中且 Experiment 有 template 时冲突 | 预装不会移除对应 Layer;Runner 也不知道预制内容分别满足谁的条件 | 可以运行无冲突分支,但过期 manifest 仍可能假命中 |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | 外部状态不是 template;Eval 和 Experiment 可能各自声明起点 | Eval 有 Environment 且 profile 命中时选预制替代项;Eval 有 Environment、profile 未命中且 Experiment 有 template 时冲突;只有 Eval Environment 时归一它;Eval 没有 Environment 时选 Experiment template 或 Provider 默认 template;每条 Attempt 新建 Sandbox | 外部状态不会参与 template 选择,而是在 Layer 与 Agent 就位后载入 | 可以运行无冲突分支,但状态载入后没有三方最终验证屏障 |
| [C7](../CASES.md#c7复用-sandbox-活状态) | 活状态不是 template;Eval 和 Experiment 可能各自声明起点 | Eval 有 Environment 且 profile 命中时选预制替代项;Eval 有 Environment、profile 未命中且 Experiment 有 template 时冲突;只有 Eval Environment 时归一它;Eval 没有 Environment 时选 Experiment template 或 Provider 默认 template;每个复用窗口只从所选 template 创建一次 Sandbox | 活状态不会参与 template 选择;Library 也没有定义 reuse key 与 window identity | 可以运行无冲突分支,但 manifest 可能假命中 |
| [C8](../CASES.md#c8experiment-提供条件基底) | Eval 没有不可叠加的题目起点;Experiment 提供预制 template | 使用 Experiment 普通 template | Eval 条件只能变成启动后安装的 Layer;没有“只能验证但无法补齐”的不兼容分支 | 可以启动,但不能完整表达该 Case 的验收语义 |
| [C9](../CASES.md#c9双方都有不可叠加基底) | Eval 与 Experiment 各有一个不能直接叠加的完整起点 | profile 有 `templates[profile]` 时只选该替代 template;没有映射项时在启动期报告双 template 冲突 | 映射项只是作者选出的单一起点,不是 Runner 融合双方起点;双方条件也不会分别验证 | 映射项可以启动,但不满足完整验收 |
| [C10](../CASES.md#c10混合批次) | 一部分 Eval 自带 Environment,另一部分没有;Experiment 声明普通 template;Provider 还有默认 template | 有 Environment 且 profile 命中时选预制替代项;有 Environment 且 profile 未命中时与 Experiment template 冲突;没有 Environment 时选 Experiment template | 命中 profile 时 Experiment template 不再独立参与;Provider 默认 template 只在 Eval 和 Experiment 都没有起点时使用 | 混合批次会因有 Environment 的冲突项在规划期被拒绝 |
