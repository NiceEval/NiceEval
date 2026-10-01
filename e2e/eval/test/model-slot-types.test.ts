import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("安装后类型支持三用途配置与可空物理关联并拒绝修改冻结选择", async () => {
  await evalE2E.case("model-slot-types", async ({ commands: { tsc } }) => {
    const result = await tsc.run([
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
      "--skipLibCheck", "--allowImportingTsExtensions", "--types", "node", "fixtures/model-slot-types.ts",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
