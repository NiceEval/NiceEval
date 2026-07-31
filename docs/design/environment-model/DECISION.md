**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md)

---

## 结论

采纳 [PLAN-5](PLAN-5/README.md):Requirement + Base Case + Ensure,基底分默认与条件两档。

## 依据

环境模型先区分三份要求,再讨论怎样兑现:

- Eval Requirement 保存题意,可以由 Eval Base 或可移植 Ensure 兑现。
- Experiment Requirement 保存本次比较条件,可以由条件基底或 Ensure 兑现。
- Agent Requirement 由 AgentProvisioner 与 AgentRuntimeLifecycle 在最终主 Sandbox 中 Ensure,不参与 Base Case 选择。

一条 Attempt 只选择一个完整 Base Case。
SandboxSpec 上单独声明的起点产物是默认 case,不代表 Experiment Requirement,Eval Base 存在时让位。
只有与 Experiment Requirement 绑定声明的基底参与冲突判定;双基底并存必须选显式融合 case,否则启动期报冲突。

对照 [GOALS](GOALS.md) 的十一条需求:

1. 三份 Requirement 在规划期都存在,任何 Base 都不能删除其它 Requirement。
2. Eval 与 Experiment contribution 都允许携带 Base 和 Ensure,不预设哪一侧永远拥有环境。
3. 双基底没有隐式优先级。融合 case 是唯一消解方式,且启动后仍分别验证两份 Requirement。
4. Experiment 可以按 Eval profile 提供多个融合 case;矩阵展开后每条 Attempt 仍只选一个。
5. 不兼容判定分两层:声明期缺失在创建 Sandbox 前一次穷举报出;verify 未命中且无 install 在进入 Agent 阶段前判明,零 Agent turn。
6. Base、预制产物名与 manifest 都不受信短路实际验证;Sandbox Case 已有运行事实可以直接作为 verifier 输入。
7. Eval 与 Experiment Ensure 用依赖和资源调度,数组位置不表达顺序;Agent 在后续阶段复用相同原语。
8. Requirement 集合、所选 CaseKey 和逐目标解析身份分别进入 configHash 或逐 Eval fingerprint。
9. spec 起点产物是默认 case,不制造双 Base 冲突;条件基底在 `defineExperimentEnvironment` 里与 Requirement 集合同点声明。
10. ExperimentStateLifecycle 在 Agent CLI 就位后 load,按 fresh Attempt 或 reuse window save,显式声明后继 checkpoint 与失败提交策略。
11. AgentProvisioner 与 runtime lifecycle 分段验证;隐藏 verifier 只在 Agent turn 后挂载,并在复用前受管 cleanup。

## Case 证据

[CASES](CASES.md) 把历史 roadmap 中删除的场景与新方案增加的能力放进同一组验收:

- C1-C5、C7 来自删除前的六篇完整用例。
- C6 恢复更早提交里的独立路径:每条 Attempt 使用新 Sandbox,只从外部载入和回存状态。
- C8-C9 验证 Experiment 条件基底、Eval 可移植条件与双基底融合,是 PLAN-4 相对 PLAN-3 增加抽象的直接依据。
- C10 验证混合批次,区分普通默认起点与绑定实验条件的基底,是 PLAN-5 相对 PLAN-4 的直接依据。

只看 C1-C5 与 C7 的 Base/Ensure 组合,PLAN-3 的不对称模型更小。
但当前 PLAN-3 仍缺三方最终屏障,C6 的 state load 也早于 Agent。
没有 C8-C10 时,应先补齐这两处再采用 PLAN-3;终态同时要求 C8-C10,所以本决策采用 PLAN-5。

真实仓库没有把十项全部同时跑出来。
Terminal-Bench 直接证明题目 Compose Base 与独立 Agent Ensure;MemoryBench 直接证明实验重条件、新 Sandbox 状态和复用窗口状态。
C9 的双不可叠加 Base 与 C10 的混合批次是组合验收,不能冒充现有仓库事实。

## Lifecycle 对照

每个候选的 Lifecycle 都使用相同问题顺序:三方声明、Base/template 选择、build/start、安装、Fixture、fresh/reuse 与收尾。

| 候选 | Base/template 规则 | 安装与 Fixture | Reuse 主要缺口 |
|---|---|---|---|
| [PLAN-1](PLAN-1/lifecycle.md) | Eval Environment 或默认起点;Experiment 没有 Base | 有序 Provision 后接 Agent;turn 后 verifier 作者自管 | 无最终屏障和受管 cleanup |
| [PLAN-2](PLAN-2/lifecycle.md) | 强制归一成单 template | 三方压成 Layer;turn 后 verifier 作者自管 | manifest 假命中,window identity 未定义 |
| [PLAN-3](PLAN-3/lifecycle.md) | Eval Case 优先,否则默认 Case | Addon 与 AgentProvisioner 分开;turn 后 verifier 作者自管 | 状态早于 Agent,且无三方最终屏障 |
| [PLAN-4](PLAN-4/lifecycle.md) | Eval Base 与任意显式 Experiment 起点冲突时要求融合 | 两方单 Requirement 加 Agent Ensure;只有早期 Hook | 默认 template 误判;晚期 state 与受管 cleanup 未闭合 |
| [PLAN-5](PLAN-5/lifecycle.md) | 默认 case、Eval Base、条件基底与融合 case 分档 | Requirement 集合、Agent 两段、独立 state、受管前后 Fixture | 机制最完整,实现与记录面也最大 |

