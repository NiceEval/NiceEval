// 作用域断言:读标准事件流的派生事实(toolCalls / parked …)、diff、脚本结果。
// 每个 builder 产一个延迟 Spec,context 负责 record。规则覆盖不到的奇怪断言可直接落 events。
//
// 证据覆盖的三值折叠(见 docs/feature/scoring/architecture/evidence.md):
// - 正断言:找到匹配即通过(证据存在就是证据);没找到且所需通道非 complete(含 unknown)
//   记 unavailable——「没采到」不能算成「Agent 没做」;complete 通道上没找到才是 failed。
// - 负断言:找到反例即 failed(反例是确凿证据);没找到反例且通道非 complete 记 unavailable——
//   空流证明不了「没发生」。
// - 上限断言:实测已超限即 failed(partial 只会少采,超限是确凿的);未超限且通道非 complete
//   记 unavailable——缺证据不能按零聚合。

import { unavailable, type EvalUnavailable, type Spec } from "./collector.ts";
import type { CoverageChannel } from "./coverage.ts";
import type { DiffData, ScoringContext, StreamEvent, SubagentCall, SubagentMatch, ToolCall, ToolMatch } from "../types.ts";

// ── 覆盖折叠 ──

/** 所需通道非 complete 时返回 unavailable(带机器可读 reason),complete 返回 undefined。 */
function coverageGap(ctx: ScoringContext, channel: CoverageChannel): EvalUnavailable | undefined {
  const c = ctx.coverage[channel];
  if (c.status === "complete") return undefined;
  return unavailable(`coverage:${channel}=${c.status}${c.reason ? ` (${c.reason})` : ""}`);
}

// ── 工具匹配小语言 ──

function valueMatches(actual: unknown, expected: unknown, fullInput: unknown): boolean {
  if (expected instanceof RegExp) {
    if (typeof actual === "string" && expected.test(actual)) return true;
    // 逃生:对整个 input 的序列化串再试一次(路径可能藏在 command 里)
    try {
      return expected.test(JSON.stringify(fullInput));
    } catch {
      return false;
    }
  }
  if (typeof expected === "function") {
    return Boolean((expected as (v: unknown) => unknown)(actual));
  }
  if (expected !== null && typeof expected === "object") {
    return deepPartial(actual, expected);
  }
  return actual === expected;
}

function deepPartial(actual: unknown, expected: unknown): boolean {
  if (expected instanceof RegExp) return valueMatches(actual, expected, actual);
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return false;
    for (const [k, v] of Object.entries(expected)) {
      if (!valueMatches((actual as Record<string, unknown>)[k], v, actual)) return false;
    }
    return true;
  }
  return actual === expected;
}

function toolMatches(tc: ToolCall, name: string, match?: ToolMatch): boolean {
  if (tc.name !== name && tc.originalName !== name) return false;
  if (match?.status && tc.status !== match.status) return false;
  if (match?.input) {
    for (const [k, expected] of Object.entries(match.input)) {
      const actual = (tc.input as Record<string, unknown> | null | undefined)?.[k];
      if (!valueMatches(actual, expected, tc.input)) return false;
    }
  }
  return true;
}

// ── received:把调用的出入参带回断言结果,view 展开可见,不用翻原始事件流 ──

function briefJson(value: unknown, max = 800): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function describeCalls(calls: readonly ToolCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  return calls
    .map((tc) => {
      const name = tc.originalName && tc.originalName !== tc.name ? tc.originalName : tc.name;
      const lines = [`${name} [${tc.status}]`, `  input: ${briefJson(tc.input)}`];
      if (tc.output !== undefined) lines.push(`  output: ${briefJson(tc.output)}`);
      return lines.join("\n");
    })
    .join("\n");
}

function describeSubagents(calls: readonly SubagentCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  return calls
    .map((s) => {
      const lines = [`${s.name} [${s.status}]${s.remoteUrl ? ` ${s.remoteUrl}` : ""}`];
      if (s.output !== undefined) lines.push(`  output: ${briefJson(s.output)}`);
      return lines.join("\n");
    })
    .join("\n");
}

function subagentMatches(call: SubagentCall, name: string, match?: SubagentMatch): boolean {
  if (call.name !== name) return false;
  if (match?.status && call.status !== match.status) return false;
  if (match?.remoteUrl !== undefined) {
    const actual = call.remoteUrl ?? "";
    const expected = match.remoteUrl;
    if (expected instanceof RegExp ? !expected.test(actual) : actual !== expected) return false;
  }
  return true;
}

