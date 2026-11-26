import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { setTimeout } from "node:timers/promises";

const origin = "http://127.0.0.1:3000";

for (let attempt = 0; ; attempt++) {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    await response.body.cancel();
    break;
  } catch (error) {
    if (attempt === 29) throw error;
    await setTimeout(1000);
  }
}

for (const path of ["/zh", "/INIT.md", "/robots.txt"]) {
  const response = await fetch(new URL(path, origin), { redirect: "manual" });
  assert.equal(response.status, 200, path);
  if (path === "/INIT.md") assert.match(response.headers.get("content-type") ?? "", /^text\/markdown\b/);
  await response.body.cancel();
}

const response = await new Promise((resolve, reject) => {
  request(`${origin}/docs/quickstart?from=smoke`, { headers: { Host: "www.niceeval.com" } }, resolve)
    .on("error", reject)
    .end();
});
response.resume();
assert.equal(response.statusCode, 308);
assert.equal(response.headers.location, "https://niceeval.com/docs/quickstart?from=smoke");

const { rewrites } = JSON.parse(await readFile("apps/site/.next/routes-manifest.json", "utf8"));
const destinations = rewrites.afterFiles.filter(({ destination }) => destination.startsWith("https://"));
assert.deepEqual(
  destinations.map(({ source, destination }) => [source, destination]),
  [
    ["/llms-full.txt", "https://niceeval.mintlify.site/docs/llms-full.txt"],
    ["/docs", "https://niceeval.mintlify.site/docs"],
    ["/docs/:match*", "https://niceeval.mintlify.site/docs/:match*"],
    ["/showcase/memory", "https://coding-agent-memory-evals.vercel.app"],
    ["/showcase/memory/:match*", "https://coding-agent-memory-evals.vercel.app/:match*"],
    ["/showcase/terminal-bench", "https://terminal-bench-gray.vercel.app"],
    ["/showcase/terminal-bench/:match*", "https://terminal-bench-gray.vercel.app/:match*"],
  ],
);
