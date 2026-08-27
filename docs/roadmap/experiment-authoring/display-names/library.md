# Experiment 展示名称 —— Library

## 作者输入与规范化输出

`displayName` 与 `description` 是 `ExperimentPresentationInput` 的两个独立字段。
该 interface 由 `defineExperiment()` 输入和 `defineExperiments()` 的每个成员输入继承。
它不重述执行配置字段。

```ts
declare const ExperimentDisplayNameTypeId: unique symbol;

type ExperimentDisplayName = string & {
  readonly [ExperimentDisplayNameTypeId]: true;
};

interface ExperimentPresentationInput {
  readonly displayName?: string;
  readonly description?: string;
}

interface ResolvedExperimentPresentation {
  readonly experimentId: ExperimentId;
  readonly displayName: ExperimentDisplayName;
  readonly description?: string;
}

interface ExperimentOutputFieldsV1 {
  readonly experimentId: ExperimentId;
  readonly displayName: string;
}

type ExperimentPresentationError = {
  readonly code: "experiment-display-name-invalid";
  readonly reason:
    | "empty"
    | "leading-or-trailing-whitespace"
    | "control-character"
    | "too-long"
    | "invalid-unicode";
};

declare const experimentDisplayName: (
  input: string,
) => Result.Result<ExperimentDisplayName, ExperimentPresentationError>;
```

作者显式给出的 `displayName` 必须是单行 Unicode scalar text，长度为 1 至 160 UTF-8 bytes。
它不能有 leading 或 trailing whitespace、NUL、C0 或 C1 control。
`description` 保持自己的定义说明语义，不作为 `displayName` 的默认值。

discovery 为每个普通 Experiment 或 family member 规范化得到一个 `ResolvedExperimentPresentation`。
若输入省略 `displayName`，它以完整 `experimentId` 产生 branded 值。
`ExperimentOutputFieldsV1` 总是输出两个字符串字段。

## identity 隔离

`experimentId` 由路径和 family key 形成。
`displayName` 和 `description` 不进入以下任何值：

- Experiment ID、selector、Run Core 或 Member relation；
- input identity、config identity、Eligibility 或 `ExecutionReusePlan`；
- budget domain、并发限制、sharedState key、Sandbox pair 或 lifecycle；
- Record source identity 中这个 presentation 字段自身的编码。

执行字段若明确读取了同一个 JavaScript 常量，其求值结果仍按原有配置 identity 规则处理。
上述隔离只排除 `displayName` 与 `description` 字段本身，不能隐藏真实执行条件。

重复展示名称合法。
数组、JSON、列表和 group 的规范顺序始终按 `experimentId`，不按展示文本或 description 排序。
展示名称不提供唯一性依据，也不能转换为 selector。

## Run 快照与交接边界

新 Run 写入自己的 presentation Attachment。
它只保存规范化后的展示值和对 Core identity 的交叉校验，不拥有 identity 或 description。

```ts
interface ExperimentPresentationAttachmentV1 {
  readonly experimentId: ExperimentId;
  readonly displayName: ExperimentDisplayName;
}
```

`niceeval.experiment-presentation/v1` 是 Run-owned RecordAttachment。
writer 验证 Attachment 的 `experimentId` 与同一 Run Core 完全相等。
它不参与 Analysis denominator、source barrier 或 reuse。

`InvocationReceipt` 不指向 Experiment；它是 Run publication 的终态交接值。
它只保留既定的 `invocationId`、canonical published `runIds`、`startedAt`、必填 `completedAt` 与 `completion`。

因此 terminal JSON receipt 缺少 Experiment presentation 不是例外或缺字段：它的 `runIds` 是唯一身份集合，不复制 Attempt、Verdict、Usage、cost、Inspection 摘要或展示名称。
需要名称映射的机器表面是 exp plan/progress/result 与 Run-owned Attachment；query 与 View 则从所选 Run 的快照产生 summary。

## 旧 Run、迁移与生产入口验收

缺少 `niceeval.experiment-presentation/v1` 的 Run 使用完整 `experimentId` 作为展示名称。
它不读取当前 Experiment 源码，也不把 description 写回历史 Run。
新 Attachment 不要求 Record Core major migration。

删除把展示名称写入 Invocation receipt、identity、selector 或 reuse 输入的路径。
receipt consumer 继续按既定 receipt 契约消费 canonical published `runIds`；其它机器表面按各自 schema version 分流，不按字段存在性猜版本。

生产验收包含显式名称、缺失名称、重复名称、family member、历史 Run fallback 和 displayName-only 改动后的 carried Run。
验收使用公开 CLI/E2E 旅程，不新增 Eval Assertion。