/** ToolMatch 的期望描述(`≥1 call matching input.city = "Brooklyn"` 之类)。 */
function describeToolExpectation(name: string, match?: ToolMatch): string {
  const conditions: string[] = [];
  if (match?.input) {
    for (const [k, v] of Object.entries(match.input)) conditions.push(`input.${k} = ${briefJson(v, 120)}`);
  }
  if (match?.status) conditions.push(`status = ${match.status}`);
  const cond = conditions.length ? ` matching ${conditions.join(", ")}` : "";
  const count = match?.count !== undefined ? `exactly ${match.count} calls of ${name}` : `≥1 call of ${name}`;
  return `${count}${cond}`;
}

// ── builders ──

export function succeeded(): Spec {
  return {
    name: "succeeded",
    severity: "gate",
    evaluate: (ctx) => {
      // status 通道非 complete(恒 completed 的映射)时,末态不可信,通过与失败都评不了。
      const gap = coverageGap(ctx, "status");
      if (gap) return gap;
      const ok = ctx.status !== "failed" && !ctx.facts.parked;
      if (ok) return 1;
      return {
        score: 0,
        received: ctx.facts.parked
          ? `${ctx.facts.inputRequests.length || 1} unanswered input request`
          : `status: ${ctx.status}`,
      };
    },
  };
}

export function parked(): Spec {
  return {
    name: "parked",
    severity: "gate",
    evaluate: (ctx) => {
      const gap = coverageGap(ctx, "status");
      if (gap) return gap;
      return ctx.facts.parked ? 1 : { score: 0, received: `status: ${ctx.status} (no pending input request)` };
    },
  };
}

export function messageIncludes(token: string | RegExp): Spec {
  return {
    name: `messageIncludes(${token})`,
    severity: "gate",
    evaluate: (ctx) => {
      // 只看助手回复——事件流现在也含用户消息(send 内容),扫它会误判。
      const text = ctx.events
        .filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.role === "assistant")
        .map((e) => e.text)
        .join("\n");
      const ok = token instanceof RegExp ? token.test(text) : text.includes(token);
      if (ok) return 1;
      // 正断言:非 complete 通道上没找到记 unavailable,不判失败。
      const gap = coverageGap(ctx, "messages");
      if (gap) return gap;
      return {
        score: 0,
        expected: token instanceof RegExp ? `matches ${token}` : `contains ${JSON.stringify(token)}`,
        received: text ? (text.length > 4000 ? text.slice(0, 4000) + "…" : text) : "(no assistant messages)",
      };
    },
  };
}

export function calledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `calledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.toolCalls.filter((tc) => toolMatches(tc, name, match));
      const n = matched.length;
      const ok = match?.count !== undefined ? n === match.count : n >= 1;
      // 命中给命中调用的出入参;没命中给同名调用(条件不满足的近失);再没有就列出实际调过的工具。
      const sameName = ctx.facts.toolCalls.filter((tc) => tc.name === name || tc.originalName === name);
      const shown = matched.length ? matched : sameName.length ? sameName : ctx.facts.toolCalls;
      if (ok) return { score: 1, received: describeCalls(shown) };
      // 精确 count 且实测已超出:partial 只会少采,超出是确凿失败;其余未命中按覆盖折叠。
      const definitiveOvershoot = match?.count !== undefined && n > match.count;
      if (!definitiveOvershoot) {
        const gap = coverageGap(ctx, "actions");
        if (gap) return gap;
      }
      return {
        score: 0,
        expected: describeToolExpectation(name, match),
        received:
          describeCalls(shown) ??
          `${ctx.facts.toolCalls.length} tool calls, none matching`,
      };
    },
  };
}

export function notCalledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `notCalledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.toolCalls.filter((tc) => toolMatches(tc, name, match));
      // 负断言:找到反例即 failed(证据确凿),没找到时空流证明不了「没发生」。
      if (matched.length > 0) return { score: 0, received: describeCalls(matched) };
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      return 1;
    },
  };
}

