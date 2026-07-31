# 方案 3：Architecture

**相关文档**：[README](README.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 实体关系

```text
AcceptanceCase
├── one WorldSpec
├── one or more ordered ActionStep
├── one or more named ClaimSpec
├── one ProofRequirement
└── ProofProjection
    ├── exactly one Primary Projection
    ├── one Projection per required boundary
    └── zero or more Supporting Projections
        └── ProjectionResult + EvidenceRef
```

Feature 文档仍是产品契约单源。
Case 只引用契约并声明证明，不复制完整产品定义。

## 数据模型

`WorldSpec`、`ActionSpec` 与 `ClaimSpec` 由每个领域定义成封闭判别联合：

```typescript
type Layer = "unit" | "e2e";
type ProofRole = "primary" | "boundary" | "supporting";
type PublicBoundary =
  | "library"
  | "cli"
  | "stdout"
  | "terminal-pty"
  | "json"
  | "junit"
  | "html"
  | "browser"
  | "real-protocol";

interface ActionStep<A extends ActionSpec> {
  id: string;
  action: A;
}

interface ClaimBinding<C extends ClaimSpec> {
  after: string;
  expectation: C;
}

interface BoundaryRequirement {
  id: string;
  repository: string;
  surfaces: readonly [PublicBoundary, ...PublicBoundary[]];
}

interface AcceptanceCase<
  W extends WorldSpec,
  A extends ActionSpec,
  C extends ClaimSpec,
> {
  id: string;
  contract: string;
  goal: string;
  world: W;
  steps: readonly [ActionStep<A>, ...ActionStep<A>[]];
  claims: Readonly<Record<string, ClaimBinding<C>>>;
  proof: {
    primary: {
      layer: Layer;
      surfaces: readonly [PublicBoundary, ...PublicBoundary[]];
      realProtocols?: readonly string[];
    };
    requiredBoundaries: readonly BoundaryRequirement[];
  };
  regressions: readonly string[];
}

interface ExternalCaseRef {
  repository: string;
  id: string;
  digest: string;
}

type LocalProjectionSpec =
  | {
      id: string;
      case: AcceptanceCase<WorldSpec, ActionSpec, ClaimSpec>;
      layer: "unit";
      role: ProofRole;
      driver: string;
      surfaces: readonly (PublicBoundary | "mechanism")[];
      claims: "all" | readonly string[];
      requirementId?: string;
      controls?: {
        clock: "real" | "manual";
        barriers?: readonly string[];
      };
    }
  | {
      id: string;
      case: AcceptanceCase<WorldSpec, ActionSpec, ClaimSpec>;
      layer: "e2e";
      role: ProofRole;
      driver: string;
      surfaces: readonly PublicBoundary[];
      claims: "all" | readonly string[];
      requirementId?: string;
      evidence: { world: string };
    };

interface ExternalProofLink {
  case: ExternalCaseRef;
  requirementId: string;
  nativeProofId: string;
  repository: string;
  layer: "e2e";
  surfaces: readonly [PublicBoundary, ...PublicBoundary[]];
}
```

Case 是纯数据。
`goal` 只用于阅读与报告，不参与执行。
Step ID 在 Case 内唯一；每个 claim 的 `after` 必须引用存在的 step。

## 两层保持独立

| 项目 | unit Projection | E2E Projection |
|---|---|---|
| 入口 | `registerUnitProjection` | `registerE2EProjection` |
| 边界 | 进程内模块或公开 Library | 安装包、CLI、浏览器或真实协议 |
| 控制 | TestClock、barrier、可区分 fixture | 真实进程、产物与交互 |
| 证据 | 返回值、事件、受控机制事实 | stdout、文件、DOM、screen 或 trace |
| 复用 | 每例重新创建 | 按 evidence identity 准备一次，之后只读 |

两套注册器没有共同的 `execute()` 基类。
Supporting unit Projection 通过，不能替代真实协议或外部安装边界的 Primary E2E。

## 注册数据流

```text
读取 AcceptanceCase
  → 校验 Case、step、claim 与 Projection ID
  → 校验 claim.after 引用
  → 校验契约链接
  → 校验恰有一个 Primary Projection
  → 校验 Primary 覆盖全部 claim
  → 校验层、surfaces、必需边界与真实协议要求
  → 分别生成 unit 与 E2E 原生测试
```

未知 Action 或 Claim 是 authoring error。
它在测试注册前失败，不能变成 skip。

每个 E2E 仓库拥有自己的 Projection 注册器与 driver。
Case owner 从纯数据声明生成带 digest 的 Case Manifest。

只有同一自治仓库内的 Projection 可以引用并执行 Case 对象。
`ExternalCaseRef` 没有 step、claim 或 expectation，因此明确**不可执行**。
跨仓库只能登记 `ExternalProofLink`：它把 Case 的某个 boundary requirement 连接到目标仓库里一条完整的原生 proof。
目标仓库自己声明用户动作、观察与期望并独立运行；它不声称复用了 Case claim。

根 Registry 只读汇总 Manifest、校验 Case digest 与 link 指向，并判断 boundary requirement 是否有目标 proof。
它不能把 Case 运行时或 expectation 注入目标仓库。
独立 checkout 没有根汇总器时，目标仓库的原生验收仍完整运行，只少全局链接报告。

这意味着 PLAN-3 的“共享语义”承诺只在单仓多 driver 内成立。
跨仓仍可能重复表达结果，这是该候选未被推荐的明确限制，而不是由不完整 `CaseRef` 偷渡解决。

## unit 数据流

```text
Unit Projection
  → driver 创建可区分 fixture
  → 安装 TestClock / barrier 等显式控制
  → 按 step 顺序执行领域动作
  → 读取返回值、事件或机制事实
  → 逐 claim 比较
  → 销毁本次 fixture
```

并发、超时与取消仍由 unit driver 使用受控时钟和屏障证明。
Case 不把这些机制伪装成 E2E 也能复用的步骤。

## E2E 数据流

```text
按 evidence identity 准备 named world
  → 完成全部有副作用的真实运行
  → 冻结 evidence root
  → 同仓 Projection 从公开边界按 step 顺序执行只读动作
  → 媒介 adapter 产生 typed observation
  → 逐 claim 比较
  → 保留失败证据并清理临时消费者
```

同一 world 可以供多个 Case 使用。
测试体不能再次执行模型任务、覆盖结果或依赖上一条测试的副作用。

## Driver 义务

- JSON 按结构、字段和业务身份比较，不做整文件 byte golden。
- XML 按 suite、case、failure 与 error 语义解析。
- Browser 优先使用 role locator 与 ARIA。
- Terminal 显式区分 pipe 与 PTY；布局 claim 只能投影到 PTY screen。
- 只有本身逐字属于契约的短帮助、错误或提示使用 golden。
- Driver 不支持某个 Claim 时显式拒绝，不做 fallback。
- Driver 不按 Case ID 分支，也不重新计算产品应得结果。

## 不变量

1. 每条 Case 恰有一个 Primary Projection，并覆盖全部 claim 与声明 surfaces。
2. 每个 claim 都引用稳定主体身份。
3. Primary 满足 Case 的 layer、公开边界与真实协议要求；每个 required boundary 有同仓 Projection 或指向完整原生 proof 的 ExternalProofLink。
4. unit 与 E2E 不共享执行、时钟、setup 或 cleanup。
5. E2E prepare 是最后一个可修改 evidence 的阶段。
6. 真实协议兼容性只能由真实协议 E2E 主证明。
7. Feature 文档仍是契约来源。
8. `goal` 声称的每个结果都必须落到具体 claim。
9. 不支持的媒介语义显式失败。
10. 机制定律可以留在原生 unit test，不强制投影。

## 身份与复用

Case ID 是人工稳定身份。
World、Steps 与 Claims 的规范化内容生成 semantic digest；自然语言 goal 与契约链接位置不进入 digest。

E2E evidence identity 至少包含：

```text
semantic digest
+ candidate package digest
+ producer / driver digest
+ external dependency identity
+ prepare configuration
+ evidence-affecting runtime identity
```

相同 identity 可以 single-flight 准备一次。
产物进入独立命名目录，冻结后只读；任一组成变化都创建新目录。
运行时 identity 包含会影响证据的 Node、OS、locale、PTY、终端列数、浏览器与 viewport。

unit Projection 不跨测试复用可变 fixture。

## 生命周期与错误

`DeclarationError` 与 `ProjectionError` 在注册前失败。
`PreparationError` 让依赖同一 world 的 Projection 指向同一个根因，不把它们标成通过或跳过。

`InvocationError` 表示公开动作意外失败。
只有 Claim 明确声明产品错误结果时，错误才成为 observation。

`ObservationError` 表示媒介无法解析。
`ClaimMismatch` 必须打印 Case、claim、Projection、driver、契约、身份、期望、观察与证据位置。

`CleanupError` 单独附在主要结果后，不能覆盖更早失败。
