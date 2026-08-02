// 配置身份的字段级投影:`configHash` 的哈希输入本身,加上「同一份输入怎样按字段路径比对」。
//
// 哈希只回答「等不等」,回答不了「哪里变了」。`--accept config:<字段路径>` 与 `--dry` 的逐条
// 作废原因都要后一个答案,而两侧必须来自同一份字段集合——configHash 里有的字段,这里就能按
// 点路径指名;这里指不出来的路径,`--accept` 也就没有对应的差异可授权。
//
// 历史侧的同名投影从落盘重建(`ExperimentRunInfo` + 结果顶层的 agent/model),这正是
// 「进 configHash 的字段必须落进 run.json」那条规则存在的理由。

import type { LinkedRunPlan } from "../sandbox/plan.ts";
import { sandboxLayerIdentityFor } from "../sandbox/link.ts";
import type { AgentIdentity, AgentInstaller } from "../agents/types.ts";
import type { EvalResult, JsonValue, JudgeConfig } from "../types.ts";
import type { AgentRun } from "./types.ts";

/**
 * 一次运行的**配置身份**:`computeConfigHash` 的哈希输入,字段集合与
 * docs/feature/experiments/cache.md「指纹:两个哈希嵌套」逐字对应。
 *
 * 键恒存在(值可以是 `undefined`):稳定序列化把键本身也算进字节,少一个键就是另一个哈希。
 * 新增公开配置字段时只在这里裁决一次「进不进 configHash」。
 */
export interface ConfigIdentity {
  readonly agent: string;
  readonly model: DeclaredConfigValue<string>;
  readonly reasoningEffort: DeclaredConfigValue<string>;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>>;
  readonly sandboxReuse: boolean;
  /** Experiment 作者 layer 身份；物理 provider plan 属于逐 Eval fingerprint，不进入 Run 级身份。 */
  readonly sandboxLayer: JsonValue;
  readonly strict: boolean;
  readonly judge: JudgeConfigIdentity;
  /** 声明顺序、精确 installer 配对、安装模式与计划目标平台的完整静态身份。 */
  readonly agentInstalls: readonly JsonValue[];
}

export type DeclaredConfigValue<Value> =
  | { readonly _tag: "Omitted" }
  | { readonly _tag: "Configured"; readonly value: Value };

export type JudgeConfigIdentity =
  | { readonly _tag: "Unconfigured" }
  | {
      readonly _tag: "Configured";
      readonly model: DeclaredConfigValue<string>;
      readonly baseUrl: DeclaredConfigValue<string>;
      readonly timeoutMs: DeclaredConfigValue<number>;
    };

/** manifest 相减得出的一条具名差异;`selector` 原样可复制进 `--accept`。 */
export type ConfigFieldDelta =
  | {
      readonly _tag: "Added";
      readonly selector: string;
      readonly from?: never;
      readonly to: string;
    }
  | {
      readonly _tag: "Removed";
      readonly selector: string;
      readonly from: string;
      readonly to?: never;
    }
  | {
      readonly _tag: "Changed";
      readonly selector: string;
      readonly from: string;
      readonly to: string;
    };

export function addedConfigField(selector: string, to: string): ConfigFieldDelta {
  return Object.freeze({ _tag: "Added", selector, to });
}

export function removedConfigField(selector: string, from: string): ConfigFieldDelta {
  return Object.freeze({ _tag: "Removed", selector, from });
}

export function changedConfigField(selector: string, from: string, to: string): ConfigFieldDelta {
  return Object.freeze({ _tag: "Changed", selector, from, to });
}

function freezeJson<Value extends JsonValue>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeJson(entry))) as Value;
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
  )) as Value;
}

function freezeConfigIdentity(identity: ConfigIdentity): ConfigIdentity {
  return Object.freeze({
    ...identity,
    model: Object.freeze(identity.model),
    reasoningEffort: Object.freeze(identity.reasoningEffort),
    flags: freezeJson({ ...identity.flags }),
    sandboxLayer: freezeJson(identity.sandboxLayer),
    judge: identity.judge._tag === "Unconfigured"
      ? Object.freeze({ _tag: "Unconfigured" as const })
      : Object.freeze({
          _tag: "Configured" as const,
          model: Object.freeze(identity.judge.model),
          baseUrl: Object.freeze(identity.judge.baseUrl),
          timeoutMs: Object.freeze(identity.judge.timeoutMs),
        }),
    agentInstalls: Object.freeze(identity.agentInstalls.map((entry) => freezeJson(entry))),
  });
}

