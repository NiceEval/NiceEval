import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { createCheckpoint, restoreCheckpoint } from "../sandbox/checkpoint.ts";
import { mapBubSpans } from "../o11y/otlp/mappers/bub.ts";
import type { Agent, AgentContext, Sandbox } from "../types.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { t } from "../i18n/index.ts";

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

const UV = "$HOME/.local/bin/uv";

// TODO(upstream): BUB_OVERRIDE 钉在个人 fork 的修复分支上(tool-call 分支丢助手文本的修复
// 尚未进上游,见 memory/bub-tapestore-otel…drift.md 台账),等上游包含后改回发布版。
// 可用 NICEEVAL_BUB_OVERRIDE / NICEEVAL_BUB_OTEL_PLUGIN 覆盖,不必改源码。
const BUB_OVERRIDE =
  getEnv("NICEEVAL_BUB_OVERRIDE") ??
  "bub @ git+https://github.com/CorrectRoadH/bub.git@fix/tape-assistant-text-with-tool-calls";
const BUB_OVERRIDE_FILE = "/tmp/bub-override.txt";
// otel 插件跟上游 main 走(bub-contrib#50 起从 bub.tape 导入,要求 bub ≥ 0.3.10dev,
// 与上面的 override 分支兼容)。插件不发 PyPI,git 依赖是唯一安装方式。
const OTEL_PLUGIN =
  getEnv("NICEEVAL_BUB_OTEL_PLUGIN") ??
  "git+https://github.com/bubbuild/bub-contrib.git#subdirectory=packages/bub-tapestore-otel";

// override 钉在 git ref 上时,镜像里烘焙的 bub 不可信:模板构建时间早于 ref 当前指向的
// commit 的话,`command -v bub` 命中的就是修复前的旧构建 —— e2b 模板 fasteval-agents 上
// 整轮 bub turn failed(send 后无 AI 回复)就是这么来的:override 分支修好了,但捷径
// 让它从未被安装。所以 pinned 时绕开 PATH 捷径、恒走 uv 安装(有 checkpoint 缓存,
// 不是每沙箱都全量装),且运行时钉死用 $HOME/.local/bin/bub —— 只改 ensureBub 不改这里
// 的话,PATH 上的 /usr/local/bin/bub 仍会先于新装的被 command -v 找到,白装。
const BUB_PINNED = BUB_OVERRIDE.includes("git+");
// bub 二进制:pinned → 恒用 uv 装到 $HOME/.local/bin 的那个;非 pinned → 优先用镜像里
// (预制模板)烘焙在 PATH 上的 bub(装到 /usr/local/bin,见 sandbox/docker/Dockerfile)。
const BUB = BUB_PINNED ? "$HOME/.local/bin/bub" : "$(command -v bub || echo $HOME/.local/bin/bub)";

// checkpoint 只打 $HOME/.local:uv 装的 python 工具链、bub 的 tool venv 和 bin shim 全在
// 这里,restore 后即可运行。~/.cache/uv 是 wheel/构建缓存,只在「下一次安装」有用,而
// restore 场景 bub 已经装好、不会再装——打进去只是把单次 HTTP 传输撑到 100MB+,在 e2b
// 文件 API 上超时/连接重置概率明显偏高。子目录列表参与 INSTALL_HASH:改它会换缓存文件
// 名,不会继续复用老的大 checkpoint。
const CHECKPOINT_SUBDIRS = [".local"];

const INSTALL_SPEC =
  `bub --override(${BUB_OVERRIDE}) --with ${OTEL_PLUGIN} --checkpoint(${CHECKPOINT_SUBDIRS.join(",")})`;
const INSTALL_HASH = createHash("md5").update(INSTALL_SPEC).digest("hex").slice(0, 12);

function diskCachePath(home: string): string {
  const homeKey = createHash("md5").update(home).digest("hex").slice(0, 8);
  return join(homedir(), ".cache", "niceeval", `bub-checkpoint-${homeKey}-${INSTALL_HASH}.bin`);
}

// in-memory checkpoint + mutex keyed by sandbox $HOME,
// so Docker(/home/node)と Vercel(/home/vercel-sandbox)でキャッシュが混ざらない。
const memCheckpoints = new Map<string, Buffer>();
const installsInProgress = new Map<string, Promise<void>>();

