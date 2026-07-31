# 方案 3：声明式 Acceptance Case 与显式投影

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [DECISION](../DECISION.md)

## 解决的问题

PLAN-2 让行为规格与机制证明分开。
但同一自治仓库里的稳定行为需要在 Library、CLI 或浏览器重复表达时，前置、动作和结果身份仍可能漂移。

本方案把一条精选用户行为声明成纯数据的 TypeScript `AcceptanceCase`。
unit 与 E2E 分别用显式 Projection 证明其中的 claim。
同仓 Projection 共享行为语义，不共享执行过程。
跨自治仓库只共享 proof link，不共享可执行 claim。

它不是 Gherkin。
没有自然语言步骤解释器，World、Action 与 Claim 都是领域专属的判别联合。

## 核心心智

一条 Acceptance Case 包含：

1. `world`：执行前有哪些带稳定身份的用户实体；
2. `steps`：用户按顺序从公开入口发起哪些动作；
3. `claims`：哪些带身份的结果必须成立；
4. `proof`：主证明与必需真实边界分别经过什么。

每条 Case 恰有一个 Primary Projection，并覆盖全部 claim。
Supporting Projection 可以证明 claim 子集或更精确的机制定律。

两个界面的用户结果不同，就写两条 Case。
不允许在 driver 内按界面或 Case ID 分支。

## 调用面

每个领域提供封闭的 Case 工厂：

```typescript
export const rerunReusesMatchingAttempt = defineRunnerCase({
  id: "runner.cache.reuse-expired",
  contract: "docs/feature/experiments/cache.md#携带粒度以-attempt-为单位",
  goal: "再次运行时，只重新执行身份变化的 attempt",
  world: runnerWorld({
    project: {
      evals: { kept: evalV1, rerun: evalV1 },
    },
    completedRun: {
      experiment: "compare",
      attempts: ["kept", "rerun"],
    },
  }),
  steps: [
    step("edit-rerun", replaceEval("rerun", evalV2)),
    step("rerun", runExperiment({ experiment: "compare" })),
  ],
  claims: {
    "kept-is-carried": after("rerun",
      runnerClaim.attempt("kept").isCarried()),
    "rerun-is-executed": after("rerun",
      runnerClaim.attempt("rerun").ranTimes(1)),
  },
  proof: {
    primary: { layer: "unit", surfaces: ["library"] },
    requiredBoundaries: [{
      id: "installed-cli",
      repository: "cli",
      surfaces: ["cli"],
    }],
  },
  regressions: [],
});
```

两层使用不同注册入口：

```typescript
registerUnitProjection({
  id: "runner.cache.reuse-expired.primary",
  case: rerunReusesMatchingAttempt,
  role: "primary",
  driver: runnerLibraryDriver,
  surfaces: ["library"],
  claims: "all",
  controls: {
    clock: "manual",
    barriers: ["attempt-dispatch"],
  },
});

registerExternalProofLink({
  case: {
    repository: "niceeval",
    id: "runner.cache.reuse-expired",
    digest: "<case-digest>",
  },
  requirementId: "installed-cli",
  nativeProofId: "cli.cache-rerun.installed-package",
  repository: "cli",
  layer: "e2e",
  surfaces: ["cli"],
});
```

不存在根据 `layer` 分支的统一 `run(case)`。
unit 与 E2E 注册器也不共享 setup、clock、cleanup 或协议模拟。

只有 Case owner 仓库内的 Projection 可以引用 Case 对象。
跨自治仓库只传 `repository + Case ID + case digest + requirement ID + native proof ID`。
目标仓库里的 native proof 自己写完整用户动作、观察与期望；`ExternalProofLink` 只说明它满足哪个边界要求，不能执行或复用 Case claim。
根聚合器检查引用、digest 与 proof 存在性，不能把 Case 运行时或 expectation 注入 E2E 仓库。
因此跨仓语义仍可能重复；PLAN-3 只解决同仓多 driver 的漂移。

## 领域模型

Runner、Report、Record 等领域分别定义 World、Action 和 Claim。
不存在跨全仓的 `click`、`line`、`row` 或任意回调步骤。

例如 Report 可以定义：

