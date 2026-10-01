import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/assertions/README.md
// @regression memory/readonly-material-recursive-json.md
test.concurrent("安装后递归材料类型可编译并保持深只读与受管集合语义", async () => {
  await evalE2E.case("recursive-material-types", async ({ commands: { tsc } }) => {
    const result = await tsc.run([
      "--noEmit", "--strict", "--target", "ES2024", "--module", "NodeNext",
      "--skipLibCheck", "--allowImportingTsExtensions", "--types", "node", "fixtures/recursive-material-types.ts",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
