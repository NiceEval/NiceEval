// 沙箱型 adapter 的共享工具(对应 agent-eval 的 shared.ts)。
//
// adapter 真正要写的只有「装 CLI / 鉴权 / 拼调用 / 模型 / 读 transcript」那几行,
// 其余跨 agent 一致的活(装包去重、定位最新 transcript、写配置文件、从 stdout
// 抠 JSONL、解析成标准事件流)都收在这里,经 `shared` 暴露给用户写的 adapter。

import type { ParsedTranscript } from "../o11y/parsers/index.ts";
import {
  parseCodexTranscript,
  parseClaudeCodeTranscript,
  parseBubTranscript,
} from "../o11y/parsers/index.ts";
import type { Sandbox } from "../types.ts";

/** 每个沙箱里「已经装过的全局包」去重,避免每轮 send 重复 npm i -g。 */
const installedBySandbox = new WeakMap<Sandbox, Set<string>>();

function installKey(cmd: string, args: string[]): string {
  return [cmd, ...args].join(" ");
}

async function ensureInstalled(sandbox: Sandbox, cmd: string, args: string[]): Promise<void> {
  let set = installedBySandbox.get(sandbox);
  if (!set) {
    set = new Set();
    installedBySandbox.set(sandbox, set);
  }
  const key = installKey(cmd, args);
  if (set.has(key)) return;
  const res = await sandbox.runCommand(cmd, args);
  if (res.exitCode !== 0) {
    const tail = (res.stdout + res.stderr).trim().split("\n").slice(-12).join("\n");
    throw new Error(`安装失败:${key}\n${tail}`);
  }
  set.add(key);
}

/** 在 dir(可含 ~)下找最新的 *.jsonl,读回其内容;没有则 undefined。 */
async function captureLatestJsonl(sandbox: Sandbox, dir: string): Promise<string | undefined> {
  try {
    const find = await sandbox.runShell(
      `find ${dir} -type f -name '*.jsonl' -printf '%T@\\t%p\\n' 2>/dev/null | sort -nr | head -1 | cut -f2-`,
    );
    const path = find.stdout.trim();
    if (!path) return undefined;
    return await sandbox.readFile(path);
  } catch {
    return undefined;
  }
}

/** 写一个文件到沙箱任意路径(含 ~ / 绝对路径),用随机定界符的 heredoc,内容不被解释。 */
async function writeFile(sandbox: Sandbox, path: string, content: string): Promise<void> {
  const delim = `FE_EOF_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  // path 不加引号,以便 bash 展开 ~;dirname 也走 $() 不加引号同理。这些是受信内部路径。
  await sandbox.runShell(`mkdir -p $(dirname ${path}) && cat > ${path} <<'${delim}'\n${content}\n${delim}\n`);
}

/** Claude Code 的 transcript JSONL 里抠 sessionId(取最后一个,供下一轮 --resume)。 */
function sessionIdFromClaudeTranscript(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let last: string | undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as { sessionId?: unknown; session_id?: unknown };
      const id = (obj.sessionId ?? obj.session_id) as unknown;
      if (typeof id === "string" && id) last = id;
    } catch {
      // 跳过非 JSON 行
    }
  }
  return last;
}

/** 从混了普通日志的 stdout 里抠出 JSONL(只留看起来是 JSON 对象的行)。 */
function extractJsonlFromStdout(stdout: string | undefined): string | undefined {
  if (!stdout || !stdout.trim()) return undefined;
  const lines = stdout.split("\n").filter((line) => {
    const t = line.trim();
    return t.startsWith("{") && t.endsWith("}");
  });
  return lines.length ? lines.join("\n") : undefined;
}

/** 从 codex 的 --json stdout 里取 thread_id(thread.started 事件),供下一轮 resume。 */
function codexThreadId(stdout: string | undefined): string | undefined {
  if (!stdout) return undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t) as { type?: string; thread_id?: unknown };
      if (e.type === "thread.started" && typeof e.thread_id === "string") return e.thread_id;
    } catch {
      // 跳过
    }
  }
  return undefined;
}

/** 扫 JSONL,返回第一个出现的 field 的字符串值。 */
function firstJsonField(raw: string | undefined, field: string): string | undefined {
  if (!raw) return undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const v = obj[field];
      if (typeof v === "string" && v) return v;
    } catch {
      // 跳过
    }
  }
  return undefined;
}

/**
 * `shared`:用户写的沙箱 adapter 唯一要碰的工具袋。解析器把各 agent 的原始 JSONL
 * 归一化成标准事件流 + token 用量(ParsedTranscript),adapter 直接 return 即可。
 */
export const shared = {
  ensureInstalled,
  captureLatestJsonl,
  writeFile,
  sessionIdFromClaudeTranscript,
  extractJsonlFromStdout,
  codexThreadId,
  firstJsonField,
  /** 原始 codex JSONL → 标准事件流 + 用量 + 压缩计数。 */
  parseCodex(raw: string | undefined): ParsedTranscript {
    return parseCodexTranscript(raw);
  },
  parseClaudeCode(raw: string | undefined): ParsedTranscript {
    return parseClaudeCodeTranscript(raw);
  },
  parseBub(raw: string | undefined): ParsedTranscript {
    return parseBubTranscript(raw);
  },
};

export type Shared = typeof shared;
