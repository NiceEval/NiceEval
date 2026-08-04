# NiceEval 测试体系重构 —— Architecture

本篇定义完整测试 portfolio 的登记、证据生产、调度、验证、退役与准入边界。Behavior 的作者 schema 单源在
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

上图的 Behavior 主证明与机制 proof 共同进入 Proof Portfolio。机制 proof 不要求伪装成用户 Behavior，但必须
声明唯一风险 owner；新增或升级主证明时，Retirement Declaration 负责删除被替代的旧 proof。执行层是 unit
还是 E2E，不改变这套所有权关系。

```text
Behavior ──恰有一个──▶ PrimaryProof ─┐
                                     ├──▶ ProofPortfolio ──▶ Selection / Outcome
MechanismRisk ──恰有一个──▶ MatrixOwner ┘          │
                                                  └──▶ RetirementAudit
```

八个实体各有一个职责：

- Coverage Category 表示需要持续证明的高风险工程类别，例如 Report target 闭环。
- Behavior Declaration 表示稳定用户结果；其身份、任务和契约链接由 PLAN-2 定义。
- Evidence Recipe Declaration 表示怎样准备一次可复用的真实输入世界。
- World Manifest 是某次 prepare 的纯数据收据，不包含运行时代码。
- Execution Registration 决定 Behavior 以哪个频率和资源类别运行。
- Behavior Outcome 记录某次验证的执行结论与证据，不反写静态声明。
- Mechanism Risk 表示主证明无法稳定制造或定位的具名错误算法，不等于源码函数或分支。
- Retirement Declaration 是一次迁移的临时静态输入，证明新 owner 已替代、合并或明确保留旧 proof。

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

type PreparedProcess = {
  command: string;
  cwd: string;
  exitCode: number;
  signal?: string;
} & (
  | { streams: "separate"; stdoutPath: string; stderrPath: string }
  | { streams: "merged"; combinedPath: string }
);

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
    sourceDigest: string;
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
    world: "read-only";
    clones: readonly {
      behaviorId: string;
      writeRoots: readonly string[];
      mutationActionIds: readonly string[];
    }[];
  };
  resources: readonly {
    id: string;
    kind: "process" | "browser" | "port" | "sandbox" | "lease";
    owner: string;
    cleanupActionId: string;
  }[];
}
```

`producer.sourceDigest` 的遍历根是 recipe 模块文件与声明的 fixture 文件，不是叶子：

- 沿相对路径可达、以及非相对 specifier 经 tsconfig paths 或 package.json `imports` 命中仓库内解析的仓库内文件全部计入；
- fixture 自身的 import 链——tsx 会真实执行的那部分——同样计入；
- 逐 fixture 签入的 lockfile 一并计入，堵住同一缓存键在不同机器解出不同依赖树。

静态解析不了的动态 import 使该 recipe 直接标记为不可缓存。

`recipe.digest` 聚合 `producer.sourceDigest` 与环境元组（Node 主版本、操作系统、TZ/LANG、Playwright 浏览器 revision），两者任一变化都产生新的 recipe 身份。`candidate.digest` 单独记录实际安装并执行的候选包，不参与 recipe 身份。
verifier 的代码身份写入 Verification Run，不进入 recipe digest；修改 matcher 不应迫使真实模型重新运行。

World Manifest 只使用可移植的纯数据。函数、Browser、子进程句柄和 secret 值不能进入 manifest。
运行时句柄归本次执行器所有，通过 manifest 中的资源身份和 cleanup action 关联。

`PreparedProcess.streams` 声明进程输出的捕获形态；`separate` 与 `merged` 各自携带哪些路径字段、返回哪层读面，单源见 [DSL · `cli()`](../e2e-acceptance-dsl/library.md)。

`permissions.world` 恒为 `"read-only"`；需要写入的 Behavior 按 `permissions.clones` 逐条登记自己的写根与可执行的 mutation action，使共享同一 recipe 的 read-only 与 mutable Behavior 能够共存。

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

单条 Behavior 的 execution mode 与 resource class 必须唯一：read-only 断言与 mutable-clone / service 断言不能出现在同一条 Behavior 里，这是粒度判据里“一句用户结果陈述”之外唯一机器可判的约束。census、hosting 类结构断言允许作为该 Behavior 用户结果陈述的声明式前置条件共存，不算违反这条唯一性。

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

### 基础设施故障分类

证据日志逐条携带 stepKind，至少区分五类：`harness-fetch`、`harness-install`、`browser-launch`、`candidate-install`、`product-invoke`。基础设施故障出口（exit 75）只能由 `harness-*` 与 `browser-launch` 步骤触发。

`candidate-install`（候选 tarball 装进消费方）归产品侧：坏 exports、files 漏文件或 prepare 链产物缺失，一律判回归，不因为步骤形似安装步骤就归到基础设施。无 stepKind 归属的失败一律判回归，允许经 flake 台账人工改判，不默认走 75。

分类器自身持有一组准入 fixture：真实基础设施故障（如包 registry 不可达）判 75；文案含网络词但实际是产品失败、以及候选坏包安装失败，两者都判回归。分类逻辑变化必须先在这组 fixture 上重新通过才能合入。

### Flake 政策

确定性 lane 不设自动重试。flake 台账是一份签入文件，配一条随所属 E2E 仓库测试套件运行的静态守护：条目超期仍未关联缺陷即红，不依赖人工周期清点。

同一 Behavior 在滚动窗口内进台账满 3 次（不限阶段，竞态的失败阶段会漂移）即强制按回归处理，禁止隔离。隔离唯一合法方式是三件套同批完成：cadence 改为 `scheduled`、开一条缺陷、记一条 memory。`risk` 为 `release-blocking` 的 Behavior 处于隔离状态时阻断 release tag；隔离状态本身不构成对失败的豁免。

external lane 与 lifecycle lane 仅 declared-retryable 步骤自动重试一次；其余步骤失败即失败。

## 身份、复用与准入

World 只有在 candidate digest 与 recipe digest 全部相同时才可复用；recipe digest 已聚合 producer sourceDigest 与环境元组，环境元组任一分量变化即视为不同 world。
read-only verifier 前后核对受保护根的 digest；需要写入的 Behavior 只能使用登记过的 mutable clone 和 mutation action。

### 两层 World 身份

| 层 | 内容 | 身份键 | 缓存 |
|---|---|---|---|
| fixture 层 | consumer 骨架（第三方依赖已装、候选未装）、fixture 文件、浏览器二进制 | recipe sourceDigest + 环境元组 | 跨 PR 复用，最大年龄 7 天，到期强制冷重建 |
| candidate 绑定层 | 候选 tarball 安装、deliberate Record、静态导出、命名进程结果 | fixture 层身份键 + candidate digest | 仅同一候选内复用 |

三条规则维持两层边界不被绕过：

- 每个 consumer fixture 携带的锁文件已经计入 `producer.sourceDigest`；依赖树变化因此总是产生新的 fixture 层身份，不会跨机器解出不同依赖树却共享同一缓存键。
- 候选包生成的产物（例如 `init` 脚手架产出的 package.json、tsconfig）不得以静态镜像形式进入 fixture 层，一律在 candidate 绑定层逐候选真实生成，防止镜像不随候选 diff 失效。
- world 内 node_modules 使用 pnpm `package-import-method=copy` 落盘，防止 mutable clone 的就地写透过硬链接污染共享 store。

fixture 层到期强制冷重建；另设一条 scheduled 冷 lane 每日从零搭建跑消费方矩阵，复现只在冷路径可观察的缺陷。

一条 proof 进入门禁前同时满足：

1. 当前候选经真实公开入口通过；
2. fix parent 或最小历史逆补丁在预期阶段失败；
3. 一个同形反证也失败；
4. 非契约文案、DOM class、ANSI 与毫秒扰动不误红；
5. malformed 或 unsupported 观察使 observer 显式失败；
6. 用户代码不需要测试探针。

## Portfolio Registry

Registry 同时收集 Behavior 主证明和 mechanism matrix owner，不扫描源码函数推导测试义务：

```ts
interface MechanismProofDeclaration {
  id: string;
  feature: { path: string; anchor: string };
  risk: string;
  wrongAlgorithms: readonly [string, ...string[]];
  matrixOwner: string;
  layer: "unit" | "structure";
}

