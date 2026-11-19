import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

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
