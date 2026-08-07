import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
};

export const quickAgent = defineAgent({
  name: "lifecycle-quick",
  evidenceCoverage,
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "lifecycle-fixture-ok" }],
    };
  },
});

export const hangingAgent = defineAgent({
  name: "lifecycle-hanging",
  evidenceCoverage,
  async send(_input, ctx) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      timer.unref();
      ctx.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (ctx.signal.aborted) return { status: "failed", events: [] };
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "unexpected completion" }],
    };
  },
});
