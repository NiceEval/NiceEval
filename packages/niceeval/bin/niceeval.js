#!/usr/bin/env node
// Local source candidates opt into TypeScript through the package condition.
// Published consumers load the same ESM graph through Node require(esm).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fromSource = import.meta.resolve("niceeval").endsWith("/src/index.ts");
if (fromSource) {
  // The source runner keeps Node require(esm) and dynamic import on one graph.
  // A CommonJS TypeScript transform hook would split their definition identity.
  require("../src/cli/bootstrap.ts");
} else {
  require("../dist/cli/bootstrap.js");
}
