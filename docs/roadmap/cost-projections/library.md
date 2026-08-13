# 成本投影 —— Library

## `PricingProfile`

`PricingProfile` 是 `niceeval/report` 导出的纯值。
`definePricingProfile()` 规范化、验证并计算 content identity。
调用方不能自报 identity，也不能用文件路径、当前日期或网络响应代替内容。

```ts
declare const PricingProfileTypeId: unique symbol;
declare const PricingProfileContentIdentityTypeId: unique symbol;
declare const PricingCoverageIdTypeId: unique symbol;

type PricingProfileContentIdentity = string & {
  readonly [PricingProfileContentIdentityTypeId]: true;
};

type PricingCoverageId = string & {
  readonly [PricingCoverageIdTypeId]: true;
};

interface PricingProfile {
  readonly [PricingProfileTypeId]: typeof PricingProfileTypeId;
  readonly contentIdentity: PricingProfileContentIdentity;
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
  readonly coverage: readonly PricingCoverage[];
}

interface PricingProfileInput {
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
  readonly coverage: readonly PricingCoverageInput[];
}

type PricingCoverageInput =
  | PricedCoverageInput
  | UnpricedCoverageInput;

type PricingCoverage =
  | PricedCoverage
  | UnpricedCoverage;

interface PricingCoverageBase {
  readonly coverageId: PricingCoverageId;
  readonly subject: BillableSubject;
  readonly effective: PricingEffectiveCondition;
}

type BillableSubject = {
  readonly kind: "provider-model";
  readonly provider: SafeIdentifier;
  readonly model: SafeIdentifier;
};

interface PricingEffectiveCondition {
  readonly timeBasis: "origin-run-started-at";
  readonly startsAt: UtcMillis;
  readonly endsAt: UtcMillis | null;
}

interface PricedCoverageInput {
  readonly coverageId: string;
  readonly state: "priced";
  readonly subject: BillableSubject;
  readonly effective: PricingEffectiveCondition;
  readonly charges: readonly [PricingCharge, ...PricingCharge[]];
}

interface PricedCoverage extends PricingCoverageBase {
  readonly state: "priced";
  readonly charges: readonly [PricingCharge, ...PricingCharge[]];
}

interface UnpricedCoverageInput {
  readonly coverageId: string;
  readonly state: "unpriced";
  readonly subject: BillableSubject;
  readonly effective: PricingEffectiveCondition;
  readonly reason:
    | "provider-not-priced"
    | "billing-mode-not-priced"
    | "rate-not-published";
}

interface UnpricedCoverage extends PricingCoverageBase {
  readonly state: "unpriced";
  readonly reason: UnpricedCoverageInput["reason"];
}

type PricingCharge =
  | {
      readonly kind: "token";
      readonly bucket:
        | "input"
        | "output"
        | "cache-read"
        | "cache-write"
        | "reasoning"
        | "other";
      readonly tokensPerUnit: PositiveSafeInteger;
      readonly amount: CanonicalDecimal;
    }
  | {
      readonly kind: "request";
      readonly requestKind: "model" | "tool";
      readonly amount: CanonicalDecimal;
    };

type PricingProfileError =
  | {
      readonly code: "pricing-profile-invalid";
      readonly reason:
        | "decimal-places-invalid"
        | "coverage-id-invalid"
        | "coverage-overlap"
        | "effective-window-invalid"
        | "billable-subject-invalid"
        | "charge-duplicate"
        | "charge-invalid";
    };

declare const definePricingProfile: (
  input: PricingProfileInput,
) => Either.Either<PricingProfile, PricingProfileError>;
```

`decimalPlaces` 必须是 0 至 9 的整数。
所有金额先以 exact decimal 运算，最终展示才按 Profile 的小数位舍入。
`currency` 是 Profile 报价 currency，且使用 Usage 既有的三位大写 `CurrencyCode`。

`coverage` 是封闭集合。
每条 coverage 明确一个精确的 `BillableSubject`（provider + model）与一个以 origin Run `startedAt` 判断的半开有效区间。
同一 billable subject 和时点最多命中一项。
content identity 编码 subject；改变 provider 或 model 必定得到新的 identity。
未带精确 provider + model subject 的 Usage、或 subject 未匹配的 Usage，不适用任何价格条目，不是默认价格。