export function toolOrder(names: string[]): Spec {
  return {
    name: `toolOrder(${names.join("→")})`,
    severity: "gate",
    evaluate: (ctx) => {
      let i = 0;
      for (const tc of ctx.facts.toolCalls) {
        if (i < names.length && (tc.name === names[i] || tc.originalName === names[i])) i++;
      }
      if (i === names.length) return 1;
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      const actual = ctx.facts.toolCalls.map((tc) => tc.originalName ?? tc.name).join(" → ");
      return {
        score: 0,
        expected: names.join(" → "),
        received: actual ? `${actual} (missing ${names[i]})` : "(no tool calls)",
      };
    },
  };
}

export function usedNoTools(): Spec {
  return {
    name: "usedNoTools",
    severity: "gate",
    evaluate: (ctx) => {
      if (ctx.facts.toolCalls.length > 0) return { score: 0, received: describeCalls(ctx.facts.toolCalls) };
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      return 1;
    },
  };
}

export function maxToolCalls(max: number): Spec {
  return {
    name: `maxToolCalls(${max})`,
    severity: "gate",
    evaluate: (ctx) => {
      const n = ctx.facts.toolCalls.length;
      // 上限断言:实测已超限是确凿失败;未超限时,partial 通道可能漏采,不能按不完整计数放行。
      if (n > max) return { score: 0, expected: `≤ ${max} tool calls`, received: describeCalls(ctx.facts.toolCalls) };
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      return 1;
    },
  };
}

export function loadedSkill(skill: string): Spec {
  return {
    name: `loadedSkill(${skill})`,
    severity: "gate",
    // 读 skill.loaded 一等事件,不按名字猜工具调用:各 agent 表达 Skill 加载的原生形态不同
    // (Claude Code 是 Skill tool_use、eve 是 load-skill action kind),归一化的责任在 parser。
    evaluate: (ctx) => {
      const loaded = ctx.events.filter((e): e is Extract<StreamEvent, { type: "skill.loaded" }> => e.type === "skill.loaded");
      const matched = loaded.filter((e) => e.skill === skill);
      if (matched.length) return { score: 1, received: matched.map((e) => e.skill).join(", ") };
      const gap = coverageGap(ctx, "events");
      if (gap) return gap;
      // 没命中时把实际加载过的 skill 列出来(常见失败是名字对不上,而不是一个都没加载)。
      return {
        score: 0,
        expected: `skill ${JSON.stringify(skill)} loaded`,
        received: loaded.length ? loaded.map((e) => e.skill).join(", ") : "(no skills loaded)",
      };
    },
  };
}

export function noFailedActions(): Spec {
  return {
    name: "noFailedActions",
    severity: "gate",
    evaluate: (ctx) => {
      const failedTools = ctx.facts.toolCalls.filter((tc) => tc.status === "failed");
      const failedSubs = ctx.facts.subagentCalls.filter((s) => s.status === "failed");
      if (failedTools.length || failedSubs.length) {
        const received = [describeCalls(failedTools), describeSubagents(failedSubs)].filter(Boolean).join("\n") || undefined;
        return { score: 0, received };
      }
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      return 1;
    },
  };
}

