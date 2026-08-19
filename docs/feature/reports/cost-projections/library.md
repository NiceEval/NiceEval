# Report 成本投影 —— Library

## `definePricingProfile`

价格配置是 Report 作者在模块里声明的不可变值。它不是项目配置、运行参数或 Record payload。唯一的作者入口与完整输入形状如下：

```ts
type UtcMillis = number;

interface PricingDisplayInput {
  readonly decimalPlaces: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly rounding: "half-away-from-zero";
}

interface PricingProvenanceInput {
  readonly kind: "declared-rate-card";
  readonly source: string;
  readonly asOf: UtcMillis;
}

interface PricingSelectorInput {
  readonly provider?: string;
  readonly model: string;
  readonly agentId?: string;
  readonly reasoningEffort?: string | null;
  readonly executionIdentityDigest?: string;
}

interface PricingEffectiveConditionInput {
  readonly startsAt: UtcMillis;
  readonly endsAt: UtcMillis | null;
}

type PricingChargeInput =
  | {
      readonly kind: "token";
      readonly bucket: "input" | "output" | "cache-read" | "cache-write";
      readonly perMillionTokens: CanonicalDecimal;
    }
  | {
      readonly kind: "request";
      readonly requestKind: "model" | "tool";
      readonly ratePerRequest: CanonicalDecimal;
    };

type PricingCoverageInput =
  | {
      readonly coverageId: string;
      readonly state: "priced";
      readonly selector: PricingSelectorInput;
      readonly effective: PricingEffectiveConditionInput;
      readonly charges: readonly [PricingChargeInput, ...PricingChargeInput[]];
    }
  | {
      readonly coverageId: string;
      readonly state: "unpriced";
      readonly selector: PricingSelectorInput;
      readonly effective: PricingEffectiveConditionInput;
    };

interface PricingProfileInput {
  readonly currency: "USD";
  readonly display: PricingDisplayInput;
  readonly provenance: PricingProvenanceInput;
  readonly coverage: readonly PricingCoverageInput[];
}

type PricingDisplay = Readonly<PricingDisplayInput>;
type PricingProvenance = Readonly<PricingProvenanceInput>;
type PricingSelector = Readonly<PricingSelectorInput>;
type PricingEffectiveCondition = Readonly<PricingEffectiveConditionInput>;
type PricingCharge = Readonly<PricingChargeInput>;

type PricingCoverage =
  | {
      readonly coverageId: string;
      readonly state: "priced";
      readonly selector: PricingSelector;
      readonly effective: PricingEffectiveCondition;
      readonly charges: readonly [PricingCharge, ...PricingCharge[]];
    }
  | {
      readonly coverageId: string;
      readonly state: "unpriced";
      readonly selector: PricingSelector;
      readonly effective: PricingEffectiveCondition;
    };

interface PricingProfile {
  readonly contentIdentity: string;
  readonly currency: "USD";
  readonly display: PricingDisplay;
  readonly provenance: PricingProvenance;
  readonly coverage: readonly PricingCoverage[];
}

declare function definePricingProfile(input: PricingProfileInput): PricingProfile;
declare const builtInPricingProfile: PricingProfile;
```

`currency` 固定为 `"USD"`。价格配置不做货币换算，也不收另一种货币的费率。Token bucket 只有四个 durable hyphen literal；
`reasoning` 与 `other` 不是可报价 bucket。`display.decimalPlaces` 是 0 至 9 的整数，`rounding` 固定为
`"half-away-from-zero"`。`UtcMillis` 是安全的毫秒 epoch number；`asOf`、`effective.startsAt` 与 `effective.endsAt` 不使用 ISO
字符串。

每个 selector 必须以 execution `model` 为基础；`model` 缺失时不会匹配。作者声明的 rate card 通常同时固定 `provider`。
NiceEval 的 `builtInPricingProfile` 省略 provider，表示一个明确的 provider-neutral model quote，而不是从 agent 名推断计费商。可选的
`executionIdentityDigest`、`agentId` 与 `reasoningEffort` 只会进一步收窄同一组持久化 origin 事实，不能替代 model，也不能读取今天的
Experiment 或配置。

