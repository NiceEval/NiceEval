import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineScoreEval({
  test(t) {
    const value = t.flags.variant === "next";
    t.check(value, equals(true)).score(2).label("Changed criterion");
    t.check(true, equals(true)).score(1).label("Duplicate criterion");
    t.check(false, equals(true)).score(1).label("Duplicate criterion");
    t.check(true, equals(true)).label("Label identity");
    if (!value) t.check(true, equals(true)).label("Only baseline");
    const unlabeled = t.check(true, equals(true)).group("Unlabeled group");
    if ("key" in unlabeled) throw new Error("Assertion handles must not expose key()");
    t.check(true, equals(true)).group("Separate group").label("Label identity");
  },
});
