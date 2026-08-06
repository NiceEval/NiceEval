# 方案 2：用户任务规格与类型化可观察读面

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [旧 Example 归档](example.md) · [DECISION](../DECISION.md)

## 解决的问题

本方案把测试分成两种作者视角：

- **用户行为主证明**回答“用户做什么、看到什么结果”。
- **机制证明**回答“实现靠什么定律保证这个结果”。

这条作者轴与 unit / E2E 执行轴正交：

| | unit | E2E |
|---|---|---|
| 用户行为主证明 | 公开 Library 与确定性用户结果 | 真实包、CLI、协议、PTY 或浏览器结果 |
| 机制证明 | 算法、锁、并发、时钟、转换与错误传播 | 只在真实边界本身就是证明对象时使用 |

用户行为不再埋在巨型源文件旁测试和粗粒度覆盖清单里。
机制测试也不必为了“可读”而伪装成不精确的用户故事。

## 核心心智

### Behavior

Behavior 是稳定的用户结果身份。
它保存 ID、既有用户任务链接、Feature 契约链接、用户标题、风险和主证明要求，不复制产品语义正文。

每个 Behavior 恰有一个主证明。
真实边界证明与机制证明只补充主证明没有承担的风险。

### Typed Observable View

行为测试不直接操作私有模块、任意字符串或 DOM 层级。
每个能力提供一套小型、类型化的可观察读面：

```typescript
const project = await fixture.project({
  evals: { kept: evalV1, rerun: evalV1 },
});
const first = await user.run(project);

await project.replaceEval("rerun", evalV2);
const second = await user.run(project);

expectObserved(second.attempt("kept").carriedFromRunId())
  .toEqualObserved(first.runId());
expectObserved(second.attempt("rerun").runCount()).toEqualValue(1);
```

```typescript
const report = await user.show({ report: "scatter" });

expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds())
  .toHaveSeries(["codex", "claude"]);

expectObserved(report.table("Experiments").rowIds())
  .toShowRows(["main", "rag"]);
```

读面返回带 evidence、提取路径与对象身份的不透明 `Observed<T>`。
预期值始终由测试声明；读面不能重新实现产品算法。

### Supporting Proof

机制证明继续靠近源码，并使用最精确的工具：

```typescript
const reuseSingleFlight = supportingProof({
  id: "runner.cache.reuse-expired.single-flight",
  behavior: "runner.cache.reuse-expired",
});

it.effect(
  reuseSingleFlight.title(
  "等待同一身份时只启动一个 producer",
  ),
  () =>
    Effect.gen(function* () {
      // 明确的 TestClock、barrier、事件顺序和意外调用失败。
    }),
  { timeout: 2_000 },
);
```

`supportingProof()` 只登记元数据并给原生标题加 Proof ID，不包装 `it.effect`。
关联是可选的。
一个只保护内部算法且没有独立用户结果的测试，可以继续使用普通 `it`。

## 调用面

每个 Feature 的测试支持包定义自己的 Behavior 入口与 User View：

```typescript
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
  | { mode: "read-only"; evidenceRecipeId: string }
  | {
      mode: "mutable-clone";
      evidenceRecipeId: string;
      cloneId: string;
      mutationActionId: string;
    };

interface ContractRef {
  repository: string;
  path: string;
  /** Canonical Markdown fragment, without "#". */
  anchor: string;
}

interface BehaviorDeclaration {
  id: string;
  task: ContractRef;
  contract: ContractRef;
  title: string;
  risk: "release-blocking" | "high" | "normal";
  primary:
    | { layer: "unit"; target: ProofTarget; execution?: never }
    | {
        layer: "e2e";
        target: ProofTarget;
        execution: E2EExecutionBinding;
      };
  requiredBoundaryProofs: readonly {
    id: string;
    repository: string;
    target: ProofTarget;
  }[];
}

interface BehaviorRef {
  repository: string;
  id: string;
}

interface MutationActionDeclaration {
  id: string;
  entry: PublicEntry;
  execute: (clone: MutableScenarioClone) => Promise<void>;
}

runnerBehavior(declaration, testBody);
reportBehavior(declaration, testBody);
recordBehavior(declaration, testBody);
defineMutationAction(declaration);

boundaryProof(behaviorRef, {
  requirementId: "installed-cli",
  target: {
    entry: "cli",
    observations: ["ndjson-events"],
    boundaries: ["installed-package", "external-cwd", "real-cli"],
  },
  execution: {
    mode: "read-only",
    evidenceRecipeId: "cache-rerun-installed-cli",
  },
}).it(title, body);
```