function sameAgentIdentity(left: AgentIdentity, right: AgentIdentity): boolean {
  return left.agent === right.agent && left.version === right.version && left.revision === right.revision;
}

function installerIdentity(installer: AgentInstaller | undefined): JsonValue {
  if (installer === undefined) return { _tag: "Missing" };
  return {
    _tag: "Matched",
    identity: {
      agent: installer.identity.agent,
      version: installer.identity.version,
      revision: installer.identity.revision,
    },
    installMode: installer.installMode,
    platforms: installer.platforms === undefined
      ? { _tag: "All" }
      : { _tag: "Listed", values: [...installer.platforms] },
  };
}

/** 计划期一次性冻结全部 ensure/installer 配对；运行事实与 staged digest 不反写配置身份。 */
export function agentInstallPlansForRun(run: AgentRun): readonly JsonValue[] {
  const agent = run.agent;
  if (agent.kind === "direct") return Object.freeze([]);
  return Object.freeze(agent.ensure.map((ensure, index) => freezeJson({
    order: index,
    ensure: {
      agent: ensure.identity.agent,
      version: ensure.identity.version,
      revision: ensure.identity.revision,
    },
    installer: installerIdentity(
      agent.installers.find((candidate) => sameAgentIdentity(candidate.identity, ensure.identity)),
    ),
  })));
}

function declaredString(value: string | undefined): DeclaredConfigValue<string> {
  return value === undefined ? { _tag: "Omitted" } : { _tag: "Configured", value };
}

function judgeIdentity(judge: JudgeConfig | undefined): JudgeConfigIdentity {
  return judge === undefined
    ? { _tag: "Unconfigured" }
    : {
        _tag: "Configured",
        model: declaredString(judge.model),
        baseUrl: declaredString(judge.baseUrl),
        timeoutMs: judge.timeoutMs === undefined ? { _tag: "Omitted" } : { _tag: "Configured", value: judge.timeoutMs },
      };
}
/** 本次解析后配置的身份投影。 */
export function configIdentityForRun(
  run: AgentRun,
  plan: LinkedRunPlan,
  judge: JudgeConfig | undefined = run.judge,
): ConfigIdentity {
  return freezeConfigIdentity({
    agent: run.agent.name,
    model: declaredString(run.model),
    reasoningEffort: declaredString(run.reasoningEffort),
    flags: run.flags,
    sandboxReuse: run.sandboxReuse ?? false,
    sandboxLayer: sandboxLayerIdentityFor(plan.pair, "experiment"),
    strict: run.strict ?? false,
    judge: judgeIdentity(judge),
    agentInstalls: agentInstallPlansForRun(run),
  });
}

/**
 * 历史条目的同一份投影,从落盘重建。缺 `ExperimentRunInfo`(第三方 harness 写的结果)时
 * 配置面无从重算,返回 `undefined`——差异算不出就如实算不出,不猜。
 */
export function configIdentityFromResult(result: EvalResult): ConfigIdentity | undefined {
  const exp = result.experiment;
  if (exp === undefined) return undefined;
  return freezeConfigIdentity({
    agent: result.agent,
    model: declaredString(result.model),
    reasoningEffort: declaredString(exp.reasoningEffort),
    flags: exp.flags ?? {},
    sandboxReuse: exp.sandboxReuse ?? false,
    sandboxLayer: exp.sandboxLayer,
    strict: exp.strict ?? false,
    judge: judgeIdentity(exp.judge),
    agentInstalls: exp.agentInstalls,
  });
}

/**
 * 身份 → 字段路径表。可省略配置先归一为完整 ADT，再由 `_tag` 决定是否产生字段路径。
 */
function flatten(identity: ConfigIdentity): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>();
  const put = (path: string, value: JsonValue): void => { out.set(path, value); };
  const putDeclared = <Value extends JsonValue>(path: string, value: DeclaredConfigValue<Value>): void => {
    if (value._tag === "Configured") put(path, value.value);
  };
  put("agent", identity.agent);
  putDeclared("model", identity.model);
  putDeclared("reasoningEffort", identity.reasoningEffort);
  put("sandboxReuse", identity.sandboxReuse);
  put("strict", identity.strict);
  for (const [key, value] of Object.entries(identity.flags)) put(`flags.${key}`, value);
  put("sandboxLayer", identity.sandboxLayer);
  if (identity.judge._tag === "Configured") {
    putDeclared("judge.model", identity.judge.model);
    putDeclared("judge.baseUrl", identity.judge.baseUrl);
    putDeclared("judge.timeoutMs", identity.judge.timeoutMs);
  }
  put("agentInstalls", [...identity.agentInstalls]);
  return out;
}

