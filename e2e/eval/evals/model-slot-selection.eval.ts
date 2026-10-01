import { equals } from "niceeval/expect";
import { modelSlots } from "../fixtures/model-slots.ts";

export default modelSlots.defineEval({
  description: "Read one immutable canonical selection and its default aliases",
  test(t) {
    const first = t.selection();
    const second = t.selection();
    t.check(first.sameSelection && second.sameSelection && first.models === second.models, equals(true)).gate();
    t.check(first.frozen, equals(true)).gate();
    t.check(first.keys, equals([...first.keys].sort())).gate();
    t.check(first.model, equals(first.models.default?.model ?? null)).gate();
    t.check(first.reasoningEffort, equals(first.models.default?.reasoningEffort ?? null)).gate();
    t.check(t.model ?? null, equals(first.model)).gate();
    t.check(t.reasoningEffort ?? null, equals(first.reasoningEffort)).gate();
    // An unattributed observation makes the ledger available without inventing a default reference.
    t.record({ callId: "unattributed", provider: null, model: null, status: "succeeded", inputTokens: 0, outputTokens: 0 });
    t.record({ callId: "explicit-null", modelSlot: null, provider: null, model: null, status: "succeeded", inputTokens: 0, outputTokens: 0 });
    t.finishUsage();
  },
});
