import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

function recallEval(topic: string, prompt: string) {
  return defineEval({
    description: `classic/${topic}: deterministic MemoryBench-like recall`,
    async test(t) {
      const turn = await t.send(prompt);
      await turn.succeeded().orStop();
      t.check(t.reply, includes("RECALL_OK"));
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
      turn.calledTool("write_note", { count: 1 });
      t.check(t.reply, includes("RECALL_OK"));
    },
  }),
};
