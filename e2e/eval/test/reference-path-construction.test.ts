import { referencesAnyPath } from "niceeval/expect";
import { expect, test } from "vitest";

// @feature docs/feature/assertions/README.md
test.concurrent.each(["secrets/**", "secret?.key"])("路径禁区拒绝不受支持的 glob：%s", (path) => {
  expect(() => referencesAnyPath([path])).toThrow(TypeError);
  expect(() => referencesAnyPath([path])).toThrow(/glob.*directory/iu);
  expect(() => referencesAnyPath([".env", "secrets"])).not.toThrow();
});
