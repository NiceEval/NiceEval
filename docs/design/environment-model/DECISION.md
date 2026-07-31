**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md)

---

## 结论

采纳 [PLAN-5](PLAN-5/README.md):Requirement + Base Case + Ensure,基底分默认与条件两档。

## 依据

环境模型先区分三份要求,再讨论怎样兑现:

- Eval Requirement 保存题意,可以由 Eval Base 或可移植 Ensure 兑现。
- Experiment Requirement 保存本次比较条件,可以由条件基底或 Ensure 兑现。
- Agent Requirement 由 AgentProvisioner 在最终主 Sandbox 中 Ensure,不参与 Base Case 选择。

一条 Attempt 只选择一个完整 Base Case。
SandboxSpec 上单独声明的起点产物是默认 case,不代表 Experiment Requirement,Eval Base 存在时让位。
只有与 Experiment Requirement 绑定声明的基底参与冲突判定;双基底并存必须选显式融合 case,否则启动期报冲突。

对照 [GOALS](GOALS.md) 的九条需求:

1. 三份 Requirement 在规划期都存在,任何 Base 都不能删除其它 Requirement。
2. Eval 与 Experiment contribution 都允许携带 Base 和 Ensure,不预设哪一侧永远拥有环境。
3. 双基底没有隐式优先级。融合 case 是唯一消解方式,且启动后仍分别验证两份 Requirement。
4. Experiment 可以按 Eval profile 提供多个融合 case;矩阵展开后每条 Attempt 仍只选一个。
5. 不兼容判定分两层:声明期缺失在创建 Sandbox 前一次穷举报出;verify 未命中且无 install 在进入 Agent 阶段前判明,零 Agent turn。
6. Base、预制产物名与 manifest 都不受信短路实际验证;Sandbox Case 已有运行事实可以直接作为 verifier 输入。
7. Eval 与 Experiment Ensure 用依赖和资源调度,数组位置不表达顺序;Agent 在后续阶段复用相同原语。
8. Requirement 集合、所选 CaseKey 和逐目标解析身份分别进入 configHash 或逐 Eval fingerprint。
9. spec 起点产物是默认 case,不制造双 Base 冲突;条件基底在 `defineExperimentEnvironment` 里与 Requirement 集合同点声明。

## Case 证据

[CASES](CASES.md) 把历史 roadmap 中删除的场景与新方案增加的能力放进同一组验收:

- C1-C5、C7 来自删除前的六篇完整用例。
- C6 恢复更早提交里的独立路径:每条 Attempt 使用新 Sandbox,只从外部载入和回存状态。
- C8-C9 验证 Experiment 条件基底、Eval 可移植条件与双基底融合,是 PLAN-4 相对 PLAN-3 增加抽象的直接依据。
- C10 验证混合批次,区分普通默认起点与绑定实验条件的基底,是 PLAN-5 相对 PLAN-4 的直接依据。

只看 C1-C7,PLAN-3 的不对称模型更小,而且覆盖最完整。
本决策采用 PLAN-5,是因为 GOALS 同时把 C8-C10 对应的双向 Base、Ensure 和混合批次列为终态能力;没有这三项需求时应选择 PLAN-3。

## 为什么改判 PLAN-4

PLAN-4 建立了 Requirement 与兑现方式的分离,定义了融合 case 与 Ensure 调度。
PLAN-5 独立保留这些机制,并完整重写 Library、Architecture 与 Use Case,不依赖 PLAN-4 提供必需契约。
改判只因为三处缺口:

- PLAN-4 把 `e2bSandbox({ template })` 一律判为 Experiment Base。混合批次里每条自带环境的 Eval 都落入双基底冲突,而 [Sandbox Case](../../feature/sandbox/case.md) 的既有契约里 spec 起点产物与 folder-local source 本就共存。
- contribution 只装一个 Requirement,证书加工具这类多条实验条件没有表达位。
- 「创建 Sandbox 前给出不兼容结果」与「verify 需要运行事实」在 PLAN-4 内互相矛盾;判定必须按可判时机分声明期与运行期。

## 否决的候选项

**PLAN-1(Environment 与 Provision 二分)。**
它把 Eval 固定为 Environment、Experiment 固定为 Provision,无法表达二者任一方提供 Base 或 Ensure;有序数组与全价 Provision 还增加作者负担。

**PLAN-2(单 template 与统一 Layer)。**
template 不能表达完整 Compose case,统一 Layer 也会丢失 Agent staged payload 与运行事实。
它只数声明来源,没有把 Requirement 与兑现方式分开,所以双 template 冲突只能靠特例表修补。

**PLAN-3(完整 Sandbox Case + Experiment Addon)。**
它是 PLAN-5 的严格子集:Eval 总提供 Base、Experiment 总提供 Ensure 时,PLAN-5 退化成 PLAN-3。
它没有表达条件基底、可迁移 Eval Requirement 与双基底的融合 case,因此不作为终态。

**PLAN-4(Requirement + Base Case + Ensure,基底不分档)。**
它是 PLAN-5 的直接前身;差异只在基底分档、Requirement 集合与不兼容判定分层,见上节。

## 一并裁决

- Requirement 是必须成立的事实;Base Case 与 Ensure 是两种兑现方式。
- Base Case 是完整 Sandbox Case,不是跨 Provider template。image、template、snapshot、Dockerfile 与 Compose 都只是具体 case 输入。
- 每条 Attempt 一个 Base Case;一次 Experiment 可以按 Eval profile 声明多个候选 case。
- spec `environments` 表项是 Eval Requirement 的预制实现,归 Eval Base,沿既有的表项优先契约;融合 `cases` 表才同时预期兑现两份 Requirement。
- contribution 可以同时带 `base` 与可安装 Requirement:base 是预期命中的优化,verify 未命中的成员仍走 install 收敛。
- 融合 case 显式承担 Eval Base × 条件基底的组合成本。Runner 不承诺在运行时合并两个基底。
- AgentProvisioner 不提供 Base,也不改成通用 Requirement 实现;它只复用 Ensure 原语。
- 普通作者使用 `composeSandbox`、Requirement helper 与 Adapter 工厂,不直接实现底层 Requirement 接口。

## 遗留风险

- Eval Requirement 的 verifier 需要访问完整 Materialized Sandbox Case,尤其是 services、ready 与身份事实;验证结果形状要在 Feature 契约中穷尽定义。
- contribution helper 怎样隐藏底层组合,需要用真题调用点复核。
- 融合 case 表第一期只支持精确 profile。profile 重命名、缺项穷举和未选中条目是否校验需要定稿。
- 同一 Requirement 在 Base、Ensure 与融合 case 三条路径下必须共享 identity 与 check,否则预制优化会形成不可比较的旁路。