export function calledSubagent(name: string, match?: SubagentMatch): Spec {
  return {
    name: `calledSubagent(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.subagentCalls.filter((call) => subagentMatches(call, name, match));
      const n = matched.length;
      const ok = match?.count !== undefined ? n === match.count : n >= 1;
      if (ok) return { score: 1, received: describeSubagents(matched) };
      const definitiveOvershoot = match?.count !== undefined && n > match.count;
      if (!definitiveOvershoot) {
        const gap = coverageGap(ctx, "actions");
        if (gap) return gap;
      }
      return { score: 0, received: describeSubagents(matched.length ? matched : ctx.facts.subagentCalls) };
    },
  };
}

export function eventOfType(type: string, opts?: { count?: number }): Spec {
  return {
    name: `event(${type})`,
    severity: "gate",
    evaluate: (ctx) => {
      const n = ctx.events.filter((e) => e.type === type).length;
      const ok = opts?.count !== undefined ? n === opts.count : n >= 1;
      if (ok) return 1;
      const definitiveOvershoot = opts?.count !== undefined && n > opts.count;
      if (!definitiveOvershoot) {
        const gap = coverageGap(ctx, "events");
        if (gap) return gap;
      }
      return {
        score: 0,
        expected: opts?.count !== undefined ? `exactly ${opts.count} × ${type}` : `≥1 × ${type}`,
        received: `${n} × ${type}`,
      };
    },
  };
}

export function notEventOfType(type: string): Spec {
  return {
    name: `notEvent(${type})`,
    severity: "gate",
    evaluate: (ctx) => {
      const hits = ctx.events.filter((e) => e.type === type);
      if (hits.length > 0) return { score: 0, received: `${hits.length} × ${type}` };
      const gap = coverageGap(ctx, "events");
      if (gap) return gap;
      return 1;
    },
  };
}

export function eventOrder(types: StreamEvent["type"][]): Spec {
  return {
    name: `eventOrder(${types.join("→")})`,
    severity: "gate",
    evaluate: (ctx) => {
      let i = 0;
      for (const ev of ctx.events) {
        if (i < types.length && ev.type === types[i]) i++;
      }
      if (i === types.length) return 1;
      const gap = coverageGap(ctx, "events");
      if (gap) return gap;
      return {
        score: 0,
        expected: types.join(" → "),
        received: `missing ${types[i]} (matched ${i}/${types.length})`,
      };
    },
  };
}

/** label 是失败时的全部解释(谓词不透明),必填、进断言标题。 */
export function eventsSatisfy(
  label: string,
  predicate: (events: readonly StreamEvent[]) => boolean,
): Spec {
  return {
    name: label,
    severity: "gate",
    evaluate: (ctx) => {
      if (predicate(ctx.events)) return 1;
      const gap = coverageGap(ctx, "events");
      if (gap) return gap;
      return { score: 0, received: `${ctx.events.length} events in scope` };
    },
  };
}

// ── 工作区 / 沙箱 ──

function diffMatchesRe(diff: DiffData, re: RegExp): boolean {
  for (const [path, content] of Object.entries(diff.generatedFiles)) {
    if (re.test(path) || re.test(content)) return true;
  }
  for (const path of diff.deletedFiles) {
    if (re.test(path)) return true;
  }
  return false;
}

export function fileChanged(path: string): Spec {
  return {
    name: `fileChanged(${path})`,
    severity: "gate",
    evaluate: (ctx) =>
      ctx.diff.generatedFiles[path] !== undefined
        ? 1
        : { score: 0, expected: "changed in diff", received: "not in diff" },
  };
}

export function fileDeleted(path: string): Spec {
  return {
    name: `fileDeleted(${path})`,
    severity: "gate",
    evaluate: (ctx) =>
      ctx.diff.deletedFiles.includes(path) ? 1 : { score: 0, expected: "deleted in diff", received: "not deleted" },
  };
}

export function notInDiff(re: RegExp): Spec {
  return {
    name: `notInDiff(${re})`,
    severity: "gate",
    evaluate: (ctx) => {
      if (!diffMatchesRe(ctx.diff, re)) return 1;
      const hit = Object.entries(ctx.diff.generatedFiles).find(([p, c]) => re.test(p) || re.test(c));
      return { score: 0, received: hit ? `matched in ${hit[0]}` : "matched a deleted path" };
    },
  };
}

export function noFailedShellCommands(): Spec {
  return {
    name: "noFailedShellCommands",
    severity: "gate",
    evaluate: (ctx) => {
      const failed = ctx.facts.toolCalls.filter((tc) => tc.name === "shell" && tc.status === "failed");
      if (failed.length) return { score: 0, received: describeCalls(failed) };
      const gap = coverageGap(ctx, "actions");
      if (gap) return gap;
      return 1;
    },
  };
}

// ── 效率 / 成本 ──

export function maxTokens(max: number): Spec {
  return {
    name: `maxTokens(${max})`,
    severity: "gate",
    evaluate: (ctx) => {
      const total = ctx.usage.inputTokens + ctx.usage.outputTokens;
      // 上限断言:实测已超限是确凿失败;未超限时缺 usage 不能按零聚合。
      if (total > max) return { score: 0, expected: `≤ ${max} tokens`, received: `${total} tokens` };
      const gap = coverageGap(ctx, "usage");
      if (gap) return gap;
      return 1;
    },
  };
}

export function maxCost(usd: number): Spec {
  return {
    name: `maxCost(${usd})`,
    severity: "gate",
    evaluate: (ctx) => {
      const cost = ctx.usage.costUSD ?? 0;
      if (cost > usd) return { score: 0, expected: `≤ $${usd}`, received: `$${cost.toFixed(4)}` };
      const gap = coverageGap(ctx, "usage");
      if (gap) return gap;
      return 1;
    },
  };
}
