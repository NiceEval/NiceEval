import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
// Development builds have no release tag. Pin their examples to this checkout's
// immutable commit rather than manufacturing a nonexistent development tag.
const revision = version === "0.0.0-development"
  ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim()
  : `v${version}`;
if (version === "0.0.0-development" && !/^[a-f0-9]{40}$/u.test(revision)) throw new Error("Invalid development documentation revision");

function bundledContent(path, bytes) {
  if (!/\.mdx?$/u.test(path)) return bytes;
  const text = bytes.toString("utf8")
    .replaceAll("https://github.com/CorrectRoadH/niceeval", "https://github.com/NiceEval/NiceEval")
    .replace(/https:\/\/github\.com\/NiceEval\/NiceEval\/(?:blob|tree|raw)\/main\/examples\//giu,
      `https://github.com/NiceEval/NiceEval/tree/${revision}/examples/`);
  if (/https:\/\/(?:github\.com\/[^/\s]+\/niceeval\/(?:blob|tree|raw)\/main(?:\/|\b)|raw\.githubusercontent\.com\/[^/\s]+\/niceeval\/main(?:\/|\b))/iu.test(text)) {
    throw new Error(`Bundled documentation must not link to repository main: ${path}`);
  }
  return Buffer.from(text);
}

async function files(root, dir = root, out = []) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) await files(root, path, out);
    else out.push(relative(root, path).replaceAll("\\", "/"));
  }
  return out.sort();
}

async function digest(root, list, transform = (_path, bytes) => bytes) {
  const hash = createHash("sha256");
  for (const path of list) hash.update(path).update("\0").update(transform(path, await readFile(join(root, path)))).update("\0");
  return hash.digest("hex");
}

for (const subtree of ["zh", "images"]) {
  const source = join(repoRoot, "apps", "docs-site", subtree);
  const target = join(packageRoot, "docs-site", subtree);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  const [sourceFiles, targetFiles] = await Promise.all([files(source), files(target)]);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) throw new Error(`docs staging file closure mismatch: ${subtree}`);
  if (subtree === "zh") {
    for (const path of targetFiles) {
      const targetPath = join(target, path);
      await writeFile(targetPath, bundledContent(path, await readFile(targetPath)));
    }
  }
  const [sourceDigest, targetDigest] = await Promise.all([digest(source, sourceFiles, subtree === "zh" ? bundledContent : undefined), digest(target, targetFiles)]);
  if (sourceDigest !== targetDigest) throw new Error(`docs staging content mismatch: ${subtree}`);
  console.log(`staged docs-site/${subtree}: ${sourceFiles.length} files sha256=${sourceDigest}`);
}