content identity 是按 canonical field order 编码 Profile 的 SHA-256。
它包含 currency、小数位、每个 billable subject、coverage、有效区间和每项 charge。
改变任何这些内容必定得到新的 identity。

## Cost Calculation

`calculateCostProjection()` 是纯函数。
作者在普通 `defineCalculation()` callback 中调用它，并声明 Attempt Usage projection。
函数不读取 Record、文件、进程变量集合或网络，也不接受价格 provider。

```ts
interface CostProjectionInput {
  readonly sample: AnalysisSample;
  readonly usage: ProjectedSample<"attempt-slot", UsageView>;
  readonly billingSubjects: ProjectedSample<
    "attempt-slot",
    BillingSubjectBindingsView
  >;
  readonly profile: PricingProfile;
}

interface BillingSubjectBindingV1 {
  readonly usageObservationId: UsageObservationIdV1;
  readonly subject: BillableSubject;
}

interface BillingSubjectBindingsView {
  readonly bindings: readonly BillingSubjectBindingV1[];
}

declare const billingSubjectBindingsProjector: RecordAttachmentProjector<
  "attempt",
  BillingSubjectBindingsView
>;

type CostProjectionState = "available" | "partial" | "unavailable";
type CostBasis = "observed" | "estimated" | "mixed" | "unavailable";

interface ProjectedMoney {
  readonly amount: CanonicalDecimal;
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
}

interface CostProjectionProfile {
  readonly contentIdentity: PricingProfileContentIdentity;
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
  readonly coverage: readonly PricingCoverage[];
}

interface CostProjectionCoverage {
  readonly coveredSlots: number;
  readonly denominator: number;
  readonly observedSlots: number;
  readonly estimatedSlots: number;
  readonly incompleteSlots: number;
  readonly reasons: readonly CostCoverageReason[];
}

type CostCoverageReason =
  | {
      readonly slotId: SlotId;
      readonly subject: BillableSubject | null;
      readonly code:
        | "usage-not-recorded"
        | "usage-core-invalid"
        | "usage-unavailable"
        | "usage-migration-required"
        | "usage-migration-unavailable"
        | "usage-unsupported"
        | "usage-invalid"
        | "usage-billable-subject-missing"
        | "profile-not-covered"
        | "profile-unpriced"
        | "observed-cost-other-currency";
    }
  | {
      readonly slotId: SlotId;
      readonly subject: BillableSubject | null;
      readonly code: "usage-collection-partial";
      readonly limitations: readonly ObservabilityLimitationV1[];
    };

interface CostProjectionKnown {
  readonly state: "available" | "partial";
  readonly basis: Exclude<CostBasis, "unavailable">;
  readonly profile: CostProjectionProfile;
  readonly observed: ProjectedMoney | null;
  readonly estimated: ProjectedMoney | null;
  readonly combined: ProjectedMoney | null;
  readonly observedOtherCurrencies: readonly {
    readonly subject: BillableSubject | null;
    readonly currency: CurrencyCode;
    readonly amount: CanonicalDecimal;
  }[];
  readonly coverage: CostProjectionCoverage;
}

interface CostProjectionUnavailable {
  readonly state: "unavailable";
  readonly basis: "unavailable";
  readonly profile: CostProjectionProfile;
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
  readonly observedOtherCurrencies: readonly {
    readonly subject: BillableSubject | null;
    readonly currency: CurrencyCode;
    readonly amount: CanonicalDecimal;
  }[];
  readonly coverage: CostProjectionCoverage;
}

type CostProjectionValue =
  | CostProjectionKnown
  | CostProjectionUnavailable;

declare const calculateCostProjection: (
  input: CostProjectionInput,
) => CostProjectionValue;
```

`niceeval.billing-subjects/v1` 是新增的 Attempt-owned RecordAttachment。
Usage producer 在 observation identity 确定后写入 binding；`bindings` 按 `usageObservationId` 排序且不得重复。
每个 binding 必须引用同一 Attempt 的一项 Usage observation，且 subject 的 provider 必须等于 observation provider。

引用不存在的 observation、provider 不一致或重复 binding 都使 Attachment `invalid`，Report 不从 Experiment 源码、model 名字符串或当前工作树修补。

## 计算规则

