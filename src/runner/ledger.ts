// 变更分类账(私有 git ledger):回答「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。
// 契约见 docs/feature/sandbox/architecture.md「变更归因:send 窗口与分类账」:
// - ledger 的 git 目录在沙箱内、workdir 外(runner 私有路径),以 workdir 为 work-tree——
//   workdir 保持素净:agent 看不到 runner 的 .git,eval 需要真实 git repo 时自己 git init,
//   agent 在 workdir 里的任何 git 操作都碰不到分类账。
// - 三类 commit 时点:锚点一笔(workspace.baseline);每次 t.send() 进入前 workdir 有未记录
//   变化就落一笔 eval 归因;t.send() 返回后落一笔 agent 归因(send 窗口内的全部变化)。
// - 归因排除清单 runner 私有、锚点时冻结:项目自己的 .gitignore 不参与归因判断(add -f 绕过),
//   排除靠 pathspec,include 显式打洞加回。
// - agent 归因增量 = 逐窗口 delta 序列(DiffWindow[]),不做跨窗口压缩。

import type { DiffArtifact, DiffWindow, Sandbox, WindowChange } from "../types.ts";

/** ledger 的私有 git 目录:workdir 之外、runner 控制;agent 的工具默认不会去 /tmp 翻它。 */
const LEDGER_GIT_DIR = "/tmp/.niceeval-ledger";

/** 整相导出文件的落点(与 ledger 同前缀,同样是 runner 私有路径)。 */
const EXPORT_DIR = "/tmp/.niceeval-ledger-export";

/** 默认归因排除清单(锚点时冻结):依赖、构建产物、包管理器缓存与 niceeval 自己的落位。 */
const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".niceeval",
  "__niceeval__",
  "coverage",
  ".cache",
  ".pnpm-store",
  ".npm",
  ".yarn",
  "*venv*/",
  ".venv",
  "__pycache__",
];

/** 单个 send 窗口的证据安全上限。越界必须让 workspace.diff 失败,不能产出误导性的空窗口。 */
const MAX_WINDOW_PATHS = 10_000;
const MAX_WINDOW_BLOB_BYTES = 64 * 1024 * 1024;

/**
 * 整相导出:一条 POSIX shell 命令枚举**全部** agent 窗口并把证据写进沙箱内导出文件,宿主随后
 * 经文件通道一次下载——provider 往返数与窗口数、文件数都无关。对沙箱环境的全部要求是 git 与
 * POSIX 工具(sh/awk/wc/sort/grep),不依赖 node、python 等运行时。
 *
 * 沙箱内不组装 JSON:导出文件直接拼接 git 原生输出——每窗口四段,`diff-tree -z`(状态 + 前后
 * blob sha + 路径,NUL 安全)、`numstat -z`(二进制识别)、`cat-file --batch-check`(全部 blob
 * 尺寸)、`cat-file --batch`(文本 blob 内容,输出自带长度帧)——解析与校验全部在宿主侧完成。
 * 需要在沙箱内做的两个判断都不解析路径列:sha 提取用 awk 取 diff-tree 原始输出的第 3/4 列
 * (路径在其后,含空格也不影响);二进制排除靠 numstat 与 diff-tree 输出的行号对齐。
 * 尺寸核算(--batch-check)先于内容读取(--batch),越界在产出任何内容前失败。
 */