同仓库引用可以省略 `repository`。
`requiredBoundaryProofs` 为空，表示主证明本身已经经过全部必需真实边界，不表示边界检查可由作者随意省略。

Behavior 文件按用户任务组织：

```text
test/unit/behavior/
├── rerun/
│   ├── reuse-unmodified-attempts.test.ts
│   └── stop-on-loss-budget.test.ts
└── read-results/
    └── read-published-attempt.test.ts

e2e/report/test/behavior/
├── analyze/compare-experiments.test.ts
└── debug/inspect-attempt.test.ts
```

这些目录不是第三种执行环境。
根仓库里的文件仍由 unit project 执行；E2E 仓库里的文件仍由自己的真实 E2E 入口执行。

机制测试继续与实现相邻：

```text
src/runner/run.test.ts
src/report/components/compute.test.ts
```

## User View 设计规则

- 按能力定义 `RunnerUser`、`ReportUser`、`RecordUser`，不提供全仓基类。
- 方法用用户对象和动作命名，不用 `section`、`row`、`line` 或 CSS selector 命名。
- 主证明只从公开 import、CLI、机器出口或浏览器进入；私有事件与模块只供机制证明观察。
- 每个 Behavior 同时链接既有 Use Case 的用户任务锚点和 Feature 契约锚点；标题不能替代这两个来源。
- CLI 行为在调用点保留可复制的完整 argv 或 shell literal；User View 只类型化返回结果，不把命令藏进场景 helper。
- 返回值必须能按稳定身份继续寻址，例如 attempt ID、experiment name 或 case ID。
- 观察值必须是带 evidence、提取路径和对象身份的 `Observed<T>`；主证明 matcher 只消费这种值。
- 关系测试逐字段列出比较口径，不提供 `semanticValues()` 一类隐藏聚合。
- 找不到身份时，错误列出实际候选；不能退化成 `undefined` 后产生模糊断言。
- 底层可以使用 JSON parser、ARIA、Playwright、plain stdout 或 PTY adapter。
- 不支持的观察显式报错，不回退成文本包含或 regex。
- 只有两个自治消费者证明相同稳定边界后，才考虑提取共享包。

每个 E2E 仓库签入自己的 Behavior wrapper、User View 和 parser。
根仓库可以只读扫描共同的静态元数据形状，但不能向仓库注入运行时代码或测试语义。
把任一 E2E 仓库复制到独立 checkout 后，它仍能只靠自己的 `pnpm e2e` 完成验收。

## 主证明选择

主证明选择能以最低成本完整观察用户结果的最外层稳定边界：

- 纯确定性 Library 行为可以由 unit 行为规格主证明。
- package export、CLI 参数、真实协议、PTY、HTML 可访问语义与浏览器交互由 E2E 主证明。
- 同一行为不在每个媒介重复完整矩阵。
- 其它媒介只证明自己独有的接线、序列化或降级。

例如，“筛选后只剩 main”由 browser 行为主证明。
JSON 测试只证明源数据保留 `main` 与 `rag` 的身份，不重复浏览器筛选步骤。

跨媒介关系本身也可以是一个 Behavior。
“text 与 web 呈现同一组终值”由同一个主证明声明两个 observation，并直接断言两面的显式字段关系；不能拆成两个各自通过却从未互相比较的测试。

## Registry

每个仓库从自己的静态声明生成 Behavior Manifest。
Manifest 只包含 Behavior、Proof 与外部引用元数据，不包含运行时代码、产品预期或 evidence。

本地静态守护验证：

- 本仓 Behavior ID 唯一；
- 本仓拥有的 ContractRef 指向真实 heading；
- 外部 ContractRef 的 repository、path 与 anchor 形状完整；
- 每个本仓 Behavior 恰有一个主证明；
- 主证明所在层与声明的 entry、observations、boundaries 相符；
- `boundaryProof` 不能冒充主证明；
- 本仓引用存在；跨仓引用声明明确的 `repository + Behavior ID`；
- 每个 E2E proof 的 `evidenceRecipeId` 指向本仓唯一 recipe，并精确绑定自己的 world 与 read-only / mutable-clone 模式。
- 每个 `mutable-clone` proof 的 `mutationActionId` 指向本仓唯一 `defineMutationAction()` export，且 action 的公开入口与 proof target 相同；
- mutation action 的 module / export 与静态 symbol closure 可解析；`read-only` proof 不引用 action。

根聚合守护只读收集各仓 Manifest，再验证：

- 外部 ContractRef 能在对应 repository 找到真实 heading；
- 跨仓引用能找到唯一 owner；
- 每个 `requiredBoundaryProofs` 都有匹配的真实 proof；
- 没有两个仓库同时声明同一个 `repository + Behavior ID`；
- supporting proof 不被计入完整性要求。