`effective` 唯一以 origin Run 的 started-at 作为时间基准：半开区间 `[startsAt, endsAt)`，`endsAt: null` 表示没有上界。

`defineReport()` 未收到 `pricing` 时自动保留 `builtInPricingProfile`。目录包含随当前 NiceEval 包发布的全部模型条目，只做 exact model
匹配；未知 model、未发布 token bucket 与 tool request 都不会 fallback。作者仍可用 `definePricingProfile()` 声明私有网关、折扣或
其它明确 rate card，并通过 `pricing` 整体替换默认目录。

对一个 slot-provider，所有 selector 与 effective 条件合取后必须恰好命中一条 coverage。零条或多条命中都不是自动挑选费率的机会。
`coverageId` 在 Profile 内唯一；`priced` coverage 必有非空 `charges`，`unpriced` coverage 是明确的未定价状态，其投影原因只能是
`pricing-coverage-unpriced`。

Profile 规范化 coverage、selector、charge 与 provenance 后形成 `contentIdentity`。同一 `kind` 和 bucket，或同一 `kind` 和
`requestKind`，在一条 coverage 中不能重复。所有费率都以 canonical decimal 表示；`perMillionTokens` 以一百万 token 为单位，
`ratePerRequest` 以一个 request 为单位。Profile 的跨包 descriptor 是不可枚举的
`Symbol.for("niceeval.report.pricing-profile/v1")` 内部识别机制；它不是作者可读、可写或可声明的字段。

## 闭合成本投影

成本投影保存 slot-provider ledger，而不以一个 observed 或 estimated 汇总字段掩盖上游事实。`provider-cost` 是 sealed Usage 中
`costUSD` 的 provider/adapter observed 事实。某个 slot-provider 只要有任一 `provider-cost`，这个坐标就锁定 observed 路径，
不得再用 token 或 request 费率估算。

