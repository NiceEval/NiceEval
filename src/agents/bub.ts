import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { createCheckpoint, restoreCheckpoint } from "../sandbox/checkpoint.ts";
import type { Agent, Sandbox, StreamEvent } from "../types.ts";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// bub 的 agent adapter(沙箱型)。
//
// ⚠️ 现实校正:bub 是 PyPI 上的 `bub`(alpha,Python 3.12),不是 npm 包。
//    · 安装:uv tool install bub(uv 自带 python 3.12,免 root)。
//    · 调用:bub run "<prompt>" --session-id <id> --workspace <path>
//    · 模型 + 代理:BUB_MODEL=openai:<model>、BUB_API_BASE、BUB_API_KEY。
//    · 记忆:tape(总是开),落盘在 ~/.bub/tapes/<md5(ws)[:16]>__<md5(sess)[:16]>.jsonl。
// ───────────────────────────────────────────────────────────────────────────

export interface BubConfig {
  /** OpenAI 兼容代理的 API key。省略时读 BUB_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理的 base URL。省略时读 BUB_API_BASE env。 */
  apiBase?: string;
  /**
   * 额外装进 bub tool 环境的 Python 包(pip 名或 git URL)。
   * 每个沙箱 setup 时作为 `uv tool install --with <pkg>` 追加到 bub 环境里。
   * 示例:["bub-plugin-memory", "git+https://github.com/..."]
   */
  pythonPlugins?: string[];
}

const SANDBOX_WORKSPACE = "/home/sandbox/workspace";

const UV = "$HOME/.local/bin/uv";
// bub 二进制:优先用镜像里(预制模板)烘焙在 PATH 上的 bub,否则用 uv 装到 $HOME/.local/bin 的那个。
// 预制模板把 bub 装到 /usr/local/bin(见 sandbox/docker/Dockerfile),command -v 命中即用 → 跳过安装。
const BUB = "$(command -v bub || echo $HOME/.local/bin/bub)";

const BUB_OVERRIDE = "bub @ git+https://github.com/CorrectRoadH/bub.git@fix/streaming-usage-include-usage";
const BUB_OVERRIDE_FILE = "/tmp/bub-override.txt";
const OTEL_PLUGIN =
  "git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation" +
  "#subdirectory=packages/bub-tapestore-otel";

const INSTALL_SPEC = `bub --override(${BUB_OVERRIDE}) --with ${OTEL_PLUGIN}`;
const INSTALL_HASH = createHash("md5").update(INSTALL_SPEC).digest("hex").slice(0, 12);

function diskCachePath(home: string): string {
  const homeKey = createHash("md5").update(home).digest("hex").slice(0, 8);
  return join(homedir(), ".cache", "fasteval", `bub-checkpoint-${homeKey}-${INSTALL_HASH}.bin`);
}

// in-memory checkpoint + mutex keyed by sandbox $HOME,
// so Docker(/home/node)と Vercel(/home/vercel-sandbox)でキャッシュが混ざらない。
const memCheckpoints = new Map<string, Buffer>();
const installsInProgress = new Map<string, Promise<void>>();

async function ensureBub(sb: Sandbox, home: string): Promise<void> {
  // 预制模板已把 bub 烘焙进镜像(PATH 上)→ 直接用,跳过 uv 安装 + checkpoint 全套。
  if ((await sb.runShell("command -v bub >/dev/null 2>&1")).exitCode === 0) return;

  const checkpointPaths = [`${home}/.local`, `${home}/.cache/uv`];
  const cachePath = diskCachePath(home);

  const mem = memCheckpoints.get(home);
  if (mem) { await restoreCheckpoint(sb, mem); return; }

  const disk = await readFile(cachePath).catch(() => undefined);
  if (disk) {
    try { await restoreCheckpoint(sb, disk); memCheckpoints.set(home, disk); return; } catch { /* 损坏,回退 */ }
  }

  const inflight = installsInProgress.get(home);
  if (inflight) {
    await inflight;
    const after = memCheckpoints.get(home);
    if (after) { await restoreCheckpoint(sb, after); return; }
  }

  let resolveInstall!: () => void;
  let rejectInstall!: (e: unknown) => void;
  const installPromise = new Promise<void>((res, rej) => { resolveInstall = res; rejectInstall = rej; });
  installsInProgress.set(home, installPromise);

  try {
    await sb.runShell(`test -x ${UV} || (curl -LsSf https://astral.sh/uv/install.sh | sh)`);
    await sb.runShell(`printf '%s\\n' '${BUB_OVERRIDE}' > ${BUB_OVERRIDE_FILE}`);
    let last = { stdout: "", stderr: "" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const install = await sb.runShell(
        `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}'`,
      );
      if (install.exitCode === 0) break;
      last = install;
      if (attempt === 3) throw new Error(`bub 安装失败(重试 3 次):\n${(last.stdout + last.stderr).split("\n").slice(-15).join("\n")}`);
    }
    const cp = await createCheckpoint(sb, checkpointPaths);
    memCheckpoints.set(home, cp);
    await mkdir(dirname(cachePath), { recursive: true }).catch(() => {});
    await writeFile(cachePath, cp).catch(() => {});
    resolveInstall();
  } catch (e) {
    rejectInstall(e);
    installsInProgress.delete(home);
    throw e;
  }
}

