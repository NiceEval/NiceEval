// flag() / runConfig() / numericFlag() / numericRunConfig():把 experiment 声明的变量当
// 分组维度或数值轴(docs/feature/reports/library/measures.md「维度与数值轴」)。
// 变量来自配置,不来自命名 —— 报告不解析 experiment id 字符串抠变量。
// flag() 只读 `ExperimentDef.flags` 里显式声明的 KV;model / reasoningEffort / budget / runs
// 这类顶层运行配置不在 flags 里,用 runConfig() 读快照的 ExperimentRunInfo 投影。

import type { AttemptHandle } from "../../record/types.ts";
import type { JsonValue } from "../../shared/types.ts";
import type {
  DimensionOptions,
  DimensionRef,
  NumericAxis,
  NumericAxisOptions,
  NumericRunConfigAxisOptions,
  RunConfigKey,
} from "./types.ts";

/** experiment 声明的 flags(快照级投影优先;第三方落盘只拼在条目上时回退 result.experiment)。 */
export function flagValueOf(attempt: AttemptHandle, name: string): JsonValue | undefined {
  const info = attempt.run?.experiment ?? attempt.result.experiment;
  return info?.flags?.[name];
}

/** experiment 声明的报告归类标注 labels(同 flags 的读取回退链;值域 string | number)。 */
export function labelValueOf(attempt: AttemptHandle, name: string): string | number | undefined {
  const info = attempt.run?.experiment ?? attempt.result.experiment;
  return info?.labels?.[name];
}

/**
 * runConfig() 的取值:读快照的 `ExperimentRunInfo` 投影,外加桥接到快照顶层权威字段的
 * `model` / `agent` 两个键(与 "model" / "agent" 内置维度同一读法,不另造第二套口径)。
 * 未投影 → undefined。
 */
export function runConfigValueOf(attempt: AttemptHandle, name: RunConfigKey): JsonValue | undefined {
  if (name === "model") return attempt.result.model ?? attempt.run?.model;
  if (name === "agent") return attempt.result.agent || attempt.run?.agent;
  const info = attempt.run?.experiment ?? attempt.result.experiment;
  if (info === undefined) return undefined;
  switch (name) {
    case "description": return info.description;
    case "reasoningEffort": return info.reasoningEffort;
    case "flags": return info.flags;
    case "labels": return info.labels;
    case "attempts": return info.attempts;
    case "earlyExit": return info.earlyExit;
    case "timeoutMs": return info.timeoutMs;
    case "budget": return info.budget;
    case "maxConcurrency": return info.maxConcurrency;
    case "selectedEvalIds": return info.selectedEvalIds;
    case "evalFilterFingerprint": return info.evalFilterFingerprint;
    case "sandboxLayer": return info.sandboxLayer;
    case "sandboxPlansByEval": return info.sandboxPlansByEval;
    case "sandboxReuse": return info.sandboxReuse;
    case "strict": return info.strict;
    case "judge":
      return info.judge === undefined
        ? undefined
        : {
            ...(info.judge.model !== undefined ? { model: info.judge.model } : {}),
            ...(info.judge.baseUrl !== undefined ? { baseUrl: info.judge.baseUrl } : {}),
            ...(info.judge.timeoutMs !== undefined ? { timeoutMs: info.judge.timeoutMs } : {}),
          };
    case "agentInstalls": return info.agentInstalls;
  }
}

function assertName(name: unknown, fn: string, hint: string): asserts name is string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${fn}: name must be a non-empty string (${hint}).`);
  }
}

/**
 * 把 experiment 声明的一个 flag 当分组维度(rows / columns / points / series / by 槽)。
 * 分组显示键按稳定 JSON 规则生成(字符串直接显示,其它值用键递归排序后的 JSON),
 * 缺失值显示内置文案 `(missing)`;显示键冲突时计算报错并要求改用 CustomDimension。
 */
export function flag(name: string, options?: DimensionOptions): Extract<DimensionRef, { readonly kind: "flag" }> {
  assertName(name, "flag", "the key declared in the experiment's flags");
  return {
    kind: "flag",
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
  };
}

/**
 * 把 experiment 声明的一个报告标注(`ExperimentDef.labels` 的键)当分组维度,与 {@link flag}
 * 同一套用法。labels 是纯报告侧的归类坐标:不透传运行时、不参与可比性配置;报告不从
 * experiment id 字符串猜语义,归类只认声明(docs/feature/experiments/library.md「labels」)。
 */
export function label(name: string, options?: DimensionOptions): Extract<DimensionRef, { readonly kind: "label" }> {
  assertName(name, "label", "the key declared in the experiment's labels");
  return {
    kind: "label",
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
  };
}

/**
 * 把一项顶层运行配置当分组维度,与 {@link flag} 同一套用法。读快照的 `ExperimentRunInfo`
 * 投影;可用键由 RunConfigKey 在类型层穷尽(那张接口的字段全集,外加桥接到快照顶层权威
 * 字段的 `model` / `agent`),拼错键在编译期就被拒绝。
 */
export function runConfig(name: RunConfigKey, options?: DimensionOptions): Extract<DimensionRef, { readonly kind: "runConfig" }> {
  assertName(name, "runConfig", 'an ExperimentRunInfo field, or the bridged "model" / "agent" keys');
  return {
    kind: "runConfig",
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
  };
}

/**
 * MetricLine 的 x 轴:只接受落盘值为 number 的 flag。未声明或非数值的 attempt 返回 null
 * (折线不绘该点并报告缺失),不猜 `low < medium < high`。
 */
export function numericFlag(name: string, options?: NumericAxisOptions): NumericAxis {
  assertName(name, "numericFlag", "the key declared in the experiment's flags");
  return {
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
    of(attempt) {
      const value = flagValueOf(attempt, name);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
  };
}

/**
 * MetricLine 的 x 轴:只接受 number 值的 label。labels 由作者亲手声明,要数值轴就直接
 * 声明成 number,不设 map;字符串值返回 null(折线不绘该点并报告缺失)。
 */
export function numericLabel(name: string, options?: NumericAxisOptions): NumericAxis {
  assertName(name, "numericLabel", "the key declared in the experiment's labels");
  return {
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
    of(attempt) {
      const value = labelValueOf(attempt, name);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
  };
}

/**
 * 顶层运行配置作数值轴:数值配置直接返回该值;字符串配置必须显式给 `map`
 * (如 { low: 1, medium: 2, high: 3 })。未声明、未投影、非数值或未命中 map 的值返回 null。
 */
export function numericRunConfig(name: RunConfigKey, options?: NumericRunConfigAxisOptions): NumericAxis {
  assertName(name, "numericRunConfig", 'an ExperimentRunInfo field, or the bridged "model" / "agent" keys');
  const map = options?.map;
  return {
    name,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.unit !== undefined ? { unit: options.unit } : {}),
    of(attempt) {
      const value = runConfigValueOf(attempt, name);
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && map !== undefined) {
        const mapped = map[value];
        return typeof mapped === "number" && Number.isFinite(mapped) ? mapped : null;
      }
      return null;
    },
  };
}
