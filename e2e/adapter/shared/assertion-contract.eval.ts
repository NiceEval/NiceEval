// owner: docs/engineering/testing/e2e/adapter/README.md#共享断言契约
//
// 这是所有 live Adapter Repo 共用的协议中立 Eval 契约。根 E2E runner 仅在隔离副本中
// 把本文件物化为 evals/assertion-contract.eval.ts；每个 Repo 用自己的
// evals/assertion-profile.ts 提供真实工具名、提示词和可观察 marker。MCP / HITL / Skill /
// Plugin / Subagent 等能力特有形状仍由各 Repo 的本地 Eval 拥有。
import { defineEval, defineScoreEval, type AnyEvalDefinition, type ToolMatch } from "niceeval";
import {
  commandSucceeded,
  equals,
  excludes,
  hasSections,
  includes,
  includesUrl,
  isDefined,
  isFalse,
  isTrue,
  makeAssertion,
  matches,
  satisfies,
  similarity,
} from "niceeval/expect";
import profileValue from "./assertion-profile.ts";

interface ToolExpectation {
  readonly name: string;
  readonly inputToken: string;
  readonly outputToken?: string;
  readonly exactCount?: number;
}

interface AssertionProfile {
  readonly conversation: {
    readonly prompt: string;
    readonly marker: string;
    readonly absentTool: string;
  };
  readonly scopeTool: {
    readonly prompt: string;
    readonly name: string;
    readonly inputToken: string;
    readonly outputToken: string;
    readonly absentTool: string;
  };
  readonly coding: {
    readonly prompt: string;
    readonly changedPath: string;
    readonly changedBefore: string;
    readonly changedAfter: string;
    readonly createdPath: string;
    readonly createdMarker: string;
    readonly deletedPath: string;
    readonly absentDiffToken: string;
    readonly calls: readonly ToolExpectation[];
    readonly absentTool: string;
    readonly maxToolCalls: number;
  };
  readonly maxTokens: number;
  readonly maxCostUsd: number;
  /** Adapter 协议明确不提供 usage 时仍登记资源断言，并以 optional 验证 unavailable 折叠。 */
  readonly usageUnavailable?: boolean;
  /** Direct Agent 没有 Sandbox；仍跑 ToolMatch，只把 Sandbox 专属断言留给 coding adapters。 */
  readonly sandboxUnavailable?: boolean;
  readonly turnDataIsUndefined?: boolean;
}

function assertionProfile(value: unknown): AssertionProfile {
  if (value === null || typeof value !== "object") {
    throw new TypeError("evals/assertion-profile.ts must default-export an assertion profile object");
  }
  const candidate = value as Partial<AssertionProfile>;
  if (!candidate.conversation || !candidate.scopeTool || !candidate.coding) {
    throw new TypeError("assertion profile requires conversation, scopeTool, and coding sections");
  }
  if (!(candidate.maxTokens! > 0) || !(candidate.maxCostUsd! >= 0)) {
    throw new TypeError("assertion profile requires positive maxTokens and non-negative maxCostUsd");
  }
  return candidate as AssertionProfile;
}

const profile = assertionProfile(profileValue);

const unknownSchema = {
  safeParse(value: unknown) {
    return { success: true, data: value };
  },
};

const objectSchema = {
  safeParse(value: unknown) {
    return {
      success: value !== null && typeof value === "object" && "ok" in value,
      data: value,
    };
  },
};

function serializedContains(token: string): (value: unknown) => boolean {
  return (value) => {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.includes(token);
  };
}

function escapedPattern(token: string, flags?: string): RegExp {
  return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
}

function toolMatch(call: ToolExpectation): ToolMatch {
  return {
    status: "completed",
    input: serializedContains(call.inputToken),
    ...(call.outputToken === undefined ? {} : { output: serializedContains(call.outputToken) }),
    ...(call.exactCount === undefined ? {} : { count: call.exactCount }),
  };
}

