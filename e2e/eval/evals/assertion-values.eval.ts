import { defineEval } from "niceeval";
import {
  and,
  defineScoreMatch,
  defineValueMatch,
  equals,
  excludes,
  hasSections,
  includes,
  includesUrl,
  isDefined,
  isFalse,
  isTrue,
  jsonMatch,
  matches,
  not,
  or,
  pattern,
  satisfies,
  similarity,
} from "niceeval/expect";

const valueDataSchema = {
  "~standard": {
    version: 1,
    vendor: "niceeval-e2e",
    validate(value: unknown) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "fixture" in value &&
        value.fixture === "assertion-values"
      ) {
        return { value };
      }

      return {
        issues: [
          { message: "fixture must equal assertion-values", path: ["fixture"] },
        ],
      };
    },
  },
} as const;

export default defineEval({
  description: "确定性回复上的值 Match 与已登记 Assertion",
  async test(t) {
    const turn = await t.send("assertion/values");
    await turn.succeeded().orStop();

    await t.group("值 matcher", async () => {
      turn.usedNoTools();
      t.check(turn.data, equals({ fixture: "assertion-values", ok: true }));
      t.check(turn.data, matches(valueDataSchema));
      t.check(turn.message, includes("assertion-values-marker"));
      t.check(turn.message, excludes("forbidden-marker"));
      t.check(turn.message, pattern(/assertion-values-marker/u));
      t.check(
        turn.message,
        and(
          includes("assertion-values-marker"),
          not(includes("forbidden-marker")),
        ),
      );
      t.check(
        turn.message,
        or(includes("missing-alternative"), includes("assertion-values-marker")),
      );
      t.check(turn.message, includesUrl(2));
      t.check(turn.message, hasSections(2));
      t.check(
        turn.data!,
        jsonMatch({ fixture: "assertion-values", ok: true }),
      );
      t.check(
        "stable fixture text",
        similarity("stable fixture text").atLeast(1),
      );
      t.check(
        "// ignored\nconst live = true",
        includes("const live", { stripComments: true }),
      );
      t.check(
        "// forbidden\nconst live = true",
        excludes("forbidden", { stripComments: true }),
      );
      t.check(
        ["a", "b"],
        satisfies(
          "two values",
          (value) => Array.isArray(value) && value.length === 2,
        ),
      );
      t.check(
        "custom-value",
        defineValueMatch<string>({
          name: "custom value matcher",
          evaluate: (value) => value === "custom-value",
        }),
      );
      t.check(turn.data, isDefined("fixture data"));
      t.check(true, isTrue("explicit true"));
      t.check(false, isFalse("explicit false"));
      t.check(
        { one: { two: { three: { four: { five: { six: { seven: { eight: { nine: true } } } } } } } } },
        isDefined("deep fixture data"),
      );
      t.check(
        4,
        defineScoreMatch({
          name: "even fixture",
          score: (value) => (value === 4 ? 1 : 0),
        }).atLeast(1),
      );
      await t.check(turn.data, isDefined("required fixture data")).orStop();
    });
  },
});
