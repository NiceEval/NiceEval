# 核对 RecordAttachment 完整度

团队要知道一个 Report 是否基于完整的命令检查数据，而不是把有值的 Attempt 当成全部 Attempt。

## 选择固定分母

    niceeval show --latest --report ./reports/command-checks.ts --page /coverage

`--latest` 选择每个 Experiment 的最新 published Run。`AnalysisSample` 随后保留每个 expected slot，因此这张页的分母在 Calculation 开始前已经固定为 100。该分母只是 Sample-wide 的 slot denominator；页面上显示的 `observed` / `denominator` 由 Calculation value 返回。

## 声明 `commands.checked` projection

Report 通过 `attemptSlotProjection(commandsCheckedProjector)` 声明每个 Sample slot 的 logical access，并把它放进 Calculation 的 `inputs`。宿主保留 excluded、not-recorded 与 core-invalid entries；included slot 定位为 Attempt owner 与 `ProjectedRecordAttachmentResult`。Attachment 要么是完整 available 值，要么是 unavailable、migration-required、migration-unavailable、unsupported 或 invalid 数据状态。

```ts
const commandsChecked = attemptSlotProjection(commandsCheckedProjector);

const commandChecks = defineCalculation({
  id: Either.getOrThrow(reportComponentId("command-checks")),
  inputs: reportInputs({ commandsChecked }),
  completeness: "allow-partial",
  calculate({ sample, inputs }) {
    return checkedCommands(sample, inputs.commandsChecked);
  },
});
```

当只有 20 个 slot 提供可用检查数据时，Calculation 返回数值 `20` 与 `{ observed: 20, denominator: 100 }`：

    {
      state: "available",
      value: { count: 20, observed: 20, denominator: 100 },
      inputState: { state: "partial" },
    }

页面写 `20 / 100 · partial`。它不把 20 显示成完整数量，也不把 20 当成新的分母。

## 需要完整读数时

若业务读数不能使用缺口数据，使用 `require-complete`。

```ts
const releaseGate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("release-gate")),
  inputs: reportInputs({ commandsChecked }),
  completeness: "require-complete",
  calculate({ sample, inputs }) {
    return gateFromChecks(sample, inputs.commandsChecked);
  },
});
```

同样的 20/100 输入使 `releaseGate` 成为 `data-unavailable`，宿主不调用 `calculate`。页面显示 20、100、partial 和原因，但不给出通过或失败的数值。

## 分清数据问题

| 输入状态 | 页面文本 |
|---|---|
| `unavailable` | 写明未采集或不适用。 |
| `migration-required` | 写明需要 `niceeval migrate`。 |
| `migration-unavailable` | 写明没有无损 converter，Attachment 不能迁移到当前格式；不提示再次运行 `niceeval migrate`。 |
| `unsupported` | 写明当前 reader 不支持 `commands.checked`。 |
| `invalid` | 显示该 Attachment 的具名 issue。 |

这些状态只影响请求 `commands.checked` 的 Calculation 和页面。例如只使用 Verdict 的质量页保持可读。

## 相关阅读

- [Calculations](../calculations.md)：完整度 policy 的完整规则。
- [Architecture](../architecture.md#completeness-与局部隔离)：Attachment 状态的局部边界。
- [比较质量与成本](比较质量与成本.md)：不同 inputs 可以独立失效。
