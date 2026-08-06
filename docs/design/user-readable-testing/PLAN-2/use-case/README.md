# 方案 2：Use Cases

**相关文档**：[方案](../README.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md) · [共同 Cases](../../CASES.md)

本页按共同 Cases 展示本候选的完整作者路径。
契约语义仍以各 Feature 文档为准。

## C1：缓存复用

行为规格按用户任务放在 `test/unit/behavior/rerun/reuse-unmodified-attempts.test.ts`：

```typescript
runnerBehavior({
  id: "runner.cache.reuse-expired",
  task: {
    repository: "niceeval",
    path: "docs/feature/experiments/use-case/缓存与沿用/修改评测源码.md",
    anchor: "修改评测源码后只重跑受影响项",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/experiments/cache.md",
    anchor: "携带粒度以-attempt-为单位",
  },
  title: "只修改一条 eval 后，未修改项被携带，修改项重新执行",
  risk: "release-blocking",
  primary: {
    layer: "unit",
    target: {
      entry: "library",
      observations: ["library-result"],
      boundaries: ["in-process"],
    },
  },
  requiredBoundaryProofs: [{
    id: "installed-cli",
    repository: "cli",
    target: {
      entry: "cli",
      observations: ["ndjson-events"],
      boundaries: ["installed-package", "external-cwd", "real-cli"],
    },
  }],
}, async ({ user, fixture }) => {
  const project = await fixture.project({
    evals: { kept: evalV1, rerun: evalV1 },
  });
  const first = await user.run(project);

  await project.replaceEval("rerun", evalV2);
  const second = await user.run(project);

  expectObserved(second.attempt("kept").carriedFromRunId())
    .toEqualObserved(first.runId());
  expectObserved(second.attempt("rerun").runCount()).toEqualValue(1);
});
```

标题中的“携带”和“身份变化项重新执行”分别落到公开结果的来源与执行次数。
测试输入是用户能做的 eval 源码修改，不暴露 fingerprint 测试入口。
Fixture 的 Agent 对 `kept` 或第二次 `rerun` 调用立即抛错，但这个防伪事实由相邻 supporting proof 直接展示，不成为 User View 的一部分。
读者不需要打开 Runner 调度实现，也不会把两个 attempt 混成一个总数。

`e2e/cli` 另行满足必需边界：

```typescript
const cacheCliWorld = defineEvidenceRecipe({
  id: "cache-rerun-installed-cli",
  async prepare({ project, capture }) {
    await project.writeEval("kept", evalV1);
    await project.writeEval("rerun", evalV1);
    await project.exec([
      "niceeval", "exp", "cache-probe", "--rerun", "all",
    ]);

    await project.writeEval("rerun", evalV2);
    await capture("rerun-events", project.exec([
      "niceeval", "exp", "cache-probe", "--json",
    ]));
  },
});

boundaryProof({
  repository: "niceeval",
  id: "runner.cache.reuse-expired",
}, {
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
}).it(
  "安装后的 CLI 只派发身份变化的 attempt",
  async ({ world }) => {
    const rerun = world.command("rerun-events");
    expectObserved(rerun.executedAttemptIds()).toEqualValue(["rerun"]);
  },
);
```

Recipe 与 proof 放在同一文件：公开 argv 和源码修改就地可见，但命令只在 prepare 执行。
Proof 只读冻结的 NDJSON 生命周期事件流，并产出自己的 identity-bearing outcome。
根聚合缺少这份 proof 时判定行为证明不完整。

## C2：Report 多读面

同一个行为只选择一个主证明，其它读面证明自己的独有合同：

| 读面 | 证明内容 |
|---|---|
| plain stdout | 管道中仍能读到实验、状态与下一步 |
| PTY | 宽度、折行、窄宽降级与 CJK 显示宽度 |
| JSON | experiment / attempt 身份、字段与结果值 |
| HTML | 静态内容与可访问语义 |
| browser | 筛选、展开、可见状态与对象归属 |

配色、padding 或 JSON 缩进变化只触及对应 adapter。
聚合、排序和 coverage 等共享数据语义由 unit 机制证明，不在五个读面复制完整矩阵。

text / web 同源本身由一个关系型 Behavior 证明：