## 采纳 PLAN-5 的代价

PLAN-5 不把组合成本藏进 Runner,而是把它显式分摊到四处:

- 双方都贡献不可叠加 Base 时,Experiment 作者必须按 profile 维护完整融合 case;Runner 不自动合并 Compose 与 template。
- Runner 要新增 Environment Requirement 图、两道全组屏障、Agent runtime verify 与独立 state lifecycle。
- 记录面要保存全部 BuildKey/locator、CaseKey、三方 check、payload、runtime identity、verifier cleanup、checkpoint digest 与 window activity。
- 现有把 MemoryBench 状态写入早期 `SandboxSpec.setup/teardown` 的写法需要迁到 `defineExperimentState`;普通环境预置 Hook 不迁。
- 复用窗口没有逐 Attempt 状态回滚,因此只能选择 `saveOn: "after-load"`;需要失败不提交时必须使用 fresh Sandbox。
- Terminal-Bench 的 turn 后测试要从 `test(t)` 内直接上传迁到受管 verifier Fixture,为 `/tests`、mount 与进程预登记 cleanup。

换来的边界是:只有真正的双条件 Base 才支付融合表成本。
C1-C5 的可安装条件不生成 Eval × Experiment template 矩阵,C10 的普通默认 template 也不制造假冲突。

## 为什么改判 PLAN-4

PLAN-4 建立了 Requirement 与兑现方式的分离,定义了融合 case 与 Ensure 调度。
PLAN-5 独立保留这些机制,并完整重写 Library、Architecture 与 Use Case,不依赖 PLAN-4 提供必需契约。
改判因为六处缺口:

- PLAN-4 把 `e2bSandbox({ template })` 一律判为 Experiment Base。混合批次里每条自带环境的 Eval 都落入双基底冲突,而 [Sandbox Case](../../feature/sandbox/case.md) 的既有契约里 spec 起点产物与 folder-local source 本就共存。
- contribution 只装一个 Requirement,证书加工具这类多条实验条件没有表达位。
- 「创建 Sandbox 前给出不兼容结果」与「verify 需要运行事实」在 PLAN-4 内互相矛盾;判定必须按可判时机分声明期与运行期。
- PLAN-4 只描述“Agent 后 load”,没有独立于早期 SandboxSpec setup 的 state API、identity、activity 与失败语义。
- PLAN-4 的最终 Agent 检查只闭合到 AgentProvisioner,没有验证逐 Attempt Plugin、Skill、MCP 与配置。
- PLAN-4 沿用 `test(t)` 内作者自管 verifier,没有为 workdir 外路径、mount 与进程提供受管 cleanup 和硬失败语义。

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
它是 PLAN-5 的直接前身。
Base 模型差异在基底分档、Requirement 集合与不兼容判定分层;state 与 Agent runtime 还各缺一个可执行闭环。

## 一并裁决

- Requirement 是必须成立的事实;Base Case 与 Ensure 是两种兑现方式。
- Base Case 是完整 Sandbox Case,不是跨 Provider template。image、template、snapshot、Dockerfile 与 Compose 都只是具体 case 输入。
- 每条 Attempt 一个 Base Case;一次 Experiment 可以按 Eval profile 声明多个候选 case。
- spec `environments` 表项是 Eval Requirement 的预制实现,归 Eval Base,沿既有的表项优先契约;融合 `cases` 表才同时预期兑现两份 Requirement。
- contribution 可以同时带 `base` 与可安装 Requirement:base 是预期命中的优化,verify 未命中的成员仍走 install 收敛。
- 融合 case 显式承担 Eval Base × 条件基底的组合成本。Runner 不承诺在运行时合并两个基底。
- AgentProvisioner 不提供 Base,也不改成通用 Requirement 实现;它只复用 Ensure 原语。
- Agent runtime setup 有独立 identity、verify 与 teardown;最终屏障同时重查 AgentProvisioner 与 runtime。
- 外部状态使用独立 ExperimentStateLifecycle;fresh 每 Attempt load/save,reuse 每 window load/save 且必须选 `after-load`。
- turn 前 Fixture 与 turn 后隐藏 verifier 分开;Base 不携带本应对 Agent 隐藏的评分材料。
- 普通作者使用 `composeSandbox`、Requirement helper 与 Adapter 工厂,不直接实现底层 Requirement 接口。

## 遗留风险

- Eval Requirement 的 verifier 需要访问完整 Materialized Sandbox Case,尤其是 services、ready 与身份事实;验证结果形状要在 Feature 契约中穷尽定义。
- contribution helper 怎样隐藏底层组合,需要用真题调用点复核。
- 融合 case 表第一期只支持精确 profile。profile 重命名、缺项穷举和未选中条目是否校验需要定稿。
- 同一 Requirement 在 Base、Ensure 与融合 case 三条路径下必须共享 identity 与 check,否则预制优化会形成不可比较的旁路。
