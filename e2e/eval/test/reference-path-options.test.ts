import { referencesAnyPath } from "niceeval/expect";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/assertions/README.md
test.concurrent("路径匹配显式忽略 Unicode 简单大小写并保持默认匹配身份", async () => {
  expect(() => referencesAnyPath(["secrets", "ſecrets"], { ignoreCase: true })).toThrow(TypeError);
  expect(() => referencesAnyPath(["σ", "ς"], { ignoreCase: true })).toThrow(TypeError);
  expect(() => referencesAnyPath(["a"], { unknown: true } as never)).toThrow(TypeError);
  expect(() => referencesAnyPath(["a"], { ignoreCase: "yes" } as never)).toThrow(TypeError);
  expect(() => referencesAnyPath(["secrets", "ſecrets"])).not.toThrow();
  expect(referencesAnyPath(["a"], { ignoreCase: true }).name).not.toBe(referencesAnyPath(["a"]).name);
  await evalE2E.case("reference-path-options", async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "reference-path-options", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(
      only(run.expEvalEvents(), (event) => event.evalId === "reference-path-options", run.diagnostic()).verdict,
    ).toBe("passed");
  });
});