```typescript
const reportScoreboardWorld = defineEvidenceRecipe({
  id: "report-scoreboard",
  fixtureInputs: ["test/fixtures/report/scoreboard-record"],
  async prepare({ fixture, project, capture, captureDirectory }) {
    const record = fixture.path("scoreboard-record");

    await capture("show-text", project.exec([
      "niceeval", "show", "--record", record,
    ]));
    await captureDirectory("export-html", "site", project.exec([
      "niceeval", "view", "--record", record, "--out", "site",
    ]));
  },
});

reportBehavior({
  id: "reports.page.text-web-parity",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/交付报告/导出静态站.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/view.md",
    anchor: "自定义报告与外壳",
  },
  title: "同一页的 text 与 web 面保留相同终值和证据身份",
  risk: "high",
  primary: {
    layer: "e2e",
    target: {
      entry: "cli",
      observations: ["stdout", "html"],
      boundaries: [
        "installed-package",
        "external-cwd",
        "real-cli",
        "real-browser",
      ],
      verifier: {
        engine: "playwright-chromium",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        javaScript: "disabled",
        network: "local-only",
      },
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-scoreboard",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ user, world }) => {
  const { text, html } = user.readBoth(world.report("scoreboard"));

  expectObserved(text.page("report").attemptIds())
    .toEqualObserved(html.page("report").attemptIds());
  expectObserved(text.page("report").verdictsByAttempt())
    .toEqualObserved(html.page("report").verdictsByAttempt());
});
```

两条关系 matcher 都记录 stdout 与 HTML 的 evidence、提取路径和对象身份。
测试明确写出“attempt 身份”和“逐 attempt verdict”两项口径，不把语义范围藏进 `semanticValues()`。
这条测试证明两面关系。
具体通过率是否正确，仍由计算语义自己的主证明负责。

## C3：筛选与展开

浏览器行为规格使用领域对象，而不是行数和任意 modal：

```typescript
reportBehavior({
  id: "reports.view.narrow-by-experiment",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/使用宿主/浏览器复盘与收窄.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/view.md",
    anchor: "打开与收窄",
  },
  title: "用户收窄到 main 后，只看到 main 的实验",
  risk: "high",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["browser-a11y"],
      boundaries: ["installed-package", "real-browser"],
      verifier: {
        engine: "playwright-chromium",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        javaScript: "enabled",
        network: "local-only",
      },
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-scoreboard",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ user, world }) => {
  const page = await user.open(world.report("scoreboard"), {
    experiments: ["main"],
  });

  expectObserved(page.table("Comparison").rowIds())
    .toEqualValue(["main"]);
});

reportBehavior({
  id: "reports.view.open-attempt-dialog",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/调试/按定位符下钻.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/view.md",
    anchor: "参数化页的-dialog-摆放",
  },
  title: "用户打开 attempt 后，详情属于所选 attempt",
  risk: "high",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["browser-a11y"],
      boundaries: ["installed-package", "real-browser"],
      verifier: {
        engine: "playwright-chromium",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        javaScript: "enabled",
        network: "local-only",
      },
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-scoreboard",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ user, world }) => {
  const page = await user.open(world.report("scoreboard"));
  await page.openAttempt("attempt-main-2");
  const dialog = page.attemptDialog("attempt-main-2");
  expectObserved(dialog.experimentId()).toEqualValue("main");
  expectObserved(dialog.attemptNumber()).toEqualValue(2);
});
```

两个结果分别拥有主证明，但可以复用同一个 frozen world。
每例都创建新的 Chromium BrowserContext / Page；ARIA 观察来自真实浏览器，不来自 DOM 模拟器。

## C4：并发与超时

用户行为主证明只观察最终执行身份。
更精确的调度定律留在源码旁：

