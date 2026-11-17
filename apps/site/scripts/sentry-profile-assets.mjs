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

// Run inside Next before the provider's onBuildComplete asset snapshot.
export async function writeProfileManifests(distDir, release) {
  if ((process.env.CI || process.env.VERCEL_ENV === "production") && !/^site@[a-f0-9]{40}$/.test(release))
    throw new Error("Official profile manifest requires the deployment Git SHA release");
  const browserKey = /^site@([a-f0-9]{40})$/.exec(release)?.[1] ?? "local";
  for (const [root, prefix, target] of [
    [join(distDir, "static"), "/_next/static", join(distDir, "static/sentry-profile-assets", `${browserKey}.json`)],
    [join(distDir, "server"), ".next/server", join(distDir, "server/sentry-profile-assets.json")],
  ]) {
    const manifest = await generateManifest(root, prefix, release);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(manifest));
    console.log(`Profile manifest before provider collection: ${Object.keys(manifest.files).length} artifacts`);
  }
  // Turbopack emits NFT during compilation, before this manifest exists.
  // Preserve the existing explicit membership update, before the provider consumes NFT.
  async function includeManifest(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await includeManifest(path);
      else if (entry.name.endsWith(".nft.json")) {
        const trace = JSON.parse(await readFile(path, "utf8"));
        const file = relative(dirname(path), join(distDir, "server/sentry-profile-assets.json"));
        if (!trace.files.includes(file)) {
          trace.files.push(file);
          delete trace.fileHashes;
          await writeFile(path, JSON.stringify(trace));
        }
      }
    }
  }
  await includeManifest(join(distDir, "server"));
}
