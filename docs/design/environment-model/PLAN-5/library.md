# PLAN-5 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇定义推荐方案的候选声明面。
它不是已定稿 Feature API,但公开形状完整表达默认 case、条件基底、Requirement 集合与两层不兼容结果。

## 三个领域入口

| 所有者 | 入口 | 产物 |
|---|---|---|
| Eval | `composeSandbox()`、`defineEvalEnvironment()` 与题目 helper | Eval `EnvironmentContribution` |
| Experiment | `defineExperimentEnvironment()` | Experiment `EnvironmentContribution` 与融合 cases 表 |
| Agent | Adapter 工厂 | `AgentProvisioner` |

Eval 与 Experiment contribution 参与 Base Case 选择。
AgentProvisioner 不提供 Base,也不实现通用 Requirement 接口。

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

`name` 在同一个所有者的 contribution 内唯一。
解析成安装图后使用 `owner + name` 作为稳定节点键,因此 Eval 与 Experiment 可以各自使用领域内的自然名称。

`identity` 是声明目标身份。
版本、脚本 revision、模型、证书与 payload digest 等语义输入必须进入该值。
函数体不自动参与哈希。

`verify` 读取已经创建的完整 Sandbox Case。
它可以消费主 Sandbox 命令结果,也可以使用 ready、services、能力与身份事实。
返回值必须包含实际事实或不匹配原因,不能只返回 boolean。

`prepare` 与 `install` 都可省略。
省略后,Requirement 只能通过所选 Base 的现有事实满足。
Runner 只有在 verify 未命中后才检查安装入口和 Sandbox 能力。

## Ensure 上下文

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

宿主侧准备写入 `stageDir`。
`install` 通过 Sandbox 文件 API 上传并消费准备结果,不要求题面网络可以下载依赖。

准备任务按以下元组 single-flight:

```text
owner + requirement.name + requirement.identity + targetPlatform
```

每个等待者继续受自己的剩余 setup deadline 限制。
一个等待者超时不会为共享工作追加时间;仍有其它有效等待者时,工作可以继续服务它们。
所有等待者离开后,共享准备不能脱离 Run 无限运行。

## Contribution 携带集合

```typescript
interface EnvironmentContribution {
  readonly requirements: readonly EnvironmentRequirement[];
  readonly base?: SandboxCaseSource;
}
```

`requirements` 省略或空数组表示该所有者没有额外环境事实。
集合参与哈希前按成员 `name` 排序。
数组位置不表达依赖、安装顺序或优先级。

`base` 是与同点 Requirement 集合绑定的条件基底。
它表示该完整 Sandbox Case 预期满足集合内每个成员,但启动后所有成员仍执行 `verify`。

一个 contribution 只能提供一个 Base。
需要按 Eval profile 提供多个融合 case 时,使用 Experiment 的 `cases` 表。

## Eval contribution

题目自带完整 Compose Base:

```typescript
export default defineEval({
  environment: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    mainService: "client",
    requirements: [
      composeServicesRequirement({
        profile: "terminal-bench/sheets",
        composeDigest: COMPOSE_SHA256,
      }),
      taskDatasetRequirement({
        digest: DATASET_SHA256,
      }),
    ],
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

`composeSandbox()` 产生 Eval Base 与 Requirement 集合。
Compose 的 services、网络、volume、ready 条件、主 Sandbox 与资源组继续归完整 Sandbox Case。

Eval 也可以只贡献可移植 Ensure:

```typescript
export default defineEval({
  environment: defineEvalEnvironment({
    requirements: [
      pythonRuntimeRequirement({ version: "3.12" }),
      taskDatasetRequirement({ digest: DATASET_SHA256 }),
    ],
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

该 Eval 没有 Base。
Runner 在条件基底、默认 case 或 Provider 中性 case 上验证并补齐这些成员。

## Experiment Requirement 集合

只贡献 Ensure:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [
      companyCertificates({ bundleDigest: COMPANY_CA_SHA256 }),
      internalRegistry({
        endpoint: "https://registry.example.test",
        dependsOn: ["company-certificates"],
      }),
      mempalRequirement({
        version: "0.9.0",
        modelDigest: MODEL_SHA256,
        dependsOn: ["internal-registry"],
      }),
    ],
  }),
  sandbox: e2bSandbox({
    template: "base-node-22",
  }),
  agent: codexAgent(),
});
```

这里的 `sandbox.template` 是普通默认 case。
它不表示 template 预装了证书、registry 或 mempal,也不构成 Experiment Base。

## Experiment 条件基底

只有 `defineExperimentEnvironment()` 内与 Requirement 集合同点声明的 `base` 才是条件基底:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [
      companyCertificates({ bundleDigest: COMPANY_CA_SHA256 }),
      mempalRequirement({
        version: "0.9.0",
        modelDigest: MODEL_SHA256,
      }),
    ],
    base: {
      template: "acme/mempal-runtime-v5",
    },
  }),
  sandbox: e2bSandbox({
    template: "base-node-22",
  }),
  agent: codexAgent(),
});
```

