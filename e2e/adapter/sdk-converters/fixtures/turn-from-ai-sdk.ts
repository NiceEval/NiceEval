import { Effect } from "effect";
import { generateText, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createSessionSlot, defineAgent, turnFromAiSdk } from "niceeval/adapter";
import { completeEvidenceCoverage } from "niceeval/adapter";
import { z } from "zod";

const AI_SDK_SESSION_ID = "turn-from-ai-sdk-deterministic-session";
const approvalSlot = createSessionSlot<{
  responseMessages: ModelMessage[];
  approvalId: string;
}>("sdk-converters/turn-from-ai-sdk/approval");

const fixtureTools = {
  inventory_lookup: tool({
    description: "offline deterministic inventory lookup",
    inputSchema: z.object({ sku: z.string() }),
    execute: async ({ sku }) => ({ sku, availability: "in-stock", marker: "ai-sdk-tool-result-marker" }),
  }),
  approval_tool: tool({
    description: "offline deterministic action that must wait for approval",
    inputSchema: z.object({ change: z.string() }),
    execute: async ({ change }) => ({ change, marker: "ai-sdk-approved-tool-result" }),
  }),
};

const fixtureToolApproval = { approval_tool: "user-approval" } as const;

function initialModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    // This is the AI SDK's own test/model seam. generateText() turns this
    // lower-level response into real v7 result/responseMessages shapes.
    doGenerate: async () =>
      ({
        content: [
          {
            type: "tool-call",
            toolCallId: "ai-sdk-inventory-call",
            toolName: "inventory_lookup",
            input: '{"sku":"fixture-001"}',
          },
          {
            type: "tool-call",
            toolCallId: "ai-sdk-approval-call",
            toolName: "approval_tool",
            input: '{"change":"apply-fixture-change"}',
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: {
          inputTokens: { total: 13, noCache: 7, cacheRead: 4, cacheWrite: 2 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
        request: { body: undefined },
        response: {
          id: "ai-sdk-initial-response",
          timestamp: new Date("2026-08-09T00:00:00.000Z"),
          modelId: "mock-ai-sdk-v4",
          headers: undefined,
          body: undefined,
        },
      }) satisfies Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>,
  });
}

function resumedModel(approved: boolean): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () =>
      ({
        content: [{ type: "text", text: approved ? "ai-sdk-approved-marker" : "ai-sdk-rejected-marker" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
        request: { body: undefined },
        response: {
          id: approved ? "ai-sdk-approved-response" : "ai-sdk-rejected-response",
          timestamp: new Date("2026-08-09T00:00:01.000Z"),
          modelId: "mock-ai-sdk-v4",
          headers: undefined,
          body: undefined,
        },
      }) satisfies Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>,
  });
}

function approvedResponse(input: { readonly responses?: readonly { readonly requestId: string; readonly optionId?: string }[] }, approvalId: string): boolean {
  return input.responses?.some((response) => response.requestId === approvalId && response.optionId === "approve") ?? false;
}

export const turnFromAiSdkFixtureAgent = defineAgent({
  name: "turn-from-ai-sdk-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: (input, ctx) => Effect.tryPromise({
    try: async () => {
      ctx.session.capture(AI_SDK_SESSION_ID);
      const pending = ctx.session.take(approvalSlot);

      if (pending !== undefined) {
        const approved = approvedResponse(input, pending.approvalId);
        const result = await generateText({
          model: resumedModel(approved),
          messages: [
            ...pending.responseMessages,
            {
              role: "tool",
              content: [{ type: "tool-approval-response", approvalId: pending.approvalId, approved }],
            },
          ],
          tools: fixtureTools,
          toolApproval: fixtureToolApproval,
        });
        return turnFromAiSdk(result);
      }

      const result = await generateText({
        model: initialModel(),
        prompt: input.text,
        tools: fixtureTools,
        toolApproval: fixtureToolApproval,
      });
      const approval = result.content.find((part) => part.type === "tool-approval-request");
      if (approval?.approvalId === undefined) {
        throw new Error("AI SDK fixture expected its real generateText result to contain a tool approval request");
      }
      ctx.session.set(approvalSlot, {
        responseMessages: result.responseMessages,
        approvalId: approval.approvalId,
      });
      return turnFromAiSdk(result);
    },
    catch: (cause) => cause,
  }),
});
