// 作用域断言:读标准事件流的派生事实(toolCalls / parked …)、diff、脚本结果。
// 每个 builder 产一个延迟 Spec,context 负责 record。规则覆盖不到的奇怪断言可直接落 events。

import type { Spec } from "./collector.ts";
import type { DiffData, ScoringContext, ToolCall, ToolMatch } from "../types.ts";

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

function countMatches(toolCalls: readonly ToolCall[], name: string, match?: ToolMatch): number {
  return toolCalls.filter((tc) => toolMatches(tc, name, match)).length;
}

// ── builders ──

export function succeeded(): Spec {
  return {
    name: "succeeded",
    severity: "gate",
    evaluate: (ctx) => (ctx.status !== "failed" && !ctx.facts.parked ? 1 : 0),
  };
}

export function parked(): Spec {
  return { name: "parked", severity: "gate", evaluate: (ctx) => (ctx.facts.parked ? 1 : 0) };
}

export function messageIncludes(token: string | RegExp): Spec {
  return {
    name: `messageIncludes(${token})`,
    severity: "gate",
    evaluate: (ctx) => {
      const text = ctx.events
        .filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message")
        .map((e) => e.text)
        .join("\n");
      const ok = token instanceof RegExp ? token.test(text) : text.includes(token);
      return ok ? 1 : 0;
    },
  };
}

export function calledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `calledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const n = countMatches(ctx.facts.toolCalls, name, match);
      if (match?.count !== undefined) return n === match.count ? 1 : 0;
      return n >= 1 ? 1 : 0;
    },
  };
}

export function notCalledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `notCalledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => (countMatches(ctx.facts.toolCalls, name, match) === 0 ? 1 : 0),
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
      return i === names.length ? 1 : 0;
    },
  };
}

export function usedNoTools(): Spec {
  return {
    name: "usedNoTools",
    severity: "gate",
    evaluate: (ctx) => (ctx.facts.toolCalls.length === 0 ? 1 : 0),
  };
}

export function maxToolCalls(max: number): Spec {
  return {
    name: `maxToolCalls(${max})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.facts.toolCalls.length <= max ? 1 : 0),
  };
}

export function loadedSkill(skill: string): Spec {
  return calledTool("load_skill", { input: { skill } });
}

export function noFailedActions(): Spec {
  return {
    name: "noFailedActions",
    severity: "gate",
    evaluate: (ctx) => {
      const toolFail = ctx.facts.toolCalls.some((tc) => tc.status === "failed");
      const subFail = ctx.facts.subagentCalls.some((s) => s.status === "failed");
      return toolFail || subFail ? 0 : 1;
    },
  };
}

export function eventOfType(type: string, opts?: { count?: number }): Spec {
  return {
    name: `event(${type})`,
    severity: "gate",
    evaluate: (ctx) => {
      const n = ctx.events.filter((e) => e.type === type).length;
      if (opts?.count !== undefined) return n === opts.count ? 1 : 0;
      return n >= 1 ? 1 : 0;
    },
  };
}

export function notEventOfType(type: string): Spec {
  return {
    name: `notEvent(${type})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.events.some((e) => e.type === type) ? 0 : 1),
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
    evaluate: (ctx) => (ctx.diff.generatedFiles[path] !== undefined ? 1 : 0),
  };
}

export function fileDeleted(path: string): Spec {
  return {
    name: `fileDeleted(${path})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.diff.deletedFiles.includes(path) ? 1 : 0),
  };
}

export function notInDiff(re: RegExp): Spec {
  return {
    name: `notInDiff(${re})`,
    severity: "gate",
    evaluate: (ctx) => (diffMatchesRe(ctx.diff, re) ? 0 : 1),
  };
}

export function scriptPassed(script: string): Spec {
  return {
    name: `scriptPassed(${script})`,
    severity: "gate",
    evaluate: (ctx) => {
      const r = ctx.scripts[script];
      if (!r) return 0;
      return r.success ? 1 : 0;
    },
    detail: undefined,
  };
}

export function testsPassed(): Spec {
  return {
    name: "testsPassed",
    severity: "gate",
    evaluate: (ctx) => (ctx.scripts.__vitest__?.success ? 1 : 0),
  };
}

export function noFailedShellCommands(): Spec {
  return {
    name: "noFailedShellCommands",
    severity: "gate",
    evaluate: (ctx) => {
      const failed = ctx.facts.toolCalls.some((tc) => tc.name === "shell" && tc.status === "failed");
      return failed ? 0 : 1;
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
      return total <= max ? 1 : 0;
    },
  };
}

export function maxCost(usd: number): Spec {
  return {
    name: `maxCost(${usd})`,
    severity: "gate",
    evaluate: (ctx) => {
      const cost = ctx.usage.costUSD ?? 0;
      return cost <= usd ? 1 : 0;
    },
  };
}
