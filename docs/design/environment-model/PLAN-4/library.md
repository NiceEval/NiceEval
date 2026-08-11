# PLAN-4 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇定义方案 4 的候选声明面。
它不是已定稿 Feature API,但所有类型义务、默认值和错误边界都按可实现的公开形状展开。

## 三个领域入口

普通作者不直接创建统一的 Sandbox 对象。
三种所有者继续从各自入口提供声明:

| 所有者 | 入口 | 输出 |
|---|---|---|
| Eval | `composeSandbox()`、题目 Sandbox 工具 | 一个 Eval `EnvironmentContribution` |
| Experiment | `defineExperimentEnvironment()` | 一个 Experiment `EnvironmentContribution` |
| Agent | Adapter 工厂 | 一个 `AgentProvisioner` |

Eval 与 Experiment contribution 参与 Base Case 选择。
AgentProvisioner 不提供 Base Case,也不实现下面的通用 Requirement 接口。

## Requirement

```typescript
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface RequirementCheck {
  readonly satisfied: boolean;
  readonly actualIdentity?: JsonValue;
  readonly reason?: string;
  readonly facts: Readonly<Record<string, JsonValue>>;
}

interface PreparedPayload {
  readonly identity: JsonValue;
  readonly digest: string;
  readonly files: readonly PreparedFile[];
}

interface EnvironmentRequirement {
  readonly name: string;
  readonly identity: JsonValue;
  readonly dependsOn?: readonly string[];
  readonly resources?: readonly string[];

  verify(ctx: RequirementVerifyContext): Promise<RequirementCheck>;
  prepare?(ctx: RequirementPrepareContext): Promise<PreparedPayload>;
  install?(
    ctx: RequirementInstallContext,
    payload?: PreparedPayload,
  ): Promise<void>;
}
```

`name` 在同一读取后的安装图内唯一。
`identity` 是作者声明的目标身份,必须包含脚本 revision、版本、模型或证书 digest 等语义输入。
函数体不自动参与哈希。

`verify` 读取已经创建的完整 `Sandbox Case`。
它可以消费主 Sandbox 的命令结果,也可以消费 case 的 ready、services、能力与身份事实。
返回值必须携带实际事实;只返回 boolean 不能解释漂移。

`prepare` 与 `install` 都是可选的。
省略它们表示 verify-only Requirement。
Runner 只有在 verify 未命中后才检查安装能力,不会因为一个已经满足的 Requirement 无法现场安装而提前拒绝。

## Verify 上下文

```typescript
interface RequirementVerifyContext {
  readonly owner: "eval" | "experiment";
  readonly sandboxCase: RunningSandboxCase;
  readonly sandbox: Sandbox;
  readonly targetPlatform: TargetPlatform;
  readonly deadline: Deadline;
}

interface RequirementPrepareContext {
  readonly owner: "eval" | "experiment";
  readonly name: string;
  readonly identity: JsonValue;
  readonly targetPlatform: TargetPlatform;
  readonly stageDir: string;
  readonly deadline: Deadline;
}

interface RequirementInstallContext {
  readonly owner: "eval" | "experiment";
  readonly sandboxCase: RunningSandboxCase;
  readonly sandbox: Sandbox;
  readonly targetPlatform: TargetPlatform;
  readonly deadline: Deadline;
}
```

宿主侧准备写入 `stageDir`,不把大 payload 保存在配置对象或内存协议里。
`install` 通过 Sandbox 文件 API 上传并消费这些文件。

同一个准备任务按以下元组 single-flight:

```text
owner + requirement.name + requirement.identity + targetPlatform
```

每个等待者只使用自己剩余的 setup deadline。
一个等待者超时不会给共享任务追加新时限;仍有其它有效等待者时,共享任务可以继续为它们完成。

## Contribution 是单数槽位

```typescript
interface EnvironmentContribution {
  readonly requirement: EnvironmentRequirement;
  readonly base?: SandboxCaseSource;
}
```

Eval 与 Experiment 各自读取出一个 contribution。
`base` 表示该完整 `Sandbox Case` 预期满足同点声明的 Requirement,但启动后仍执行 `verify`。

单数槽位是本方案的公开限制。
证书、内部 registry 与工具同时存在时,作者必须把它们包装成一个复合 Requirement。
复合对象可以自己完成全量检查与安装,但成员不会分别获得 identity、资源、活动和错误归属。

## Eval 贡献 Base

