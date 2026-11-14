#!/usr/bin/env node
// Local source candidates opt into TypeScript through the package condition.
// Published consumers execute the canonical CJS runtime.
const fromSource = import.meta.resolve("niceeval").endsWith("/src/index.ts");
if (fromSource) {
  // The project loader shares require.cache with the CLI. Keep one definition
  // graph when tsx transforms source; ESM plus require would split identities.
  const { createRequire } = await import("node:module");
  createRequire(import.meta.url)("../src/cli/bootstrap.ts");
} else {
  await import(new URL("../dist/cli/bootstrap.cjs", import.meta.url).href);
}