export default {
  "values-and-no-tools": defineEval({
    description: "普通对话证明零工具，并枚举值 matcher、反向断言与句柄修饰符",
    async test(t) {
      const turn1 = await t.send(profile.conversation.prompt);
      await turn1.succeeded().gate().stopOnFailure();

      await t.group("普通对话：turn scope", () => {
        turn1.messageIncludes(profile.conversation.marker);
        turn1.messageIncludes(escapedPattern(profile.conversation.marker, "i"));
        turn1.usedNoTools();
        turn1.notCalledTool(profile.conversation.absentTool);
        turn1.notCalledTool(profile.conversation.absentTool, {
          input: /must-not-exist/,
          status: "completed",
        });
        turn1.maxToolCalls(0);
        turn1.noFailedActions();
        turn1.event("message", { count: (count) => count >= 1 });
        turn1.notEvent("operation.started");
        turn1.eventOrder(["message"]);
        turn1.eventsSatisfy(
          "turn1 包含 assistant message",
          (events) => events.some((event) => event.type === "message" && event.role === "assistant"),
        );
        const tokens = turn1.maxTokens(profile.maxTokens);
        const cost = turn1.maxCost(profile.maxCostUsd);
        if (profile.usageUnavailable) {
          tokens.optional();
          cost.optional();
        }
        if (profile.turnDataIsUndefined) {
          turn1.outputEquals(undefined);
          turn1.outputMatches(unknownSchema);
        }
      });

      const branch = t.newSession();
      const branchTurn1 = await branch.send(profile.conversation.prompt);
      await branchTurn1.succeeded().stopOnFailure();

      await t.group("普通对话：session scope", () => {
        branch.succeeded();
        branch.messageIncludes(profile.conversation.marker);
        branch.usedNoTools();
        branch.notCalledTool(profile.conversation.absentTool);
        branch.maxToolCalls(0);
        branch.noFailedActions();
        branch.event("message", { count: (count) => count >= 1 });
        branch.notEvent("operation.started");
        branch.eventOrder(["message"]);
        branch.eventsSatisfy("分支 session 包含 assistant message", (events) =>
          events.some((event) => event.type === "message" && event.role === "assistant"));
        const tokens = branch.maxTokens(profile.maxTokens);
        const cost = branch.maxCost(profile.maxCostUsd);
        if (profile.usageUnavailable) {
          tokens.optional();
          cost.optional();
        }
      });

      await t.group("普通对话：t attempt scope 聚合全部 session", () => {
        t.succeeded();
        t.messageIncludes(profile.conversation.marker);
        t.usedNoTools();
        t.notCalledTool(profile.conversation.absentTool);
        t.maxToolCalls(0);
        t.noFailedActions();
        t.event("message", { count: (count) => count >= 2 });
        t.notEvent("operation.started");
        t.eventOrder(["message", "message"]);
        t.eventsSatisfy("两条 session 都进入 t 聚合 scope", (events) =>
          events.filter((event) => event.type === "message" && event.role === "assistant").length === 2);
        const tokens = t.maxTokens(profile.maxTokens * 2);
        const cost = t.maxCost(profile.maxCostUsd * 2);
        if (profile.usageUnavailable) {
          tokens.optional();
          cost.optional();
        }
      });

      await t.group("值 matcher 参数全形状", async () => {
        t.check("alpha beta", includes("alpha"));
        t.check("alpha beta", includes(/BETA/i));
        t.check("// sentinel\nconst live = true", includes("const live", { stripComments: true }));
        t.check("alpha beta", excludes("gamma"));
        t.check("alpha beta", excludes(/GAMMA/i));
        t.check("// forbidden\nconst live = true", excludes("forbidden", { stripComments: true }));
        t.check({ ok: true, nested: [1, 2] }, equals({ ok: true, nested: [1, 2] }));
        t.check({ ok: true }, matches(objectSchema));
        t.check("stable text", similarity("stable text"));
        t.check("stable text", similarity("stable text").gate(1));
        t.check("stable text", similarity("stable text").atLeast(1));
        t.check("stable text", similarity("stable text").soft());
        t.check("stable text", similarity("stable text").optional());
        t.check("https://one.example", includesUrl());
        t.check("https://one.example https://two.example", includesUrl(2));
        t.check("# One\n## Two", hasSections());
        t.check("# One\n## Two\n### Three", hasSections(3));
        t.check([1, 2], satisfies((value) => Array.isArray(value)));
        t.check([1, 2], satisfies((value) => Array.isArray(value) && value.length === 2, "two items"));
        t.check("defined", isDefined());
        t.check("defined", isDefined("named value"));
        t.check(true, isTrue());
        t.check(true, isTrue("positive boolean"));
        t.check(false, isFalse());
        t.check(false, isFalse("negative boolean"));
        t.check({ exitCode: 0 }, commandSucceeded());
        t.check(4, makeAssertion({ name: "even", score: (value) => typeof value === "number" && value % 2 === 0 ? 1 : 0 }));
        t.check(4, makeAssertion({ name: "async-even", severity: "soft", threshold: 1, async score(value) {
          return typeof value === "number" && value % 2 === 0 ? 1 : 0;
        } }));
        await t.require("required", isDefined("required value"));
      });

      t.messageIncludes(profile.conversation.marker).soft();
      t.messageIncludes(profile.conversation.marker).atLeast(1);
      t.messageIncludes(profile.conversation.marker).optional();

      // Judge 是公开 Assertion 词汇，但不是 Adapter 协议，也不该让每个 Adapter Repo
      // 再消费一份裁判 key。这里枚举三种方法及 opts 形状，并用 optional 验证未配置
      // judge 时的 unavailable 折叠；真正评分成功路径归 judge 自己的 E2E owner。
      turn1.judge.autoevals.closedQA("回复是否只含指定 marker？").optional();
      branch.judge.autoevals.factuality(profile.conversation.marker, {
        on: branchTurn1.message,
        model: "",
      }).optional();
      t.judge.autoevals.summarizes(profile.conversation.marker, {
        on: turn1.message,
      }).optional();
    },
  }),

  "score-handles": defineScoreEval({
    description: "计分制句柄枚举 points、gate、atLeast、soft、optional 与 t.score",
    async test(t) {
      const turn1 = await t.send(profile.conversation.prompt);
      await turn1.succeeded().points(1).gate().stopOnFailure();
      turn1.usedNoTools().points(1).optional();
      t.check(turn1.message, includes(profile.conversation.marker)).points(2);
      t.check(turn1.message, includes(profile.conversation.marker)).atLeast(1);
      t.check(turn1.message, includes(profile.conversation.marker)).soft();
      t.check(turn1.message, includes(profile.conversation.marker)).optional();
      t.score("普通对话由真实 Adapter 返回", 1);
    },
  }),

  "scope-tool": defineEval({
    description: "同一笔真实工具调用分别由 turn、session 与 t 三种 scope 断言",
    async test(t) {
      const session1 = t.newSession();
      const turn1 = await session1.send(profile.scopeTool.prompt);
      await turn1.succeeded().stopOnFailure();

      const match: ToolMatch = {
        status: "completed",
        input: serializedContains(profile.scopeTool.inputToken),
        output: serializedContains(profile.scopeTool.outputToken),
      };
      await t.group("turn1.xxx", () => {
        turn1.calledTool(profile.scopeTool.name, match);
        turn1.notCalledTool(profile.scopeTool.absentTool);
        turn1.toolOrder([profile.scopeTool.name]);
        turn1.maxToolCalls(1);
        turn1.noFailedActions();
        turn1.event("operation.started", { count: 1 });
        turn1.event("operation.finished", { count: 1 });
        turn1.eventOrder(["operation.started", "operation.finished", "message"]);
      });
      await t.group("session1.xxx", () => {
        session1.calledTool(profile.scopeTool.name, match);
        session1.notCalledTool(profile.scopeTool.absentTool);
        session1.toolOrder([profile.scopeTool.name]);
        session1.maxToolCalls(1);
        session1.noFailedActions();
        session1.event("operation.started", { count: 1 });
        session1.eventOrder(["operation.started", "operation.finished", "message"]);
      });
      await t.group("t.xxx", () => {
        t.calledTool(profile.scopeTool.name, { ...match, count: 1 });
        t.calledTool(profile.scopeTool.name, { ...match, count: (count) => count === 1 });
        t.notCalledTool(profile.scopeTool.absentTool);
        t.toolOrder([profile.scopeTool.name]);
        t.maxToolCalls(1);
        t.noFailedActions();
        t.event("operation.started", { count: 1 });
        t.eventOrder(["operation.started", "operation.finished", "message"]);
      });
    },
  }),

  "tool-match-and-sandbox": defineEval({
    description: "工具 ToolMatch 的 input/count/output/status 参数及 Sandbox 正反断言",
    async test(t) {
      if (!profile.sandboxUnavailable) {
        await t.sandbox.writeText(profile.coding.changedPath, profile.coding.changedBefore);
        await t.sandbox.writeText(profile.coding.deletedPath, "delete-me\n");
      }
      const turn1 = await t.send(profile.coding.prompt);
      await turn1.succeeded().stopOnFailure();

      const first = profile.coding.calls[0];
      if (!first) throw new TypeError("assertion profile coding.calls must not be empty");
      turn1.calledTool(first.name);
      turn1.calledTool(first.name, { input: {} });
      turn1.calledTool(first.name, { input: escapedPattern(first.inputToken) });
      turn1.calledTool(first.name, { input: serializedContains(first.inputToken) });
      turn1.calledTool(first.name, toolMatch(first));

      for (const call of profile.coding.calls) {
        t.calledTool(call.name, toolMatch(call));
      }
      const outputCall = profile.coding.calls.find((call) => call.outputToken !== undefined);
      if (outputCall?.outputToken !== undefined) {
        const outputPattern = escapedPattern(outputCall.outputToken);
        t.calledTool(outputCall.name, { output: outputPattern, status: "completed" });
        t.calledTool(outputCall.name, {
          output: serializedContains(outputCall.outputToken),
          count: (count) => count >= 1,
        });
      }
      t.notCalledTool(profile.coding.absentTool);
      t.notCalledTool(profile.coding.absentTool, { input: /must-not-exist/, status: "completed" });
      t.toolOrder(profile.coding.calls.map((call) => call.name));
      t.maxToolCalls(profile.coding.maxToolCalls);
      t.noFailedActions();
      t.event("operation.started");
      t.event("operation.started", { count: (count) => count >= profile.coding.calls.length });
      t.event("operation.finished", { count: (count) => count >= profile.coding.calls.length });
      t.eventOrder(["operation.started", "operation.finished", "message"]);
      t.eventsSatisfy("所有 operation.started 都有非空 operationId", (events) =>
        events.filter((event) => event.type === "operation.started").every((event) => event.operationId.length > 0));

      if (!profile.sandboxUnavailable) {
        t.sandbox.fileChanged(profile.coding.changedPath);
        t.sandbox.fileChanged(profile.coding.createdPath);
        t.sandbox.fileDeleted(profile.coding.deletedPath);
        t.sandbox.notInDiff(escapedPattern(profile.coding.absentDiffToken));
        t.sandbox.noFailedShellCommands();
        t.check(t.sandbox.file(profile.coding.changedPath), includes(profile.coding.changedAfter));
        t.check(t.sandbox.file(profile.coding.changedPath), excludes(profile.coding.changedBefore));
        t.check(t.sandbox.file(profile.coding.createdPath), includes(profile.coding.createdMarker));
      }
    },
  }),
} satisfies Readonly<Record<string, AnyEvalDefinition>>;
