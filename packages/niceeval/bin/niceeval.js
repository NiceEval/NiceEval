#!/usr/bin/env node
import { createRequire } from "node:module";

function isOlderThan(version, minimum) {
  const versionParts = version.split(".").map(Number);
  for (const [index, part] of minimum.split(".").entries()) {
    const difference = versionParts[index] - Number(part);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

const require = createRequire(import.meta.url);
const requiredNode = require("../package.json").engines.node;
const { node, bun } = process.versions;

// Check the package's >=X.Y.Z engine requirement before loading the CLI graph.
if (bun || isOlderThan(node, requiredNode.slice(2))) {
  const runtime = bun ? `Bun ${bun}` : `Node.js ${node}`;
  process.stderr.write(
    `niceeval error: NiceEval requires Node.js ${requiredNode} (running on ${runtime}).\n` +
      "Run with a supported Node.js installation: node ./node_modules/niceeval/bin/niceeval.js --help\n",
  );
  process.exitCode = 1;
} else {
  const fromSource = import.meta.resolve("niceeval").endsWith("/src/index.ts");
  if (fromSource) {
    // The source runner keeps Node require(esm) and dynamic import on one graph.
    // A CommonJS TypeScript transform hook would split their definition identity.
    require("../src/cli/bootstrap.ts");
  } else {
    require("../dist/cli/bootstrap.js");
  }
}
