# Eval E2E Verdict Policy

## 用户需要

Eval 已经在自己的正文里完成判分，但 E2E owner 仍要声明一次运行应当产生哪些终局。简单 owner 会重复运行命令、读取 NDJSON、按身份找结果和比较 Verdict。包含多个 Eval 的 live Adapter owner 还会重复编写 retry 过滤、passed 计数和最终全绿检查。

这些期望分散后，刻意失败的 Eval 容易被通用 retry 当成偶发失败，随后又被最终全绿检查要求变成 `passed`。Repo 需要一份带类型、穷尽且位于原生测试正文的 Verdict Policy，让同一份期望约束首次运行、retry 和最终验收。

## 核心心智

Verdict 期望属于一次 E2E 证明，不属于 Eval 产品定义。一个结果的稳定身份是 `Experiment × Eval`，运行时还受 Agent、model、flags 和其它 Experiment 配置影响。同一 Eval 在不同坐标下可以有不同终局。

每个 Repo 在原生测试文件里声明一份 `EvalRunPolicy`。Policy 完整列出 invocation 契约和全部结果坐标；Repo-local support 只执行机械读取与比较。测试文件仍拥有 owner、标题、完整 argv、退出码、completion、每个坐标的 Verdict，以及预期失败或错误的具名证据。

```ts
// owner: docs/engineering/testing/e2e/adapter/claude-code.md#adapter-claude-code-live-compatibility

import { defineEvalRunPolicy, expectEvalRun } from "./support.ts";

const policy = defineEvalRunPolicy({
  invocation: {
    argv: ["exp", "--rerun", "all", "--json"],
    exitCode: 1,
    completion: "completed",
  },
  outcomes: [
    {
      experimentId: "coding",
      evalId: "coding-task",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    },
    {
      experimentId: "locked-down",
      evalId: "websearch-denied",
      verdict: "failed",
      attempts: 1,
      passed: 0,
    },
  ],
  retry: {
    expectedVerdicts: ["passed"],
    observedVerdicts: ["failed", "errored"],
    maxRunsPerCoordinate: 1,
    concurrency: 4,
  },
});

test("Claude Code 交付每个声明坐标的预期终局", async () => {
  const result = await expectEvalRun(policy);

  const denied = result.first.get("locked-down", "websearch-denied");
  await expectFailedAssertion(denied, "turn.succeeded");
});
```

`outcomes` 没有隐式默认值。一次调用涉及多个 Eval 时必须完整列出每个坐标，不能把未写项默认为 `passed`。`attempts` 与 `passed` 都是显式 expected，因为多 Attempt 聚合可以允许部分通过，也可以要求全部通过。

## Policy 形状

Repo-local support 使用以下穷尽形状。具体命名可以适应该 Repo，但字段语义保持一致。

```ts
interface EvalRunPolicy {
  invocation: {
    argv: readonly string[];
    exitCode: number;
    completion: "completed" | "cancelled";
  };
  outcomes: readonly ExpectedEvalOutcome[];
  retry?: LiveRetryPolicy;
}

interface ExpectedEvalOutcome {
  experimentId: string;
  evalId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  attempts: number;
  passed: number;
}

interface LiveRetryPolicy {
  expectedVerdicts: readonly ("passed" | "failed" | "errored" | "skipped")[];
  observedVerdicts: readonly ("passed" | "failed" | "errored" | "skipped")[];
  maxRunsPerCoordinate: number;
  concurrency: number;
}
```

`invocation.exitCode` 保持显式，不从 outcomes 推导。退出码是独立公开结果；由 Verdict Policy 反算会复制候选 CLI 的折叠规则，使两条本应互相校验的契约变成同源计算。

## 首次结果与 retry

`expectEvalRun()` 先严格验收首次 invocation 的身份集合。缺少、重复或多出一个 `Experiment × Eval` 都立即失败，retry 不能补齐首次运行没有产出的坐标。

Retry 只服务声明了该能力的 live owner。确定性 owner 不配置 retry。一个坐标只有同时满足下列条件才可重跑：

- Policy 声明了 `retry`；
- 该坐标的 expected Verdict 在 `expectedVerdicts` 中；
- 首次 observed Verdict 在 `observedVerdicts` 中；
- observed Verdict 尚未等于 expected Verdict；
- 该坐标没有超过 `maxRunsPerCoordinate`。

预期 `failed` 的坐标观察到 `failed` 时已经满足 Policy，不参与 retry。它观察到 `errored`、`skipped` 或 timeout 时也不能被当作等价反例；`expectEvalRun()` 直接报告终局不匹配。这样不会把“权限拒绝应导致断言失败”改写成“进程挂死也算命中失败路径”。

`expectEvalRun()` 同时返回 `first` 与 `effective` 两组 typed events。首次收据永远保留；允许 retry 的坐标只有在重跑得到 expected Verdict 后，才以重跑结果进入 `effective`。最终集合检查、逐坐标检查和 passed 总数都读取同一份 Policy，不再各自维护过滤条件或魔法数字。

## 预期失败与预期错误

Verdict 只说明终局类别，不能独立证明命中了目标失败路径。