```typescript
const singleFlightProof = supportingProof({
  id: "runner.cache.reuse-expired.single-flight",
  behavior: {
    repository: "niceeval",
    id: "runner.cache.reuse-expired",
  },
});

it.effect(
  singleFlightProof.title(
    "producer 完成前相同身份的读取者保持等待，完成后共享同一结果",
  ),
  () =>
    Effect.gen(function* () {
      const producerStarted = yield* Deferred.make<void>();
      const releaseProducer = yield* Deferred.make<void>();
      const events = yield* Ref.make<readonly string[]>([]);
      const calls = yield* Ref.make(0);

      const AgentTest = Layer.succeed(Agent, {
        run: () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(calls, (n) => n + 1);
            if (count > 1) {
              return yield* Effect.die("unexpected second producer call");
            }
            yield* Ref.update(events, (xs) => [...xs, "producer:start"]);
            yield* Deferred.succeed(producerStarted, undefined);
            yield* Deferred.await(releaseProducer);
            yield* Ref.update(events, (xs) => [...xs, "producer:done"]);
            return passedAttempt;
          }),
      });

      yield* Effect.gen(function* () {
        const first = yield* Effect.fork(runAttempt("same"));
        yield* Deferred.await(producerStarted);
        const second = yield* Effect.fork(runAttempt("same"));

        yield* TestClock.adjust("999 millis");
        expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
        expect(Option.isNone(yield* Fiber.poll(second))).toBe(true);
        expect(yield* Ref.get(events)).toEqual(["producer:start"]);

        yield* Deferred.succeed(releaseProducer, undefined);
        const [a, b] = yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second),
        ]);

        expect(a).toBe(b);
        expect(yield* Ref.get(calls)).toBe(1);
        expect(yield* Ref.get(events))
          .toEqual(["producer:start", "producer:done"]);
      }).pipe(Effect.provide(AgentTest));
    }),
  { timeout: 2_000 },
);
```

`supportingProof()` 只给原生标题附加静态 ID。
`it.effect` 的 TestClock、`Effect.provide(Layer)`、timeout、原生失败位置和 `-t` 过滤都没有被 wrapper 接管；需要 Scope 时同样直接使用 `it.scoped`。
table / property / concurrent 测试也继续使用 runner 原生入口，Registry 只关联标题元数据。
真实 sleep、全局 fake timer 和捕获的真实墙钟都不进入新机制证明。
User View 也不隐藏 barrier 与时钟。

## C5：一次取证，多面复用

E2E prepare 创建 `report-scoreboard@<digest>`：

```text
prepare world
  → 安装候选 tarball
  → 运行真实模型任务
  → 一次生成 JSON、JUnit 与 HTML
  → 保存 stdout、PTY screen（grid + scrollback + raw ANSI）与 trace
  → 关闭进程，校验路径并写 manifest / 文件树 digest
  → 原子 rename，移除写权限并冻结
```

Vitest 测试只读打开 world。
下面的唯一入口可以复用 manifest 单独重跑，不调用模型：

```bash
pnpm e2e -- verify \
  --world <world-manifest> \
  --behavior reports.view.narrow-by-experiment
```

`scripts/e2e.ts` 解析参数，并先比对当前候选、producer、fixture、prepare config 和适用环境 identity。
不匹配时以 stale-evidence 失败并提示重新执行 `pnpm e2e`，不静默 prepare。

读回迁移或修复测试从 `report-scoreboard@<digest>` 创建单例私有的 mutable clone。
普通验证的 cwd、日志、browser profile 与 trace 全在 world 外；每例前后复核文件树 digest。
任何验证器尝试写冻结根都会报告具体路径，因此测试顺序不再承担语义。

## C6：真实外部协议

确定性转换可以保留 supporting unit proof：

```typescript
const usageMappingProof = supportingProof({
  id: "record.usage.from-ai-sdk.mapping",
  behavior: {
    repository: "ai-sdk",
    id: "record.usage.from-ai-sdk",
  },
});

it(
  usageMappingProof.title(
    "输入、输出与 cache token 映射到独立 usage 字段",
  ),
  () => {
    // 签入的可区分输入与显式预期。
  },
);
```

兼容性主证明在自治 Adapter E2E：

