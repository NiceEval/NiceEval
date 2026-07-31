**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md)

---

## 结论

采纳 [PLAN-3](PLAN-3.md):完整 Sandbox Case + Experiment Addon + 独立 AgentProvisioner。

## 依据

对照 [GOALS](GOALS.md) 的七条需求:

1. Eval 用 `composeSandbox` 声明 Compose 与 `mainService`;普通 Docker Provider 内建消费,免注册。
2. SandboxSpec 的 `environments` 表映射完整预制 case,可以覆盖按需构建,不把 Compose 降格成 template。
3. Experiment 工具只写一个 Addon;常见包管理器由 helper 提供低成本入口。
4. Addon 默认执行实际 `check`,安装后复检;manifest 只允许作为有失效边界的检查 cache。
5. `addons` 不以数组位置表达顺序。默认资源使未知 Addon 串行,资源互斥与依赖 DAG 让安全部分并行。
6. AgentProvisioner 保留 staged payload、平台探测、安装模式与安装事实,只复用资源调度设施。
7. Addon 声明进入 configHash;按目标环境解析出的平台与 payload 身份随 Sandbox Case 进入逐 Eval fingerprint。两边都有可解释清单与运行事实。

这个选择接受三个领域概念,因为它们的身份、生命周期与失败归属确实不同。
降低负担的手段是为常见 Addon 提供 helper,并让 Provider 内建常见 materializer,不是删除真实边界。

## 否决的候选项

**PLAN-1(Environment 与 Provision 二分)。**
它保留真实检查与领域边界,但 Provision 的最小协议过重,安装顺序以数组位置表达,普通 Compose 还需要重复接线。
PLAN-3 保留实际检查,把 Experiment 工具收敛为 Addon,并由 helper、DAG 与资源调度器消除这些负担。

**PLAN-2(单 template 与统一 Layer)。**
统一安装动作的方向过度扩张到领域模型。template 无法表达完整 Compose case;manifest 无法证明当前状态;Agent 安装也无法缩成最小 Layer 而不丢失既有义务。
默认并行还要求不同所有者提前合并冲突安装,实际无法执行。

## 一并裁决

- 环境的统一单位是完整 Sandbox Case,不是 template。image、template 与 snapshot 是部分 Provider 的 case 输入。
- `environments` 表保留为完整 case 覆盖入口。内建 Provider 自动消费内建 source kind,普通用户不手工注册 materializer。
- Addon 只属于 Experiment。Eval 独有依赖属于题目环境或 Fixture,不增加 `eval.addons`。
- AgentProvisioner 保持独立公开协议。共享的是资源调度器,不是领域对象。
- Addon 必须检查实际状态。受管 manifest 不作为默认命中依据。
- 并行安装是调度优化。未知安装默认串行,不能用“作者应当合并”解释运行时竞态。

## 遗留风险

- Addon `check`、可选 `prepare` 的结构化形状、内置 helper 清单和运行记录字段需要在 Feature 契约中穷尽定义。
- 资源词表需要先覆盖 apt、npm global、系统证书和通用文件系统修改;自定义资源的命名冲突规则也要定稿。
- Addon 与 AgentProvisioner 分处 `sandbox.setup`、`agent.setup` 两个阶段时,共享资源调度器主要防未来并行扩展。第一版即使阶段串行,也应记录资源声明,避免以后改变语义。
- Sandbox reset 对检查 cache 的失效能力必须显式声明。无法证明 reset 保留安装目录时,全部 Addon 在下一次派发重新检查。