条件基底存在时,没有 Eval Base 的 Attempt 选择它。
`base-node-22` 仍保留为普通默认 case,只在 Eval 与 Experiment 都没有 Base 时使用。

条件基底预期满足集合内全部成员。
某个成员 verify 未命中时,Runner 对该成员单独 Ensure;没有 install 时产生运行期不兼容。

## spec `environments` 表归 Eval 一侧

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [mempalRequirement(MEMPAL_CONFIG)],
  }),
  sandbox: e2bSandbox({
    template: "base-node-22",
    environments: {
      "terminal-bench/sheets": {
        template: "acme/tb-sheets-v5",
      },
    },
  }),
  agent: codexAgent(),
});
```

`environments` 表项是 Eval Requirement 的预制实现,归 Eval Base。
表项优先于同一 profile 的 folder-local source 现场构建。
这条优先级只在 Eval 一侧选择实现,不把表项改成 Experiment Base。

默认 case 与 `environments` 表可以共存。
命中表项的 Eval 使用表项,没有题目 Base 的 Eval 使用普通默认 case。

## 融合 cases 表

Eval Base 与条件基底同时存在时,Experiment 必须按 profile 提供已经融合双方条件的完整 case:

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [
      companyCertificates({ bundleDigest: COMPANY_CA_SHA256 }),
      mempalRequirement(MEMPAL_CONFIG),
    ],
    base: {
      template: "acme/mempal-runtime-v5",
    },
    cases: {
      "terminal-bench/sheets": {
        template: "acme/tb-sheets-mempal-v5",
      },
      "terminal-bench/postgres": {
        template: "acme/tb-postgres-mempal-v3",
      },
    },
  }),
  sandbox: e2bSandbox({
    template: "base-node-22",
  }),
  agent: codexAgent(),
});
```

`cases` 第一版只接受精确 profile key。
表值是完整 Sandbox Case,不是 Runner 要继续拼接的局部配置。
它替代双方 Base,不删除双方 Requirement 集合。

`environments` 与融合 `cases` 同时命中一个 profile 时,选择融合表项。
融合表项预期满足 Eval 与 Experiment 两侧,而 `environments` 表项只预期满足 Eval。
启动后仍逐成员 verify,不会因为承诺范围更大而跳过检查。

## 固定的 Base 选择次序

```text
evalBase =
  matching SandboxSpec environments entry
  or Eval contribution base

conditionalBase =
  Experiment contribution base

if evalBase && conditionalBase:
  select exact fused cases entry
else if evalBase:
  select evalBase
else if conditionalBase:
  select conditionalBase
else:
  select SandboxSpec default case
  or Provider neutral case
```

默认 case 不进入双 Base 条件。
因此有题目 Base 的 Eval 与没有 Base 的 Eval 可以在同一 Experiment 中运行。

## 安装能力与不兼容

每个未命中的 Requirement 成员独立经过以下判定:

1. `install` 不存在:该组合运行期不兼容。
2. `install` 存在,但 Sandbox 缺上传、命令或权限能力:运行期不兼容。
3. 能力满足:调用 `prepare`,再上传、安装并复检。

已经满足的成员不会执行安装能力检查。
一个条件基底可以在不支持现场安装的 Provider 上使用,前提是实际 verify 命中。

Provider 不支持合法 Sandbox source kind 属于计划期 `skipped`。
重复名称、依赖环、profile 缺项与双 Base 缺融合 case 属于启动期配置错误。
verify 后无法收敛属于运行期不兼容。

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

AgentProvisioner 继续拥有目标平台探测、staged payload、安装模式、Agent 启动条件和逐 Attempt 安装事实。
它可以复用 single-flight、deadline 与资源互斥设施,但不会进入 `requirements` 数组或 Base Case 竞争。

## 运行事实

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

实际事实与活动进入 Attempt 记录。
它们解释本次检查和安装,不成为下一次运行跳过 verify 的依据。
复用 Sandbox 时每条 Attempt 仍产生自己的检查与最终屏障活动。
