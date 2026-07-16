import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mintCache = join(homedir(), ".mintlify", "mint");
const versionMarker = join(mintCache, "mint-version.txt");
const previewBuild = join(mintCache, "apps", "client", ".next", "required-server-files.json");

// Mintlify stores the separately downloaded preview client in ~/.mintlify. An interrupted or
// concurrent download can leave the version marker behind without the Next.js build; the CLI
// then skips downloading and fails with "Client not built". Remove only that invalid managed
// cache so the normal `mint dev` update path can install it again.
if (existsSync(versionMarker) && !existsSync(previewBuild)) {
  console.warn(`Mintlify preview cache is incomplete; rebuilding ${mintCache}`);
  rmSync(mintCache, { recursive: true, force: true });
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--") forwardedArgs.shift();

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const currentNodeIsSupported =
  (nodeMajor === 20 && nodeMinor >= 17) || (nodeMajor > 20 && nodeMajor < 25);
const childEnv = { ...process.env };

if (!currentNodeIsSupported) {
  const nodeExecutable = process.platform === "win32" ? "node.exe" : "node";
  const supportedNodeBin = [
    process.env.NICEEVAL_DOCS_NODE_BIN,
    "/opt/homebrew/opt/node@22/bin",
    "/usr/local/opt/node@22/bin",
  ].find((candidate) => candidate && existsSync(join(candidate, nodeExecutable)));

  if (!supportedNodeBin) {
    console.error(
      `Mintlify requires Node >=20.17 and <25; current version is ${process.versions.node}. ` +
        "Install Node 22 or set NICEEVAL_DOCS_NODE_BIN to its bin directory.",
    );
    process.exit(1);
  }

  console.warn(`Mintlify does not support Node ${process.versions.node}; using ${supportedNodeBin}`);
  childEnv.PATH = `${supportedNodeBin}${delimiter}${childEnv.PATH ?? ""}`;
}

const child = spawn(command, ["--yes", "mint@latest", "dev", ...forwardedArgs], {
  cwd: join(repoRoot, "docs-site"),
  env: childEnv,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start Mintlify: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
