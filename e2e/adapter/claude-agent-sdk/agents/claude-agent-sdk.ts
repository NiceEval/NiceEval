// 受限的 live consumer：它只启动锁定的 Claude Agent SDK、管理 SDK 生命周期和
// session/resume。SDKMessage 的任何字段都不在此处解释；原样交给候选包 converter。

import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  completeEvidenceCoverage,
  createClaudeSdkEventStream,
  defineAgent,
  driveFrameStream,
  type AgentContext,
  type SseFrameCursor,
} from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import { isAbsolute, join } from "node:path";

// The existing Anthropic-compatible live leaves use this proxy-supported model.
// Keep it explicit so this standalone repository has no implicit model default.
export const CLAUDE_AGENT_SDK_LIVE_MODEL = "gpt-6-luna";

function requiredAbsolutePath(name: string): string {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) {
    throw new Error(`[configuration] ${name} must be an absolute path injected by the native live test`);
  }
  return value;
}

/** Adapt AsyncGenerator.next() to the public driver without changing its SDKMessage value. */
function rawSdkMessageCursor(
  sdkQuery: Query,
  close: (interrupt: boolean) => Promise<void>,
): SseFrameCursor<SDKMessage> {
  let ended = false;
  let returned: Promise<IteratorResult<SDKMessage, void>> | undefined;
  return {
    async next(): Promise<IteratorResult<SDKMessage, void>> {
      if (ended) return { done: true, value: undefined };
      let frame: IteratorResult<SDKMessage, void>;
      try {
        frame = await sdkQuery.next();
      } catch (error) {
        if (ended) return { done: true, value: undefined };
        throw error;
      }
      if (ended || frame.done) {
        ended = true;
        return { done: true, value: undefined };
      }
      return { done: false, value: frame.value };
    },
    return() {
      if (returned !== undefined) return returned;
      const interrupt = !ended;
      ended = true;
      returned = close(interrupt).then(() => ({ done: true, value: undefined }));
      return returned;
    },
  };
}

/**
 * Query.interrupt() and Query.close() are both declared by the locked SDK.
 * Preserve any lifecycle failure instead of turning a failed cleanup into a pass.
 */
async function finishQuery(sdkQuery: Query, interruption: Promise<unknown> | undefined): Promise<void> {
  let interruptError: unknown;
  if (interruption !== undefined) {
    try {
      await interruption;
    } catch (error) {
      interruptError = error;
    }
  }

  let closeError: unknown;
  try {
    sdkQuery.close();
  } catch (error) {
    closeError = error;
  }

  if (interruptError !== undefined && closeError !== undefined) {
    const aggregate = new AggregateError(
      [interruptError, closeError],
      "Claude Agent SDK interrupt and close both failed",
    );
    aggregate.cause = interruptError;
    throw aggregate;
  }
  if (closeError !== undefined) throw closeError;
  if (interruptError !== undefined) throw interruptError;
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const home = requiredAbsolutePath("NICEEVAL_CLAUDE_AGENT_SDK_HOME");
  const workspace = requiredAbsolutePath("NICEEVAL_CLAUDE_AGENT_SDK_WORKSPACE");
  const sdkQuery = query({
    prompt: input.text,
    options: {
      cwd: workspace,
      ...(ctx.model === undefined ? {} : { model: ctx.model }),
      // This live leaf has exactly one native capability. There is no Read/Write
      // fallback, MCP server, permission callback, or application pause bridge.
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      maxTurns: 3,
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
      },
      ...(ctx.session.id === undefined ? {} : { resume: ctx.session.id }),
    },
  });

  let interruption: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  const interrupt = (): void => {
    // Query.interrupt() is the locked SDK's actual abort operation. Keep its
    // rejection for finally rather than dropping a lifecycle failure.
    if (interruption !== undefined || closing !== undefined) return;
    try {
      interruption = sdkQuery.interrupt();
    } catch (error) {
      interruption = Promise.reject(error);
    }
    void interruption.catch(() => {});
  };
  const closeQuery = (shouldInterrupt: boolean): Promise<void> => {
    if (closing !== undefined) return closing;
    if (shouldInterrupt) interrupt();
    closing = finishQuery(sdkQuery, interruption);
    return closing;
  };
  if (ctx.signal.aborted) interrupt();
  else ctx.signal.addEventListener("abort", interrupt, { once: true });

  let bodyFailed = false;
  try {
    const stream = createClaudeSdkEventStream();
    const turn = await driveFrameStream(rawSdkMessageCursor(sdkQuery, closeQuery), stream, ctx, () => {
      // system/init is handled by the converter; this is only the adapter's
      // session boundary, not a second SDK field mapping.
      ctx.session.capture(stream.sessionId);
    });
    ctx.session.capture(stream.sessionId);
    return turn;
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    ctx.signal.removeEventListener("abort", interrupt);
    try {
      await closeQuery(false);
    } catch (cleanupError) {
      if (bodyFailed) {
        try {
          ctx.diagnostic({ code: "stream-cleanup-failed", level: "warning", message: "Stream cleanup failed." });
        } catch {
          // Cleanup reporting must preserve the send failure.
        }
      } else {
        throw cleanupError;
      }
    }
  }
}

export default defineAgent({
  name: "claude-agent-sdk-live-converter-consumer",
  evidenceCoverage: completeEvidenceCoverage,
  send,
});
