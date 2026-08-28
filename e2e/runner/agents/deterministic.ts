import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const deterministicAgent = defineAgent({
  name: "runner-deterministic",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    if (ctx.signal.aborted) throw new Error("runner fixture aborted");
    const barrierRoot = ctx.flags.barrierRoot;
    if (ctx.evalId === "concurrent/alpha" && typeof barrierRoot === "string") {
      await mkdir(barrierRoot, { recursive: true });
      if (process.env.NICEEVAL_CONCURRENCY_ROLE === "B") {
        await writeFile(join(barrierRoot, "second-run-started-alpha"), "");
      }
      if (process.env.NICEEVAL_CONCURRENCY_ROLE === "A") {
        await writeFile(join(barrierRoot, "first-run-started-alpha"), "");
        for (;;) {
          try {
            await access(join(barrierRoot, "release-first-run"));
            break;
          } catch {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
        }
      }
    }
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-fixture-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});