```typescript
const aiSdkUsageWorld = defineEvidenceRecipe({
  id: "ai-sdk-usage-probe",
  async prepare({ candidate, project, capture }) {
    await project.exec(["pnpm", "add", candidate.tarball]);
    await capture("usage-probe", project.exec([
      "pnpm", "exec", "tsx", "src/usage-probe.ts",
    ]));
  },
});

adapterBehavior({
  id: "record.usage.from-ai-sdk",
  task: {
    repository: "niceeval",
    path: "docs/getting-started.md",
    anchor: "1-评一个会话型-agent",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/record/architecture.md",
    anchor: "usage",
  },
  title: "用户用当前 AI SDK 运行后，记录保留真实 token usage",
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "protocol",
      observations: ["protocol-event", "json"],
      boundaries: ["installed-package", "external-cwd", "real-protocol"],
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "ai-sdk-usage-probe",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ world }) => {
  const call = world.protocolCall("usage-probe");
  const upstream = call.upstreamUsage();
  const recorded = call.publicAttemptRecord().usage();

  expectObserved(recorded.inputTokens())
    .toEqualObserved(upstream.inputTokens());
  expectObserved(recorded.outputTokens())
    .toEqualObserved(upstream.outputTokens());
  expectObserved(recorded.cacheReadTokens())
    .toEqualObserved(upstream.cacheReadTokens());
});
```

`src/usage-probe.ts` 是该自治仓库签入的真实当前 SDK 用法；prepare 同次保存上游公开 usage event 与 niceeval 公开 JSON 出口。
断言比较的是同一次调用的独立上下游字段，不是会随 provider / tokenizer 变化的固定 token 数。
每个关系 matcher 同时记录 protocol-event 与 JSON 两份来源。
E2E 不从候选包导入 schema 版本，也不读取私有记录对象。

## C7：包外消费者

Package consumer 的 `UserView` 只知道候选 tarball、临时外部 cwd、公开 import 与 CLI：

```typescript
const packageConsumerWorld = defineEvidenceRecipe({
  id: "package-consumer-smoke",
  async prepare({ candidate, project, capture }) {
    await capture("install", project.exec([
      "pnpm", "add", candidate.tarball,
    ]));
    await capture("run", project.exec([
      "niceeval", "exp", "smoke", "--rerun", "all",
    ]));
    await capture("readback", project.exec([
      "niceeval", "show", "--json",
    ]));
  },
});

packageBehavior({
  id: "package.consumer.run-and-read",
  task: {
    repository: "niceeval",
    path: "docs/getting-started.md",
    anchor: "1-评一个会话型-agent",
  },
  contract: {
    repository: "niceeval",
    path: "docs/getting-started.md",
    anchor: "看结果",
  },
  title: "用户安装发布包后能运行实验并从公开出口读回结果",
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "cli",
      observations: ["process-result", "json"],
      boundaries: ["installed-package", "external-cwd", "real-cli"],
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "package-consumer-smoke",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ world }) => {
  const install = world.command("install");
  const run = world.command("run");
  const readback = world.command("readback");

  expectObserved(install.exitCode()).toEqualValue(0);
  expectObserved(run.exitCode()).toEqualValue(0);
  expectObserved(readback.attempt("smoke-1").status())
    .toEqualValue("passed");
});
```

安装、运行与读回的原始 argv 在 Behavior 同文件的 recipe 中逐条可见，且只在 prepare 执行。
测试只读 command process result 与 JSON；不会在 verify 阶段安装包或追加 Run。
Driver 不能读取 `src/`、候选内部 schema 常量或私有 `.niceeval` 结构补足预期。

## C8：回归修复

有公开行为后果的 bug 复用或新增 Behavior ID。
主证明元数据记录 bug，Registry 展示契约、主证明、边界证明和少量 supporting proof。

只影响内部机制的 bug 直接在相邻单元测试写可区分 regression：

```typescript
it.effect("取消最后一个 waiter 会释放 producer fiber", () => {
  // 不发明一个新的用户行为身份。
});
```

这让回归可追踪，但不会为了漂亮目录给所有实现分支贴业务标签。

## 采用判断

先在 Runner cache 与 Report 读面各试点三到五条高风险 Behavior。
评审分别记录：

- 用户行为测试是否能一屏读完；
- 内部重构是否只触及机制证明；
- 失败是否直接指出对象身份；
- E2E 是否能复用冻结 world 单例重跑；
- User View 是否开始复制产品算法。

试点证明收益后再扩展。
若同一稳定任务已经在多个 driver 中重复且持续漂移，再按 [PLAN-3](../../PLAN-3/README.md) 的采用条件重新评审。