```typescript
export default defineEval({
  environment: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    mainService: "client",
    requirement: {
      name: "terminal-bench/sheets",
      identity: {
        composeDigest: COMPOSE_SHA256,
        taskRevision: "2026-07-31",
      },
      verify: verifySheetsTaskEnvironment,
    },
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

`composeSandbox()` 同时产生 Eval Requirement 与完整 Compose Base。
Compose 的 services、网络、volume、ready 条件与主 Sandbox 仍由 `Sandbox Case` 持有。

Eval 也可以只贡献可移植 Ensure:

```typescript
export default defineEval({
  environment: defineEvalEnvironment({
    requirement: pythonRuntimeRequirement,
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

这个 Eval 没有 Base。
Experiment Base 或 Provider 中性 case 创建完成后,Runner 再检查并补齐 Python 条件。

## Experiment 贡献 Base 或 Ensure

只贡献 Ensure:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirement: mempalRequirement,
  }),
  sandbox: e2bSandbox(),
  agent: codexAgent(),
});
```

贡献 Experiment Base:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirement: mempalRequirement,
    base: { template: "acme/mempal-runtime-v5" },
  }),
  sandbox: e2bSandbox(),
  agent: codexAgent(),
});
```

本方案还把 `e2bSandbox({ template })`、`dockerSandbox({ source: { type: "image", image } })` 与 `vercelSandbox({ snapshotId })`
这类 SandboxSpec 显式起点归一成 Experiment Base。
SandboxSpec 起点与 `environment.base` 同时出现时是重复 Base 声明,启动期报配置错误。

## 融合 cases 表

Eval 与 Experiment 都有 Base 时,Experiment 必须按 environment profile 提供完整融合 case:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirement: mempalRequirement,
    base: { template: "acme/mempal-runtime-v5" },
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

`cases` 第一版只接受精确 profile key。
表值是已经融合两侧条件的完整 `Sandbox Case`,不是 Runner 要继续合并的局部片段。
表项替代两个独立 Base,不替代两份 Requirement。

一次 Experiment 可以声明多个候选 case。
矩阵展开后,每条 Attempt 只按自己的 Eval profile 选择其中一个。
缺失融合 case 时,Runner 在创建任何 Sandbox 前一次列出全部缺失 profile。

## 安装能力与不兼容

Requirement verify 未命中后,Runner 按以下顺序决定下一步:

1. `install` 不存在:该 Eval × Experiment 组合运行期不兼容。
2. `install` 存在,但 Sandbox 缺少它声明所需的上传、命令或权限能力:运行期不兼容。
3. 安装能力满足:调用 `prepare`,再上传、安装并复检。

前两种结果都发生在 Agent 开始前,不会产生 Agent turn。
Provider 不支持合法 Sandbox source kind 属于计划期 `skipped`,与已经创建 Sandbox 后的安装不兼容分开。

## AgentProvisioner 保持独立

```typescript
interface AgentProvisioner {
  readonly identity: JsonValue;
  readonly resources: readonly string[];

  resolveTarget(ctx: AgentTargetContext): Promise<ResolvedAgentTarget>;
  prepare?(ctx: AgentPrepareContext): Promise<PreparedAgentPayload>;
  check(ctx: AgentCheckContext): Promise<AgentCheck>;
  install(
    ctx: AgentInstallContext,
    payload?: PreparedAgentPayload,
  ): Promise<void>;
}
```

AgentProvisioner 继续拥有目标平台探测、staged payload、安装模式、Agent 启动条件与逐 Attempt 安装事实。
它可以复用 single-flight、deadline 与资源互斥设施,但不会被转换成 `EnvironmentRequirement`。

## 运行事实

每个 Requirement 至少产生以下可观察事实:

```typescript
interface RequirementActivity {
  readonly owner: "eval" | "experiment" | "agent";
  readonly name: string;
  readonly targetIdentity: JsonValue;
  readonly actualIdentity?: JsonValue;
  readonly targetPlatform: TargetPlatform;
  readonly initialCheck: RequirementCheck;
  readonly preparedPayload?: {
    readonly identity: JsonValue;
    readonly digest: string;
  };
  readonly installed: boolean;
  readonly recheck?: RequirementCheck;
  readonly finalCheck: RequirementCheck;
  readonly durationMs: number;
}
```

实际事实与活动进入 Attempt 数据,不反向成为下一次运行的受信状态证明。
复用 Sandbox 时每条 Attempt 都产生自己的检查活动。
