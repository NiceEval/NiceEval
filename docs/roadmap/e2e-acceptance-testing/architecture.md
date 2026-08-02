# E2E 验收测试方案 —— Architecture

本篇定义验收测试的登记、证据生产、调度、验证与准入边界。Behavior 的作者 schema 单源在
[PLAN-2](../../design/user-readable-testing/PLAN-2/README.md)，媒介解析与领域断言单源在
[E2E 验收 DSL](../e2e-acceptance-dsl/README.md)。

## 实体关系

```text
CoverageCategory ──要求──▶ BehaviorDeclaration
                                  │
                                  ├──绑定──▶ EvidenceRecipeDeclaration
                                  │               │
                                  │               └──prepare──▶ WorldManifest
                                  │                                │
                                  └──登记──▶ ExecutionRegistration │
                                                   │               │
                                                   └──verify───────┘
                                                           │
                                                           ▼
                                                   BehaviorOutcome
```

六个实体各有一个职责：

- Coverage Category 表示需要持续证明的高风险工程类别，例如 Report target 闭环。
- Behavior Declaration 表示稳定用户结果；其身份、任务和契约链接由 PLAN-2 定义。
- Evidence Recipe Declaration 表示怎样准备一次可复用的真实输入世界。
- World Manifest 是某次 prepare 的纯数据收据，不包含运行时代码。
- Execution Registration 决定 Behavior 以哪个频率和资源类别运行。
- Behavior Outcome 记录某次验证的执行结论与证据，不反写静态声明。

## Recipe 与 World

Recipe declaration 是签入仓库的代码声明。它可以执行公开命令、创建消费方项目或启动所需服务，但必须把可复用结果原子发布成只读 world。

```ts
interface EvidenceRecipeDeclaration {
  id: string;
  version: number;
  profile: "deterministic" | "external" | "lifecycle";
  producer: {
    module: string;
    export: string;
    inputs: readonly string[];
  };
  capabilities: readonly (
    | "candidate-package"
    | "process"
    | "browser"
    | "network"
    | "provider"
    | "sandbox"
    | "signal"
  )[];
}

interface EvidenceRecipeDefinition extends EvidenceRecipeDeclaration {
  prepare(ctx: RecipeContext): Promise<WorldManifest>;
}

interface RecipeContext {
  readonly candidateTarball: string;
  consumerProject(
    name: string,
    options: {
      fixture?: string;
      tsconfig?: false;
      jsx?: "react" | "react-jsx";
    },
  ): Promise<ConsumerProject>;
  deliberateRecord(fixture: string): Promise<{ resultsRoot: string }>;
  fixture(path: string): string;
  publishReadOnly(draft: WorldDraft): Promise<WorldManifest>;
}

interface ConsumerProject {
  readonly name: string;
  readonly root: string;
  path(relativePath: string): string;
  locator(name: string): string;
  cli(
    shellLiteral: string,
    options?: { pipe?: boolean; expect?: number | "nonzero" },
  ): Promise<PreparedProcess>;
  installCandidate(tarball: string): Promise<void>;
  write(relativePath: string, sourcePath: string): Promise<void>;
}

interface PreparedProcess {
  command: string;
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  combinedPath: string;
  exitCode: number;
  signal?: string;
}

interface WorldDraft {
  resultsRoot?: string;
  exports?: Readonly<Record<string, string>>;
  artifacts?: Readonly<Record<string, string>>;
  consumers?: Readonly<Record<string, string>>;
  processes?: Readonly<Record<string, PreparedProcess>>;
  locators?: Readonly<Record<string, string>>;
  targets?: Readonly<Record<string, { pageId: string; key: string }>>;
}

interface WorldManifest {
  schemaVersion: 1;
  worldId: string;
  recipe: {
    id: string;
    version: number;
    digest: string;
  };
  candidate: {
    packagePath: string;
    digest: string;
  };
  producer: {
    module: string;
    export: string;
    closureDigest: string;
  };
  roots: {
    workspace: string;
    results?: string;
    exports: Readonly<Record<string, string>>;
    artifacts: Readonly<Record<string, string>>;
    consumers: Readonly<Record<string, string>>;
  };
  identities: {
    locators: Readonly<Record<string, string>>;
    targets: Readonly<Record<string, { pageId: string; key: string }>>;
    processes: Readonly<Record<string, PreparedProcess>>;
  };
  permissions: {
    mode: "read-only" | "mutable-clone";
    writeRoots: readonly string[];
    mutationActionIds: readonly string[];
  };
  resources: readonly {
    id: string;
    kind: "process" | "browser" | "port" | "sandbox" | "lease";
    owner: string;
    cleanupActionId: string;
  }[];
}
```

