import { defineScoreEval } from "niceeval";
import { defineAgentJudge } from "niceeval/expect";

const mode = process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE ?? "success";
const reviewer = defineAgentJudge({
  maxTurns: mode === "turns" ? 1 : 8,
  timeoutMs: ["cancel-http", "large-audit", "oversized-audit"].includes(mode)
    ? 60_000
    : mode === "timeout"
      ? 100
      : 20_000,
  ...(mode === "material" ? { maxMaterialBytes: 1 } : {}),
});
export default defineScoreEval({
  diff: {},
  async test(t) {
    if (mode === "direct") {
      t.agentJudge(reviewer, {}).judge("Requires a Sandbox");
      return;
    }
    const turn = await t.send("Write application evidence.");
    const material = {
      marker: "ORIGINAL_MATERIAL",
      mode,
      ...(["large-material", "context-material"].includes(mode)
        ? { evidence: "Large opening evidence. ".repeat(6000) }
        : {}),
    };
    const empty = t.newSession().agentJudge(reviewer, material);
    empty.chat("CHAT_ONLY_MUST_NOT_SEND");
    const first = t.agentJudge(reviewer, material);
    material.marker = "MUTATED_MATERIAL";
    first.chat(
      mode.startsWith("compact-") ? "Earlier evidence. ".repeat(7000) : "Inspect the application before grading.",
    );
    const firstQuestion = first.judge("First question").score(2).label("First review");
    if (mode === "stop") {
      await firstQuestion.gate(0.5).orStop();
      return;
    }
    if (mode === "barrier") await t.check(true, (await import("niceeval/expect")).equals(true)).orStop();
    first
      .grade("Second question", {
        anchors: [
          { measurement: 0, description: "No supporting evidence" },
          { measurement: 1, description: "Fully supported by evidence" },
        ],
      })
      .score(3)
      .label("Second review");
    first.chat("TRAILING_CHAT_MUST_NOT_SEND");
    const second = turn.agentJudge(reviewer, { mode, marker: "SECOND_SESSION" });
    second.judge("Check the preceding review's file").score(1).label("Following session");
    // Ordinary assertions registered last must finish before the reviewer writes.
    t.sandbox.unchangedWithin(["review.txt"]).label("Before review");
  },
});
