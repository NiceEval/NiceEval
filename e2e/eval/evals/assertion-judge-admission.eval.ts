import { defineJudge } from "niceeval";
import { equals } from "niceeval/expect";
import { markerApplication } from "./assertion-judge-fake.eval.ts";

const quality = defineJudge({ name: "admission-quality", rubric: "The text is useful.", maxMaterialBytes: 128 });
const foreign = { name: "forged-match" } as unknown as typeof quality;

export default markerApplication.defineEval({
  description: "无效 Judge 材料与伪造 Match 在登记前被拒绝",
  async test(t) {
    let accessorCalls = 0;
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const invalid = [
      undefined, [undefined], Array(1), NaN, Infinity, 1n, () => 1,
      new Date(0), cycle, "x".repeat(129),
      { get content() { accessorCalls += 1; return "not-a-snapshot"; } },
      { toJSON() { accessorCalls += 1; return "not-a-snapshot"; } },
    ];
    const rejected = invalid.map((value) => {
      try { t.check(value, quality); return false; }
      catch (error) { return error instanceof TypeError; }
    });
    const sugarRejected = invalid.map((value) => {
      try { t.judge(value, quality); return false; }
      catch (error) { return error instanceof TypeError; }
    });
    let reflected = 0;
    const material = new Proxy({}, { ownKeys() { reflected += 1; return []; } });
    let foreignRejected = false;
    try { t.check(material, foreign); }
    catch (error) { foreignRejected = error instanceof TypeError; }
    let foreignSugarRejected = false;
    try { t.judge(material, foreign); }
    catch (error) { foreignSugarRejected = error instanceof TypeError; }
    t.check({ rejected, sugarRejected, accessorCalls, reflected, foreignRejected, foreignSugarRejected }, equals({
      rejected: Array(12).fill(true), sugarRejected: Array(12).fill(true), accessorCalls: 0, reflected: 0, foreignRejected: true, foreignSugarRejected: true,
    })).gate().label("Judge admission is atomic");
  },
});
