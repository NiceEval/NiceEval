import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

function frozen(value: unknown): boolean {
  return value === null || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(frozen));
}
export default defineEval({
  async test(t) {
    const ordinary = await t.send("ordinary");
    t.check(ordinary.inputRequests, equals([]));
    t.check(frozen(ordinary.inputRequests), equals(true));
    const turn = await t.send("requests");
    t.check(
      turn.inputRequests.map((request) => request.id),
      equals(["second", "first"]),
    );
    t.check(
      turn.inputRequests,
      equals(turn.events.flatMap((event) => (event.type === "input.requested" ? [event.request] : []))),
    );
    t.check(frozen(turn.inputRequests), equals(true));
    t.check(t.requireInputRequest({ id: "second" }).prompt, equals("first in stream"));
    const resumed = await t.respond(...turn.inputRequests.map((request) => ({ request, optionId: "approve" })));
    t.check(resumed.reply, equals("second,first"));
    t.check(resumed.inputRequests, equals([]));
    t.check(
      turn.inputRequests.map((request) => request.id),
      equals(["second", "first"]),
    );
    const branch = t.newSession();
    const branchTurn = await branch.send("requests");
    t.check(branchTurn.inputRequests.length, equals(2));
    await branch.respondAll("approve");
  },
});