const EXPORT_SCRIPT = [
  "set -eu",
  `D=${EXPORT_DIR}`,
  'rm -rf "$D" && mkdir -p "$D"',
  'OUT=$D/export.bin',
  ': > "$OUT"',
  'fail() { printf "%s\\n" "$1" >&2; exit 2; }',
  // 帧格式:`section <name> <bytes>` 头一行,后跟原始字节;长度前缀让内容里的任意字节都安全。
  'emit() { printf "section %s %s\\n" "$1" "$(($(wc -c < "$2")))" >> "$OUT"; cat "$2" >> "$OUT"; }',
  'git log --reverse --format="%H %s" > "$D/log.txt"',
  "while IFS= read -r line; do",
  '  hash=${line%% *}',
  '  subject=${line#* }',
  '  case $subject in "agent "*) ;; *) continue ;; esac',
  '  label=${subject#agent }',
  // 非 -z 的 diff-tree 把特殊路径引号转义成单行,一行 = 一个条目:wc -l 即路径数,awk 列取 sha 不碰路径。
  '  git diff-tree -r --no-renames "$hash^" "$hash" > "$D/dt.txt"',
  '  n=$(($(wc -l < "$D/dt.txt")))',
  `  [ "$n" -le ${MAX_WINDOW_PATHS} ] || fail "niceeval diff window contains $n paths; limit is ${MAX_WINDOW_PATHS}"`,
  '  git diff-tree -r --no-renames --numstat "$hash^" "$hash" > "$D/ns.txt"',
  // 全部 blob 出现次数(before + after,零 sha = 无此侧,排除)→ 逐次尺寸核算。
  "  awk '$3 !~ /^0+$/ { print $3 } $4 !~ /^0+$/ { print $4 }' \"$D/dt.txt\" > \"$D/occ.txt\"",
  '  git cat-file --batch-check < "$D/occ.txt" > "$D/sizes.txt"',
  '  if grep -q " missing$" "$D/sizes.txt"; then fail "niceeval ledger export: blob object missing"; fi',
  `  awk '{ s += $3 } END { exit (s > ${MAX_WINDOW_BLOB_BYTES}) ? 1 : 0 }' "$D/sizes.txt" || fail "niceeval diff window contains more than ${MAX_WINDOW_BLOB_BYTES} blob bytes; narrow defineEval({ diff }) include/ignore rules"`,
  // 文本 blob 内容请求:numstat 第 1 列为 "-" 的行是二进制,按行号对齐排除;去重后交给 --batch。
  '  awk \'NR==FNR { bin[FNR] = ($1 == "-"); next } bin[FNR] != 1 { if ($3 !~ /^0+$/) print $3; if ($4 !~ /^0+$/) print $4 }\' "$D/ns.txt" "$D/dt.txt" | sort -u > "$D/text.txt"',
  '  git cat-file --batch < "$D/text.txt" > "$D/blobs.bin"',
  '  git diff-tree -r --no-renames -z "$hash^" "$hash" > "$D/dtz.bin"',
  '  git diff-tree -r --no-renames --numstat -z "$hash^" "$hash" > "$D/nsz.bin"',
  '  printf "window %s %s\\n" "$hash" "$label" >> "$OUT"',
  '  emit difftree "$D/dtz.bin"',
  '  emit numstat "$D/nsz.bin"',
  '  emit sizes "$D/sizes.txt"',
  '  emit blobs "$D/blobs.bin"',
  'done < "$D/log.txt"',
].join("\n");

export interface ChangeLedger {
  /** send 进入前:workdir 有未记录变化就落一笔 eval 归因(fixture / setup / runCommand 副作用)。 */
  commitEvalWindow(label: string): Promise<void>;
  /** send 返回后:落一笔 agent 归因——这个 send 窗口内的全部 workspace 变化(无变化也落空窗口)。 */
  commitAgentWindow(label: string): Promise<void>;
  /** workspace.diff 阶段:从分类账导出每个 send 窗口自己的 before/after,按时序。 */
  exportWindows(): Promise<DiffArtifact>;
}

interface LedgerOptions {
  /** defineEval({ diff }) 的归因调整:ignore 追加排除,include 打洞加回(优先级最高)。 */
  include?: string[];
  ignore?: string[];
}

