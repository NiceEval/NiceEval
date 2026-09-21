import { defineScoreEval } from "niceeval";

export default defineScoreEval({
  description: "Short execution errors preserve their explanation before a code token",
  test() {
    throw new Error("Missing API_KEY; configure the provider before running");
  },
});
