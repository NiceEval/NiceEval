import type { ThreadEvent } from "@openai/codex-sdk";
import { completeEvidenceCoverage, createCodexThreadEventStream, defineAgent } from "niceeval/adapter";

export const CODEX_COMPLETED_THREAD_ID = "codex-sdk-completed-thread";
export const CODEX_FAILED_THREAD_ID = "codex-sdk-failed-thread";

const completedFrames = [
  { type: "thread.started", thread_id: CODEX_COMPLETED_THREAD_ID },
  {
    type: "item.completed",
    item: { id: "codex-nonfatal-diagnostic", type: "error", message: "codex-sdk-nonfatal-diagnostic-marker" },
  },
  {
    type: "item.started",
    item: {
      id: "codex-command-call",
      type: "command_execution",
      command: "printf codex-sdk-command-marker",
      aggregated_output: "",
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "codex-command-call",
      type: "command_execution",
      command: "printf codex-sdk-command-marker",
      aggregated_output: "codex-sdk-command-result-marker",
      exit_code: 0,
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "codex-file-change-call",
      type: "file_change",
      changes: [{ path: "src/fixture.ts", kind: "update" }],
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "codex-agent-message",
      type: "agent_message",
      text: "codex-sdk-message-marker",
    },
  },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 21,
      cached_input_tokens: 8,
      cache_write_input_tokens: 0,
      output_tokens: 13,
      reasoning_output_tokens: 5,
    },
  },
] as const satisfies readonly ThreadEvent[];

const failedFrames = [
  { type: "thread.started", thread_id: CODEX_FAILED_THREAD_ID },
  {
    type: "item.started",
    item: {
      id: "codex-failed-command-call",
      type: "command_execution",
      command: "printf codex-sdk-terminal-marker",
      aggregated_output: "",
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "codex-failed-command-call",
      type: "command_execution",
      command: "printf codex-sdk-terminal-marker",
      aggregated_output: "codex-sdk-terminal-output-marker",
      exit_code: 0,
      status: "completed",
    },
  },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 9,
      cached_input_tokens: 2,
      cache_write_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 1,
    },
  },
  { type: "turn.failed", error: { message: "codex-sdk-terminal-failure-marker" } },
] as const satisfies readonly ThreadEvent[];

export const codexThreadStreamFixtureAgent = defineAgent({
  name: "codex-thread-stream-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const converter = createCodexThreadEventStream();
    const events = [] as ReturnType<typeof converter.add>;
    const frames = input.text === "codex terminal fixture" ? failedFrames : completedFrames;

    // The selection chooses one whole upstream fixture. Every selected raw
    // ThreadEvent goes unchanged to the public converter; it is the only mapper.
    for (const frame of frames) events.push(...converter.add(frame));
    ctx.session.capture(converter.threadId);
    return {
      status: converter.failed ? "failed" : "completed",
      events,
      usage: converter.usage,
    };
  },
});
