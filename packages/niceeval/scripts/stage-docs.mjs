import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

async function files(root, dir = root, out = []) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) await files(root, path, out);
    else out.push(relative(root, path).replaceAll("\\", "/"));
  }
  return out.sort();
}

async function digest(root, list) {
  const hash = createHash("sha256");
  for (const path of list) hash.update(path).update("\0").update(await readFile(join(root, path))).update("\0");
  return hash.digest("hex");
}

for (const subtree of ["zh", "images"]) {
  const source = join(repoRoot, "docs-site", subtree);
  const target = join(packageRoot, "docs-site", subtree);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  const [sourceFiles, targetFiles] = await Promise.all([files(source), files(target)]);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) throw new Error(`docs staging file closure mismatch: ${subtree}`);
  const [sourceDigest, targetDigest] = await Promise.all([digest(source, sourceFiles), digest(target, targetFiles)]);
  if (sourceDigest !== targetDigest) throw new Error(`docs staging content mismatch: ${subtree}`);
  console.log(`staged docs-site/${subtree}: ${sourceFiles.length} files sha256=${sourceDigest}`);
}
