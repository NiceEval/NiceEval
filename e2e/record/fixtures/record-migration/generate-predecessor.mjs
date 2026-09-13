import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => {
  if (!value.startsWith("--") || values[index + 1]?.startsWith("--")) return [value, true];
  return [value, values[index + 1]];
}).filter(([key]) => typeof key === "string" && key.startsWith("--")));

const sourceVersion = args["--source"];
const candidateArgument = args["--candidate"];
const outputArgument = args["--out"];
if ((sourceVersion !== "0.15" && sourceVersion !== "0.16" && sourceVersion !== "0.17") ||
    typeof candidateArgument !== "string" || typeof outputArgument !== "string") {
  throw new Error("usage: node generate-predecessor.mjs --source 0.15|0.16|0.17 --candidate <tgz> --out <new-bundle-dir>");
}

const candidate = resolve(candidateArgument);
const output = resolve(outputArgument);
if (!(await stat(candidate)).isFile()) throw new Error(`candidate is not a file: ${candidate}`);
try {
  await stat(output);
  throw new Error(`output already exists: ${output}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const root = dirname(new URL(import.meta.url).pathname);
const source = join(root, "producer", sourceVersion === "0.17" ? "0.15" : sourceVersion);
const project = join(output, "producer-project");
await mkdir(output, { recursive: true });
await cp(source, project, { recursive: true, errorOnExist: true });
await writeFile(join(project, "package.json"), `${JSON.stringify({
  name: `niceeval-record-predecessor-${sourceVersion}`,
  private: true,
  type: "module",
  packageManager: "pnpm@11.18.0",
  dependencies: { niceeval: `file:${candidate}` },
}, null, 2)}\n`, "utf8");

const environment = { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: "0" };
await execFileAsync("pnpm", ["install", "--ignore-scripts", "--no-frozen-lockfile"], {
  cwd: project,
  env: environment,
  maxBuffer: 16 * 1024 * 1024,
});

const experiments = sourceVersion === "0.16"
  ? ["migration-agent", "migration-custom"]
  : ["migration-agent"];
const receipts = [];
for (const experiment of experiments) {
  const invocation = await execFileAsync(
    "pnpm",
    ["--silent", "exec", "niceeval", "exp", experiment, "--rerun", "all", "--json"],
    { cwd: project, env: environment, maxBuffer: 16 * 1024 * 1024 },
  );
  receipts.push({ experiment, stdout: invocation.stdout, stderr: invocation.stderr });
}
const runList = await execFileAsync(
  "pnpm",
  ["--silent", "exec", "niceeval", "run", "list", "--json"],
  { cwd: project, env: environment, maxBuffer: 16 * 1024 * 1024 },
);

const candidateBytes = await readFile(candidate);
const digest = createHash("sha256").update(candidateBytes).digest("hex");
const bundle = join(output, "bundle");
await mkdir(bundle, { recursive: true });
await cp(join(project, ".niceeval", "record.sqlite"), join(bundle, "record.sqlite"), {
  errorOnExist: true,
});
await writeFile(join(bundle, "run-list.json"), runList.stdout, "utf8");
await writeFile(join(bundle, "producer.json"), `${JSON.stringify({
  sourceVersion,
  candidate: basename(candidate),
  candidateSha256: digest,
  commands: experiments.map((experiment) => [
    "pnpm", "--silent", "exec", "niceeval", "exp", experiment, "--rerun", "all", "--json",
  ]),
  receipts,
}, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ sourceVersion, candidateSha256: digest, output: bundle })}\n`);