- 预期 `failed` 的 owner 还要核对具名 Assertion、failure fact 或公开读回中的等价稳定证据，排除另一条无关断言失败。
- 预期 `errored` 的 owner 还要核对 phase、reason、结构化错误分类或公开读回中的等价稳定证据，排除加载错误、Runner 崩溃和 cleanup 错误。
- 预期 `skipped` 的 owner 还要核对稳定 skip reason，排除 early exit 或发现缺失。

这些场景独有的证据留在原生测试正文。`expectEvalRun()` 返回 receipt 与 typed events 供 owner 继续断言，不把具名原因藏进通用 Verdict 映射。

## Repo-local support 的职责

`expectEvalRun()` 固定完成以下机械工作：

1. 在该 owner 的独占项目副本中运行调用点给出的逐字 argv；
2. 比较显式的 exit code 与 invocation completion；
3. 严格读取 NDJSON，并取得全部带 locator 的 `event: "eval"` 终局事件；
4. 按 `experimentId + evalId` 比较完整集合，拒绝缺少、重复或额外结果；
5. 比较每项 `verdict`、`attempts` 与 `passed`；
6. 按显式 live retry policy 选择坐标，并保留首次与重跑收据；
7. 以同一份 outcomes 验收 effective 集合与 passed 总数；
8. 失败时附上原始 `ProcessReceipt.diagnostic()`；
9. 返回原始 receipt 与 typed events，供 owner 验收具名原因和其它公开结果。

它不隐藏 owner、Vitest 标题、完整 argv、退出码、completion、坐标 expected，以及 `failed`、`errored`、`skipped` 的具名证据。它也不接管 show、JUnit、execution、timing、资源终结或浏览器断言。

## 不把期望注解到 Eval

不新增 `@expectPass`、`@expectFail`、`@expectError` 之类的源码注释，也不在 `defineEval()` 增加 `expectedVerdict` 或借用 `metadata` 保存 E2E 期望。

注释没有类型检查。重命名、复制、格式化或构建转换都可能让注释和真实 Eval 静默分离；读取它还需要第二套源码扫描与 discovery。Node 和 Vitest 的 test annotation 只描述已经运行的测试 metadata，不能表达 NiceEval 的 `Experiment × Eval` 坐标。

Eval metadata 会进入 Record 并参与 Attempt fingerprint。测试期望进入这里会改变产品 provenance 与复用身份，也会把某个 E2E Repo 的预期变成 Eval 的全局属性。同一 Eval 在不同 Experiment 下需要不同终局时，这个形状无法表达。

`expectError` 尤其不能只表示“任意 errored 都通过”。Judge unavailable、加载失败、进程错误、timeout 与 cleanup 错误必须保持可区分，具名错误证据仍由 owner 明确验收。

## 适用边界

- 适用于同一场景 Repo 内重复的 `exp --json` 终局读取。
- 适用于单 Eval owner，也适用于需要统一 retry 与终局集合的 live Adapter owner。
- 每个稳定结果仍有自己的原生 Vitest owner；Journey 可以在一个 Policy 中完整列出同一次 invocation 的全部坐标。
- `--run <file>` 与 `-t <title>` 的单项重跑保持不变。
- 不从 Verdict 推导 exit code、completion 或具名失败原因。
- 不把终局运行与读取函数上移到 `@niceeval/testkit`；只有第二个独立 Repo 出现相同稳定机械协议并满足 Testkit 准入门时，才另行评审共享。
- 不替换包含多个公开动作、读面或资源生命周期收据的原生 E2E 正文，只替换其中重复的终局编排。

## 验收

Verdict Policy 只有同时满足以下条件才算交付：

- owner、标题、完整 argv、退出码、completion 与全部坐标 expected 在测试文件中一屏可定位；
- expected Verdict 写错、漏写坐标、额外运行坐标或返回重复终局时，测试确定失败；
- 预期 `failed` 的坐标不会进入 retry，且 observed `errored`、timeout 或 skipped 都不能满足它；
- 预期 `failed`、`errored` 与 `skipped` 的具名原因改变时，测试确定失败；
- live retry 的首次与重跑收据都被保留，重跑不能掩盖首次异常事实；
- 确定性 owner 不获得测试级 retry；
- passed 总数只从完整 outcomes 计算，不在 owner 另存魔法数字；
- 每个 owner 仍可按 Repo、文件和标题独立运行；
- 不改变 NiceEval 公共 API、Eval fingerprint、Record、根 E2E runner 或 Testkit；
- owner 加 Repo-local support 后的净代码量下降至少 30%，否则保留原生写法。

## 入口

- [E2E 测试正文](README.md#单边界-e2e) —— argv、动作与 expected 的现行归属。
- [Eval E2E owner](eval.md) —— 确定性 Eval owner 的稳定结果。
- [Adapter E2E](adapter/README.md) —— live compatibility、事件断言与公开读回。
- [官方 Testkit](../testkit.md) —— 机械设施与领域 expected 的边界。
- [测试作者面决策](../../../design/user-readable-testing/README.md) —— 不建立第二套 Behavior、World 或 DSL 的既有裁决。