`recipe.digest` 覆盖 fixture、producer symbol closure、环境声明和输入文件。`candidate.digest` 单独记录实际安装并执行的候选包。
verifier 的代码身份写入 Verification Run，不进入 recipe digest；修改 matcher 不应迫使真实模型重新运行。

World Manifest 只使用可移植的纯数据。函数、Browser、子进程句柄和 secret 值不能进入 manifest。
运行时句柄归本次执行器所有，通过 manifest 中的资源身份和 cleanup action 关联。

## 执行登记

执行登记把静态 Behavior 放进可运行矩阵，不复制 Behavior 的任务、契约或预期。

```ts
interface ExecutionRegistration {
  behaviorId: string;
  cadence: "change-card" | "pull-request" | "scheduled";
  resourceClass: "ordinary" | "service" | "exclusive-external";
  timeoutMs: number;
}
```

静态守护双向核对 Coverage Category、Behavior 主证明、Recipe 和 Execution Registration。
Behavior execution binding 给出 recipe ID，recipe 决定 profile；执行登记不复制这两个事实。
守护还要核对 resource class 与 execution mode、recipe capabilities 相容。

read-only / mutable-clone 是 Behavior execution mode，service / external 是独立的调度资源维度；可变 view 因此可以同时是 mutable-clone 和 service。
它不枚举测试文件里的具体 scenario，也不把一次运行结果写回登记表。

## 一次 Verification Run

```text
discover declarations
  → select Behaviors
  → validate candidate and recipe identities
  → prepare or reuse a matching world
  → atomically publish the World Manifest
  → schedule Behavior verifiers
  → aggregate every Behavior Outcome
  → run unconditional cleanup
  → decide admission
```

每个 Behavior Outcome 都使用同一组阶段：

```ts
type VerificationPhase =
  | "prepare"
  | "invoke"
  | "observe"
  | "outcome"
  | "cleanup";

interface BehaviorOutcome {
  behaviorId: string;
  status: "passed" | "failed" | "not-run";
  phase: VerificationPhase;
  worldId?: string;
  assertions: readonly {
    id: string;
    evidence: readonly string[];
  }[];
  reproduction: string;
}
```

prepare 失败时，依赖该 world 的 Behavior 记录 `not-run`，其它独立 world 继续执行。Behavior outcome 失败不会遮住同批其它 verifier。
进程最终退出码由全部被选 Behavior、required boundary proof 与 cleanup 结果共同折叠。

## 调度与并发

调度按资源所有权决定，不按文件名或声明顺序决定：

| 条件 | 调度规则 | 隔离边界 |
|---|---|---|
| execution mode 为 `read-only` | 可并发 | 独立临时输出、BrowserContext、Page 与日志 |
| execution mode 为 `mutable-clone` | clone 之间可并发；同一 clone 内 action 串行 | 私有写集、端口命名空间与 owner |
| resource class 为 `service` | 默认串行 | 动态端口、独立进程组、无条件 cleanup |
| resource class 为 `exclusive-external` | 按 provider / sandbox owner 限流 | 最小 secret 注入、外部资源清单与 lease |

同一 browser process 可以复用，BrowserContext、Page、console/request 日志和截图不能跨 Behavior 复用。
调度契约比较带身份事件的偏序与 overlap，不比较不稳定的墙钟阈值。

## 失败与诊断

最早知道事实错误的阶段负责失败：

- prepare：候选包、recipe、fixture、world 身份或权限错误。
- invoke：公开命令、消费方、hosting、provider 或 service 无法启动。
- observe：流、文件、HTTP、DOM 或解析结果不可消费。
- outcome：verdict、identity、公式、时间线或可见状态不满足契约。
- cleanup：进程、端口、sandbox、lease 或外部资源没有收束。

失败必须包含 Behavior ID、阶段、已执行 action、公开对象身份、实际观察、期望、证据路径和最短复现命令。
observer 解析失败属于 observe failure，不能返回空集合、`undefined` 或跳过。

## 身份、复用与准入

World 只有在 candidate digest、recipe digest、producer closure 和声明环境全部相同时才可复用。
read-only verifier 前后核对受保护根的 digest；需要写入的 Behavior 只能使用登记过的 mutable clone 和 mutation action。

一条 proof 进入门禁前同时满足：

1. 当前候选经真实公开入口通过；
2. fix parent 或最小历史逆补丁在预期阶段失败；
3. 一个同形反证也失败；
4. 非契约文案、DOM class、ANSI 与毫秒扰动不误红；
5. malformed 或 unsupported 观察使 observer 显式失败；
6. 用户代码不需要测试探针。

完整代码路径见 [Use Cases](use-case/README.md)。