async function ensureBub(sb: Sandbox, home: string, log: AgentContext["log"]): Promise<void> {
  // 预制模板已把 bub 烘焙进镜像(PATH 上)→ 直接用,跳过 uv 安装 + checkpoint 全套。
  // pinned(git ref override)时不走此捷径:烘焙的 bub 无法验证是不是 ref 当前指向的
  // 构建,必须按 override 真装(见 BUB_PINNED 注释)。
  if (!BUB_PINNED && (await sb.runShell("command -v bub >/dev/null 2>&1")).exitCode === 0) return;

  const checkpointPaths = CHECKPOINT_SUBDIRS.map((d) => `${home}/${d}`);
  const cachePath = diskCachePath(home);

  // restore 失败(多为 e2b 文件 API 对大 buffer 的瞬态超时/连接重置)不终结 attempt:
  // 缓存只是加速手段,落空就往下走全量安装。
  const mem = memCheckpoints.get(home);
  if (mem) {
    try { await restoreCheckpoint(sb, mem); return; } catch (e) {
      log(t("bub.checkpointRestoreFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  const disk = await readFile(cachePath).catch(() => undefined);
  if (disk) {
    try { await restoreCheckpoint(sb, disk); memCheckpoints.set(home, disk); return; } catch { /* 损坏,回退 */ }
  }

  const inflight = installsInProgress.get(home);
  if (inflight) {
    // leader 失败(多为沙箱瞬态网络错)不级联杀 waiter:兜掉后走下面自己的安装路径重试。
    await inflight.catch(() => {});
    const after = memCheckpoints.get(home);
    if (after) { await restoreCheckpoint(sb, after); return; }
  }

  let resolveInstall!: () => void;
  let rejectInstall!: (e: unknown) => void;
  const installPromise = new Promise<void>((res, rej) => { resolveInstall = res; rejectInstall = rej; });
  // 失败经由下方 throw e 传播给本 attempt;这把锁可能自始至终没有 waiter,
  // 不兜住 rejection 会变 unhandledRejection,把整个 runner 进程连同全矩阵杀掉。
  installPromise.catch(() => {});
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
      if (attempt === 3) {
        throw new Error(t("bub.installFailed", {
          attempts: 3,
          tail: (last.stdout + last.stderr).split("\n").slice(-15).join("\n"),
        }));
      }
    }
    // 到这里 bub 已装进本沙箱,checkpoint 只是给后续沙箱的缓存回填:capture/下载失败
    // (大 buffer 在 e2b 文件 API 上的瞬态错误)降级为警告,绝不反过来杀掉已就绪的 attempt。
    try {
      const cp = await createCheckpoint(sb, checkpointPaths);
      memCheckpoints.set(home, cp);
      await mkdir(dirname(cachePath), { recursive: true }).catch(() => {});
      await writeFile(cachePath, cp).catch(() => {});
    } catch (e) {
      log(t("bub.checkpointCaptureFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
    resolveInstall();
  } catch (e) {
    rejectInstall(e);
    throw e;
  } finally {
    // 成功/失败都清锁:锁只表达「正在装」,装完后 memCheckpoints 是唯一缓存事实源。
    installsInProgress.delete(home);
  }
}

function tapePath(workspace: string, sessionId: string, bubHome: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `${bubHome}/tapes/${w}__${s}.jsonl`;
}

export function bubAgent(config?: BubConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("BUB_API_KEY");
  const getApiBase = () => config?.apiBase ?? requireEnv("BUB_API_BASE");
  // sandboxId → { home, workspace }; persists values detected in setup() so send() can use them.
  const sessionInfo = new Map<string, { home: string; workspace: string }>();

  return defineSandboxAgent({
    name: "bub",
    spanMapper: mapBubSpans,

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        BUB_TAPESTORE_OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb, ctx) {
      // home 必须来自运行时探测:各 sandbox provider 不同(/home/node、/home/vercel-sandbox…),
      // 兜一个 provider 专属常量会静默走错路径(tape 读不到 → 空事件流 → 负断言假通过)。
      const home = (await sb.runShell("printf '%s' $HOME")).stdout.trim();
      if (!home) throw new Error(t("bub.homeDetectFailed"));
      const workspace = sb.workdir;
      sessionInfo.set(sb.sandboxId, { home, workspace });
      // ensureBub 的 checkpoint 缓存回填在模块级共享锁(installsInProgress)里,天然可能
      // 跨多个 attempt 复用同一次安装:警告归属到「触发这次安装的那个 attempt」的 log,
      // 不追求归属到全部受益 attempt(已裁决口径)。
      await ensureBub(sb, home, ctx.log);

      if (config?.pythonPlugins?.length) {
        const extraWith = config.pythonPlugins.map((p) => `--with '${p}'`).join(" ");
        await sb.runShell(
          `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}' ${extraWith}`,
        );
      }

      if (!(await sb.fileExists(`${workspace}/AGENTS.md`))) {
        await shared.writeFile(
          sb,
          `${workspace}/AGENTS.md`,
          [
            `You are a coding agent working in a Next.js project at ${workspace}.`,
            ``,
            `Implement the requested feature by writing files directly to disk with the available tools:`,
            `- fs_write(path, content): create or overwrite a file`,
            `- fs_edit(path, old, new): edit an existing file`,
            `- bash(cmd): run shell commands`,
            ``,
            `Do NOT respond with only a text explanation — write the actual code files.`,
            `After writing, verify with bash("cd ${workspace} && npm run build").`,
          ].join("\n"),
        );
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const info = sessionInfo.get(sb.sandboxId);
      if (!info) throw new Error(t("bub.setupNotRun"));
      const { home, workspace } = info;
      const bubHome = `${home}/.bub`;
      // 会话契约:ctx.session.id 未记录时开新 tape(新 sessionId),否则 resume 传入的 id。
      // tape 路径由 md5(workspace)+md5(sessionId) 决定,同沙箱多会话靠 sessionId 区分。
      const sessionId = ctx.session.id ?? `fe-${sb.sandboxId}-${randomUUID().slice(0, 8)}`;
      ctx.session.capture(sessionId);

      const env: Record<string, string> = {
        BUB_API_KEY: getApiKey(),
        BUB_API_BASE: getApiBase(),
        BUB_HOME: bubHome,
        ...ctx.telemetry?.env,
      };
      // model 归属:实验决定(ctx.model),省略时交给 bub 原生默认 / 用户环境,不硬编码。
      if (ctx.model) env.BUB_MODEL = `openai:${ctx.model}`;
      const res = await sb.runShell(
        `${BUB} --workspace ${workspace} run ${shared.shellQuote(input.text)} --session-id ${sessionId}`,
        { env, stream: true },
      );

      const raw = await sb.readFile(tapePath(workspace, sessionId, bubHome)).catch(() => undefined);
      const parsed = shared.parseBub(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default bubAgent();
