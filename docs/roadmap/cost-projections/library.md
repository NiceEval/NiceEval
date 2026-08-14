# 成本投影 —— Library

## `PricingProfile`

`PricingProfile` 是纯值。作者不能指定 content identity，也不能以路径、当前日期或网络响应充当 identity。

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
```

每项 coverage 使用 Core 已保存的 execution identity，而不是从当前 Experiment、配置或 provider 名称反推一个 model。这样 Profile 只能对已被持久事实精确区分的执行条件报价。

```ts
interface PricingSelector {
  readonly provider: SafeIdentifier;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

interface PricingEffectiveCondition {
  readonly timeBasis: "origin-run-started-at";
  readonly startsAt: UtcMillis;
  readonly endsAt: UtcMillis | null;
}

type PricingCoverageInput =
  | PricedCoverageInput
  | UnpricedCoverageInput;

type PricingCoverage =
  | PricedCoverage
  | UnpricedCoverage;

interface PricingCoverageBase {
  readonly coverageId: PricingCoverageId;
  readonly selector: PricingSelector;
  readonly effective: PricingEffectiveCondition;
}

interface PricedCoverageInput {
  readonly coverageId: string;
  readonly state: "priced";
  readonly selector: PricingSelector;
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
  readonly selector: PricingSelector;
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
```

`decimalPlaces` 是 0 至 9 的整数。金额以 exact decimal 运算，只有展示时按 Profile 的小数位舍入。coverage 的有效区间是半开区间；同一 selector 与时点最多命中一项。

canonical encoding 包含 currency、小数位、coverage ID、selector、时间条件、状态、reason 和每项 charge。任一内容变化都会产生新的 content identity。

## 闭合成本值

成本解释发生在 Analysis 关闭事实之后。Report 取得的值不含 reader、路径、Usage payload、Profile source object 或重新计算能力。

```ts
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

interface CostCoverageReason {
  readonly slot: AnalysisSlotRef;
  readonly provider: SafeIdentifier | null;
  readonly code:
    | "member-not-recorded"
    | "core-invalid"
    | "usage-not-recorded"
    | "usage-unavailable"
    | "usage-unsupported"
    | "usage-invalid"
    | "usage-collection-partial"
    | "provider-not-covered"
    | "profile-unpriced"
    | "observed-cost-other-currency";
}

interface CostProjectionKnown {
  readonly state: "available" | "partial";
  readonly basis: Exclude<CostBasis, "unavailable">;
  readonly profile: CostProjectionProfile;
  readonly observed: ProjectedMoney | null;
  readonly estimated: ProjectedMoney | null;
  readonly combined: ProjectedMoney | null;
  readonly observedOtherCurrencies: readonly {
    readonly provider: SafeIdentifier;
    readonly currency: CurrencyCode;
    readonly amount: CanonicalDecimal;
  }[];
  readonly reasons: readonly CostCoverageReason[];
}

interface CostProjectionUnavailable {
  readonly state: "unavailable";
  readonly basis: "unavailable";
  readonly profile: CostProjectionProfile;
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
  readonly observedOtherCurrencies: readonly {
    readonly provider: SafeIdentifier;
    readonly currency: CurrencyCode;
    readonly amount: CanonicalDecimal;
  }[];
  readonly reasons: readonly CostCoverageReason[];
}

type CostProjectionValue = CostProjectionKnown | CostProjectionUnavailable;
```

`CostProjectionValue` 是闭合的成本领域值，不含任何重新计算能力。成本组件直接读取它；中立组件只接收由 Analysis 形成的 rows、points 或 `MetricValue`。
显示组件不得只读取 `combined.amount`，也不得用 `null` 生成零值或删除 coverage reasons。

## 作者约束

Profile 由 Report module 声明。已发布的成本 Analysis input 接收这份已验证的 Profile，并由 `aggregate()` 或 `query()` 关闭结果。
renderer 只接收闭合结果。

Profile coverage 无法区分某个执行条件时，结果保留 reason。没有匹配 token／request charge 也保留 reason。
Usage 仅以不同 currency 报告 observed amount 时同样如此。作者不能用当前工作树、model 标签或额外载荷补齐这些条件。
