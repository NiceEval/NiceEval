**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 实现方案 4(Requirement + Base Case + Ensure,推荐)

### 简述

一次 Attempt 有三份互不覆盖的 Requirement:

| 所有者 | Requirement 回答什么 | 可否提供 Base Case | Ensure 的领域职责 |
|---|---|---|---|
| Eval | 题意要求什么环境、服务和初始状态 | 可以 | 在别人的 Base Case 上补齐并验证题意;无法补齐时省略 install |
| Experiment | 本次比较要求什么工具、模型和证书 | 可以 | 准备、安装并验证实验条件 |
| Agent | Adapter 启动需要什么 CLI、版本和运行条件 | 不可以 | AgentProvisioner 的 prepare、check、install、recheck |

Base Case 是单条 Attempt 唯一的启动基底。
它仍是完整 Sandbox Case,可以来自 image、template、snapshot、Dockerfile 或 Compose;后四个词不是新的跨 Provider 抽象。

Ensure 是 Requirement 在既定 Base Case 上的收敛路径。
每份 Requirement 都有 verifier;它可以读取 Sandbox Case 已有的 ready、能力与身份事实,不要求作者重复执行同一检查。
可安装的 Requirement 再提供 `prepare` / `install`,不可安装的 Requirement 等价于 verify-only。

### 核心形状

下面是概念形状,具体导出名在 Feature API 评审时定稿:

```typescript
interface EnvironmentRequirement {
  name: string;
  identity: JsonValue;
  verify(target: MaterializedSandboxCase): Promise<RequirementCheck>;
  prepare?: (ctx: PrepareContext) => Promise<PreparedPayload>;
  install?: (sandbox: Sandbox, prepared?: PreparedPayload) => Promise<void>;
  dependsOn?: readonly EnvironmentRequirement[];
  resources?: readonly string[];
}

interface EnvironmentContribution {
  requirement: EnvironmentRequirement;
  base?: SandboxCaseSource;
}
```

Eval 和 Experiment 各自声明一个 `EnvironmentContribution`。
一个 contribution 可以只带 requirement、只带 base 隐含的 verify-only requirement,或同时带 base 与可移植 Ensure。
Agent 的 contribution 固定为 AgentProvisioner,不进入 Base Case 竞争。

### 四种普通组合

| Eval Base | Experiment Base | 最终 Base Case | 后续 Ensure |
|---|---|---|---|
| 无 | 无 | SandboxSpec 中性默认 case | Eval + Experiment + Agent |
| 有 | 无 | Eval Base | Experiment + Agent;Eval 仍 check |
| 无 | 有 | Experiment Base | Eval + Agent;Experiment 仍 check |
| 有 | 有 | 配置冲突 | 必须改用融合 case,不隐式选边 |

「有 Base 的 Requirement 仍 check」是关键约束。
Base 只是预期满足该 Requirement 的候选起点;浮动 tag、错误构建或后续修改都不能因为来源相同而跳过验证。

`sandbox: e2bSandbox({ template })` 或同类 Provider 起点明确选择了 Experiment Base。
未声明起点产物时,Provider 为创建普通 Sandbox 使用的默认 case 是中性 fallback,不算 Experiment Requirement 自己提供了 Base。

只有一侧提供 Base、另一侧没有 `install` 时,Runner 先运行另一侧的 `check`。
检查命中可以继续;检查不命中则该 Eval × Experiment 组合不兼容,零安装、零 Agent turn。
缺能力属于计划期 `skipped`;用户明确声明了互相矛盾的两个 Base 则是启动期配置错误。

### 融合 case:显式解决两个 Base 冲突

