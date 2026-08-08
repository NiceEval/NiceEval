# Sample —— 库用法

`niceeval/sample` 把一份 [Record](../record/README.md) 选成当前配置下唯一的结果集。
判断全部写在返回值上，Reports 不再从 Run 或规划字段重建贡献集合。

## 当前选择器

```typescript
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";

const record = await openRecord(".niceeval");
const current = currentSample(record, {
  experiments: "compare/",
  evals: "algebra/",
});
```

`currentSample()` 对每个 Experiment 执行同一条选择规则：

1. 最新 Run 的 `configHash` 是当前配置身份。
2. 只有相同 `configHash` 的 Run 可以共同贡献；缺少 `configHash` 的 Run 只与自己可比。
3. 每个 Eval 按 Run 从新到旧取第一组实际存在的物理 Attempt。
4. Attempt 来自实际执行、携带合入或可比旧 Run，不改变贡献资格。
5. 没有当前 Attempt 的 Eval 进入 coverage 缺口。

物理 Attempt 指 Record 已经登记并暴露的 `AttemptHandle`，不是递归扫描任意 `result.json`。
`selectedEvalIds` 是 Runner 的运行期计划，不属于 Record、Sample 或 Reports 的贡献规则。

## 单 Run 选择

```typescript
import { latestRunSample } from "niceeval/sample";

const snapshot = latestRunSample(record, { experiments: "compare/" });
```

`latestRunSample()` 只服务需要一份自包含 Run 的发布与审计旅途。
它收最新 Run 里实际登记的全部 Attempt，不跨 Run 补题，也不产生另一种 current 状态。

## Sample 形状

```typescript
interface SampleMissing {
  evalId: string;
  reason: "never-run" | "previous-result";
  previous?: {
    locator: string;
    verdict: "passed" | "failed" | "errored" | "skipped";
    startedAt: string;
  };
}

interface SampleCoverage {
  experimentId: string;
  run: Run;
  knownEvalIds: string[];
  missing: SampleMissing[];
}

interface Sample {
  attempts: AttemptHandle[];
  runs: Run[];
  historyAttempts: AttemptHandle[];
  coverage: SampleCoverage[];
  issues: SampleIssue[];
  scope(options: { experiments?: string | string[]; evals?: string | string[] }): Sample;
  filter(predicate: (attempt: AttemptHandle) => boolean): Sample;
}
```

`attempts` 是当前贡献全集，官方计算函数只消费它。
`runs` 只保存真正贡献过 Attempt 的 Run；同一个 Experiment 可以有多个贡献 Run，但它们共享当前 `configHash`。
`historyAttempts` 服务明确的 History、趋势和稳定性旅途，不参与当前报告计票。

## 缺口与分母

`knownEvalIds` 是分母，来自本地历史与各 Run 声明的已知 Eval 并集，再与调用方范围求交。
`missing` 只列当前 `attempts` 里没有对应 Attempt 的 Eval。

`never-run` 表示历史中没有该 Eval 的任何物理 Attempt。
`previous-result` 表示历史中有物理 Attempt，但它不在当前可比 Run 集合中；`previous` 取最近一条可定位结果作为审计入口。
这个引用不参与任何读数，也不保证 `accept` 一定成功；`accept` 仍会按当前项目重新完成全部资格校验。

## provenance 事实

`AttemptHandle.carried` 保留为 provenance 事实。
它用于 Attempt 详情解释证据从哪里来，不用于过滤、分段、降饱和或改变统计。

如果产品要求结果必须在一定时间内重新执行，这项要求进入携带资格或 fingerprint 输入。
过期结果不能被携带时，自然形成 current 缺口；Reports 不提供时间过滤器修正当前结果集。

## 转换

```typescript
const algebra = currentSample(record)
  .scope({ experiments: "compare/", evals: "algebra/" })
  .filter((attempt) => attempt.result.verdict !== "skipped");
```

| 方法 | 含义 | coverage 分母 |
|---|---|---|
| `scope()` | 重新定义当前总体 | 与范围求交 |
| `filter()` | 删除不可信或不适用的当前观测 | 保持不变，删出的 Eval 进入缺口 |

转换同步更新 `attempts`、`runs`、`historyAttempts`、`coverage` 与 `issues`(带 experiment 归属的随所属实验存活)。
Sample 不提供 `freshOnly()`；需要查看单次执行事实时进入 Run 或 History 旅途。

## 去重

携带会让同一 Attempt 出现在多份 Run 中。
选择器按稳定 locator 身份去重，重复时保留最新 Run 中的物理副本，证据入口因此落在最新副本上。
缺少稳定身份时宁可保留，不靠近似字段误删。

## Issue code 全集

`issues` 只收不能归到某个 coverage 缺口或某个 Attempt 上的读取问题：

```ts
type SampleIssue =
  | { code: "unfinished-run"; experimentId: string; startedAt: string; dir: string }
  | {
      code: "dangling-evidence";
      experimentId: string;
      evalId: string;
      attempt: number;
      artifactBase: string;
      artifacts: readonly string[];
    }
  | {
      code: "unreadable-run";
      dir: string;
      reason: "incompatible" | "malformed" | "incomplete";
      producer?: { name: string; version?: string };
    };
```

Issue 不携带文案、严重度或修复命令；Reports 的 Notice policy 决定如何解释。

## 相关阅读

- [README](README.md) —— 当前结果集的唯一心智。
- [局部补跑](use-case/partial-rerun.md) —— 多 Run 如何形成 current。
- [Record](../record/library.md) —— 物理事实、身份与发布。
- [Reports](../reports/library.md) —— 消费 Sample 的计算与组件。
