import { createEmulator } from "emulate";

type Match = {
  model: string;
  stream?: boolean;
  textContains?: string;
  tool?: string;
  hasToolResult?: boolean;
};

type Reply =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> };

export type ModelRule = { id: string; match: Match; times?: number } & (
  | { error: { status: number; message: string; headers?: Record<string, string> }; reply?: never }
  | {
      reply: readonly Reply[];
      fault?: { kind: "disconnect"; afterChunks: number } | { kind: "stall"; afterChunks: number; stallMs: number };
    }
);

export async function startModelEmulator(rules: readonly ModelRule[]) {
  const emulator = await createEmulator({ service: "ai", port: 0, seed: { ai: { strict: true, rules } } });
  return {
    baseUrl: `${emulator.url}/v1`,
    close: () => emulator.close(),
    reset: () => emulator.reset(),
    async calls(): Promise<readonly { time: string }[]> {
      const response = await fetch(`${emulator.url}/_ai/calls`);
      if (!response.ok) throw new Error(`Cannot read emulator calls: HTTP ${response.status}`);
      const calls: unknown = await response.json();
      if (!Array.isArray(calls) || !calls.every((call) => typeof call?.time === "string")) {
        throw new Error("Expected emulator call records with timestamps");
      }
      return calls;
    },
  };
}
