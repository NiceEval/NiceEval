// 配置身份的字段级投影:`configHash` 的哈希输入本身,加上「同一份输入怎样按字段路径比对」。
//
// 哈希只回答「等不等」,回答不了「哪里变了」。`--accept config:<字段路径>` 与 `--dry` 的逐条
// 作废原因都要后一个答案,而两侧必须来自同一份字段集合——configHash 里有的字段,这里就能按
// 点路径指名;这里指不出来的路径,`--accept` 也就没有对应的差异可授权。
//
// 历史侧的同名投影从落盘重建(`ExperimentRunInfo` + 结果顶层的 agent/model),这正是
// 「进 configHash 的字段必须落进 run.json」那条规则存在的理由。

import { sandboxRunInfo } from "../sandbox/resolve.ts";
import { isSandboxLayer } from "../sandbox/layer.ts";
import { agentInstallIdentityInput } from "../agents/provisioner.ts";
import type { EvalResult, JsonValue, JudgeConfig, SandboxOption } from "../types.ts";
import type { AgentRun, SandboxRunInfo } from "./types.ts";

/**
 * 一次运行的**配置身份**:`computeConfigHash` 的哈希输入,字段集合与
 * docs/feature/experiments/cache.md「指纹:两个哈希嵌套」逐字对应。
 *
 * 键恒存在(值可以是 `undefined`):稳定序列化把键本身也算进字节,少一个键就是另一个哈希。
 * 新增公开配置字段时只在这里裁决一次「进不进 configHash」。
 */
export interface ConfigIdentity {
  agent: string;
  model?: string;
  reasoningEffort?: string;
  flags: globalThis.Record<string, JsonValue>;
  sandboxReuse: boolean;
  sandbox?: SandboxRunInfo;
  sandboxLayer?: JsonValue;
  strict: boolean;
  judge?: { model?: string; baseUrl?: string; timeoutMs?: number };
  /** Agent Ensure 安装身份;与 CaseKey 正交。 */
  agentInstall?: {
    agent: string;
    version: string;
    revision: string;
    artifactDigest?: string;
    artifactPlatform?: string;
  };
}

/** manifest 相减得出的一条具名差异;`selector` 原样可复制进 `--accept`。 */
export interface ConfigFieldDelta {
  /** `config:<字段路径>`,如 `config:judge.model`、`config:flags.webSearch`。 */
  selector: string;
  /** 历史侧的值摘要;该侧没有这个键时省略(键是本次新增的)。 */
  from?: string;
  /** 本次侧的值摘要;该侧没有这个键时省略(键被本次删掉了)。 */
  to?: string;
}

function agentInstallOf(run: AgentRun): ConfigIdentity["agentInstall"] {
  if (run.agent.kind !== "sandbox") return undefined;
  for (const ensure of run.agent.ensure) return agentInstallIdentityInput(ensure.identity);
  return undefined;
}

/** 本次解析后配置的身份投影。 */
export function configIdentityForRun(
  run: AgentRun,
  sandboxSpec?: SandboxOption,
  judge: JudgeConfig | undefined = run.judge,
  sandboxLayer?: JsonValue,
): ConfigIdentity {
  const legacyRunSpec = run.sandbox !== undefined && !isSandboxLayer(run.sandbox)
    ? run.sandbox
    : undefined;
  return {
    agent: run.agent.name,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    flags: run.flags,
    sandboxReuse: run.sandboxReuse ?? false,
    sandbox: sandboxRunInfo(sandboxSpec ?? legacyRunSpec),
    sandboxLayer,
    strict: run.strict ?? false,
    judge: judge ? { model: judge.model, baseUrl: judge.baseUrl, timeoutMs: judge.timeoutMs } : undefined,
    agentInstall: agentInstallOf(run),
  };
}

/**
 * 历史条目的同一份投影,从落盘重建。缺 `ExperimentRunInfo`(第三方 harness 写的结果)时
 * 配置面无从重算,返回 `undefined`——差异算不出就如实算不出,不猜。
 */
