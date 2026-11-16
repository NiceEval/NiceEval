import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/assertions/README.md
test.concurrent("数值单位保留运行时身份并拒绝非法数值与混合分位样本", async () => {
  await evalE2E.case("numeric-units", async ({ paths }) => {
    const result = await command([process.execPath]).run(
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { ms, seconds, tokens, usd, ratio, count, bytes, measured, quantile, between } from "niceeval/expect";
      for (const [make, unit] of [[ms,"ms"],[seconds,"seconds"],[tokens,"tokens"],[usd,"usd"],[ratio,"ratio"],[count,"count"],[bytes,"bytes"]]) {
        const value = make(0.5);
        assert.deepEqual(value, { value: 0.5, unit });
        assert.ok(Object.isFrozen(value));
        assert.throws(() => make(Infinity), RangeError);
        assert.throws(() => make(NaN), RangeError);
        assert.deepEqual(measured(value, { unavailable: "missing" }), { state: "exact", value: 0.5, unit });
      }
      assert.throws(() => ratio(-0.01), RangeError);
      assert.throws(() => ratio(1.01), RangeError);
      assert.equal(quantile([ms(1), ms(3)], 0.5).unit, "ms");
      assert.equal(quantile([ms(1), ms(3)], 0.5).value, 2);
      assert.throws(() => quantile([ms(1), seconds(1)], 0.5), TypeError);
      assert.throws(() => quantile([ms(1), 1], 0.5), TypeError);
      assert.throws(() => quantile([NaN, ms(1)], 0.5), TypeError);
      assert.equal(quantile([null, 1], 0.5).reason, "non-finite-sample");
      assert.equal(quantile([null, ms(1)], 0.5).unit, "ms");
      assert.throws(() => between(ms(1), seconds(2)), TypeError);
      assert.throws(() => between(ms(1), 2), TypeError);
      assert.throws(() => between(ms(2), ms(1)), RangeError);
    `,
      ],
      { cwd: paths.projectRoot },
    );
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});

// @feature docs/feature/assertions/README.md
test.concurrent("安装后 ESM/CJS 类型检查拒绝跨单位与无单位阈值", async () => {
  await evalE2E.case("numeric-unit-types", async ({ commands: { tsc } }) => {
    const result = await tsc.run([
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--skipLibCheck",
      "--allowImportingTsExtensions",
      "--types",
      "node",
      "fixtures/numeric-unit-types.mts",
      "fixtures/numeric-unit-types.cts",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