/** 每条 git 命令都带上私有 GIT_DIR + workdir work-tree;项目/全局 gitignore 一律不参与。 */
function gitEnv(sandbox: Sandbox): Record<string, string> {
  return {
    GIT_DIR: LEDGER_GIT_DIR,
    GIT_WORK_TREE: sandbox.workdir,
    GIT_AUTHOR_NAME: "niceeval",
    GIT_AUTHOR_EMAIL: "niceeval@localhost",
    GIT_COMMITTER_NAME: "niceeval",
    GIT_COMMITTER_EMAIL: "niceeval@localhost",
    HOME: "/tmp",
  };
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** 打分类账锚点(workspace.baseline 阶段,环境层钩子之后):git init + 冻结排除清单 + 首笔 commit。 */
export async function createChangeLedger(sandbox: Sandbox, opts?: LedgerOptions): Promise<ChangeLedger> {
  const excludes = [...DEFAULT_EXCLUDES, ...(opts?.ignore ?? [])];
  const includes = opts?.include ?? [];
  const env = gitEnv(sandbox);

  // add -A -f:绕过项目自己的 .gitignore(项目 ignore 的文件照常记录);排除靠 pathspec
  // (runner 私有清单,agent / fixture 写 .gitignore 影响不了它);include 用第二次 add 打洞加回。
  const excludeSpecs = excludes.map((e) => shellQuote(`:(exclude)${e}`)).join(" ");
  // include 打洞:路径此刻可能还不存在(如 agent 之后才写),unmatched pathspec 不算错。
  const includeAdd =
    includes.length > 0 ? ` && { git add -A -f -- ${includes.map(shellQuote).join(" ")} 2>/dev/null || true; }` : "";
  const addAll = `git add -A -f -- . ${excludeSpecs}${includeAdd}`;

  const anchor = await sandbox.runShell(`git init -q "${LEDGER_GIT_DIR}" && ${addAll} && git commit -q --allow-empty -m "anchor"`, {
    env,
  });
  ensureCommandSucceeded(anchor, "create change ledger anchor");

  return {
    async commitEvalWindow(label: string): Promise<void> {
      // 有未记录变化才落这一笔;干净时不产生空的 eval 归因 commit。
      const result = await sandbox.runShell(`${addAll} && (git diff --cached --quiet || git commit -q -m ${shellQuote(`eval ${label}`)})`, {
        env,
      });
      ensureCommandSucceeded(result, `commit eval window ${label}`);
    },
    async commitAgentWindow(label: string): Promise<void> {
      // 窗口内没有变化时也落一条(--allow-empty),diff.json 里该窗口 changes 为空对象。
      const result = await sandbox.runShell(`${addAll} && git commit -q --allow-empty -m ${shellQuote(`agent ${label}`)}`, { env });
      ensureCommandSucceeded(result, `commit agent window ${label}`);
    },
    async exportWindows(): Promise<DiffArtifact> {
      return exportAgentWindows(sandbox, env);
    },
  };
}

async function exportAgentWindows(sandbox: Sandbox, env: Record<string, string>): Promise<DiffArtifact> {
  const result = await sandbox.runShell(EXPORT_SCRIPT, { env });
  ensureCommandSucceeded(result, "export agent windows");
  const payload = await sandbox.downloadFile(`${EXPORT_DIR}/export.bin`);
  return parseExportPayload(payload);
}

function ensureCommandSucceeded(result: { exitCode: number; stderr: string }, operation: string): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim().split("\n")[0];
  throw new Error(`${operation} failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`);
}

// ---------- 导出文件的宿主侧解析(严格校验:帧、git 输出形状、尺寸与内容的完备性) ----------

const ZERO_SHA = /^0+$/;

function parseExportPayload(payload: Buffer): DiffArtifact {
  const windows: DiffWindow[] = [];
  let offset = 0;

  const readLine = (): string => {
    const newline = payload.indexOf(0x0a, offset);
    if (newline === -1) throw new Error("niceeval ledger export: truncated header");
    const line = payload.subarray(offset, newline).toString("utf8");
    offset = newline + 1;
    return line;
  };
  const readSection = (expected: string): Buffer => {
    const header = readLine().split(" ");
    if (header.length !== 3 || header[0] !== "section" || header[1] !== expected) {
      throw new Error(`niceeval ledger export: expected section ${expected}, got ${JSON.stringify(header.join(" "))}`);
    }
    const length = Number(header[2]);
    if (!isNonNegativeInteger(length) || offset + length > payload.length) {
      throw new Error(`niceeval ledger export: invalid ${expected} section length`);
    }
    const body = payload.subarray(offset, offset + length);
    offset += length;
    return body;
  };

  while (offset < payload.length) {
    const header = readLine();
    if (!header.startsWith("window ")) throw new Error(`niceeval ledger export: expected window header, got ${JSON.stringify(header)}`);
    const rest = header.slice("window ".length);
    const space = rest.indexOf(" ");
    const label = space === -1 ? "" : rest.slice(space + 1);
    const entries = parseDiffTree(readSection("difftree"), label);
    const binaryPaths = parseBinaryPaths(readSection("numstat"), label);
    const sizeBySha = parseSizes(readSection("sizes"), label);
    const contentBySha = parseBlobBatch(readSection("blobs"), label);

    const changes: Record<string, WindowChange> = {};
    for (const entry of entries) {
      const change: WindowChange = { status: entry.status };
      if (binaryPaths.has(entry.path)) {
        const binary: NonNullable<WindowChange["binary"]> = {};
        if (entry.status !== "added") binary.beforeBytes = requireSize(sizeBySha, entry.beforeSha, label, entry.path);
        if (entry.status !== "deleted") binary.afterBytes = requireSize(sizeBySha, entry.afterSha, label, entry.path);
        change.binary = binary;
      } else {
        if (entry.status !== "added") change.before = requireContent(contentBySha, entry.beforeSha, label, entry.path);
        if (entry.status !== "deleted") change.after = requireContent(contentBySha, entry.afterSha, label, entry.path);
      }
      changes[entry.path] = change;
    }
    windows.push({ window: label, changes });
  }
  return windows;
}