export function configIdentityFromResult(result: EvalResult): ConfigIdentity | undefined {
  const exp = result.experiment;
  if (exp === undefined) return undefined;
  return {
    agent: result.agent,
    model: result.model,
    reasoningEffort: exp.reasoningEffort,
    flags: exp.flags ?? {},
    sandboxReuse: exp.sandboxReuse ?? false,
    sandbox: exp.sandbox,
    sandboxLayer: exp.sandboxLayer,
    strict: exp.strict ?? false,
    judge: exp.judge
      ? { model: exp.judge.model, baseUrl: exp.judge.baseUrl, timeoutMs: exp.judge.timeoutMs }
      : undefined,
    agentInstall: exp.agentInstall,
  };
}

/** 该 eval 这一轮实际解析到的沙箱产物(声明了 environment 的走逐 eval 映射表)。 */
export function historicalSandboxForEval(result: EvalResult, evalId: string): SandboxRunInfo | undefined {
  const exp = result.experiment;
  return exp?.sandboxByEval?.[evalId] ?? exp?.sandbox;
}

/**
 * 身份 → 字段路径表。值为 `undefined` 的字段**不进表**:这一侧没有这个键,与「有这个键、值是
 * 别的」是两回事,`flags` 增删键正是靠这条成为一条差异。
 */
function flatten(identity: ConfigIdentity): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>();
  const put = (path: string, value: JsonValue | undefined): void => {
    if (value !== undefined) out.set(path, value);
  };
  put("agent", identity.agent);
  put("model", identity.model);
  put("reasoningEffort", identity.reasoningEffort);
  put("sandboxReuse", identity.sandboxReuse);
  put("strict", identity.strict);
  for (const [key, value] of Object.entries(identity.flags ?? {})) put(`flags.${key}`, value);
  if (identity.sandbox !== undefined) {
    put("sandbox.provider", identity.sandbox.provider);
    put("sandbox.fingerprint", identity.sandbox.fingerprint);
    for (const [key, value] of Object.entries(identity.sandbox.params ?? {})) put(`sandbox.params.${key}`, value);
  }
  put("sandboxLayer", identity.sandboxLayer);
  if (identity.judge !== undefined) {
    put("judge.model", identity.judge.model);
    put("judge.baseUrl", identity.judge.baseUrl);
    put("judge.timeoutMs", identity.judge.timeoutMs);
  }
  if (identity.agentInstall !== undefined) {
    put("agentInstall.agent", identity.agentInstall.agent);
    put("agentInstall.version", identity.agentInstall.version);
    put("agentInstall.revision", identity.agentInstall.revision);
    put("agentInstall.artifactDigest", identity.agentInstall.artifactDigest);
    put("agentInstall.artifactPlatform", identity.agentInstall.artifactPlatform);
  }
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
    out.push({
      selector: `config:${path}`,
      ...(hasFrom ? { from: summarize(from.get(path)!) } : {}),
      ...(hasTo ? { to: summarize(to.get(path)!) } : {}),
    });
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
export function rollBackAccepted(
  current: ConfigIdentity,
  historical: ConfigIdentity,
  accepted: ReadonlySet<string>,
): ConfigIdentity {
  const differing = new Set(configDeltas(historical, current).map((d) => d.selector));
  const out: ConfigIdentity = { ...current, flags: { ...current.flags } };
  if (accepted.has("config:agent")) out.agent = historical.agent;
  if (accepted.has("config:model")) out.model = historical.model;
  if (accepted.has("config:reasoningEffort")) out.reasoningEffort = historical.reasoningEffort;
  if (accepted.has("config:sandboxReuse")) out.sandboxReuse = historical.sandboxReuse;
  if (accepted.has("config:strict")) out.strict = historical.strict;
  for (const selector of accepted) {
    if (!selector.startsWith("config:flags.")) continue;
    const key = selector.slice("config:flags.".length);
    if (Object.hasOwn(historical.flags ?? {}, key)) out.flags[key] = historical.flags[key]!;
    else delete out.flags[key];
  }
  for (const group of ["sandbox", "judge", "agentInstall"] as const) {
    const paths = [...differing].filter((selector) => selector.startsWith(`config:${group}.`));
    if (paths.length === 0 || !paths.every((selector) => accepted.has(selector))) continue;
    if (group === "sandbox") out.sandbox = historical.sandbox;
    else if (group === "judge") out.judge = historical.judge;
    else out.agentInstall = historical.agentInstall;
  }
  return out;
}
