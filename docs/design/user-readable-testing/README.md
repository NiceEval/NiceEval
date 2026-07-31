# 测试作者面：从用户任务到可验证结果

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [EVIDENCE](EVIDENCE.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

niceeval 已经有清楚的 unit / E2E 执行边界，却缺少同样清楚的测试作者面。
测试常能证明一个内部规则，但读者很难从中回答三个用户问题：

1. 用户在完成什么任务？
2. 哪个公开结果证明任务成功？
3. 失败时，究竟是哪一个用户结果坏了？

这不是要增加第三个执行层。
本决策只比较测试如何命名、组织、观察与登记；实际证明仍落到确定性 unit 或真实 E2E。

## 为什么现在需要裁决

仓库约有 152 个测试文件、40,938 行测试和 1,927 个 `it` / `test`。
Runner 一项就有约 13,250 行、482 个场景，其中 [`run.test.ts`](../../../src/runner/run.test.ts) 单文件 4,587 行。

当前登记只验证测试文件头的一条 `// cases:` 能指向测试文档。
它不能验证一个测试对应哪个覆盖类别，也不能验证标题声称的结果是否真的被断言。
规则见 [`cases-registry.test.ts`](../../../test/docs/cases-registry.test.ts)。

历史已经试过两个极端：

- `6abccb8b` 把场景再抄进每个 Feature 的测试文档；一周后 `998ebeef` 删除了 1,862 行重复清单。
- 覆盖清单改成粗类别后又重新膨胀。
  [`experiments-runner.md`](../../engineering/testing/unit/experiments-runner.md) 现有 58 个 bullet，最大的一个类别已经无法导航。

因此，问题不是再选一份地方手写测试清单，而是给用户行为、主证明和机制证明不同的身份。

## 三个候选

| 候选 | 测试作者主要看到什么 | 迁移量 | 用户可读性 | 抽象风险 |
|---|---|---:|---:|---:|
| [PLAN-1](PLAN-1/README.md) | 场景元数据与媒介 matcher | 小 | 中 | 低 |
| [PLAN-2](PLAN-2/README.md)（推荐） | 用户任务规格与类型化可观察读面 | 中 | 高 | 中 |
| [PLAN-3](PLAN-3/README.md) | 可投影到多个 driver 的声明式 Acceptance Case | 大 | 很高 | 高 |

三个候选都保留现有两层体系、独立 oracle、一次昂贵取证多面复用，以及真实 E2E 仓库自治。
差别在于：测试正文要暴露多少媒介细节，又要建立多强的统一模型。

## 同一个行为的三种写法

用户行为是：用户只修改一条 eval 源码后再次运行，未修改的 attempt 被携带，受影响的 attempt 重新执行。

PLAN-1 保留普通测试，只为场景加稳定身份：

```typescript
behavior({
  id: "runner.cache.reuse-expired",
  contract: "docs/feature/experiments/cache.md#携带粒度以-attempt-为单位",
  surfaces: ["library"],
  requiredBoundaryProofs: [{
    id: "installed-cli",
    repository: "cli",
    surfaces: ["cli"],
  }],
}).it(
  "再次运行时，只重新执行身份变化的 attempt",
  async () => {
    const project = await projectFixture({
      evals: { kept: evalV1, rerun: evalV1 },
    });
    const first = await runFixture(project);
    await project.replaceEval("rerun", evalV2);
    const result = await runAgain(project);

    expect(result.attempt("kept")).toBeCarriedFrom(first.attempt("kept"));
    expect(result.attempt("rerun")).toHaveRunOnce();
  },
);
```

PLAN-2 让测试作者从用户可观察对象进入：

```typescript
behavior(cacheReuse, async ({ user, fixture }) => {
  const project = await fixture.project({
    evals: { kept: evalV1, rerun: evalV1 },
  });
  const first = await user.run(project);
  await project.replaceEval("rerun", evalV2);
  const run = await user.run(project);

  expectObserved(run.attempt("kept").carriedFromRunId())
    .toEqualObserved(first.runId());
  expectObserved(run.attempt("rerun").runCount()).toEqualValue(1);
});
```

PLAN-3 把前置、动作与结果声明成可投影的数据：

```typescript
defineRunnerCase({
  id: "runner.cache.reuse-expired",
  contract: "docs/feature/experiments/cache.md#携带粒度以-attempt-为单位",
  goal: "再次运行时，只重新执行身份变化的 attempt",
  world: cacheWorld({
    project: { kept: evalV1, rerun: evalV1 },
  }),
  steps: [
    step("first-run", runExperiment()),
    step("edit-rerun", replaceEval("rerun", evalV2)),
    step("second-run", runExperiment()),
  ],
  claims: {
    carried: after("second-run", attempt("kept").isCarried()),
    executed: after("second-run", attempt("rerun").ranTimes(1)),
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

PLAN-1 最接近现状，但媒介和 fixture 仍容易占据正文。
PLAN-3 最像一份规格，却会建立第二套产品模型。
PLAN-2 只统一用户可观察对象，机制测试仍保留最适合自己的精确语言。

## 阅读顺序

- 先看共同判据与边界：[GOALS](GOALS.md) 和 [LIMITS](LIMITS.md)。
- 看现有测试与代表性提交怎样支持这些判断：[EVIDENCE](EVIDENCE.md)。
- 用固定场景比较方案：[CASES](CASES.md)。
- 看最终选择、迁移顺序与现有 E2E DSL 的去向：[DECISION](DECISION.md)。
- 执行层现行契约仍以[测试体系总纲](../../engineering/testing/README.md)为准。
