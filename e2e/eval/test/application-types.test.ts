import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

test.concurrent("应用上下文推导保留方法和 Post 类型并拒绝冲突与越界能力 [necase_EKGS6P7K8JZTF1TX]", async () => {
  await evalE2E.case("application-types", async ({ commands: { tsc } }) => {
    const result = await tsc.run([
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
      "--skipLibCheck", "--types", "node", "fixtures/application-types.ts",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
