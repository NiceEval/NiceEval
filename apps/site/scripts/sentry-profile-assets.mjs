import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { parse } from "acorn";

export function identifiers(source) {
  const symbols = new Set();
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") symbols.add(node.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(tree);
  return [...symbols].sort();
}

export async function generateManifest(root, prefix, release) {
  const files = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.[cm]?js$/.test(entry.name))
        files[`${prefix}/${relative(root, path).split("\\").join("/")}`] = identifiers(await readFile(path, "utf8"));
    }
  }
  await walk(root);
  if (!Object.keys(files).length) throw new Error("Profile manifest requires actual JavaScript artifacts");
  return { release, files };
}

if (process.argv[1]?.endsWith("sentry-profile-assets.mjs")) {
  const release =
    process.env.SENTRY_RELEASE ||
    (process.env.VERCEL_GIT_COMMIT_SHA ? `site@${process.env.VERCEL_GIT_COMMIT_SHA}` : "");
  if ((process.env.CI || process.env.VERCEL_ENV === "production") && !/^site@[a-f0-9]{40}$/.test(release))
    throw new Error("Official profile manifest requires the deployment Git SHA release");
  for (const [root, prefix, target] of [
    [".next/static", "/_next/static", ".next/static/sentry-profile-assets.json"],
    [".next/server", ".next/server", ".next/server/sentry-profile-assets.json"],
  ]) {
    const manifest = await generateManifest(root, prefix, release);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(manifest));
    console.log(`Profile manifest: ${Object.keys(manifest.files).length} artifacts`);
  }
  // Post-build files must enter the same deployment traces (never a separate release).
  async function includeManifest(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await includeManifest(path);
      else if (entry.name.endsWith(".nft.json")) {
        const trace = JSON.parse(await readFile(path, "utf8"));
        const file = relative(dirname(path), ".next/server/sentry-profile-assets.json");
        if (!trace.files.includes(file)) {
          trace.files.push(file);
          // NFT hashes are optional; post-build membership invalidates the old parallel list.
          delete trace.fileHashes;
          await writeFile(path, JSON.stringify(trace));
        }
      }
    }
  }
  await includeManifest(".next/server");
}
