import { Effect } from "effect";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { completeEvidenceCoverage, createClaudeSdkEventStream, defineAgent } from "niceeval/adapter";

export const CLAUDE_SESSION_ID = "claude-sdk-converter-session";

const claudeMessageUsage = {
  cache_creation: null,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 30,
  fallback_credit: null,
  inference_geo: null,
  input_tokens: 100,
  iterations: null,
  output_tokens: 20,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard",
  speed: "standard",
} satisfies BetaMessage["usage"];

// Exact raw Claude Agent SDK protocol values. They are checked against the
// locked package's exported message unions; NiceEval types never define them.
const claudeInit = {
  type: "system",
  subtype: "init",
  apiKeySource: "user",
  claude_code_version: "2.1.0-fixture",
  cwd: "/offline/claude-sdk-fixture",
  tools: [],
  mcp_servers: [],
  model: "claude-sonnet-4-5-20250929",
  permissionMode: "default",
  slash_commands: [],
  output_style: "default",
  skills: [],
  plugins: [],
  uuid: "00000000-0000-4000-8000-000000000001",
  session_id: CLAUDE_SESSION_ID,
} satisfies SDKSystemMessage;

const claudeAssistant = {
  type: "assistant",
  parent_tool_use_id: null,
  uuid: "00000000-0000-4000-8000-000000000002",
  session_id: CLAUDE_SESSION_ID,
  message: {
    id: "claude-sdk-fixture-message",
    container: null,
    content: [
      { type: "text", text: "claude-sdk-assistant-marker", citations: null },
      {
        type: "tool_use",
        id: "claude-bash-call",
        name: "Bash",
        input: { command: "printf claude-sdk-bash-marker" },
      },
      {
        type: "tool_use",
        id: "claude-read-call",
        name: "Read",
        input: { file_path: "/offline/fixture.txt" },
      },
      {
        type: "tool_use",
        id: "claude-write-call",
        name: "Write",
        input: { file_path: "/offline/out.txt", content: "claude-sdk-write-marker" },
      },
      {
        type: "tool_use",
        id: "claude-rejected-call",
        name: "Bash",
        input: { command: "rm -f prohibited-fixture" },
      },
    ],
    context_management: null,
    diagnostics: null,
    model: "claude-sonnet-4-5-20250929",
    role: "assistant",
    stop_details: null,
    stop_reason: "tool_use",
    stop_sequence: null,
    type: "message",
    usage: claudeMessageUsage,
  },
} satisfies SDKAssistantMessage;

const completedToolResults = [
  {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "claude-bash-call", content: "claude-sdk-bash-result-marker" },
        { type: "tool_result", tool_use_id: "claude-read-call", content: "claude-sdk-read-result-marker" },
        { type: "tool_result", tool_use_id: "claude-write-call", content: "claude-sdk-write-result-marker" },
      ],
    },
  } satisfies SDKUserMessage,
] as const satisfies readonly SDKMessage[];

const rejectedToolResult = {
  type: "user",
  parent_tool_use_id: null,
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "claude-rejected-call",
        content: "claude-sdk-rejected-result-marker",
        is_error: true,
      },
    ],
  },
} satisfies SDKUserMessage;

type ClaudeTerminalFixture = Pick<
  SDKResultSuccess,
  "type" | "subtype" | "is_error" | "num_turns" | "result" | "total_cost_usd" | "uuid" | "session_id"
> & {
  usage: Pick<SDKResultSuccess["usage"], "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">;
};

const claudeTerminalResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 2,
  result: "claude-sdk-result-marker",
  total_cost_usd: 0.0123,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 30,
    cache_creation_input_tokens: 10,
  },
  uuid: "00000000-0000-4000-8000-000000000003",
  session_id: CLAUDE_SESSION_ID,
} satisfies ClaudeTerminalFixture;

export const claudeSdkStreamFixtureAgent = defineAgent({
  name: "claude-sdk-stream-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: (_input, ctx) => Effect.sync(() => {
    const converter = createClaudeSdkEventStream();
    const events = [] as ReturnType<typeof converter.add>;

    // Consumer glue owns only iteration and collection. No StreamEvent, tool
    // canonicalization, usage, or status is constructed outside the converter.
    events.push(...converter.add(claudeInit));
    events.push(...converter.add(claudeAssistant));
    for (const frame of completedToolResults) events.push(...converter.add(frame));
    // This is the consumer's approval decision. The converter receives only raw
    // Claude frames, and this fixture intentionally never calls driveFrameStream.
    converter.markRejected("claude-rejected-call");
    events.push(...converter.add(rejectedToolResult));
    events.push(...converter.add(claudeTerminalResult));
    ctx.session.capture(converter.sessionId);
    return {
      status: converter.failed ? "failed" : "completed",
      events,
      usage: converter.usage,
    };
  }),
});
