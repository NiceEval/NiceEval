import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

type DirectReply = {
  readonly marker: string;
  readonly data: { readonly fixture: string; readonly ok: true };
  readonly tool?: {
    readonly name: string;
    readonly input: Record<string, string>;
    readonly output: Record<string, string>;
  };
};

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
  "assertion/scopes-main": {
    marker: "assertion-scope-main",
    data: { fixture: "assertion-scope-main", ok: true },
    tool: {
      name: "scope_main_tool",
      input: { session: "main", token: "scope-main-input" },
      output: { marker: "scope-main-output" },
    },
  },
  "assertion/scopes-branch": {
    marker: "assertion-scope-branch",
    data: { fixture: "assertion-scope-branch", ok: true },
    tool: {
      name: "scope_branch_tool",
      input: { session: "branch", token: "scope-branch-input" },
      output: { marker: "scope-branch-output" },
    },
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

    const events = reply.tool === undefined
      ? [{ type: "message" as const, role: "assistant" as const, text: reply.marker }]
      : [
          {
            type: "operation.started" as const,
            operationId: `${reply.tool.name}-${input.text}`,
            operation: { kind: "tool" as const, name: reply.tool.name, input: reply.tool.input },
          },
          {
            type: "operation.finished" as const,
            operationId: `${reply.tool.name}-${input.text}`,
            kind: "tool" as const,
            output: reply.tool.output,
            status: "completed" as const,
          },
          { type: "message" as const, role: "assistant" as const, text: reply.marker },
        ];

    return {
      status: "completed" as const,
      events,
      data: reply.data,
      usage: { inputTokens: 2, outputTokens: 3, costUSD: 0 },
    };
  },
});
