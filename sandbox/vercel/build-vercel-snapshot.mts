// 构建 Vercel Sandbox 的预制快照:起一个 microVM,跑与 Dockerfile 等价的安装
// (codex / claude-code / bub 都装到 /usr/local/bin),snapshot 后打印 snapshotId。
//
// Vercel 没有「从 Dockerfile 构建模板」的概念,只能对运行中的 microVM 拍快照,
// 所以这里在运行时复刻 Dockerfile 的安装步骤,再 snapshot。
//
// 用法(需要 VERCEL_API_TOKEN + VERCEL_TEAM_ID [+ VERCEL_PROJECT_ID] 在环境里):
//   node --import tsx sandbox/vercel/build-vercel-snapshot.mts
//
// 输出的 snapshotId 填进 eval:
//   import { vercelSandbox } from "niceeval";
//   defineExperiment({ sandbox: vercelSandbox({ snapshotId: "snap_..." }), ... })

import { Sandbox as VSandbox } from "@vercel/sandbox";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_OVERRIDE,
  bubInstallHash,
} from "../../src/agents/bub-install-spec.ts";
import {
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
} from "../../src/agents/coding-cli-versions.ts";

const BUB_INSTALL_HASH = bubInstallHash([]);

const token = process.env.VERCEL_API_TOKEN;
const teamId = process.env.VERCEL_TEAM_ID;
const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
const credParams = token && teamId ? { token, teamId, projectId } : {};

async function run(sb: InstanceType<typeof VSandbox>, script: string, sudo = true): Promise<void> {
  const r = await sb.runCommand({ cmd: "bash", args: ["-c", script], sudo, timeoutMs: 900_000 });
  const out = (await r.stdout()) + (await r.stderr());
  if (r.exitCode !== 0) throw new Error(`安装步骤失败(exit ${r.exitCode}):\n${out.split("\n").slice(-20).join("\n")}`);
}

console.log("起 Vercel microVM…");
const sb = await VSandbox.create({ runtime: "node24", timeout: 1_200_000, ...credParams } as Parameters<typeof VSandbox.create>[0]);

console.log("装 git / curl / build-essential…");
await run(sb, "command -v git && command -v curl || (dnf install -y git curl gcc gcc-c++ make || (apt-get update && apt-get install -y git curl build-essential))");

console.log("装 codex + claude-code(npm -g → /usr/local/bin)…");
await run(
  sb,
  `npm install -g @openai/codex@${DEFAULT_CODEX_CLI_VERSION} @anthropic-ai/claude-code@${DEFAULT_CLAUDE_CODE_CLI_VERSION}`,
);

console.log("按运行时用户装 uv + bub，并写安装规格指纹…");
await run(
  sb,
  [
    "curl -LsSf https://astral.sh/uv/install.sh | sh",
    `printf '%s\\n' '${DEFAULT_BUB_OVERRIDE}' > /tmp/bub-override.txt`,
    `$HOME/.local/bin/uv tool install --python 3.12 --prerelease allow 'bub' --overrides /tmp/bub-override.txt --with '${DEFAULT_BUB_OTEL_PLUGIN}'`,
    `mkdir -p "$HOME/$(dirname '${BUB_INSTALL_MARKER}')"`,
    `printf '%s' '${BUB_INSTALL_HASH}' > "$HOME/${BUB_INSTALL_MARKER}"`,
    "rm -f /tmp/bub-override.txt",
  ].join(" && "),
  false,
);

console.log("自检三个 CLI…");
await run(sb, "command -v codex && command -v claude && test -x $HOME/.local/bin/bub", false);

console.log("拍快照…");
const snap = await sb.snapshot({ expiration: 0 });
console.log(`\n✅ snapshotId: ${snap.snapshotId}\n   用法: vercelSandbox({ snapshotId: "${snap.snapshotId}" })`);
