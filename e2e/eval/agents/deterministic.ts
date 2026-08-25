import {
  commandProjection,
  completeEvidenceCoverage,
  defineAgent,
  notCommandProjection,
} from "niceeval/adapter";
import type { CommandProjection } from "niceeval/adapter";

type DirectTool = {
  readonly name: string;
  readonly input: Record<string, string>;
  readonly output: Record<string, string>;
  readonly command?: CommandProjection;
};

type DirectReply = {
  readonly marker: string;
  readonly data: { readonly fixture: string; readonly ok: true };
  readonly tool?: DirectTool;
  readonly tools?: readonly DirectTool[];
  readonly partialActionsReason?: string;
};

function shellCommand(id: string, executable: string, args: readonly string[]): DirectTool {
  return {
    name: "shell",
    input: { command: [executable, ...args].join(" "), id },
    output: { marker: id },
    command: commandProjection({ state: "available", executable, args }),
  };
}

const replies: Readonly<Record<string, DirectReply>> = {
  "context/main-first": {
    marker: "context-main-first",
    data: { fixture: "context-main-first", ok: true },
    tool: {
      name: "context_main",
      input: { session: "main", turn: "first" },
      output: { marker: "context-main-first" },
    },
  },
  "context/main-second": {
    marker: "context-main-second",
    data: { fixture: "context-main-second", ok: true },
    tool: {
      name: "context_main",
      input: { session: "main", turn: "second" },
      output: { marker: "context-main-second" },
    },
  },
  "context/branch": {
    marker: "context-branch-only",
    data: { fixture: "context-branch", ok: true },
    tool: {
      name: "context_branch",
      input: { session: "branch", turn: "first" },
      output: { marker: "context-branch-only" },
    },
  },
  "assertion/values": {
    marker: "assertion-values-marker\n# First\n## Second\nhttps://one.example https://two.example",
    data: { fixture: "assertion-values", ok: true },
  },
  "assertion/match-outcomes": {
    marker: "assertion-match-outcomes-marker",
    data: { fixture: "assertion-match-outcomes", ok: true },
    tools: [
      shellCommand("match-command", "niceeval", ["exp", "fixture"]),
      {
        name: "matcher_tool",
        input: { path: "match/input.txt", mode: "safe" },
        output: { marker: "match-output" },
        command: notCommandProjection(),
      },
    ],
  },
  "assertion/scopes-main": {
    marker: "assertion-scope-main",
    data: { fixture: "assertion-scope-main", ok: true },
    tools: [
      ...Array.from({ length: 10_000 }, (_, index) =>
        shellCommand(`scope-filler-${index}`, "node", ["fixture.mjs", `--case=${index}`])),
      shellCommand("scope-init", "niceeval", ["init"]),
      shellCommand("scope-exp", "niceeval", ["exp", "sample"]),
      shellCommand("scope-show", "niceeval", ["show", "@sample"]),
      {
        name: "scope_main_tool",
        input: { session: "main", token: "scope-main-input" },
        output: { marker: "scope-main-output" },
      },
    ],
  },
  "assertion/scopes-branch": {
    marker: "assertion-scope-branch",
    data: { fixture: "assertion-scope-branch", ok: true },
    tool: {
      name: "scope_branch_tool",
      input: { session: "branch", token: "scope-branch-input" },
      output: { marker: "scope-branch-output" },
    },
    partialActionsReason: "deterministic partial-source fixture",
  },
  "assertion/score": {
    marker: "assertion-score-marker",
    data: { fixture: "assertion-score", ok: true },
  },
  "assertion/judge": {
    marker: "assertion-judge-marker",
    data: { fixture: "assertion-judge", ok: true },
  },
};

function replyFor(input: string): DirectReply {
  const reply = replies[input];
  if (reply === undefined) throw new Error(`unknown deterministic Eval input: ${JSON.stringify(input)}`);
  return reply;
}

/**
 * This is the only fake in the direct cases: a deterministic external Agent
 * boundary. NiceEval still owns session routing, event aggregation, assertion
 * evaluation, verdict folding, CLI output, and Record persistence.
 */
export const deterministicAgent = defineAgent({
  name: "eval-deterministic-direct",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    if (ctx.signal.aborted) throw new Error("deterministic Eval agent aborted");

    const reply = replyFor(input.text);
    const branch = input.text.includes("branch") ? "branch" : "main";
    ctx.session.capture(`eval-direct-${branch}`);

    const tools = [...(reply.tool === undefined ? [] : [reply.tool]), ...(reply.tools ?? [])];
    const events = tools.length === 0
      ? [{ type: "message" as const, role: "assistant" as const, text: reply.marker }]
      : [
          ...tools.flatMap((tool, index) => {
            const operationId = `${tool.name}-${input.text}-${index}`;
            return [
              {
                type: "operation.started" as const,
                operationId,
                operation: {
                  kind: "tool" as const,
                  name: tool.name,
                  input: tool.input,
                  ...(tool.command === undefined ? {} : { command: tool.command }),
                },
              },
              {
                type: "operation.finished" as const,
                operationId,
                kind: "tool" as const,
                output: tool.output,
                status: "completed" as const,
              },
            ];
          }),
          { type: "message" as const, role: "assistant" as const, text: reply.marker },
        ];

    return {
      status: "completed" as const,
      events,
      data: reply.data,
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUSD: 0,
      },
      ...(reply.partialActionsReason === undefined
        ? {}
        : {
            evidenceCoverage: {
              actions: {
                status: "partial" as const,
                reason: reply.partialActionsReason,
              },
            },
          }),
    };
  },
});
