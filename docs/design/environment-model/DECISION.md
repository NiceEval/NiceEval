**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md)

---

## 结论

采纳 [PLAN-4](PLAN-4.md):Requirement + Base Case + Ensure。

## 依据

环境模型先区分三份要求,再讨论怎样兑现:

- Eval Requirement 保存题意,可以由 Eval Base 或可移植 Ensure 兑现。
- Experiment Requirement 保存本次比较条件,可以由 Experiment Base 或 Ensure 兑现。
- Agent Requirement 由 AgentProvisioner 在最终主 Sandbox 中 Ensure,不参与 Base Case 选择。

一条 Attempt 只选择一个完整 Base Case。
Eval 与 Experiment 只有一侧提供 Base 时选择该侧,另一侧只能检查并补齐;两侧同时提供 Base 时必须选择显式融合 case,否则启动期报冲突。

对照 [GOALS](GOALS.md) 的八条需求:

1. 三份 Requirement 在规划期都存在,任何 Base 都不能删除其它 Requirement。
2. Eval 与 Experiment contribution 都允许携带 Base 和 Ensure,不预设哪一侧永远拥有环境。
3. 双 Base 没有隐式优先级。融合 case 是唯一消解方式,且启动后仍分别验证两份 Requirement。
4. Experiment 可以按 Eval profile 提供多个融合 case;矩阵展开后每条 Attempt 仍只选一个。
5. 单 Base 下另一侧检查命中即继续,未命中时 install;没有 install 则明确判为不兼容。
6. Base、预制产物名与 manifest 都不受信短路实际验证;Sandbox Case 已有运行事实可以直接作为 verifier 输入。
7. Eval 与 Experiment Ensure 用依赖和资源调度,数组位置不表达顺序;Agent 在后续阶段复用相同原语。
8. Requirement、所选 CaseKey 和逐目标解析身份分别进入 configHash 或逐 Eval fingerprint。

## 为什么改判 PLAN-3

PLAN-3 正确保住了完整 Sandbox Case 与 AgentProvisioner,也给 Experiment 工具建立了低成本 Addon。
它仍把 Eval 默认为完整 case 的唯一所有者,Experiment 只能向其上添加 Addon,没有对称表达「Experiment 提供 Base,Eval 在其上 Ensure」。

PLAN-4 把 Addon 提升为 Experiment Requirement 的一种 helper,并把 Eval 一侧也拆成 Requirement 与可选 Base。
这不是把三个领域对象压成同一协议:三方仍有不同 helper、生命周期和错误归属;统一的只是 Base 选择与 Ensure 收敛规则。

## 否决的候选项

**PLAN-1(Environment 与 Provision 二分)。**
它把 Eval 固定为 Environment、Experiment 固定为 Provision,无法表达二者任一方提供 Base 或 Ensure;有序数组与全价 Provision 还增加作者负担。

**PLAN-2(单 template 与统一 Layer)。**
template 不能表达完整 Compose case,统一 Layer 也会丢失 Agent staged payload 与运行事实。
它只数声明来源,没有把 Requirement 与兑现方式分开,所以双 template 冲突只能靠特例表修补。

**PLAN-3(完整 Sandbox Case + Experiment Addon)。**
它是 PLAN-4 的严格子集:Eval 总提供 Base、Experiment 总提供 Ensure 时,PLAN-4 退化成 PLAN-3。
它没有表达 Experiment Base、可迁移 Eval Requirement 与双 Base 的融合 case,因此不作为终态。

## 一并裁决

- Requirement 是必须成立的事实;Base Case 与 Ensure 是两种兑现方式。
- Base Case 是完整 Sandbox Case,不是跨 Provider template。image、template、snapshot、Dockerfile 与 Compose 都只是具体 case 输入。
- 每条 Attempt 一个 Base Case;一次 Experiment 可以按 Eval profile 声明多个候选 case。
- 融合 case 显式承担 Eval Base × Experiment Base 的组合成本。Runner 不承诺在运行时合并两个基底。
- AgentProvisioner 不提供 Base,也不改成通用 Requirement 实现;它只复用 Ensure 原语。
- 普通作者使用 `composeSandbox`、Addon helper 与 Adapter 工厂,不直接实现底层 Requirement 接口。

## 遗留风险

- Eval Requirement 的 verifier 需要访问完整 Materialized Sandbox Case,尤其是 services、ready 与身份事实;验证结果形状要在 Feature 契约中穷尽定义。
- Contribution 是否同时允许 `base` 与 `install`,以及 helper 怎样隐藏底层组合,需要用真题调用点复核。
- 融合 case 表第一期只支持精确 profile。profile 重命名、缺项穷举和未选中条目是否校验需要定稿。
- 同一 Requirement 在 Base、Ensure 与融合 case 三条路径下必须共享 identity 与 check,否则预制优化会形成不可比较的旁路。
