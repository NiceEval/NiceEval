# PLAN-11 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇定义推荐方案的候选声明面。
它不是已定稿 Feature API,但公开形状完整表达默认 case、条件基底、Requirement 集合与两层不兼容结果。

## 三个领域入口

| 所有者 | 入口 | 产物 |
|---|---|---|
| Eval | `composeSandbox()`、`defineEvalEnvironment()` 与题目 helper | Eval `EnvironmentContribution` |
| Experiment | `defineExperimentEnvironment()` 与可选 `defineExperimentState()` | Experiment `EnvironmentContribution`、融合 cases 表与独立状态生命周期 |
| Agent | Adapter 工厂 | `AgentEnvironmentContribution` |

Eval 与 Experiment contribution 参与 Base Case 选择。
Agent contribution 不提供 Base,也不实现通用 Requirement 接口。

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

interface EvalEnvironmentContribution extends EnvironmentContribution {
  readonly profile?: string;
}

interface ExperimentEnvironmentContribution extends EnvironmentContribution {
  readonly cases?: Readonly<Record<string, SandboxCaseSource>>;
}
```

`requirements` 为空数组表示该所有者没有额外环境事实。
集合参与哈希前按成员 `name` 排序。
数组位置不表达依赖、安装顺序或优先级。

Eval 的 `base` 是题目 Base。
Experiment 的 `base` 是与同点 Requirement 集合绑定的条件基底。
它们都表示完整 Sandbox Case 预期满足所属成员,但启动后所有成员仍执行 `verify`。

一个 contribution 只能提供一个 Base。
需要按 Eval profile 提供多个融合 case 时,使用 Experiment contribution 的 `cases` 表。
AgentProvisioner 没有这两个字段,不能贡献 Base 或融合表项。

## Experiment 状态保持独立

外部实验状态既不是 Requirement install,也不是早期 `SandboxSpec.setup()`。
PLAN-11 为需要在 Agent CLI 就位后载入的状态保留独立相位:

```typescript
interface StateCheckpoint {
  readonly identity: JsonValue;
  readonly digest?: string;
  readonly facts: Readonly<Record<string, JsonValue>>;
}

interface ExperimentStateContext {
  readonly phase: "load" | "save";
  readonly experimentId: string;
  readonly windowId: string;
  readonly sandboxCase: RunningSandboxCase;
  readonly sandbox: Sandbox;
  readonly deadline: Deadline;
  readonly signal: AbortSignal;
}

type StateConsistency =
  | { readonly mode: "pinned"; readonly revision: string }
  | { readonly mode: "rolling" };

type StateSavePolicy =
  | "after-load"
  | "attempt-succeeded";

interface ExperimentStateLifecycle {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;

