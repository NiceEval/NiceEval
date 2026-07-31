**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [DECISION](DECISION.md)

---

## 目的

记录环境模型必须服从的 Provider 原语、既有 Feature 契约与安装系统限制。
目标见 [GOALS](GOALS.md),结论见 [DECISION](DECISION.md)。

## Sandbox 起点不是统一 template

单实例 Provider 通常从一个 image、template 或 snapshot 启动。
Compose case 还包含多个 service、网络、volume、ready 条件、主执行空间与整组清理,并且可以引用多个构建产物。

因此统一不变量是「一条 Attempt 解析到一个完整 Sandbox Case」,不是「只有一个 template 槽位」。
Provider 不能合并两个起点产物,但可以让 environment profile 映射到一个完整预制 case,替代 folder-local source 的现场 materialize。

这条限制允许一次 Experiment 声明多个候选 case。
候选项按 Eval environment profile 选择,所以一批异构 Eval 可以分别起自不同 template 或 Compose case;限制只要求单条 Attempt 最终选择一个。

## 两个基底不能靠覆盖组合

Eval 的 Compose case 可能携带题意,Experiment 的 template 可能预装昂贵工具。
二者同时存在时,让任意一侧静默覆盖都会丢失另一侧的要求;Provider 也没有通用原语把两份完整 case 合并。

可行路径只有三类:

- 选择 Eval Base Case,在其中 Ensure Experiment Requirement。
- 选择 Experiment Base Case,在其中 Ensure Eval Requirement。
- 显式提供一个融合 case,声明它同时兑现两份 Requirement,并分别验证。

融合 case 可以按 Eval profile 建表,但它是用户或构建系统已经组合好的完整 case,不是 Runner 在运行时合并两个 template。

## Sandbox Case 与 Agent Ensure 已有完整义务

[Sandbox Case](../../feature/sandbox/case.md) 已经拥有环境输入、BuildKey、CaseKey、主 Sandbox、能力、证据、错误、清理与留存契约。
[Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 已经拥有 Agent identity、宿主侧 staged payload、平台探测、check、install、recheck、安装模式与 Attempt 安装事实。

新的模型可以降低两者之间的接线成本,但不能通过更通用的名字删除这些义务。
普通实验工具也可能需要宿主侧准备 payload,但没有 Agent 的安装模式、启动条件与 Attempt 安装事实等职责。
Addon 可以复用准备协调设施,不能因此迫使 AgentProvisioner 降格成最小安装协议。

## Manifest 不是状态证明

受管 manifest 只能证明某次安装曾以某个声明身份成功。
它不能证明二进制仍存在、PATH 与权限仍正确、动态库仍可用,也不能发现后续安装覆盖了共享目录。

预制产物、复用 Sandbox 与安装完成后的状态都必须通过实际检查确认。
框架可以在同一不可变实例内缓存已经验证的检查结果,但 cache key 必须包含实例代次与可能破坏该状态的安装批次。

## 安装既有资源冲突,也有语义依赖

apt、dpkg、npm global 等包管理器持全局锁或写共享目录。
两个不相关的安装单元也可能因为使用同一资源而无法并行。

证书、内部 registry 与运行时之间则存在语义依赖。
把依赖项合并成一个安装单元会丢失独立复用与身份;让用户靠数组位置表达依赖又会产生隐式状态。
模型需要同时表达资源互斥与显式依赖,调度器据此串行冲突项、并行独立项。

## 身份分属两层

Sandbox Case 与 Eval environment 属于逐 Eval 身份。
Experiment Requirement 的声明身份和 AgentProvisioner 属于整场实验配置,进入 Run 级 configHash。
Requirement 按目标环境选择出的平台与 payload digest 可能逐 Eval 不同,这部分解析身份进入逐 Eval fingerprint。

同一个 Experiment Requirement 若只影响某些 Eval,它的解析后选择必须进入对应逐 Eval fingerprint,不能让 configHash 按 Eval 分叉。
