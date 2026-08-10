import { defineEval } from "niceeval";
import {
  equals,
  excludes,
  hasSections,
  includes,
  includesUrl,
  isDefined,
  isFalse,
  isTrue,
  makeAssertion,
  matches,
  satisfies,
  similarity,
} from "niceeval/expect";

const valueDataSchema = {
  safeParse(value: unknown) {
    return {
      success:
        value !== null &&
        typeof value === "object" &&
        (value as { fixture?: unknown }).fixture === "assertion-values",
      data: value,
    };
  },
};

export default defineEval({
  description: "确定性回复上的值 matcher 与通过制句柄修饰符",
  async test(t) {
    const turn = await t.send("assertion/values");
    await turn.succeeded().gate().stopOnFailure();

    await t.group("值 matcher", async () => {
      turn.usedNoTools();
      turn.outputEquals({ fixture: "assertion-values", ok: true });
      turn.outputMatches(valueDataSchema);
      t.check(turn.message, includes("assertion-values-marker"));
      t.check(turn.message, excludes("forbidden-marker"));
      t.check(turn.message, includesUrl(2));
      t.check(turn.message, hasSections(2));
      t.check(turn.data, equals({ fixture: "assertion-values", ok: true }));
      t.check(turn.data, matches(valueDataSchema));
      t.check("stable fixture text", similarity("stable fixture text").gate(1));
      t.check("// ignored\nconst live = true", includes("const live", { stripComments: true }));
      t.check("// forbidden\nconst live = true", excludes("forbidden", { stripComments: true }));
      t.check(["a", "b"], satisfies((value) => Array.isArray(value) && value.length === 2, "two values"));
      t.check(turn.data, isDefined("fixture data"));
      t.check(true, isTrue("explicit true"));
      t.check(false, isFalse("explicit false"));
      t.check(4, makeAssertion({ name: "even fixture", score: (value) => value === 4 ? 1 : 0 }));
      await t.require(turn.data, isDefined("required fixture data"));
    });

    await t.group("通过制句柄修饰", () => {
      t.messageIncludes("assertion-values-marker").atLeast(1);
      t.messageIncludes("assertion-values-marker").soft();
      t.messageIncludes("assertion-values-marker").optional();
    });
  },
});
