import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";

export default defineEval({
  description: "制造合法但超过 Assertions document 总预算的 display framing",
  async test(t) {
    const label = "界".repeat(256);
    for (let index = 0; index < 4_096; index += 1) {
      t.check(true, isTrue(`assertion-${index}`)).label(label);
    }
  },
});
