import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineScoreEval({
  test(t) {
    const value = t.flags.variant === "next";
    t.check(value, equals(true)).score(2).key("changed").label("Changed criterion");
    t.check(true, equals(true)).score(1).key("duplicate").label("Duplicate criterion");
    t.check(false, equals(true)).score(1).key("duplicate").label("Duplicate criterion");
    t.check(true, equals(true)).label("Label identity");
    if (!value) t.check(true, equals(true)).key("only-baseline");
    t.check(true, equals(true));
  },
});