运行期报告与静态 Registry 分开。
每个实际执行的主证明和 required BoundaryProof 都必须产生自己的带身份 Outcome Assertion。
每个声明的 observation 都必须贡献 evidence；关系断言必须在同一 assertion 中记录全部来源。
Browser / HTML observation 还必须引用本次 Verification Run 和 frozen HTML 来源。
标题声称业务结果或跨媒介关系时，只断言 exit code 或只读取其中一面不能满足声明。
未执行、prepare 失败与 outcome 失败分别记录。
单例重跑不会改写静态完整性结论，完整 CI 则要求本次选择范围里的主证明与必需边界证明都被执行。

自然语言标题仍由 review 检查。
运行期记录只能守住“至少一个身份断言”，不能理解标题里的全部主张。

Behavior Manifest 是静态证明目录。
E2E 命令打印的 evidence manifest 是一次运行的只读证据入口；两者身份、生命周期与用途分开。

字面量测试代码是 Behavior Manifest 的唯一来源，生成文件不签入。
根仓 `test/docs/` 用只读 AST 扫描当前 checkout 直接构造内存 Manifest；它不运行自治 E2E 生成器。
每个 `pnpm e2e` 在本次运行 artifact 目录输出本仓 `behavior-manifest.json`，只供该次独立 CI 阅读，不回流为根守护输入。

## 执行命令

根仓 `test/unit/behavior/` 与机制证明仍由 `pnpm test` 执行。
每个自治 E2E 仓库仍以唯一入口完成最终验收：

```bash
pnpm e2e
```

命令完成 prepare、打印 frozen world manifest，再运行该仓库的 Behavior。
开发者可以用同一入口复用证据：

```bash
pnpm e2e -- verify \
  --world <manifest> \
  --behavior reports.view.narrow-by-experiment
```

`scripts/e2e.ts` 是唯一参数解析者。
每个 E2E proof 的 `evidenceRecipeId` 必须在传入 manifest 中恰好匹配一次；一个 Behavior 需要多个 world 时重复传 `--world`。
`verify --world` 必须校验 candidate、recipe、producer symbol closure、fixture、外部依赖与适用 producer environment identity。
World 不匹配、未冻结或 artifact 不完整时，命令直接失败；它不能暗中重新运行模型。
Vitest 原生标题统一带 `[Behavior ID]` 前缀，因此底层 `-t` 仍可用稳定 ID 定位同一测试。

## 失败语义

行为失败统一显示：

```text
Behavior: reports.view.narrow-by-experiment
Task: niceeval:docs/feature/reports/use-case/使用宿主/浏览器复盘与收窄.md#全流程
Contract: niceeval:docs/feature/reports/view.md#打开与收窄
Outcome: Comparison table shows only experiment "main"
Entry: browser
Observations: browser-a11y
Boundaries: real-browser
Execution: read-only @ report-scoreboard
World: report-scoreboard@<digest>
Verification: playwright-chromium@<version> / run <id>
Expected identity: main
Observed identities: main, rag
Evidence:
  browser-a11y: <trace-or-artifact>#role=table[name=Comparison]
```

错误按阶段区分：

- declaration：ID、契约、主证明或注册关系错误；
- prepare：fixture、真实模型运行或 evidence world 失败；
- invoke：公开动作未能执行；
- observe：媒介无法解析或对象身份无法寻址；
- outcome：观察合法，但用户结果不符合预期；
- cleanup：清理失败，保留更早的主失败。

解析失败不能退回宽松匹配。
缺少 evidence 也不能被解释成产品结果不符合预期。

## 范围

本方案包含精选用户行为规格、Feature-owned typed view、派生 Registry、proof→recipe 绑定、只读 evidence world、Verification Run 与能力专用失败诊断。

本方案不包含：

- 改写所有现有机制测试；
- unit / E2E 共用一套运行协议；
- 公共 Gherkin 或万能 Acceptance DSL；
- 从候选实现生成期望；
- 一开始就发布跨仓库 verifier；
- 让行为规格成为第二份 Feature 契约。

## 代价

- 每个高价值 Feature 要维护一套小型 User View。
- 行为规格与机制测试分开后，调查复杂失败时可能需要沿 Registry 跳一次。
- “一个主证明”的选择需要明确风险判断，不能机械按目录决定。
- User View 若开始计算期望或暴露所有底层结构，就会变成影子产品模型。

这些成本换来的是：普通读者看到用户任务，机制维护者看到精确定律，两者都不用接受最低公分母语言。