function tapePath(workspace: string, sessionId: string, bubHome: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `${bubHome}/tapes/${w}__${s}.jsonl`;
}

function diagnose(
  res: { exitCode: number; stdout: string; stderr: string },
  events: StreamEvent[],
  rawTape: string | undefined,
): string {
  const parts: string[] = [`bub run 退出码 ${res.exitCode}`];
  if (rawTape === undefined) parts.push("tape 未生成");
  else if (events.length === 0) parts.push("tape 存在但 0 事件");
  const lastErr = [...events].reverse().find((e) => e.type === "error") as { type: "error"; message: string } | undefined;
  if (lastErr) parts.push(`最后错误:${lastErr.message}`);
  const errTail = tail(res.stderr) || tail(res.stdout);
  if (errTail) parts.push(`输出末尾:${errTail}`);
  return parts.join(" · ");
}

function tail(s: string, n = 6): string {
  return s.trim().split("\n").filter(Boolean).slice(-n).join(" ⏎ ").slice(0, 600);
}

export function bubAgent(config?: BubConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("BUB_API_KEY");
  const getApiBase = () => config?.apiBase ?? requireEnv("BUB_API_BASE");
  // sandboxId → $HOME; persists home detected in setup() so send() can use it.
  const homeBySession = new Map<string, string>();

  return defineSandboxAgent({
    name: "bub",
    capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true, tracing: true },

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        BUB_TAPESTORE_OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb) {
      const home = (await sb.runShell("printf '%s' $HOME")).stdout.trim() || "/home/node";
      homeBySession.set(sb.sandboxId, home);
      await ensureBub(sb, home);

      if (config?.pythonPlugins?.length) {
        const extraWith = config.pythonPlugins.map((p) => `--with '${p}'`).join(" ");
        await sb.runShell(
          `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}' ${extraWith}`,
        );
      }

      if (!(await sb.fileExists(`${SANDBOX_WORKSPACE}/AGENTS.md`))) {
        await shared.writeFile(
          sb,
          `${SANDBOX_WORKSPACE}/AGENTS.md`,
          [
            `You are a coding agent working in a Next.js project at ${SANDBOX_WORKSPACE}.`,
            ``,
            `Implement the requested feature by writing files directly to disk with the available tools:`,
            `- fs_write(path, content): create or overwrite a file`,
            `- fs_edit(path, old, new): edit an existing file`,
            `- bash(cmd): run shell commands`,
            ``,
            `Do NOT respond with only a text explanation — write the actual code files.`,
            `After writing, verify with bash("cd ${SANDBOX_WORKSPACE} && npm run build").`,
          ].join("\n"),
        );
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const home = homeBySession.get(sb.sandboxId) ?? "/home/node";
      const bubHome = `${home}/.bub`;
      const model = ctx.model ?? "gpt-5.4";
      const sessionId = `fe-${sb.sandboxId}`;
      ctx.session.id = sessionId;

      const env = {
        BUB_API_KEY: getApiKey(),
        BUB_API_BASE: getApiBase(),
        BUB_MODEL: `openai:${model}`,
        BUB_HOME: bubHome,
        ...ctx.telemetry?.env,
      };
      const escaped = input.text.replace(/'/g, "'\\''");
      const res = await sb.runShell(
        `${BUB} --workspace ${SANDBOX_WORKSPACE} run '${escaped}' --session-id ${sessionId}`,
        { env, stream: true },
      );

      const raw = await sb.readFile(tapePath(SANDBOX_WORKSPACE, sessionId, bubHome)).catch(() => undefined);
      const parsed = shared.parseBub(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: diagnose(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default bubAgent();
