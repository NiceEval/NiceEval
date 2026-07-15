// flag() / config():把 experiment 声明的变量当维度或轴(docs/feature/reports/library.md「维度与 flags」)。
// 变量来自配置,不来自命名 —— 报告不解析 experiment id 字符串抠变量。
// flag() 只读 `ExperimentDef.flags` 里显式声明的 KV;model / reasoningEffort / budget / runs
// 这类顶层运行配置不在 flags 里,用 config() 读快照的 ExperimentRunInfo 投影。

import type { ConfigRef, FlagRef } from "./types.ts";

/**
 * 把 experiment 声明的一个 flag 当分组维度(series / rows / columns / points 槽)或数值轴
 * (MetricLine 的 x 槽)。只读 `ExperimentDef.flags` 里显式声明的 KV;未声明的 experiment
 * 分组归 `(unset)`,作轴不画点并报告缺失。
 */
export function flag(
  name: string,
  opts?: {
    /** 组标签 / 轴标签;函数形态把声明值折成组名(如 `(v) => \`${v} agents\``)。 */
    label?: string | ((value: string | number | boolean) => string);
    unit?: string;
  },
): FlagRef {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("flag: name must be a non-empty string (the key declared in the experiment's flags).");
  }
  return { kind: "flag", name, label: opts?.label, unit: opts?.unit };
}

/**
 * 把一项顶层运行配置当分组维度或数值轴,与 {@link flag} 同一套用法。读快照的
 * `ExperimentRunInfo` 投影(可用键是那张接口的字段全集),外加桥接到快照顶层权威字段的
 * `model` / `agent` 两个键。未投影的值分组归 `(unset)`,作轴不画点并报告缺失。
 */
export function config(
  name: string,
  opts?: {
    /** 组标签 / 轴标签;函数形态把投影值折成组名(如 `(v) => \`effort ${v}\``)。 */
    label?: string | ((value: string | number | boolean) => string);
    unit?: string;
  },
): ConfigRef {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      "config: name must be a non-empty string (an ExperimentRunInfo field, or the bridged \"model\" / \"agent\" keys).",
    );
  }
  return { kind: "config", name, label: opts?.label, unit: opts?.unit };
}