interface DiffTreeEntry {
  path: string;
  status: WindowChange["status"];
  beforeSha: string;
  afterSha: string;
}

/** `git diff-tree -r --no-renames -z` 原始输出:`:mode mode sha sha status NUL path NUL` 重复。 */
function parseDiffTree(section: Buffer, label: string): DiffTreeEntry[] {
  const parts = section.toString("utf8").split("\0");
  const entries: DiffTreeEntry[] = [];
  for (let i = 0; i < parts.length; ) {
    const meta = parts[i++];
    if (!meta) continue;
    const path = parts[i++];
    const fields = meta.split(" ");
    if (path === undefined || fields.length !== 5 || !fields[0]!.startsWith(":")) {
      throw new Error(`export window ${label}: malformed git diff-tree output`);
    }
    const code = fields[4]!;
    const status = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified";
    entries.push({ path, status, beforeSha: fields[2]!, afterSha: fields[3]! });
  }
  return entries;
}

/** `git diff-tree --numstat -z`:二进制条目的 added/removed 计数是 `-`。 */
function parseBinaryPaths(section: Buffer, label: string): Set<string> {
  const paths = new Set<string>();
  for (const record of section.toString("utf8").split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) throw new Error(`export window ${label}: malformed git --numstat output`);
    if (record.slice(0, firstTab) === "-" && record.slice(firstTab + 1, secondTab) === "-") {
      paths.add(record.slice(secondTab + 1));
    }
  }
  return paths;
}

/** `git cat-file --batch-check`:每行 `sha type size`(输入是逐出现次数的 sha,重复无害)。 */
function parseSizes(section: Buffer, label: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of section.toString("utf8").split("\n")) {
    if (!line) continue;
    const fields = line.split(" ");
    const size = Number(fields[fields.length - 1]);
    if (fields.length < 3 || !isNonNegativeInteger(size)) {
      throw new Error(`export window ${label}: malformed git cat-file --batch-check output`);
    }
    sizes.set(fields[0]!, size);
  }
  return sizes;
}

/** `git cat-file --batch`:自带长度帧——`sha type size\n` + size 字节内容 + `\n`。 */
function parseBlobBatch(section: Buffer, label: string): Map<string, string> {
  const contents = new Map<string, string>();
  let offset = 0;
  while (offset < section.length) {
    const newline = section.indexOf(0x0a, offset);
    if (newline === -1) throw new Error(`export window ${label}: malformed git cat-file --batch header`);
    const fields = section.subarray(offset, newline).toString("utf8").split(" ");
    const size = Number(fields[fields.length - 1]);
    if (fields.length < 3 || !isNonNegativeInteger(size)) {
      throw new Error(`export window ${label}: malformed git cat-file --batch header`);
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= section.length || section[contentEnd] !== 0x0a) {
      throw new Error(`export window ${label}: truncated git cat-file --batch content`);
    }
    contents.set(fields[0]!, section.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }
  return contents;
}

function requireSize(sizes: Map<string, number>, sha: string, label: string, path: string): number {
  const size = sizes.get(sha);
  if (size === undefined || ZERO_SHA.test(sha)) throw new Error(`export window ${label}: missing blob size for ${JSON.stringify(path)}`);
  return size;
}

function requireContent(contents: Map<string, string>, sha: string, label: string, path: string): string {
  const content = contents.get(sha);
  if (content === undefined || ZERO_SHA.test(sha)) throw new Error(`export window ${label}: missing blob content for ${JSON.stringify(path)}`);
  return content;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
