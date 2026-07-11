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
import type { Sandbox, StreamEvent } from "../types.ts";
import { t } from "../i18n/index.ts";
import { shellQuote } from "../sandbox/shell.ts";

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
    throw new Error(t("agent.installFailed", { key, tail }));
  }
  set.add(key);
}

/**
 * 在 dir(可含 ~)下找 mtime 最新的 *.jsonl,读回其内容;没有则 undefined。
 * 「最新」是对的:同一沙箱内 send 严格串行,刚跑完的那次一定写在最后 —— 不要改成按
 * session id 精确定位(claude --resume 会 fork 出新 session id 的新文件,旧 id 的
 * 文件还在,精确匹配会读到过期 transcript,负断言静默假通过)。
 * 用沙箱里的 node 递归找全局最新:不依赖 GNU find 的 -printf(BSD / 精简镜像没有),
 * 也没有 `-exec ls -t +` 的 ARG_MAX 分批陷阱(每批各自排序,head -1 不是全局最新)。
 * 沙箱必然有 node(agent CLI 靠 npm 装,预制镜像也带)。
 */
async function captureLatestJsonl(sandbox: Sandbox, dir: string): Promise<string | undefined> {
  const script =
    'const fs=require("fs"),p=require("path");let best=null;' +
    "const walk=(d)=>{let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}" +
    "for(const e of es){const f=p.join(d,e.name);" +
    "if(e.isDirectory())walk(f);" +
    'else if(e.name.endsWith(".jsonl")){try{const m=fs.statSync(f).mtimeMs;if(!best||m>best.m)best={f,m}}catch{}}}};' +
    "walk(process.argv[1]);if(best)process.stdout.write(best.f);";
  try {
    // dir 不加引号以便 shell 展开 ~;受信内部路径(同 writeFile 的约定)。
    const find = await sandbox.runShell(`node -e '${script}' ${dir}`);
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

/**
 * JSONL 逐行扫描的唯一骨架:逐行 parse,把每行对象交给 pick 抠值,
 * 按 mode 取第一个或最后一个非空命中。非 JSON 行跳过。
 */
function scanJsonl(
  raw: string | undefined,
  pick: (obj: Record<string, unknown>) => string | undefined,
  mode: "first" | "last" = "first",
): string | undefined {
  if (!raw) return undefined;
  let hit: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const v = pick(JSON.parse(trimmed) as Record<string, unknown>);
      if (typeof v === "string" && v) {
        if (mode === "first") return v;
        hit = v;
      }
    } catch {
      // 跳过非 JSON 行
    }
  }
  return hit;
}

/** Claude Code 的 transcript JSONL 里抠 sessionId(取最后一个,供下一轮 --resume)。 */
function sessionIdFromClaudeTranscript(raw: string | undefined): string | undefined {
  return scanJsonl(raw, (obj) => (obj.sessionId ?? obj.session_id) as string | undefined, "last");
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
  return scanJsonl(stdout, (obj) =>
    obj.type === "thread.started" ? (obj.thread_id as string | undefined) : undefined,
  );
}

/** 扫 JSONL,返回第一个出现的 field 的字符串值。 */
function firstJsonField(raw: string | undefined, field: string): string | undefined {
  return scanJsonl(raw, (obj) => obj[field] as string | undefined);
}


/**
 * 非零退出的通用诊断:退出码、transcript 有无、事件数、最后一条 error、输出末尾,
 * 拼成一条可读信息。adapter 在 status=failed 时把它塞进 error 事件——
 * 否则 transcript 为空时失败原因彻底丢失,用户只能干瞪眼。
 */
function diagnoseFailure(
  res: { exitCode: number; stdout: string; stderr: string },
  events: readonly StreamEvent[],
  rawTranscript: string | undefined,
): string {
  const parts: string[] = [t("agent.diagnose.exitCode", { code: res.exitCode })];
  if (rawTranscript === undefined) parts.push(t("agent.diagnose.noTranscript"));
  else if (events.length === 0) parts.push(t("agent.diagnose.zeroEvents"));
  const lastErr = [...events].reverse().find((e) => e.type === "error") as
    | { type: "error"; message: string }
    | undefined;
  if (lastErr) parts.push(t("agent.diagnose.lastError", { message: lastErr.message }));
  const errTail = outputTail(res.stderr) || outputTail(res.stdout);
  if (errTail) parts.push(t("agent.diagnose.outputTail", { tail: errTail }));
  return parts.join(" · ");
}

function outputTail(s: string, n = 6): string {
  return s.trim().split("\n").filter(Boolean).slice(-n).join(" ⏎ ").slice(0, 600);
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
  /** 把文本包成 shell 单引号字面量(含转义)。与 sandbox provider 同一份实现,别在 adapter 里手写。 */
  shellQuote,
  diagnoseFailure,
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
