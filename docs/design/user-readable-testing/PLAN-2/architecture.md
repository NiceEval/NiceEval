# 方案 2：Architecture

**相关文档**：[README](README.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 实体关系

```text
Feature contract
└── Behavior
    ├── exactly one PrimaryProof
    ├── zero or more required BoundaryProof
    └── zero or more SupportingProof

PrimaryProof
├── one UserView
├── one execution layer
├── one public entry
├── one or more observation media
├── one or more crossed boundaries
└── one or more identity-bearing OutcomeAssertion

E2E Proof
└── one immutable EvidenceWorld

Repository
└── one local BehaviorManifest
```

Feature 文档仍是产品契约单源。
Behavior 只保存引用、证明要求与诊断身份。
包含主证明的仓库拥有该 Behavior 声明。

## 数据模型

```typescript
type BehaviorId = string;
type ProofLayer = "unit" | "e2e";
type ProofRole = "primary" | "boundary" | "supporting";
type PublicEntry =
  | "library"
  | "cli"
  | "browser"
  | "protocol";
type ObservationMedium =
  | "library-result"
  | "protocol-event"
  | "process-result"
  | "ndjson-events"
  | "stdout"
  | "pty-screen"
  | "json"
  | "junit"
  | "html"
  | "browser-a11y";
type BoundaryKind =
  | "in-process"
  | "installed-package"
  | "external-cwd"
  | "real-cli"
  | "real-protocol"
  | "real-pty"
  | "real-browser";

interface ProofTarget {
  entry: PublicEntry;
  observations: readonly [ObservationMedium, ...ObservationMedium[]];
  boundaries: readonly [BoundaryKind, ...BoundaryKind[]];
  verifier?: {
    engine: "playwright-chromium";
    viewport?: { width: number; height: number };
    locale?: string;
    javaScript: "disabled" | "enabled";
    network: "local-only";
  };
}

type E2EExecutionBinding =
  | {
      mode: "read-only";
      evidenceRecipeId: string;
    }
  | {
      mode: "mutable-clone";
      evidenceRecipeId: string;
      cloneId: string;
      mutationActionId: string;
    };

type PrimaryProofRequirement =
  | {
      layer: "unit";
      target: ProofTarget;
      execution?: never;
    }
  | {
      layer: "e2e";
      target: ProofTarget;
      execution: E2EExecutionBinding;
    };

interface BehaviorSpec {
  id: BehaviorId;
  task: ContractRef;
  contract: ContractRef;
  title: string;
  risk: "release-blocking" | "high" | "normal";
  primary: PrimaryProofRequirement;
  requiredBoundaryProofs: readonly BoundaryRequirement[];
}

interface BoundaryRequirement {
  id: string;
  repository: string;
  target: ProofTarget;
}

interface ContractRef {
  repository: string;
  path: string;
  /** Canonical Markdown fragment, without "#". */
  anchor: string;
}

interface ProofRegistrationBase {
  id: string;
  repository: string;
  behaviorId: BehaviorId;
  behaviorRepository: string;
  role: ProofRole;
  target?: ProofTarget;
  mechanism?: string;
  requirementId?: string;
  testFile: string;
  testTitle: string;
}

type ProofRegistration =
  | (ProofRegistrationBase & {
      layer: "unit";
      execution?: never;
    })
  | (ProofRegistrationBase & {
      layer: "e2e";
      target: ProofTarget;
      execution: E2EExecutionBinding;
    });

interface BehaviorManifest {
  schemaVersion: 1;
  repository: string;
  behaviors: readonly BehaviorSpec[];
  proofs: readonly ProofRegistration[];
  mutationActions: readonly MutationActionRegistration[];
}

interface MutationActionSpec {
  id: string;
  entry: PublicEntry;
  execute: (clone: MutableScenarioClone) => Promise<void>;
}

interface MutationActionRegistration {
  id: string;
  repository: string;
  entry: PublicEntry;
  implementation: { module: string; export: string };
}

interface ObservationSource {
  medium: ObservationMedium;
  evidence: EvidenceRef;
  derivedFrom?: EvidenceRef;
  selector: readonly (string | number)[];
  verification?: {
    runId: string;
    identity: VerificationIdentity;
  };
}

declare const observedValue: unique symbol;

interface Observed<T> {
  readonly [observedValue]: T;
  readonly identity: Readonly<Record<string, string>>;
  readonly source: ObservationSource;
}

interface OutcomeAssertion {
  kind: string;
  identity: Readonly<Record<string, string>>;
  sources: readonly [ObservationSource, ...ObservationSource[]];
}

interface ProofRunResult {
  proofId: string;
  target: ProofTarget;
  worlds: readonly {
    evidenceRecipeId: string;
    worldDigest: string;
  }[];
  verificationRun?: VerificationRun;
  mutableClone?: MutableScenarioClone;
  assertions: readonly [OutcomeAssertion, ...OutcomeAssertion[]];
}

interface EvidenceWorld {
  id: string;
  evidenceRecipeId: string;
  digest: string;
  root: string;
  candidateDigest: string;
  recipe: RecipeFingerprint;
  producer: SourceClosureFingerprint;
  fixture: FileTreeFingerprint;
  externalDependencies: Readonly<Record<string, string>>;
  environmentIdentity: Readonly<Record<string, string>>;
  fileTreeDigest: string;
  state: "preparing" | "frozen";
  artifacts: Readonly<Record<string, EvidenceRef>>;
}

interface EvidenceRef {
  kind:
    | "text"
    | "json"
    | "xml"
    | "html"
    | "ndjson"
    | "process-result"
    | "aria-snapshot"
    | "pty-screen"
    | "raw-ansi"
    | "trace";
  root:
    | { kind: "world"; id: string }
    | { kind: "verification-run"; id: string }
    | { kind: "mutable-clone"; id: string };
  location: string;
  digest: string;
}

interface PtyScreenEvidence {
  schemaVersion: 1;
  kind: "pty-screen";
  invocation: {
    argv: readonly string[];
    cwd: string;
    term: string;
    locale: string;
    initialSize: { columns: number; rows: number };
    resizes: readonly {
      afterOutputBytes: number;
      columns: number;
      rows: number;
    }[];
  };
  exit: { code: number | null; signal: string | null };
  rawAnsi: EvidenceRef;
  finalScreen: {
    columns: number;
    rows: number;
    cursor: { row: number; column: number; visible: boolean };
    viewport: readonly ScreenRow[];
    scrollback: readonly ScreenRow[];
  };
}

interface ScreenRow {
  columns: number;
  cells: readonly ScreenCell[];
}

interface ScreenCell {
  grapheme: string;
  width: 0 | 1 | 2;
}

interface VerificationIdentity {
  adapter: SourceClosureFingerprint;
  mutationAction?: SourceClosureFingerprint;
  proofSourceDigest: string;
  playwrightVersion?: string;
  browserName?: "chromium";
  browserVersion?: string;
  viewport?: { width: number; height: number };
  locale?: string;
}

interface VerificationRun {
  id: string;
  proofId: string;
  identity: VerificationIdentity;
  worldDigests: readonly string[];
  mutation?: {
    actionId: string;
    cloneId: string;
  };
  artifacts: Readonly<Record<string, EvidenceRef>>;
}

interface MutableScenarioClone {
  id: string;
  ownerProofId: string;
  baseWorldDigest: string;
  root: string;
  initialTreeDigest: string;
  finalTreeDigest?: string;
  state: "ready" | "mutating" | "verified" | "cleaned";
}

interface EvidenceRecipeSpec {
  id: string;
  /** Extra dynamic module/file inputs not reachable from the prepare symbol graph. */
  producerInputs?: readonly string[];
  /** Static project/data roots read by the prepared candidate. */
  fixtureInputs?: readonly string[];
  prepare: (...args: readonly unknown[]) => Promise<void>;
}

interface RecipeFingerprint {
  id: string;
  normalizedAstDigest: string;
  referencedLiteralDigest: string;
  digest: string;
}

interface SourceClosureFingerprint {
  roots: readonly { module: string; export: string }[];
  files: readonly { path: string; digest: string }[];
  packageResolutions: readonly { name: string; version: string }[];
  digest: string;
}

interface FileTreeFingerprint {
  roots: readonly string[];
  entries: readonly {
    path: string;
    type: "file" | "directory" | "symlink";
    digest: string;
  }[];
  digest: string;
}
```

`task` 指向用户为什么要完成这个任务的现有任务文档；`contract` 指向结果规则。
两者都只是链接，不复制正文。

`Observed<T>` 是不透明值。
只有 identity-aware matcher 可以取出其值并生成 `OutcomeAssertion`；普通测试代码不能通过 `.value` 绕过来源记录。
每个来源同时保存媒介、原始 evidence 和提取路径。
Verify 阶段才产生的 ARIA、trace 或 mutation 结果还必须保存 `VerificationRun`，并用 `derivedFrom` 指回 frozen world 的输入 artifact。
期望不进入 User View，也不进入 evidence manifest。

每个 E2E PrimaryProof 和 E2E ProofRegistration 都有穷尽的 `E2EExecutionBinding`。
`evidenceRecipeId` 把 proof 精确连到 prepared world；同一 Behavior 有多个 proof 或 world 时，各 proof 分别绑定，不能靠目录或测试顺序猜测。
`mutationActionId` 也不是自由字符串。
它必须指向本仓库由 `defineMutationAction()` 导出的唯一声明；Manifest 保存声明所在的 module / export 和公开入口。

入口、观察媒介与真实边界是三条不同的轴。
例如安装后 CLI 的目标是：

```typescript
{
  entry: "cli",
  observations: ["json"],
  boundaries: ["installed-package", "external-cwd", "real-cli"],
}
```

它不能被一个“进程内调用成功”或“CLI 退出 0”的 proof 冒充。

## 两条正交轴

执行层只回答“证明经过什么真实程度的边界”：

- unit：确定性模块、公开 Library、受控依赖；
- E2E：候选包、外部 cwd、真实 CLI、协议、PTY 与浏览器。

作者面只回答“证明给谁读”：

- behavior：用户任务和公开结果；
- mechanism：实现定律与诊断事实。

目录、runner 和 helper 不能把两条轴合并。
`test/unit/behavior/` 仍属于 unit project；`e2e/*/test/behavior/` 仍属于各自治 E2E 仓库。

## Behavior 注册

每个 Feature 拥有自己的薄注册函数：

```typescript
runnerBehavior(spec, async ({ user, fixture }) => {
  // user 只走公开入口；fixture 只建立不可由用户动作表达的前置世界。
});
```

注册函数负责：

- 把 `BehaviorSpec` 交给 Registry；
- 安装 Feature-owned User View；
- 捕获 identity-aware matcher 的 Outcome 记录；
- 给 Vitest 标题加稳定 Behavior ID，并保留过滤与重试能力；
- 在失败消息中加入用户任务、契约、entry、observation、boundary 与 evidence。

它不负责计算 fixture、启动模型、推进时钟或重试断言。
测试正文必须就地出现影响结果的公开配置、Library 调用、完整 CLI argv 或浏览器动作。
Helper 可以隐藏临时目录、端口与进程清理，不能把用户选择折进 `runSameScenario()` 之类的不透明入口。

## Typed Observable View

每个 User View 都分成 driver 与 observation 两部分：

```text
用户动作
  → Driver 调用公开 Library / CLI / browser
  → Media adapter 读取公开结果
  → Typed Observation 按身份寻址
  → Matcher 比较测试侧预期
```

例如 `ReportUser` 可以由多种局部 driver 支持：

```typescript
interface ReportUser {
  show(input: ShowInput): Promise<ReportObservation>;
  open(input: OpenInput): Promise<InteractiveReport>;
}

interface ReportObservation {
  table(name: string): TableObservation;
  chart(axes: { x: string; y: string }): ChartObservation;
  attempt(id: string): AttemptObservation;
}

interface TableObservation {
  rowIds(): Observed<readonly string[]>;
  cell(rowId: string, column: string): Observed<string | number | null>;
}

interface AttemptObservation {
  status(): Observed<"passed" | "failed" | "errored" | "skipped">;
  experimentId(): Observed<string>;
}
```

接口共享用户概念，不强求 driver 共享所有能力。
plain stdout driver 不支持 browser 交互时，注册阶段就拒绝该行为，而不是模拟点击。

### 防止影子实现

User View 必须满足：

- 只选择、解析、规范化 transport 噪声；
- 不重新计算通过率、缓存命中、去重、排序或 verdict；
- 不从候选包导入 schema 常量和 renderer helper；
- 不按 Behavior ID 分支；
- 不提供 `semanticValues()`、`summary()` 这类隐藏比较口径的聚合；
- 找不到对象时列出实际身份；
- 不提供 `raw()`、`.value` 逃生舱给主证明绕过身份与来源断言；
- 每个观察值都保留 evidence、提取路径和对象身份。

复杂算法继续由机制测试直接证明。
跨媒介关系必须在测试里逐项列出比较字段。
例如比较两面 attempt ID 与 verdict，而不是调用一个不可审计的“语义相等” helper。

## Registry 数据流

本节定义 Registry 的数据边界与不变量；跨 owner 的完整运行顺序见 [Lifecycle](lifecycle.md#声明与静态聚合)。

```text
各仓静态发现 BehaviorSpec / ProofRegistration
  → 校验 ID、用户任务与契约链接
  → 校验本仓恰有一个 PrimaryProof
  → 校验 layer / target 三轴
  → 生成本仓 BehaviorManifest

根聚合所有 Manifest
  → 解析跨仓 Behavior 引用
  → 校验 required BoundaryProof
  → 生成只读行为索引

独立执行选中的测试
  → 收集本次 OutcomeAssertion
  → 生成 run report，不改静态 Registry
```

Manifest 从字面量元数据静态派生，不运行测试、不读取 candidate，也不需要 secret。
它不签入仓库。

根 `test/docs/behavior-registry.test.ts` 用只读 AST parser 扫描根仓和 `e2e/` 下 tracked test 源码，在内存中按 repository 构造 Manifest。
它不安装 E2E 依赖，也不 import 仓库 helper。

自治仓库的 `scripts/e2e.ts` 在 prepare 前用本仓实现完成同一静态检查，并把 `behavior-manifest.json` 写进本次 artifact 目录。
该文件只供独立 CI 报告，不成为下一次运行或根静态守护的输入。
它不是签名、锁文件或跨仓交付协议。
根守护永远从当前 checkout 的字面量源码重建索引，不读取上一次 CI artifact，也不执行自治仓库的生成器。

行为索引可以作为 CI artifact 或命令输出，不签入第二份 Markdown。
它按用户任务展示契约、主证明、真实边界证明与 supporting proof。

普通机制测试不进入索引。
只有能明显帮助某个 Behavior 诊断的测试才注册 supporting proof。

根 Registry 对 E2E 仓库只有只读发现权。
每个仓库自己拥有注册器、User View、parser 和执行命令；静态元数据缺少根 Registry 消费者时，也不改变仓库的验收行为。
Registry 不能成为 `pnpm e2e` 的运行时依赖。

跨仓 supporting / boundary proof 只携带 `behaviorRepository + behaviorId`。
独立 checkout 的本地守护验证引用形状并把它写进 Manifest，不要求其它仓库在场。
完整 checkout 的根聚合守护负责解析引用与判定全局证明是否齐全。
根仓 repository ID 固定为 `niceeval`；自治 E2E 仓库使用自己的 `e2e.json.id`。

`task` 与 `contract` 的 ContractRef 使用同一 repository 命名。
本地 guard 只解析本仓拥有的引用；外部引用只查 `repository + path + anchor` 形状。
完整 checkout 的根聚合器按 repository root map 解析外部 path 与 heading，并报告 owner、来源测试和失效 anchor。

静态完整性不能替代运行证明。
PrimaryProof 和每个 required BoundaryProof 在执行时都必须各自产生 `ProofRunResult`：

- `target` 与声明的 entry、observations、boundaries 完全相符；
- 每个声明的 observation 至少贡献一个 `ObservationSource`；
- 关系断言在同一个 `OutcomeAssertion.sources` 中列出参与关系的全部 observation；
- 至少一个 outcome 按用户对象身份验证结果。
- E2E proof 的 execution、实际 world recipe 与可选 mutable clone 完全相符。

因此，只检查 CLI exit code 的测试不能满足“安装后的 CLI 只派发变化 attempt”。
它必须从该次 CLI evidence 中观察执行的 attempt 身份并生成自己的 outcome。

## Evidence World 生命周期

本节定义 world 的状态转换与冻结不变量；fresh / reuse 次数和 owner 顺序见 [Lifecycle](lifecycle.md#e2e-fresh)。

E2E world 经历两个阶段：

```text
prepare
  → 安装候选包
  → 运行全部有副作用的真实动作
  → 生成 text / JSON / XML / HTML / PTY screen / trace
  → 关闭子进程与文件句柄
  → 校验路径并计算文件树、artifact 与 manifest digest
  → 原子发布只读 frozen world

verify
  → 每条测试只读打开 world
  → 校验 proof binding 与当前 candidate、recipe、producer、fixture、环境身份
  → 通过局部 adapter 形成 observation
  → 浏览器类证明在全新 context / page 中读取只读产物
  → 单独通过或失败
  → 复核文件树 digest
```

为后续只读观察**生产输入证据**的安装、实验、SDK、报告、迁移和 package-consumer 命令都属于 prepare。
测试体不能用“幂等读动作”名义重新执行可能建缓存、自动迁移或改访问时间的候选命令。
浏览器中的筛选、展开等动作只改变本例的新页面状态，不改变 evidence root。

E2E Behavior 可以在同一文件用局部 `defineEvidenceRecipe()` 就地展示公开 argv、项目文件修改与 capture 名称。
Recipe 只描述该仓库的 prepare 动作，其 AST 与引用值进入 `RecipeFingerprint`；它不包含期望或 matcher，也不是跨仓公共 DSL。
执行器先完成全部 recipe，再启动 Vitest verify。

如果迁移、修复或其它写动作**本身就是待证明的用户动作**，E2E proof 必须声明 `mode: "mutable-clone"`。
Prepare 只生成并冻结动作前 baseline；verify 按 `cloneId` 创建 `MutableScenarioClone`，再从声明的公开入口执行 `mutationActionId`。
副本位于单例私有临时目录，由该 proof 独占并清理；原 world 始终只读。
这种 proof 不能与普通只读 proof 共享副本或执行顺序。
Reuse 只复用 baseline，仍为本次 proof 创建 fresh clone 并重新执行待测写动作。

Mutation action 是 proof 文件或相邻 driver 中的本仓局部声明：

```typescript
export const migrateRecord = defineMutationAction({
  id: "record.migrate-v1",
  entry: "cli",
  async execute(clone) {
    await clone.cli(["record", "migrate", "--record", "fixture"]);
  },
});
```

它只描述从声明的公开入口执行哪一个待测动作，不包含 matcher、预期值或产品算法。
静态守卫要求 action ID 在本仓唯一、module / export 可解析、实现位于同一仓库，并要求每个 `mutable-clone` proof 恰好解析一个 action。
Proof 的 `target.entry` 必须与 action 的 `entry` 相同；`read-only` proof 不能引用 action。
Mutation action 只允许静态 import；实现依赖的本地 symbol closure 必须能被完整解析，动态 import 或运行时代码生成直接使声明失败。

Verify 在创建 clone 前导入 Manifest 指向的确切 module / export，复核 action ID 与 entry，再计算 action 及其静态依赖的 `SourceClosureFingerprint`。
该 fingerprint 写入本次 `VerificationIdentity.mutationAction`，action ID 与 clone ID 写入 `VerificationRun.mutation`，随后 action 在 fresh clone 上恰好执行一次。
Action 实现变化会改变 Verification Run 身份，但不会伪装 frozen baseline 已改变；reuse 仍执行当前已解析并指纹化的 action。

### 冻结强制

`state: "frozen"` 不是作者承诺，而由执行器强制：

1. prepare 只写 world 的同级临时目录；关闭所有进程和文件句柄后，拒绝绝对路径、`..`、越根 symlink 与未登记 artifact；
2. 计算 artifact digest，写 manifest，再对除 manifest 自身外的规范化 path / type / content 文件树计算 digest；
3. 在临时目录递归移除写权限后原子 rename 到最终目录；平台支持时再以只读 mount 打开；
4. verify 的 cwd、日志、trace、browser profile 与临时文件全部位于 world 之外；
5. guarded evidence reader 拒绝路径穿越与 symlink 逃逸；
6. 每个 proof 前后都重算文件树 digest；新增、删除或修改任何路径立即失败并列出差异。

权限不是唯一防线。
即使某个平台无法只读 mount，路径守卫和前后 digest 仍会发现写入。

### World 与 verifier 身份

World 的 fingerprint 分区固定如下：

| 分区 | 精确输入 | 明确排除 |
|---|---|---|
| candidate | 注入 tarball 的原始 bytes | checkout 路径、mtime |
| recipe | `defineEvidenceRecipe()` AST 子树与它引用的字面量 | 同文件的 Behavior 期望、matcher |
| producer | recipe `prepare` 与 `scripts/e2e.ts` prepare entry 引用的本地 symbol 闭包，以及这些模块的 lockfile resolution | `scripts/e2e.ts` verify branch、User View、verify adapter、测试期望 |
| fixture | recipe 声明的 fixture roots 的规范化 path / type / content | prepare 产生的输出 |
| external dependencies | provider、model、SDK / protocol 版本与其它声明身份 | secret 值 |
| producer environment | 真正影响产物的 Node、OS、locale、PTY 实现与终端尺寸 | 验证顺序、browser page 状态 |
| verifier | User View / media adapter / matcher 的 symbol 闭包、proof source digest 与 browser identity | frozen world digest |

Recipe 即使与 Behavior 位于同一文件，也只摘要 `defineEvidenceRecipe()` 的 AST 与其引用 symbol，不 hash 整个测试文件。
TypeScript symbol graph 解析静态 import；动态 module / 文件读取必须列入 recipe 的 `producerInputs` / `fixtureInputs`。
Prepare sandbox 记录实际本地读取，发现未声明输入就失败。
Manifest 保存每个闭包成员及 digest；reuse 重新解析当前闭包并逐项比较，因此 helper 新增、删除或修改都会拒绝旧 world。

World identity 由 candidate、recipe、producer、fixture、external dependencies 与 producer environment 组成。
PTY 已在 prepare 产出，因此这些终端维度进入 world identity。

浏览器观察发生在 verify，不冒充 world producer。
每次 Verification Run 另记 `VerificationIdentity`。
身份包括 adapter 与适用 mutation action 的 symbol closure、proof source、Playwright / Chromium 版本、viewport 与 locale。
若 Behavior 固定这些维度，执行器在开始前校验；否则它们只进入 run report，world digest 不因换 verifier 而伪装未变。
普通验证顺序不进入身份，也不影响结果。

### 单例重跑协议

自治仓库只有一个参数解析者：自己的 `scripts/e2e.ts`。
标准命令是：

```bash
pnpm e2e -- verify \
  --world <world-manifest> [--world <another-manifest> ...] \
  --behavior <behavior-id>
```

它先定位当前注入的 candidate，再按每个 proof 的 `evidenceRecipeId` 从 manifest 参数中选择恰好一个 world，并逐项校验：

- candidate、recipe、producer symbol closure、fixture、external dependencies 与适用 producer environment digest；
- `state === "frozen"`、文件树 digest 和全部 artifact；
- prepare 输入 evidence 是否都位于对应 world root；verify 新产物是否都位于对应 Verification Run root。

缺少、重复或 recipe ID 不符都在执行测试前失败。
任一项不匹配都以 expired-evidence 失败，并打印重新运行 `pnpm e2e` 完整 prepare 的命令。
它绝不静默创建新 world、调用模型或改写 manifest。

## 媒介边界

| Observation | Adapter 责任 | 不承担 |
|---|---|---|
| process result | argv、cwd、退出码、信号 | stdout 内容、业务结果 |
| NDJSON events | 逐行解析生命周期事件、事件身份与顺序 | 把事件流冒充结果 JSON 文档 |
| plain stdout | 无框文字、顺序、公开状态 | PTY 布局、精确机器身份 |
| protocol event | 同次真实调用的公开 SDK / wire 事件 | 固定 token 常量、候选私有 Record |
| terminal PTY | 最终 cell grid、scrollback、宽度、折行、降级 | JSON 字段语义 |
| JSON | 完整结构、字段、身份、值 | 缩进与字段顺序 |
| JUnit | suite、case、failure、error | XML 空白与属性顺序 |
| HTML | 真实 Chromium 解析出的静态内容与可访问语义 | CSS 像素布局 |
| browser | 交互、可见状态、role 与归属 | 重新计算报告数据 |

`PtyScreenEvidence` 的 `viewport` 必须恰有 `rows` 行；每行的 `columns` 等于最终列数，`cells` 也恰有该数量。
scrollback 每行保存自己产生时的列数，避免 resize 后重新解释旧行。
双宽字符由一个 `width: 2` 的起始 cell 和一个 `width: 0` 的 continuation cell 表示。
布局 matcher 只读 terminal emulator 的最终 grid / scrollback；raw ANSI transcript 只供诊断，不能用框线 byte 或 ANSI 片段代替 screen 语义。
`TERM`、locale、初始尺寸、resize 顺序、退出码与信号都属于同一份 evidence。

HTML 与 browser-a11y 的 ARIA 读面固定使用 Playwright 驱动的真实 Chromium accessibility / role 语义。
不允许 happy-dom、ivya 或自写 DOM 模拟器冒充该 E2E 边界。
每个 Behavior 新建 BrowserContext 和 Page；过滤、展开、focus、storage 与 DOM 状态不跨例共享。

静态 HTML proof 必须设置 `javaScript: "disabled"`，并阻断除本地静态 server 外的全部网络。
它证明初始文档在禁 JS 时已经完整可读，不能让脚本补回缺失内容。
交互 browser-a11y proof 才设置 `javaScript: "enabled"`，网络仍为 `local-only`。

ARIA snapshot、交互后状态、截图和 trace 写进 world 外的 `VerificationRun.artifacts`。
对应 `ObservationSource.evidence` 指向 run artifact，`derivedFrom` 指向 frozen HTML，`verification` 保存 run ID 与 Chromium / adapter identity。
`ProofRunResult.verificationRun` 让失败报告能从 observation 追到这次真实 verifier。
静态 server、browser profile 和日志也写在 world 外。

关系型 Behavior 可以让一个主证明读取多个 observation medium。
例如 text / web parity 先分别形成带同一字段身份和 provenance 的 `Observed<T>`，再逐字段断言两边相等。
这只证明关系；各面的值是否符合产品契约，仍由拥有该语义的 Behavior 或机制证明负责。

短小且逐字承诺的错误、帮助与提示可以 exact golden。
其它场景不使用整份 byte golden。

## Effect 机制证明

Effect 路径使用 `@effect/vitest` 原生的 `it.effect` / `it.scoped`、`TestClock`、Layer 与显式 barrier。
时间、文件系统和外部调用经稳定服务缝注入。

User View 不吞掉这些控制。
行为主证明只看用户结果，supporting proof 则直接展示时间推进、事件顺序和意外调用失败。

Proof 关联只产生静态元数据与带 ID 的标题，不包装测试函数。
因此 Effect/Vitest 原生的 Scope、`Effect.provide(Layer)`、table / property helper、timeout、retry、并发选项、过滤和失败位置都原样保留。
若一个 runner form 无法无损保留，就让测试保持普通机制测试，不登记 supporting proof。

这能逐步替换全局 fake timer 与真实墙钟混合协议，但不是 Behavior Registry 成立的前置条件。

## 不变量

1. 每个 Behavior 恰有一个 PrimaryProof。
2. 每个主证明覆盖声明的 entry、observations 与 boundaries；每个 observation 都实际贡献 evidence。
3. 每个 required BoundaryProof 都必须存在、执行并产生自己的身份断言；supporting proof 或 exit-code smoke 不能满足这项要求。
4. User View 不拥有期望，也不实现产品算法。
5. Feature 文档是语义单源。
6. E2E verify 只读 frozen world，且不依赖测试顺序。
7. unit 与 E2E 不共享 setup、clock、cleanup 或协议模拟。
8. plain stdout 与 PTY screen 是两个显式 observation medium。
9. 外部协议兼容性必须有真实协议 E2E。
10. 内部机制测试可以完全不进入 Behavior Registry。

## 错误与清理

| 错误 | 归属与反馈 |
|---|---|
| Behavior 或 Proof 注册非法 | 本地 Registry 失败，列出仓库、ID、用户任务、契约与测试位置 |
| 跨仓引用或必需边界缺失 | 根聚合失败，列出 owner、requirement 与已发现 Manifest |
| world identity 过期 | verify 开始前失败，逐项列出不匹配并给出重新 prepare 命令 |
| frozen root 被修改 | proof 失败，列出新增、删除或 digest 变化的路径 |
| prepare 失败 | World 失败，所有消费者引用同一根因，不标成 skip |
| invoke 失败 | 报告公开动作、entry、进程或 browser step |
| observe 失败 | 报告 adapter、observation、提取路径、evidence 与实际候选身份 |
| outcome mismatch | 报告 Behavior、目标身份、期望、观察和每个来源 evidence |
| cleanup 失败 | 附加到主结果，不覆盖更早失败 |

意外 boundary 调用继续立即抛错。
Parser 不得在失败后退回字符串包含，让本应失败的行为通过。

## 变化预算

- 产品行为不变的内部重构，只允许改 supporting proof 与局部 driver。
- transport 噪声变化，只允许改一个 media adapter。
- 公开用户结果变化，先改 Feature 契约，再改同 ID 的 Behavior 或显式换 ID。
- 真实协议变化，更新独立字段关系并由同次真实 E2E 的上下游观察驱动，不能只刷新 fixture。
- User View 两次因同类新能力扩张前，必须判断它是否正在复制产品模型。