```ts
type CostCoverageReasonCode =
  | "member-not-recorded"
  | "core-invalid"
  | "origin-run-unavailable"
  | "execution-model-not-recorded"
  | "usage-not-recorded"
  | "usage-unavailable"
  | "usage-unsupported"
  | "usage-invalid"
  | "usage-collection-partial"
  | "pricing-coverage-not-found"
  | "pricing-coverage-unpriced"
  | "pricing-charge-not-found"
  | "observed-cost-other-currency";

interface CostCoverageReason {
  readonly slot: AnalysisSlotRef;
  readonly provider: SafeIdentifier | null;
  readonly code: CostCoverageReasonCode;
}

interface ProjectedMoney {
  readonly amount: CanonicalDecimal;
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
}

interface ObservedCostComponent {
  readonly kind: "provider-cost";
  readonly provider: SafeIdentifier;
  readonly currency: string;
  readonly amount: CanonicalDecimal;
}

interface EstimatedTokenCostComponent {
  readonly kind: "token";
  readonly provider: SafeIdentifier;
  readonly bucket: "input" | "output" | "cache-read" | "cache-write";
  readonly tokens: number;
  readonly ratePerMillionTokens: CanonicalDecimal;
  readonly amount: CanonicalDecimal;
}

interface EstimatedRequestCostComponent {
  readonly kind: "request";
  readonly provider: SafeIdentifier;
  readonly requestKind: "model" | "tool";
  readonly ratePerRequest: CanonicalDecimal;
  readonly amount: CanonicalDecimal;
}

type CostLedgerEntry =
  | {
      readonly slot: AnalysisSlotRef;
      readonly provider: SafeIdentifier | null;
      readonly branch: "observed";
      readonly components: readonly [ObservedCostComponent, ...ObservedCostComponent[]];
      readonly estimated: null;
    }
  | {
      readonly slot: AnalysisSlotRef;
      readonly provider: SafeIdentifier;
      readonly branch: "estimated";
      readonly components: readonly (EstimatedTokenCostComponent | EstimatedRequestCostComponent)[];
      readonly estimated: ProjectedMoney;
    }
  | {
      readonly slot: AnalysisSlotRef;
      readonly provider: SafeIdentifier | null;
      readonly branch: "unavailable";
      readonly components: readonly [];
      readonly estimated: null;
    };

type CostProjectionAggregate =
  | {
      readonly kind: "mean";
      readonly numerator: CanonicalDecimal;
      readonly denominator: number;
    }
  | {
      readonly kind: "total";
      readonly total: CanonicalDecimal;
    };

interface CostProjectionProfile {
  readonly contentIdentity: string;
  readonly currency: CurrencyCode;
  readonly display: PricingDisplay;
  readonly provenance: PricingProvenance;
  readonly coverage: readonly PricingCoverage[];
}

interface CostProjectionKnown {
  readonly state: "available" | "partial";
  readonly basis: "observed" | "estimated" | "mixed";
  readonly profile: CostProjectionProfile;
  readonly aggregate: CostProjectionAggregate;
  readonly observed: ProjectedMoney | null;
  readonly estimated: ProjectedMoney | null;
  readonly combined: ProjectedMoney;
  readonly observedOtherCurrencies: readonly {
    readonly provider: SafeIdentifier;
    readonly currency: string;
    readonly amount: CanonicalDecimal;
  }[];
  readonly reasons: readonly CostCoverageReason[];
  readonly ledger: readonly CostLedgerEntry[];
}

interface CostProjectionUnavailable {
  readonly state: "unavailable";
  readonly basis: "unavailable";
  readonly profile: CostProjectionProfile;
  readonly aggregate: CostProjectionAggregate;
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
  readonly observedOtherCurrencies: readonly {
    readonly provider: SafeIdentifier;
    readonly currency: string;
    readonly amount: CanonicalDecimal;
  }[];
  readonly reasons: readonly CostCoverageReason[];
  readonly ledger: readonly CostLedgerEntry[];
}

interface CostProjectionMigrationRequired {
  readonly state: "migration-required";
  readonly basis: "unavailable";
  readonly profile: CostProjectionProfile;
  readonly aggregate: CostProjectionAggregate;
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
  readonly observedOtherCurrencies: readonly ObservedOtherCurrency[];
  readonly reasons: readonly CostCoverageReason[];
  readonly ledger: readonly CostLedgerEntry[];
}

type CostProjectionValue =
  | CostProjectionKnown
  | CostProjectionMigrationRequired
  | CostProjectionUnavailable;

interface CostMetricValue extends MetricValue<number> {
  readonly state: CostProjectionState;
  readonly format: "currency-usd";
  readonly better: "lower";
  readonly projection: CostProjectionValue;
}

declare function costUSD(profile: PricingProfile): CostMeasure;
declare function totalCostUSD(profile: PricingProfile): CostMeasure;
```

`aggregate(ctx.scope, { values: { cost: costUSD(profile) } })` 返回的 `cost` cell 是作者可观察的 `CostMetricValue`。
它的 `cell.projection` 是 `CostProjectionValue`。

两者与 `CostProjectionState`、`CostProjectionMigrationRequired`、`CostBasis`、ledger、reason 和 component data types 都是 `niceeval/report` 的 type-only exports。
具体字段以上面的 Library 形状为准。

Analysis 从 sealed Usage 和 Profile 构造每个 slot-provider `ledger` entry。`branch` 只能是 `observed`、`estimated` 或
`unavailable`；没有可辨识 provider 时 entry 的 `provider` 是 `null`。所有数组按 slot、provider 和 reason code 的 canonical
order 输出。reason 不携带自由文本、费率或第二份输入，词表外的值不能进入闭合投影。

某个 slot-provider 有任一 `provider-cost` 时，该 entry 锁定为 `observed`，不得再用 token 或 request charge 估算。
Analysis 在 `aggregate` 保留 exact total；mean 以 `numerator / denominator` 的 rational 形式保留，之后才按 Profile display 做
half-away-from-zero 格式化。它不经过 binary floating-point，也不把 unavailable slot 当作零。