同一 Slot 的同一精确 billable subject 有 `provider-cost` observation 时，该 subject 的成本分量是 observed。
没有能与同一 subject 对齐的 observed cost 时，observed cost 保持为独立事实，不授权 Profile 将它改写成 estimate。
`provider-cost` 即使缺少 binding 也仍是 observed 事实；它只是不授权任何 token/request rate。

同一 Slot 与 subject 的 token/request observation 不再由 Profile 估算，避免将同一账单重复计入。
没有 observed provider-cost 的分量，只有在 Usage 交付精确 provider + model subject 后才可以按匹配 coverage 估算。
tool/request 若没有同样精确的 billable subject，一律产生 `usage-billable-subject-missing` 或 `profile-unpriced`，绝不只按 `requestKind` 猜价格。
`requestKind` 只在 subject 已精确相等后选择 charge，不是 billable subject 的替代品。

Profile quote currency 与 observed cost currency 相同，才可以相加。
其它 currency 原样进入 `observedOtherCurrencies`，不做 FX，不并入 `combined`。
`basis` 只描述 quote currency 的已知分量：

- `observed`：只有 provider-observed amount；
- `estimated`：只有 Profile estimate；
- `mixed`：两种分量同时存在；
- `unavailable`：没有可报告的 quote currency amount。

`available` 要求所有 Sample Slot 有完整、同一 currency 的已知成本分量。
有 Usage 问题、缺少精确 billable subject、partial collection、没有适用 rate、unpriced entry 或其它 currency observed amount 时，结果为 `partial` 或 `unavailable`。
零金额是合法 observed 或 estimated amount；`null` 只表示该分量不存在。
每个结果都携带 Profile 的完整 content identity、currency、小数位与计价范围，供 Report JSON 和静态导出审计。

## Report 作者调用

```ts
import {
  attemptSlotProjection,
  billingSubjectBindingsProjector,
  calculateCostProjection,
  defineCalculation,
  definePricingProfile,
  reportInputs,
  usageProjector,
} from "niceeval/report";

const profile = Either.getOrThrow(definePricingProfile({
  currency: "USD",
  decimalPlaces: 2,
  coverage: [
    {
      coverageId: "openai-usd-2026",
      state: "priced",
      subject: { provider: "openai", model: "gpt-5.6" },
      effective: {
        timeBasis: "origin-run-started-at",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: null,
      },
      charges: [
        { kind: "token", bucket: "input", tokensPerUnit: 1_000_000, amount: "2.5" },
        { kind: "token", bucket: "output", tokensPerUnit: 1_000_000, amount: "10" },
      ],
    },
  ],
}));

const usage = attemptSlotProjection(usageProjector);
const billingSubjects = attemptSlotProjection(billingSubjectBindingsProjector);

const cost = defineCalculation({
  id: Either.getOrThrow(reportComponentId("cost")),
  inputs: reportInputs({ usage, billingSubjects }),
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) =>
    calculateCostProjection({
      sample,
      usage: inputs.usage,
      billingSubjects: inputs.billingSubjects,
      profile,
    }),
});
```

`PricingProfile` 是 Report module 的 source closure 一部分。
`ReportExecution`、`show --json` 和静态导出都携带 content identity 与结果 coverage。
它不会写入 Attempt、Run 或 Usage Attachment。

## 删除、迁移与生产入口验收

删除任何把 `estimated_cost`、价格表、FX 或跨币种总计写进 Usage 的 producer 路径。
producer 只在确有 provider 当时报告的金额时写 `provider-cost` observation。
没有 observed amount 时必须省略该 observation，不能写零。

`PricingProfile` 没有 Record schema。`niceeval.billing-subjects/v1` 是新增的 additive Attachment family。
它不修改或迁移 `niceeval.usage/v1`。
旧 Attempt 缺少该 Attachment 时，observed cost 仍可原样展示，任何估算分量则以
`usage-billable-subject-missing` 保持 partial 或 unavailable。
任何无法证明为 provider-observed 的旧金额不能被 Profile 取代或重新标记。

生产验收使用真实 Record 的 observed、estimated、mixed、partial 与 unavailable 切片。
同一 provider 的两个不同 model 切片必须只命中各自 subject 的 coverage，验证它们绝不串价；缺少 subject 的 tool/request 保持 unpriced。
同一 Report 通过 `show`、`view` 和 `view --out` 显示 identity、currency、coverage 与分量。
验收不新增 Eval Assertion。
