import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

async function waitFor(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error("Run Journey Agent was interrupted");
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

export const runJourneyAgent = defineAgent({
  name: "run-journey-deterministic",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  send(_input, ctx) {
    return Effect.tryPromise({
      try: async () => {
        const barrierRoot = ctx.flags.barrierRoot;
        if (typeof barrierRoot !== "string" || barrierRoot.length === 0) {
          throw new Error("Run Journey Agent requires its invocation-local barrier root");
        }
        await mkdir(barrierRoot, { recursive: true });
        if (ctx.attempt?.index === 0) {
          await writeFile(join(barrierRoot, "first-attempt-started"), "started\n", "utf8");
          await waitFor(join(barrierRoot, "release-first-attempt"), ctx.signal);
          return {
            status: "completed" as const,
            events: [{ type: "message" as const, role: "assistant" as const, text: "run-journey-attempt-published" }],
          };
        }
        if (ctx.attempt?.index === 1) {
          await writeFile(join(barrierRoot, "second-attempt-started"), "started\n", "utf8");
          await new Promise<void>((resolve) => {
            const interrupted = (): void => {
              ctx.signal.removeEventListener("abort", interrupted);
              resolve();
            };
            ctx.signal.addEventListener("abort", interrupted, { once: true });
            if (ctx.signal.aborted) interrupted();
          });
          throw ctx.signal.reason ?? new Error("Run Journey Agent was interrupted");
        }
        throw new Error(`unexpected Run Journey Attempt index: ${String(ctx.attempt?.index)}`);
      },
      catch: (cause) => cause,
    });
  },
});
