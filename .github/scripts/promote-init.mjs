import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateInitGuide as validateGuide } from "../../packages/niceeval/scripts/package-runtime/check-ai-docs.mjs";

const root = process.cwd();
const guidePath = "apps/site/stable/INIT.md";
const manifestPath = "apps/site/stable/INIT.json";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Not a stable SemVer: ${version}`);
  return version.split(".").map(BigInt);
}
function compare(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
async function current() {
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
  versionParts(manifest.version);
  if (manifest.tag !== `v${manifest.version}` || !/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error("Invalid stable INIT manifest");
  const guide = await readFile(resolve(root, guidePath), "utf8");
  validateGuide(guide);
  if (hash(guide) !== manifest.sha256) throw new Error("Stable INIT.md SHA-256 differs from INIT.json");
  return { manifest, guide };
}

const mode = process.argv[2];
if (mode === "--check") {
  await current();
  validateGuide(await readFile(resolve(root, "INIT.md"), "utf8"));
  console.log("Stable INIT manifest and candidate guide verified.");
} else if (mode === "--promote") {
  const tag = process.argv[3];
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag ?? "")) {
    console.log("Prerelease/canary does not promote INIT.md.");
    process.exit(0);
  }
  const verificationUrl = process.env.INIT_VERIFY_URL ?? "https://niceeval.com/INIT.md";
  const timeoutMs = Number(process.env.INIT_VERIFY_TIMEOUT_MS ?? 600000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 600000) throw new Error("Invalid INIT verification timeout");
  const version = tag.slice(1);
  const commit = git("rev-parse", `${tag}^{commit}`);
  // Preserve bytes: trimming Git output would change the published content hash.
  const guide = execFileSync("git", ["show", `${commit}:INIT.md`], { cwd: root, encoding: "utf8" });
  validateGuide(guide);
  const manifest = { version, tag, commit, sha256: hash(guide) };
  let previous;
  let promoted = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    git("fetch", "origin", "main");
    // Workflow owns this isolated checkout. Never discard unrelated working files.
    git("switch", "--detach", "origin/main");
    previous = await current();
    if (compare(version, previous.manifest.version) <= 0) {
      console.log(`INIT already at ${previous.manifest.version}; no promotion needed.`);
      process.exit(0);
    }
    await writeFile(guidePath, guide);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    git("add", "--", guidePath, manifestPath);
    git("commit", "-m", `docs: promote stable INIT from ${tag}`, "--", guidePath, manifestPath);
    try { git("push", "origin", "HEAD:main"); promoted = true; break; }
    catch { /* Read the winning version again; a later stable release must win. */ }
  }
  if (!promoted) throw new Error("Stable INIT promotion exhausted push attempts");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${verificationUrl}${verificationUrl.includes("?") ? "&" : "?"}sha256=${manifest.sha256}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === manifest.sha256) {
        console.log(`Verified https://niceeval.com/INIT.md sha256=${manifest.sha256}`);
        process.exit(0);
      }
    } catch { /* Deployment and HTTP errors remain bounded by the deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Math.max(0, deadline - Date.now()))));
  }
  // Revert only our exact publication; never overwrite a newer promotion.
  for (let attempt = 0; attempt < 8; attempt++) {
    git("fetch", "origin", "main");
    git("switch", "--detach", "origin/main");
    const latest = (await current()).manifest;
    if (latest.sha256 !== manifest.sha256 || latest.version !== version || latest.commit !== commit) break;
    await writeFile(guidePath, previous.guide);
    await writeFile(manifestPath, `${JSON.stringify(previous.manifest, null, 2)}\n`);
    git("add", "--", guidePath, manifestPath);
    git("commit", "-m", `docs: retain previous stable INIT after failed ${tag} verification`, "--", guidePath, manifestPath);
    try { git("push", "origin", "HEAD:main"); break; }
    catch { /* Recheck the current publication before retrying the rollback. */ }
  }
  throw new Error("Stable INIT website hash did not match before deployment deadline");
} else {
  throw new Error("Usage: node .github/scripts/promote-init.mjs --check | --promote vX.Y.Z");
}
