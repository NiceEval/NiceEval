// Real HTTP Agent against a DeepSeek OpenAI-Chat-Completions-compatible gateway
// (OPENAI_BASE_URL). This is the only Agent in this repo — results-contract's job is to
// validate the Results format and read surfaces against one real run, not adapter
// breadth (docs/engineering/e2e-ci/report.md).
//
// A single t.send() drives a real two-round tool-calling loop entirely inside this one
// adapter call:
//   round 1 — tool_choice forces the model to call get_stock_price (real tool_calls back)
//   round 2 — tool_choice: "none" lets the model answer using the tool's result
// Chat Completions doesn't run tools for you (see docs-site/zh/tutorials/write-send.mdx
// 第四步): the client executes the call and reports the result back in a follow-up
// request. fromChatCompletion does the response → Turn mapping for each round; this file
// only hand-writes the transport plus the tool execution + action.result bridging that
// Chat Completions leaves to the caller.

import { defineAgent, fromChatCompletion } from "niceeval/adapter";
import type { ChatCompletionLike } from "niceeval/adapter";
import type { StreamEvent, Usage } from "niceeval";

const BASE_URL = process.env.OPENAI_BASE_URL;
const API_KEY = process.env.OPENAI_API_KEY;

if (!BASE_URL) throw new Error("OPENAI_BASE_URL is required — set it in .env (see .env.example)");
if (!API_KEY) throw new Error("OPENAI_API_KEY is required — set it in .env (see .env.example)");

const GET_STOCK_PRICE_TOOL = {
  type: "function" as const,
  function: {
    name: "get_stock_price",
    description: "Look up the current stock price for a ticker symbol.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string", description: "Ticker symbol, e.g. ACME" } },
      required: ["symbol"],
    },
  },
};

interface StockPriceResult {
  symbol: string;
  price: number;
  currency: string;
  /** Structural JsonValue compatibility for the action.result event's `output` field. */
  [key: string]: string | number;
}

/** Deterministic fake lookup — the contract under test is the tool-calling *mechanism*, not a real market data feed. */
function lookupStockPrice(symbol: string): StockPriceResult {
  return { symbol, price: 42.17, currency: "USD" };
}

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

async function callChatCompletions(body: Record<string, unknown>, signal: AbortSignal): Promise<ChatCompletionLike> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as ChatCompletionLike & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`POST ${BASE_URL}/chat/completions → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

/** Sums the two real HTTP round-trips into this Turn's usage; `requests` records both actually happened. */
function mergeUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a && !b) return undefined;
  const cacheReadTokens = (a?.cacheReadTokens ?? 0) + (b?.cacheReadTokens ?? 0);
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    requests: (a?.requests ?? 1) + (b?.requests ?? 1),
  };
}

export default defineAgent({
  name: "openai-compat",
  coverage: {
    actions: { status: "complete" },
    usage: { status: "complete" },
  },
  async send(input, ctx) {
    const model = ctx.model ?? "deepseek-chat";
    const history = ctx.session.history<ChatMessage>();
    const messages: ChatMessage[] = [...history.get(), { role: "user", content: input.text }];

    // Round 1: force the tool call — real HTTP call, real tool_calls back.
    const res1 = await callChatCompletions(
      {
        model,
        messages,
        tools: [GET_STOCK_PRICE_TOOL],
        tool_choice: { type: "function", function: { name: "get_stock_price" } },
      },
      ctx.signal,
    );
    const turn1 = fromChatCompletion(res1);

    const call = res1.choices[0]?.message.tool_calls?.[0];
    if (!call) {
      throw new Error(
        "Gateway did not return a get_stock_price tool_call even though tool_choice forced it — response: " +
          JSON.stringify(res1.choices[0]?.message).slice(0, 500),
      );
    }

    // Execute the tool ourselves and report the result back (Chat Completions contract).
    const args = JSON.parse(call.function.arguments) as { symbol?: string };
    const result = lookupStockPrice(args.symbol ?? "ACME");
    const actionResult: StreamEvent = { type: "action.result", callId: call.id, output: result, status: "completed" };

    const messagesWithTool: ChatMessage[] = [
      ...messages,
      res1.choices[0].message as ChatMessage,
      { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) },
    ];

    // Round 2: let the model answer using the tool result; tool_choice: "none" keeps this
    // Turn to exactly one more real call instead of looping.
    const res2 = await callChatCompletions(
      { model, messages: messagesWithTool, tools: [GET_STOCK_PRICE_TOOL], tool_choice: "none" },
      ctx.signal,
    );
    const turn2 = fromChatCompletion(res2);

    history.commit([...messagesWithTool, res2.choices[0]?.message as ChatMessage]);

    return {
      status: "completed",
      events: [...turn1.events, actionResult, ...turn2.events],
      usage: mergeUsage(turn1.usage, turn2.usage),
    };
  },
});
