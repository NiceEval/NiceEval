import { defineEval } from "niceeval";
import { and, commandSucceeded, eventMatch, includes, or, toolMatch } from "niceeval/expect";

function recallMatch() {
  return and(
    includes("RECALL_OK"),
    or(includes("RECALL_OK"), includes("NEVER_PRESENT")),
  );
}

function recallEval(topic: string, prompt: string) {
  return defineEval({
    description: `classic/${topic}: deterministic MemoryBench-like recall`,
    async test(t) {
      const turn = await t.send(prompt);
      await turn.succeeded().orStop();
      t.check(t.reply, recallMatch());
    },
  });
}

export default {
  "recall-name": recallEval("recall-name", "What is the user's name?"),
  "recall-date": recallEval("recall-date", "What date did we last meet?"),
  "recall-fact": recallEval("recall-fact", "What fact should you remember?"),
  "recall-constraint": recallEval("recall-constraint", "What constraint applies?"),
  "recall-procedure": recallEval("recall-procedure", "What procedure should you follow?"),
  "recall-entity": recallEval("recall-entity", "Which entity is in scope?"),
  "recall-multi": recallEval("recall-multi", "Recall the multi-hop chain."),
  "tool-note": defineEval({
    description: "classic/tool-note: deterministic tool evidence plus recall",
    async test(t) {
      const turn = await t.send("Write a memory note, then recall it.");
      await turn.succeeded().orStop();
      turn.notCalledTool("forbidden_state_tool").label("Forbidden state tool absence");
      turn.check(turn.toolCalls, toolMatch("write_note").exactly(1));
      turn.check(turn.eventOccurrences, eventMatch("message", {
        role: "assistant",
        text: includes("RECALL_OK"),
      }).exactly(1)).label("Assistant message event");
      t.check(t.reply, recallMatch());
      t.check({
        command: "pnpm test",
        exitCode: 0,
        stdout: "",
        stderr: "PASS src/example.test.ts",
      }, commandSucceeded());
    },
  }),
};