  load(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
  save(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
}
```

`identity` 必须包含 store、cohort 与 schema。
`consistency: { mode: "pinned", revision }` 固定输入 checkpoint;revision 进入 configHash,load 不匹配时失败。
`consistency: { mode: "rolling" }` 明确允许状态沿序列演化,并关闭该 Experiment 的结果携带。

`saveOn` 显式决定 load 成功后的失败 Attempt 是否提交状态:

| 值 | save 条件 |
|---|---|
| `after-load` | 只要 load 成功,后续 Fixture、runtime、Agent turn、verifier、断言求值或 teardown 失败也在 outer-finally 尝试 save |
| `attempt-succeeded` | 仅用于 fresh;本 Attempt 的 Agent turn、verifier、断言求值、隐藏判分 cleanup 与 Agent runtime teardown 全部成功才 save |

两种策略都在隐藏判分 cleanup 失败时跳过 save,避免隐藏材料进入 checkpoint。
Provider 硬丢实例时 save 记为 `unavailable`,不是假装成功。
Eval teardown 位于 fresh save 之后,仍沿既有规则只追加诊断,不反改已经提交的 checkpoint。
`sandboxReuse: true` 必须配 `saveOn: "after-load"`。
复用窗口没有逐 Attempt 状态回滚,不能承诺丢弃失败 Attempt 已经写入的活状态。

`load()` 返回实际载入的 checkpoint identity、digest 与中性事实;`save()` 返回成功提交的新 checkpoint。
save 使用独立 cleanup deadline 与 signal,不会复用已经超时或取消的 Attempt signal。

后继 checkpoint 规则固定如下:

| consistency | 首次 load | fresh 下一 Attempt | reuse 窗口轮换 |
|---|---|---|---|
| `pinned(revision)` | 读取并核对固定 revision | 仍读取同一固定 revision;本次 save 只作输出,不成为后继 | 新窗口仍从固定 revision 开始;需要连续演化时不能选 pinned |
| `rolling` | 读取 store 当前已提交 head | 必须读取上一条成功 save 的 checkpoint | 旧窗口 save 成功后,新窗口必须 load 该 checkpoint |

`rolling` 同一 cohort 的 load → save 临界区必须串行,因此要求 `maxConcurrency: 1`。
save 失败后没有合法后继,Runner 停止继续派发该状态序列。
fresh 的 `attempt-succeeded` 主动跳过 save 时,head 保持在本次 load 的 predecessor。
后续 `rolling` Attempt 从该 head 重新 load,不会继承失败 Attempt 的活状态。
因 load 失败、隐藏判分 cleanup 失败、save 失败或 transfer unavailable 形成的缺口不是主动策略,状态序列停止。

```typescript
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [mempalRequirement(MEMPAL_CONFIG)],
  }),
  state: defineExperimentState({
    identity: {
      store: "mempal",
      cohort: MEMPAL_COHORT,
      schema: 2,
    },
    consistency: { mode: "rolling" },
    saveOn: "after-load",
    load: (ctx) => mempalLoad(ctx),
    save: (ctx) => mempalSave(ctx),
  }),
  sandbox: e2bSandbox({ template: "base-node-22" }),
  agent: codexAgent(),
  sandboxReuse: true,
  maxConcurrency: 1,
});
```

不复用时每条 Attempt 各执行一次 load/save。
复用时每个 Sandbox window 各执行一次,中间 Attempt 直接观察同一份活状态。
Nowledge 的 nmem attach、远端能力探测等环境条件仍属于 Experiment Requirement;只有 checkpoint load/save 进入这套状态接口。

## Eval contribution

题目自带完整 Compose Base:

```typescript
export default defineEval({
  environment: defineEvalEnvironment({
    base: tbComposeEnvironment("simple-sheets-put", {
      mainService: "client",
    }),
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

`tbComposeEnvironment()` 返回完整 Compose Base。
真实 helper 填入 `T_BENCH_*` image、container、`TEST_DIR` 与日志路径插值,并固定 `build: "on-demand"`、`executionUser: "image"`。
随机 container name 与宿主日志目录只作为 materialization facts;helper revision 与变量键集合进入 CaseKey,动态值不进入 BuildKey 或 CaseKey。
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

## turn 后隐藏 verifier Fixture

`EvalDef.setup/teardown` 继续承载 turn 前可见的 Fixture。
workdir 外隐藏测试、mount、进程与临时凭据使用单独的受管 HiddenVerifierFixture,不能只依赖普通 teardown:

```typescript
interface HiddenVerifierCleanupContext {
  readonly sandboxCase: RunningSandboxCase;
  readonly sandbox: Sandbox;
  readonly deadline: Deadline;
  readonly signal: AbortSignal;
}

interface HiddenVerifierMaterializeContext
  extends HiddenVerifierCleanupContext {
  onCleanup(
    name: string,
    cleanup: (ctx: HiddenVerifierCleanupContext) => Promise<void>,
  ): void;
}

interface HiddenVerifierFixture {
  readonly identity: JsonValue;
  materialize(ctx: HiddenVerifierMaterializeContext): Promise<void>;
}

interface HiddenVerifierController {
  using<T>(
    fixture: HiddenVerifierFixture,
    evaluate: (ctx: HiddenVerifierCleanupContext) => Promise<T>,
  ): Promise<T>;
}
```

`t.verifier.using()` 只能在最后一次 Agent turn 返回后进入。
一旦进入,该 Eval 的 `send/reply` 面永久关闭;Runner 先 materialize,再执行 evaluate,最后在 `finally` 中按 LIFO 运行全部 cleanup。
每个外部副作用必须在取得资源前先 `onCleanup`;这样 materialize 中途失败也有可执行的收尾栈。

Terminal-Bench 可以把现有搬运与判分改成:

```typescript
const officialTests = defineHiddenVerifierFixture({
  identity: {
    kind: "terminal-bench-official-tests",
    taskId: "simple-sheets-put",
    revision: 1,
  },
  async materialize(ctx) {
    ctx.onCleanup("official-tests", async ({ sandbox }) => {
      await sandbox.runShell(
        `rm -rf /tests ${JSON.stringify(`${sandbox.workdir}/tests`)}`,
        { root: true },
      );
    });
    await mountOfficialTests(ctx.sandbox, "simple-sheets-put");
  },
});

export default defineEval({
  environment: defineEvalEnvironment({
    base: tbComposeEnvironment("simple-sheets-put", {
      mainService: "client",
    }),
    requirements: [
      composeServicesRequirement({
        profile: "terminal-bench/sheets",
        composeDigest: COMPOSE_SHA256,
      }),
    ],
  }),
  async test(t) {
    await t.send(TASK);
    await t.verifier.using(officialTests, async ({ sandbox }) => {
      t.check(
        await runOfficialTests(sandbox, { timeoutSec: 600 }),
        commandSucceeded(),
      );
    });
  },
});
```

判据文件仍由 `loadCriteria` 一类 loader 登记内容指纹。
`HiddenVerifierFixture.identity` 只描述 materialize / cleanup 配方。
cleanup 失败把 Attempt 改为 `errored`,跳过 state save、退休复用窗口并停止依赖该状态的序列;这条语义不同于只追加诊断的普通 `EvalDef.teardown`。

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
  sandbox: dockerSandbox({
    image: "node:22",
    environments: {
      "service/python-api": {
        compose: {
          file: "environments/python-api.compose.yaml",
          mainService: "client",
        },
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

表值必须是完整 Provider-native Case。
上例是 Docker 原生 `{ compose }` 表值,不是中性的 `ComposeSandboxSource`。
Terminal-Bench 的真实 `tbComposeEnvironment()` 应留在 Eval contribution,不能直接放进这个表。
若同一 profile 需要中央覆盖,适配层必须产出当前 Provider 的原生 case。
这个 case 仍须兑现 `T_BENCH_*` 插值、按需 build、image user 与完整服务组。
不能用单 Sandbox template 名或只给一个 Compose 路径,冒充可启动的三服务 Case。

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
      image: "ghcr.io/acme/mempal-runtime:v5",
    },
    cases: {
      "terminal-bench/sheets": {
        compose: {
          file: "environments/tb-sheets-mempal.compose.yaml",
          mainService: "client",
          build: "on-demand",
          executionUser: "image",
          env: harborComposeEnv("simple-sheets-put"),
        },
      },
      "terminal-bench/postgres": {
        compose: {
          file: "environments/tb-postgres-mempal.compose.yaml",
          mainService: "client",
          build: "on-demand",
          executionUser: "image",
          env: harborComposeEnv("postgres"),
        },
      },
    },
  }),
  sandbox: dockerSandbox({
    image: "node:22",
    materializers: {
      compose: dockerComposeMaterializer(),
    },
  }),
  agent: codexAgent(),
});
```

`cases` 第一版只接受精确 profile key。
表值是完整 Sandbox Case,不是 Runner 要继续拼接的局部配置。
它替代双方 Base,不删除双方 Requirement 集合。
Compose 融合表项仍要保留变量插值、按需 build、image user、每项服务、ready、network、资源组与 finalizer;这里只是改用一份已经融合实验条件的 Compose 定义。

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

## Agent 的安装与 runtime 保持两段

```typescript
interface AgentEnvironmentContribution {
  readonly provisioner: AgentProvisioner;
  readonly runtime: AgentRuntimeLifecycle;
}

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

interface AgentRuntimeCheck {
  readonly satisfied: boolean;
  readonly actualIdentity?: JsonValue;
  readonly reason?: string;
  readonly facts: Readonly<Record<string, JsonValue>>;
}

interface AgentRuntimeLifecycle {
  readonly identity: JsonValue;

  setup(ctx: AgentRuntimeContext): Promise<void>;
  verify(ctx: AgentRuntimeContext): Promise<AgentRuntimeCheck>;
  teardown(ctx: AgentRuntimeContext): Promise<void>;
}
```

AgentProvisioner 继续拥有目标平台探测、staged payload、安装模式、Agent 启动条件和逐 Attempt 安装事实。
它可以复用 single-flight、deadline 与资源互斥设施,但不会进入 `requirements` 数组或 Base Case 竞争。

Agent runtime identity 包含非敏感的鉴权引用名、配置 digest、Plugin / Skill 来源与 ref、MCP 声明。
setup 后必须真实 verify;最终屏障再次运行 AgentProvisioner check 与 runtime verify。
因此 CLI 存在但 Plugin、Skill、MCP 或配置静默失败时,Agent turn 不会开始。

## 运行事实

```typescript
interface EnvironmentRequirementActivity {
  readonly owner: "eval" | "experiment";
  readonly name: string;
  readonly targetIdentity: JsonValue;
  readonly actualIdentity?: JsonValue;
  readonly targetPlatform: TargetPlatform;
  readonly outcome: "succeeded" | "failed" | "blocked";
  readonly terminatedAt:
    | "initial-verify"
    | "prepare"
    | "install"
    | "recheck"
    | "full-barrier"
    | "final-barrier"
    | "completed";
  readonly initialCheck?: RequirementCheck;
  readonly preparedPayload?: {
    readonly identity: JsonValue;
    readonly digest: string;
  };
  readonly installed?: boolean;
  readonly recheck?: RequirementCheck;
  readonly fullBarrierCheck?: RequirementCheck;
  readonly finalCheck?: RequirementCheck;
  readonly error?: string;
  readonly durationMs: number;
}

interface AgentEnsureActivity {
  readonly provisionerIdentity: JsonValue;
  readonly runtimeIdentity: JsonValue;
  readonly outcome: "succeeded" | "failed";
  readonly terminatedAt:
    | "provisioner-check"
    | "provisioner-prepare"
    | "provisioner-install"
    | "provisioner-recheck"
    | "runtime-setup"
    | "runtime-verify"
    | "final-barrier"
    | "completed";
  readonly initialProvisionerCheck?: AgentCheck;
  readonly installed?: boolean;
  readonly provisionerRecheck?: AgentCheck;
  readonly runtimeEntered: boolean;
  readonly runtimeCheck?: AgentRuntimeCheck;
  readonly finalProvisionerCheck?: AgentCheck;
  readonly finalRuntimeCheck?: AgentRuntimeCheck;
  readonly runtimeTeardown?: {
    readonly outcome: "succeeded" | "failed";
    readonly error?: string;
  };
  readonly error?: string;
  readonly durationMs: number;
}

type StateTransferError = {
  readonly code: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, JsonValue>>;
};

type StateTransferActivity =
  | {
      readonly phase: "load" | "save";
      readonly outcome: "succeeded";
      readonly checkpoint: StateCheckpoint;
      readonly durationMs: number;
    }
  | {
      readonly phase: "load" | "save";
      readonly outcome: "failed";
      readonly error: StateTransferError;
      readonly durationMs: number;
    }
  | {
      readonly phase: "save";
      readonly outcome: "skipped";
      readonly reason:
        | "load-failed"
        | "save-policy"
        | "verifier-cleanup-failed";
      readonly durationMs: 0;
    }
  | {
      readonly phase: "load" | "save";
      readonly outcome: "unavailable";
      readonly reason: "sandbox-lost" | "provider-unreachable";
      readonly error?: {
        readonly code: string;
        readonly message: string;
        readonly data?: Readonly<Record<string, JsonValue>>;
      };
      readonly durationMs: number;
    };

interface ExperimentStateActivity {
  readonly declaredIdentity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
  readonly windowId: string;
  readonly load: StateTransferActivity;
  readonly save: StateTransferActivity;
}

interface HiddenVerifierActivity {
  readonly fixtureIdentity: JsonValue;
  readonly outcome: "succeeded" | "failed";
  readonly terminatedAt:
    | "materialize"
    | "evaluate"
    | "cleanup"
    | "completed";
  readonly cleanup: readonly {
    readonly name: string;
    readonly outcome: "succeeded" | "failed" | "unavailable";
    readonly error?: string;
  }[];
  readonly error?: string;
  readonly durationMs: number;
}
```

实际事实与活动进入 Attempt 记录。
它们解释本次检查和安装,不成为下一次运行跳过 verify 的依据。
复用 Sandbox 时每条 Attempt 仍产生自己的检查与最终屏障活动。
状态活动按 fresh Attempt 或复用 window 记录,不会伪装成每条复用 Attempt 都重新 load/save。
隐藏 verifier 活动只保存 identity、阶段与 cleanup 结果,不落盘判分材料正文。
