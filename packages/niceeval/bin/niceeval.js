#!/usr/bin/env node
// Local source candidates opt into TypeScript through the package condition.
// Published consumers load the same ESM graph through Node require(esm).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fromSource = import.meta.resolve("niceeval").endsWith("/src/index.ts");
if (fromSource) {
  // The project loader shares require.cache with the CLI. Keep one definition
  // graph when tsx transforms source; ESM plus require would split identities.
  require("../src/cli/bootstrap.ts");
} else {
  require("../dist/cli/bootstrap.js");
}
