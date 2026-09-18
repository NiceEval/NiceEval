import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
// @use-case docs/feature/eval/use-case/eval-native-operations.md

test.concurrent("Adapter 上下文推导保留方法和 Post 类型并拒绝冲突与越界能力", async () => {
  await evalE2E.case("application-types", async ({ commands: { tsc } }) => {
    const result = await tsc.run([
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
      "--skipLibCheck", "--types", "node", "fixtures/application-types.ts",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