/**
 * 身份的字段路径投影,供 manifest 的配置面落盘(见 `runner/manifest.ts`)。与差异比对读的是
 * 同一个 `flatten`:清单里指得出的路径,`--accept config:<路径>` 就授权得了,两侧不可能分叉。
 */
export function configIdentityPaths(identity: ConfigIdentity): Array<[string, JsonValue]> {
  return [...flatten(identity)];
}

/** 有界值摘要:差异明细与 `carriedAccepting` 留痕共用,单条不铺满一行终端。 */
function summarize(value: JsonValue): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * 历史侧与本次侧的字段级差异,按 selector 字典序。键的增删同样是一条差异。
 */
export function configDeltas(historical: ConfigIdentity, current: ConfigIdentity): ConfigFieldDelta[] {
  const from = flatten(historical);
  const to = flatten(current);
  const paths = [...new Set([...from.keys(), ...to.keys()])].sort();
  const out: ConfigFieldDelta[] = [];
  for (const path of paths) {
    const hasFrom = from.has(path);
    const hasTo = to.has(path);
    if (hasFrom && hasTo && JSON.stringify(from.get(path)) === JSON.stringify(to.get(path))) continue;
    const fromValue = from.get(path);
    const toValue = to.get(path);
    if (hasFrom && fromValue === undefined) throw new Error(`Missing historical config value for ${path}.`);
    if (hasTo && toValue === undefined) throw new Error(`Missing current config value for ${path}.`);
    const selector = `config:${path}`;
    if (!hasFrom) out.push(addedConfigField(selector, summarize(toValue!)));
    else if (!hasTo) out.push(removedConfigField(selector, summarize(fromValue!)));
    else out.push(changedConfigField(selector, summarize(fromValue!), summarize(toValue!)));
  }
  return out;
}

/**
 * 反事实身份:把本次身份里**被授权的那些字段**换回历史值,其余原样。
 *
 * 换出来的身份再算一次指纹,与历史条目落盘的那个相等,才证明「两侧只差这些被授权的字段」——
 * 授权因此不是绕开判据,而是把判据挪到一个明确写下来的口径上重算一次。
 *
 * `sandbox` / `judge` 是整对象进哈希的分组:键在不在本身改变字节,逐字段拼回去会造出两侧都
 * 不存在的形状。分组内**每一条**差异都被授权才整体换回历史对象,否则保持本次值——那样指纹
 * 自然对不上,条目照常重跑,不会静默跨过没被授权的那半。
 */
export function counterfactualConfigIdentity(
  current: ConfigIdentity,
  historical: ConfigIdentity,
  accepted: ReadonlySet<string>,
): ConfigIdentity {
  const differing = new Set(configDeltas(historical, current).map((d) => d.selector));
  const flags: globalThis.Record<string, JsonValue> = { ...current.flags };
  for (const selector of accepted) {
    if (!selector.startsWith("config:flags.")) continue;
    const key = selector.slice("config:flags.".length);
    if (Object.hasOwn(historical.flags, key)) {
      const value = historical.flags[key];
      if (value === undefined) throw new Error(`Missing historical flag value for ${key}.`);
      flags[key] = value;
    } else delete flags[key];
  }
  let sandboxLayer = current.sandboxLayer;
  let judge = current.judge;
  let agentInstalls = current.agentInstalls;
  const rollbackGroups: readonly ("sandboxLayer" | "judge" | "agentInstalls")[] = [
    "sandboxLayer", "judge", "agentInstalls",
  ];
  for (const group of rollbackGroups) {
    const paths = [...differing].filter((selector) =>
      selector === `config:${group}` || selector.startsWith(`config:${group}.`)
    );
    if (paths.length === 0 || !paths.every((selector) => accepted.has(selector))) continue;
    if (group === "sandboxLayer") sandboxLayer = historical.sandboxLayer;
    else if (group === "judge") judge = historical.judge;
    else agentInstalls = historical.agentInstalls;
  }
  return freezeConfigIdentity({
    agent: accepted.has("config:agent") ? historical.agent : current.agent,
    model: accepted.has("config:model") ? historical.model : current.model,
    reasoningEffort: accepted.has("config:reasoningEffort")
      ? historical.reasoningEffort
      : current.reasoningEffort,
    flags,
    sandboxReuse: accepted.has("config:sandboxReuse") ? historical.sandboxReuse : current.sandboxReuse,
    sandboxLayer,
    strict: accepted.has("config:strict") ? historical.strict : current.strict,
    judge,
    agentInstalls,
  });
}
