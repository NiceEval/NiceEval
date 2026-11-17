// Run after a real Next build with the hosting provider's NEXT_ADAPTER_PATH.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { identifiers } from "./sentry-profile-assets.mjs";

const output = resolve(process.argv[2] || ".next/output");
const serverBytes = await readFile(".next/server/sentry-profile-assets.json", "utf8");
const server = JSON.parse(serverBytes);
assert.match(server.release, /^site@[a-f0-9]{40}$/);
const url = `/_next/static/sentry-profile-assets/${server.release.slice(5)}.json`;
const browserBytes = await readFile(join(output, "static", url), "utf8");
assert.equal(
  browserBytes,
  await readFile(`.next/static/sentry-profile-assets/${server.release.slice(5)}.json`, "utf8"),
);
const browser = JSON.parse(browserBytes);
assert.deepEqual(Object.keys(browser).sort(), ["files", "release"]);
assert.equal(browser.release, server.release);
assert.ok(Object.keys(browser.files).length);
for (const [path, symbols] of Object.entries(browser.files)) {
  assert.ok(path.startsWith("/_next/static/") && !path.includes("..") && /\.[cm]?js$/.test(path));
  // Compare against provider-owned JS, not the pre-packaging build directory.
  assert.deepEqual(symbols, identifiers(await readFile(join(output, "static", path), "utf8")), path);
}
const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
assert.equal(config.version, 3);
assert.ok(config.routes.some((route) => route.handle === "filesystem"));
const functionManifests = [];
async function checkFunctions(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (!entry.name.endsWith(".func")) {
      await checkFunctions(path);
      continue;
    }
    const fn = JSON.parse(await readFile(join(path, ".vc-config.json"), "utf8"));
    if (!fn.runtime?.startsWith("nodejs")) continue;
    // Vercel's adapter emits references; the provider resolves these from repoRoot.
    const source = fn.filePathMap?.["apps/site/.next/server/sentry-profile-assets.json"];
    assert.equal(typeof source, "string", `Private server manifest missing from ${path}`);
    assert.equal(await readFile(resolve("../..", source), "utf8"), serverBytes);
    functionManifests.push(path);
  }
}
await checkFunctions(join(output, "functions"));
assert.ok(functionManifests.length);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      output,
      url,
      release: browser.release,
      browserArtifacts: Object.keys(browser.files).length,
      privateNodeFunctions: functionManifests.length,
      providerBytesAndASTMatch: true,
      buildOutputVersion: config.version,
    },
    null,
    2,
  ),
);