当所有选中 slot 都因 Observability v1 而无法读取 Usage，顶层 projection 与 metric state 都是
`migration-required`，Report 显示 `niceeval migrate` 恢复动作；不能只把原因藏在 `reasons`。v1/current 混合且
仍有已知金额时保持 `partial`，coverage 只计入实际贡献的 slot。

`profile.provenance` 原样进入 `CostProjectionProfile.provenance`，其形状始终是 `{ kind: "declared-rate-card", source, asOf }`。
显示层不能重算 ledger、total 或 mean。

`available` 表示所有应解释的 slot-provider 坐标都有 USD 的 observed 或 estimated entry。`partial` 保留已知 aggregate 与
ledger 中的缺口。`unavailable` 表示没有可报告的 USD entry。合法的零成本仍是 observed 或 estimated 值，不是 unavailable。

## Report 绑定与跨包身份

Profile 只能放在 `ReportDefinition.pricing`。同一个值以只读 `ctx.report.pricing` 提供给组件；没有配置时该字段是
`builtInPricingProfile`。它不是
Config、Host 或运行期价格表的别名。`costUSD(profile)` 与 `totalCostUSD(profile)` 必须传入该 Report 已声明的同一 Profile；没有零参数
形式，也没有别名入口。Report Host 只重验 Profile、捕获 Report 闭包、闭合输入并呈现 Analysis 已签发的投影；它不计算费率、ledger、
total 或 mean。

`defineReport()` 的运行时 descriptor 使用 `Symbol.for("niceeval.report.definition/v2")`。`definePricingProfile()` 的 descriptor 使用
`Symbol.for("niceeval.report.pricing-profile/v1")`。Host 载入 Report 时重新验证两个 descriptor 的 kind、版本、内容与 relationship，
因此应用依赖图中的重复 NiceEval 安装不会靠 `instanceof`、对象地址或模块私有 symbol 假定同源。

## MemoryBench 的声明估算

MemoryBench 可以把一张已审计的 rate card 与 Report 放在同一模块 closure。`source` 和 `asOf` 是投影可核查的 provenance，不是运行时
请求，也不随着浏览报告而刷新。

```ts
import { definePricingProfile } from "niceeval/report";

export const memoryBenchPricing = definePricingProfile({
  currency: "USD",
  display: { decimalPlaces: 2, rounding: "half-away-from-zero" },
  provenance: {
    kind: "declared-rate-card",
    source: "https://platform.openai.com/pricing",
    asOf: 1785542400000,
  },
  coverage: [{
    coverageId: "openai-gpt-5-6-2026-08",
    state: "priced",
    selector: {
      provider: "openai",
      model: "gpt-5.6",
      agentId: "codex",
    },
    effective: { startsAt: 1785542400000, endsAt: null },
    charges: [
      { kind: "token", bucket: "input", perMillionTokens: "1.25" },
      { kind: "token", bucket: "output", perMillionTokens: "10" },
      { kind: "token", bucket: "cache-read", perMillionTokens: "0.125" },
      { kind: "token", bucket: "cache-write", perMillionTokens: "1.25" },
      { kind: "request", requestKind: "model", ratePerRequest: "0" },
    ],
  }],
});
```

示例的 URL 是可复查的 rate-card provenance，`asOf` 锁定审计时点。生产 Report 应把当时审计的 provenance URL 连同这一日期签入 Report module；它不会
把 provider 的账单、Runner estimate 或当前网页价格写进历史 Run。

MemoryBench 的 Codex sealed Usage 含 `requestKind: "model"` observation。因此 token-priced coverage 必须同时显式列出四个既定 token
charge（`input`、`output`、`cache-read`、`cache-write`）和 `{ kind: "request", requestKind: "model", ratePerRequest: "0" }`。零是
声明的免费价格，不是缺字段的推断；缺少该 request charge 时，严格 coverage 让对应 slot-provider 进入 `unavailable`，并保留
`pricing-charge-not-found`。