Experiment 可以按 Eval environment profile 声明融合 case:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirement: mempalEnvironment,
    cases: {
      "terminal-bench/sheets": {
        template: "acme/tb-sheets-mempal-v5",
      },
      "terminal-bench/postgres": {
        template: "acme/tb-postgres-mempal-v3",
      },
    },
  }),
  sandbox: e2bSandbox(),
  agent: codexAgent(),
});
```

表键选择 Eval contribution,表值是已经融合题目环境与实验条件的完整 Sandbox Case。
它替代 Eval Base 与 Experiment 默认 Base,但不替代两份 Requirement;启动后仍分别执行 Eval verifier 与 Experiment verifier。

融合 case 位于 Experiment Requirement 自己的 `cases` 表下,因此已经表达它预期满足该 Requirement。
表键确定它同时服务哪个 Eval Requirement;两份关系都不在表值里重复。
预期不是受信短路,启动后仍分别 verify;Experiment verifier 未命中时安装或报错。

第一版只接受精确 profile key,不支持通配符或按函数动态选择。
选中的 Eval 有 Base 冲突但表里缺 key 时,启动期一次列出全部缺失融合 case;不会对部分条目静默改用另一套优先级。

### 多 case 不是多 Base

`cases` 表允许一个 Experiment 配置多个候选 Base Case,但矩阵展开后每条 Attempt 只选择一个:

```text
Experiment × Eval A -> fused case A -> one main Sandbox
Experiment × Eval B -> fused case B -> one main Sandbox
Experiment × Eval C -> Eval Base C   -> one main Sandbox + Experiment Ensure
```

case 选择结果逐 Eval 进入 fingerprint 与 `sandboxByEval`;它不让 configHash 逐 Eval 分叉。
同一个 experiment 仍是一条 Run 和一个比较横截面。

### Ensure 调度

Eval 与 Experiment Requirement 在 `sandbox.setup` 阶段进入同一调度图,但保留所有者与错误归属。
Runner 先验证这两份 Requirement,只为未命中且有 install 的节点执行准备与安装。

- 数组位置不表达顺序;`dependsOn` 表达语义依赖。
- 未声明 `resources` 的安装使用保守 `sandbox-mutation` 资源,彼此串行。
- 相同资源互斥,不同资源且依赖满足时可以并行。
- install 后重跑同一个 verifier;复检失败不写成功事实。
- Eval Requirement 失败归环境不兼容或 `sandbox.setup`;Experiment Requirement 失败归 `sandbox.setup`;Agent Requirement 失败归 `agent.setup`。

AgentProvisioner 随后在 `agent.setup` 执行,不改成通用 EnvironmentRequirement。
Adapter 仍拥有平台探测、staged payload、安装模式与 Agent 运行事实;它复用检查、准备和资源互斥原语,不与前一阶段组成跨生命周期并行图。

### 身份

```text
configHash  += Experiment Requirement 声明身份
configHash  += AgentProvisioner 声明身份
fingerprint += Eval Requirement 身份
fingerprint += 所选 Base Case 的 CaseKey / BuildKey
fingerprint += 三份 Ensure 按目标 case 解析出的平台与 payload 身份
```

Experiment 的 `cases` 表作为顶层配置落 `run.json`,但具体选择与 CaseKey 逐 Eval进入 fingerprint 清单。
Requirement 的函数体不自动哈希;脚本、payload、模型与验证协议有语义变化时,必须通过 digest 或 revision 进入 identity。

### 相比 PLAN-3

PLAN-3 只给 Experiment 工具建立 Addon,默认假设 Eval 总是拥有完整 Sandbox Case。
PLAN-4 把隐藏的对称性补齐:Eval 与 Experiment 都拥有 Requirement,也都可能提供 Base 或只提供 Ensure。

这带来两个 PLAN-3 没有直接回答的能力:

- Experiment Base 存在时,可安装的 Eval Requirement 可以迁入该 Base,而不是只能让 Eval Base 永远获胜。
- 两边都有 Base 时,`cases` 表显式选择按 Eval 构建的融合 case,允许 Experiment × Eval 的预制组合矩阵作为优化存在。

代价是内部 Requirement 协议比 Addon 更抽象,而且 Eval Requirement 的 verifier 可能需要读取服务能力,不只接收主 Sandbox。
这个协议属于框架与高级扩展面;普通用户通过 `composeSandbox`、`packagesEnvironment` 等领域 helper 构造 contribution。

### 落地路线

1. 从现有 Sandbox Case 提取只读 Requirement check,保留 BuildKey、CaseKey 与资源组契约。
2. 定稿 Eval / Experiment contribution 的 helper,不要求普通用户实现底层接口。
3. 实现四种普通组合与双 Base 冲突诊断。
4. 实现精确 profile 的融合 `cases` 表,接入 `sandboxByEval` 与 fingerprint。
5. 把 PLAN-3 Addon 迁成 Experiment Requirement helper,保留 prepare、资源与依赖能力。
6. 接入 AgentProvisioner 的调度资源,但不改变 Adapter 领域协议。
