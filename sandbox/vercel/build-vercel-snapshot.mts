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
//   import { vercelSandbox } from "fasteval";
//   defineExperiment({ sandbox: vercelSandbox({ snapshotId: "snap_..." }), ... })

import { Sandbox as VSandbox } from "@vercel/sandbox";

// 与 src/agents/bub.ts / sandbox/docker/Dockerfile 保持一致。
const BUB_OVERRIDE = "bub @ git+https://github.com/CorrectRoadH/bub.git@fix/streaming-usage-include-usage";
const OTEL_PLUGIN =
  "git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation" +
  "#subdirectory=packages/bub-tapestore-otel";

const token = process.env.VERCEL_API_TOKEN;
const teamId = process.env.VERCEL_TEAM_ID;
const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
const credParams = token && teamId ? { token, teamId, projectId } : {};

async function run(sb: InstanceType<typeof VSandbox>, script: string): Promise<void> {
  const r = await sb.runCommand({ cmd: "bash", args: ["-c", script], sudo: true, timeoutMs: 900_000 });
  const out = (await r.stdout()) + (await r.stderr());
  if (r.exitCode !== 0) throw new Error(`安装步骤失败(exit ${r.exitCode}):\n${out.split("\n").slice(-20).join("\n")}`);
}

console.log("起 Vercel microVM…");
const sb = await VSandbox.create({ runtime: "node24", timeout: 1_200_000, ...credParams } as Parameters<typeof VSandbox.create>[0]);

console.log("装 git / curl / build-essential…");
await run(sb, "command -v git && command -v curl || (dnf install -y git curl gcc gcc-c++ make || (apt-get update && apt-get install -y git curl build-essential))");

console.log("装 codex + claude-code(npm -g → /usr/local/bin)…");
await run(sb, "npm install -g @openai/codex @anthropic-ai/claude-code");

console.log("装 uv + bub(→ /usr/local/bin)…");
await run(
  sb,
  [
    "export UV_INSTALL_DIR=/usr/local/bin UV_TOOL_BIN_DIR=/usr/local/bin UV_TOOL_DIR=/opt/uv-tools",
    "curl -LsSf https://astral.sh/uv/install.sh | sh",
    `printf '%s\\n' '${BUB_OVERRIDE}' > /tmp/bub-override.txt`,
    `uv tool install --python 3.12 --prerelease allow 'bub' --overrides /tmp/bub-override.txt --with '${OTEL_PLUGIN}'`,
    "rm -f /tmp/bub-override.txt",
  ].join(" && "),
);

console.log("自检三个 CLI…");
await run(sb, "command -v codex && command -v claude && command -v bub");

console.log("拍快照…");
const snap = await sb.snapshot();
console.log(`\n✅ snapshotId: ${snap.snapshotId}\n   用法: vercelSandbox({ snapshotId: "${snap.snapshotId}" })`);

await sb.stop();