interface RetirementDeclaration {
  replacement: string;
  removes: readonly string[];
  merges: readonly {
    from: readonly [string, ...string[]];
    into: string;
  }[];
  keeps: readonly {
    proof: string;
    risk: string;
    wrongAlgorithm: string;
  }[];
  netNewReason?: string;
}
```

`matrixOwner` 是等价类集合的稳定身份，不是测试文件路径。同一个 owner 只能由一条 proof 声明；human、JSON、
text、web 等 projection 可以各有 schema case，但不能再次声明相同 owner。

Coverage Category 名单是签入清单，新增或合并一个 category 是清单文件里的显式变更，配一条静态索引守护防止名单与实际 Behavior 引用漂移。新 category 声明的 contract anchor 尚未被其它 category 引用时，享有“首个 owner 免 Retirement Declaration”的快速通道。该 anchor 已被其它 category 引用时快速通道自动失效，新 category 必须退回完整的 `netNewReason` 论证，防止每个 bug 铸一个新 category 绕开退役审计。这条快速通道与铸币税规则单源在此，[Proof Portfolio](proof-portfolio.md)只链接不复述。

静态聚合输出以下错误：

- Behavior 没有且不止一个主证明；
- mechanism proof 没有具名 wrong algorithm；
- 同一个 matrix owner 被重复声明；
- retirement 的旧 proof 仍在测试收集结果中；
- 新 proof 没有替代旧 owner，也没有 `netNewReason`；
- 新 category 声明的 contract anchor 已被其它 category 引用，却未提供完整 `netNewReason`；
- proof 链接的 Feature anchor 不存在。

迁移完成后删除 Retirement Declaration。Registry 的最终 manifest 只保留活跃 proof，不把历史迁移名单变成永久配置。

## 选择与执行

unit / structure proof 由源码影响图选择后仍走 `pnpm test`；Behavior 主证明按自己的公开边界走 unit 或 E2E
执行器。选择器按 proof ID 聚合，不按测试文件重复运行矩阵。一个文件含多个 proof 时可以只选受影响 ID；
一个 proof 的表驱动 case 必须作为整体运行，避免只跑部分等价类后错误宣称 owner 已通过。

数量、fixture 与退役规则见 [Proof Portfolio](proof-portfolio.md)。

完整代码路径见 [Use Cases](use-case/README.md)。
