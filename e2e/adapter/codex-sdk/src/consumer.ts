// This is a deliberately narrow in-process consumer of the public converter.
// It is not a Codex SDK factory: SDK invocation, signal forwarding, and thread
// capture/resume are the only glue here. Raw ThreadEvent values go straight to
// createCodexThreadEventStream(), which remains the sole event/usage/status mapper.

import { Codex, type CodexOptions } from "@openai/codex-sdk";
import { completeEvidenceCoverage, createCodexThreadEventStream, defineAgent } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import { isAbsolute } from "node:path";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const PROVIDER_NAME = "niceeval-codex-sdk";

function workspaceFromTest(): string {
  const workspace = process.env.CODEX_SDK_WORKSPACE;
  if (workspace === undefined || !isAbsolute(workspace)) {
    throw new Error("CODEX_SDK_WORKSPACE must be an absolute temporary path injected by the native E2E test");
  }
  return workspace;
}

function createCodexClient(): Codex {
  // This is the official SDK/provider shape used by the repository's Codex SDK
  // examples. CODEX_BASE_URL can point to the approved compatibility provider.
  const config: NonNullable<CodexOptions["config"]> = {
    model_providers: {
      [PROVIDER_NAME]: {
        name: PROVIDER_NAME,
        base_url: process.env.CODEX_BASE_URL ?? DEFAULT_BASE_URL,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
      },
    },
    model_provider: PROVIDER_NAME,
  };

  return new Codex({ apiKey: process.env.CODEX_API_KEY, config });
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const codex = createCodexClient();
  const threadOptions = {
    workingDirectory: workspaceFromTest(),
    skipGitRepoCheck: true,
    model: ctx.model ?? "gpt-5.4",
  };
  const thread = ctx.session.id === undefined
    ? codex.startThread(threadOptions)
    : codex.resumeThread(ctx.session.id, threadOptions);

  // Pass the runner's exact signal through to the SDK. On iterator failure or
  // cancellation, return() is awaited; a return() failure remains observable.
  const { events } = await thread.runStreamed(input.text, { signal: ctx.signal });
  const converter = createCodexThreadEventStream();
  const converted = [] as ReturnType<typeof converter.add>;
  let exhausted = false;
  let returned = false;

  const returnEvents = async (): Promise<void> => {
    if (returned) return;
    returned = true;
    await events.return(undefined);
  };

  try {
    for (;;) {
      if (ctx.signal.aborted) {
        throw new Error("Codex SDK stream aborted by the NiceEval attempt signal");
      }
      const next = await events.next();
      if (next.done) {
        exhausted = true;
        break;
      }

      // Do not rewrite or inspect SDK fields: this exact raw event is the public
      // converter's only input. It owns StreamEvent, canonical tool, usage, and
      // terminal-failure derivation.
      converted.push(...converter.add(next.value));
      ctx.session.capture(converter.threadId);
    }
  } catch (error) {
    if (!exhausted) {
      try {
        await returnEvents();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Codex SDK stream failed and iterator cleanup also failed");
      }
    }
    throw error;
  }

  ctx.session.capture(converter.threadId);
  return {
    status: converter.failed ? "failed" : "completed",
    events: converted,
    usage: converter.usage,
  };
}

export default defineAgent({
  name: "codex-sdk-converter-live-consumer",
  evidenceCoverage: completeEvidenceCoverage,
  send,
});
