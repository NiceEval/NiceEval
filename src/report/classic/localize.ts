export type ClassicLocale = "en" | "zh-CN";

/** A literal string or a locale map accepted by the 0.12.1-style surface. */
export type LocalizedText = string | {
  readonly en: string;
  readonly "zh-CN": string;
};

const LOCALIZED_TEXT_KEYS = ["en", "zh-CN"] as const;

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value === "string") {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Reflect.ownKeys(value).length !== LOCALIZED_TEXT_KEYS.length) {
    return false;
  }
  return LOCALIZED_TEXT_KEYS.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
      || typeof descriptor.value !== "string"
    ) {
      return false;
    }
    return true;
  });
}

export function resolveLocalizedText(
  value: LocalizedText,
  locale: ClassicLocale,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isLocalizedText(value)) {
    throw new TypeError(
      'LocalizedText must be a string or a locale map with exactly "en" and "zh-CN" string values',
    );
  }
  return value[locale];
}

export function resolveClassicLocale(locale: ClassicLocale | undefined): ClassicLocale {
  return locale ?? "en";
}

/** Package-owned ExperimentTable display strings. Identity and status stay isomorphic. */
export const CLASSIC_TABLE_COPY = {
  entity: { en: "Experiment", "zh-CN": "实验" },
  model: { en: "Model", "zh-CN": "模型" },
  agent: { en: "Agent", "zh-CN": "Agent" },
  durationMs: { en: "Avg. time", "zh-CN": "平均耗时" },
  passRate: { en: "Pass rate", "zh-CN": "通过率" },
  totalScore: { en: "Total score", "zh-CN": "总分" },
  tokens: { en: "Tokens", "zh-CN": "Tokens" },
  costUSD: { en: "Cost", "zh-CN": "成本" },
  record: { en: "Record", "zh-CN": "记录" },
  recordCoverage: { en: "Record coverage", "zh-CN": "记录覆盖" },
  evals: { en: "evals", "zh-CN": "题目" },
  passed: { en: "passed", "zh-CN": "通过" },
  failed: { en: "failed", "zh-CN": "失败" },
  scored: { en: "scored", "zh-CN": "已计分" },
  errored: { en: "errored", "zh-CN": "出错" },
  skipped: { en: "skipped", "zh-CN": "跳过" },
  unavailable: { en: "unavailable", "zh-CN": "不可用" },
  fresh: { en: "fresh", "zh-CN": "新跑" },
  historical: { en: "historical", "zh-CN": "历史" },
} as const satisfies Record<string, LocalizedText>;

export type ClassicTableCopyKey = keyof typeof CLASSIC_TABLE_COPY;

export function classicTableCopy(
  locale: ClassicLocale,
  key: ClassicTableCopyKey,
): string {
  return resolveLocalizedText(CLASSIC_TABLE_COPY[key], locale);
}