```typescript
type ReportAction =
  | { kind: "show-report"; report: string }
  | { kind: "filter-experiments"; names: readonly string[] }
  | { kind: "open-attempt"; attemptId: string };

type ReportClaim =
  | { kind: "table-shows-only"; table: string; rowIds: readonly string[] }
  | { kind: "dialog-describes"; attemptId: string }
  | { kind: "chart-has-series"; x: string; y: string; series: readonly string[] };
```

Case 中不允许函数、条件分支、regex assertion 或 driver 逃生参数。
表达不了的精确机制规律继续写原生 supporting test。

`steps` 是带稳定 ID 的非空有序列表。
Claim 明确指向在哪个 step 之后观察；Driver 不能把多步任务折成按 Case ID 特判的巨型 action。

## Proof 与 Registry

Registry 验证：

- Case、claim 与 Projection ID 唯一；
- 契约链接存在；
- 每条 Case 恰有一个 Primary Projection；
- Primary 覆盖全部 claim，并满足声明的 layer 与 boundary；
- 每个 required boundary 都有同仓 Projection，或指向一条完整 native proof 的跨仓 link；
- Supporting 引用存在的 claim；
- 每个 claim 都有主体身份；
- 要求真实协议的 Case 不能由 fixture driver 主证明；
- driver 支持声明的全部 World、Action 与 Claim。

Case 本身可以生成按用户任务排列的只读目录。
目录是 CI artifact，不成为第二份手写产品契约。

## 执行命令

Unit Projection 由根仓 `pnpm test` 执行。
每个自治 E2E 仓库的最终入口执行自己的 E2E Projection：

```bash
pnpm e2e
```

命令完成 E2E world prepare、打印 manifest，并运行该仓库的 Projection。
单例重跑按 Case ID 选择，并复用 frozen world：

```bash
pnpm e2e -- --reuse <manifest> --case reports.view.open-attempt-dialog
```

Manifest identity 不匹配、未冻结或缺 artifact 时直接失败。
重跑路径不重新调用模型，也不把无法执行的 Case 标成 skip。

## 错误语义

| 错误 | 时机与反馈 |
|---|---|
| DeclarationError | 注册前；重复 ID、空 claim、失效契约或 Case 含不可声明值 |
| ProjectionError | 注册前；缺主证明、claim 未覆盖、step 引用失效或必需边界不满足 |
| PreparationError | evidence world 准备失败；全部消费者指向同一根因 |
| InvocationError | 公开动作意外失败 |
| ObservationError | 输出无法由声明的媒介 adapter 解释 |
| ClaimMismatch | 打印 Case、claim、Projection、driver、身份、期望、观察与证据 |
| CleanupError | 附在主结果后，不覆盖更早失败 |

Driver 不支持某个 claim 时，在注册期失败。
它不能静默降级成字符串包含或任意节点存在。

## 范围

本方案包含精选用户行为的声明式 Case、领域专属联合、显式 Projection、派生 Registry 和不可变 evidence world。

本方案不包含：

- 把全部机制测试迁成 Case；
- unit 与 E2E 共用一套运行时；
- 自然语言解释器；
- 任意 setup、action 或 assertion 回调；
- 第一阶段发布跨仓库公共 DSL；
- 默认对 text、JSON、XML 或 HTML 做 byte golden。

## 采用条件

只有全部满足下面条件，才应采用：

1. 同一自治仓库内的稳定行为已经需要两个以上独立 Projection，复制语义造成真实漂移。
2. 对应领域词汇稳定到可以写成封闭判别联合。
3. 小规模试点中，声明比原生行为规格更短，失败也更直接。
4. Driver 不按 Case ID 分支，也不需要任意回调逃生。
5. 有明确所有者维护领域模型、Projection 守护与迁移。

任一条件不成立时，PLAN-2 的原生行为规格更直接。

## 主要风险

- Action 与 Claim 解释器可能成为产品逻辑的影子实现。
- 多 driver 复用可能把断言降成 count 或文本存在的最低公分母。
- Case、Projection 与 driver 分散后，简单失败可能需要多次跳转。
- 领域联合变化会批量触发无关 Case。
- 跨自治仓库只能共享静态 proof link，不能共享或执行 claim；语义重复仍由各仓 review 承担。
- “能生成覆盖矩阵”容易诱导团队追求迁移数量，而不是静默风险。

本方案只适合已经出现真实跨边界重复的稳定领域。
