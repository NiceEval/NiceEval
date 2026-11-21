import { createEmulator, defineEmulator } from "emulate";

/** Simulates the external Chat Completions HTTP boundary for Judge usage tests. */
export function judgeUsageChatResponse(
  usage: Readonly<Record<string, unknown>>,
  options: { invalidQA?: boolean; provider?: string; screenshot?: boolean } = {},
) {
  return {
    id: "judge-usage-response",
    object: "chat.completion",
    created: 0,
    model: "judge-usage-served",
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    usage,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "judge-usage-tool",
              type: "function",
              function: {
                name: "record_score_match",
                arguments: options.invalidQA
                  ? "{invalid-qa"
                  : options.screenshot
                    ? JSON.stringify({ measurement: 1, rationale: "Visible screenshot." })
                    : JSON.stringify({
                        choice: "satisfied",
                        rationale: "The answer names Paris.",
                        citations: ["answer-1"],
                      }),
              },
            },
          ],
        },
      },
    ],
  };
}

export async function startJudgeUsageEmulator(responses: readonly { status: number; body: unknown }[]) {
  const service = defineEmulator({
    name: "judge-usage",
    state: () => ({ next: 0 }),
    setup({ app, state }) {
      app.post("/v1/chat/completions", async ({ req }) => {
        const body = await req.text();
        if (Buffer.byteLength(body) > 32_768) return new Response("Judge fixture request exceeds its cap", { status: 413 });
        const reply = responses[state.next++];
        return Response.json(reply?.body ?? { error: { message: "Unexpected fixture request" } }, {
          status: reply?.status ?? 400,
          headers: { "Retry-After": "0" },
        });
      });
    },
  });
  const emulator = await createEmulator({ service, port: 0 });
  return {
    baseUrl: `${emulator.url}/v1`,
    close: () => emulator.close(),
  };
}
