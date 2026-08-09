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
  defineScoreMatch,
  matches,
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
  description: "确定性回复上的值 Match 与 Fact 消费",
  async test(t) {
    const turn = await t.send("assertion/values");
    await t.require(turn.succeeded());

    await t.group("值 matcher", async () => {
      t.assert(turn.usedNoTools());
      t.assert(
        t.check(turn.data, equals({ fixture: "assertion-values", ok: true })),
      );
      t.assert(t.check(turn.data, matches(valueDataSchema)));
      t.assert(t.check(turn.message, includes("assertion-values-marker")));
      t.assert(t.check(turn.message, excludes("forbidden-marker")));
      t.assert(t.check(turn.message, includesUrl(2)));
      t.assert(t.check(turn.message, hasSections(2)));
      t.assert(
        t.check("stable fixture text", similarity("stable fixture text")),
        { atLeast: 1 },
      );
      t.assert(
        t.check(
          "// ignored\nconst live = true",
          includes("const live", { stripComments: true }),
        ),
      );
      t.assert(
        t.check(
          "// forbidden\nconst live = true",
          excludes("forbidden", { stripComments: true }),
        ),
      );
      t.assert(
        t.check(
          ["a", "b"],
          satisfies(
            "two values",
            (value) => Array.isArray(value) && value.length === 2,
          ),
        ),
      );
      t.assert(t.check(turn.data, isDefined("fixture data")));
      t.assert(t.check(true, isTrue("explicit true")));
      t.assert(t.check(false, isFalse("explicit false")));
      t.assert(
        t.check(
          4,
          defineScoreMatch({
            name: "even fixture",
            score: (value) => (value === 4 ? 1 : 0),
          }),
        ),
        { atLeast: 1 },
      );
      await t.require(turn.data, isDefined("required fixture data"));
    });
  },
});
