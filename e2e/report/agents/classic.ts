import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

/** Memory condition for the three classic experiments. */
export type ClassicMemory = "baseline" | "memory-a" | "memory-b";

export const CLASSIC_RECALL_EVAL_IDS = [
  "classic/recall-name",
  "classic/recall-date",
  "classic/recall-fact",
  "classic/recall-constraint",
  "classic/recall-procedure",
  "classic/recall-entity",
  "classic/recall-multi",
  "classic/tool-note",
] as const;

export type ClassicRecallEvalId = (typeof CLASSIC_RECALL_EVAL_IDS)[number];

const PASSES: Record<ClassicMemory, ReadonlySet<string>> = {
  baseline: new Set(["classic/recall-name", "classic/tool-note", "source-snapshot"]),
  "memory-a": new Set([
    "classic/recall-name",
    "classic/recall-date",
    "classic/recall-fact",
    "classic/recall-constraint",
    "classic/recall-procedure",
    "classic/tool-note",
    "source-snapshot",
  ]),
  "memory-b": new Set([
    "classic/recall-name",
    "classic/recall-date",
    "classic/recall-fact",
    "classic/recall-constraint",
    "classic/recall-procedure",
    "classic/recall-entity",
    "classic/recall-multi",
    "classic/tool-note",
    "source-snapshot",
  ]),
};

const USAGE: Record<ClassicMemory, { inputTokens: number; outputTokens: number }> = {
  baseline: { inputTokens: 80, outputTokens: 20 },
  "memory-a": { inputTokens: 140, outputTokens: 36 },
  "memory-b": { inputTokens: 190, outputTokens: 48 },
};

export function classicExpectedVerdict(memory: ClassicMemory, evalId: string): "passed" | "failed" {
  return PASSES[memory].has(evalId) ? "passed" : "failed";
}

export function classicMemoryOf(flags: Readonly<Record<string, unknown>> | undefined): ClassicMemory {
  const value = flags?.memory;
  if (value === "baseline" || value === "memory-a" || value === "memory-b") return value;
  return "baseline";
}

/**
 * Public Direct Agent fixture: deterministic completed events, usage, and one tool
 * call. Outcome depends only on experiment flags.memory × eval id.
 */
export function classicMemoryAgent() {
  return defineAgent({
    name: "classic-memory",
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input, ctx) {
      if (ctx.signal.aborted) throw new Error("classic fixture aborted");
      const memory = classicMemoryOf(ctx.flags);
      const evalId = ctx.evalId ?? "unknown";
      ctx.session.capture(`classic:${memory}:${evalId}`);
      const recalled = PASSES[memory].has(evalId);
      const usage = USAGE[memory];
      const operationId = "classic-note-1";
      return {
        status: "completed" as const,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          requests: 1,
        },
        events: [
          {
            type: "operation.started" as const,
            operationId,
            operation: {
              kind: "tool" as const,
              name: "command_execution",
              input: {
                command: `printf '${evalId}: recalled=${recalled}\\n' > memory-note.txt`,
                cwd: ".",
              },
            },
          },
          {
            type: "operation.finished" as const,
            operationId,
            kind: "tool" as const,
            output: {
              output: `wrote memory-note.txt\n${evalId}: recalled=${recalled}\n`,
              exit_code: 0,
              written: true,
              recalled,
            },
            status: "completed" as const,
          },
          {
            type: "message" as const,
            role: "assistant" as const,
            text: recalled
              ? `I remember this. RECALL_OK for ${evalId}.`
              : `I do not remember this. RECALL_MISS for ${evalId}.`,
          },
        ],
      };
    },
  });
}
