import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOLDING_EVALS = new Set([
  "max-concurrency/hold-alpha",
  "max-concurrency/hold-beta",
  "max-concurrency/hold-gamma",
]);

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("max-concurrency fixture aborted");
}

async function waitForRelease(barrierRoot: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) throw aborted(signal);
    try {
      await access(join(barrierRoot, "release-holders"));
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

export const maxConcurrencyAgent = defineAgent({
  name: "runner-max-concurrency",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  async send(_input, ctx) {
    const barrierRoot = ctx.flags.barrierRoot;
    const evalId = ctx.evalId;
    if (typeof barrierRoot !== "string" || evalId === undefined) {
      throw new Error("max-concurrency fixture requires an Eval identity and barrier root");
    }

    await mkdir(barrierRoot, { recursive: true });
    if (HOLDING_EVALS.has(evalId)) {
      await writeFile(join(barrierRoot, `${evalId.replaceAll("/", "-")}-entered`), "");
      await waitForRelease(barrierRoot, ctx.signal);
    } else if (evalId === "max-concurrency/probe") {
      await writeFile(join(barrierRoot, "probe-agent-entered"), "");
    } else {
      throw new Error(`unexpected max-concurrency Eval: ${evalId}`);
    }

    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "max-concurrency-fixture-ok" }],
    };
  },
});
