// 变更分类账(私有 git ledger):回答「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。
// 契约见 docs/feature/sandbox/architecture/README.md「变更归因:send 窗口与分类账」:
// - ledger 的 git 目录在沙箱内、workdir 外(runner 私有路径),以 workdir 为 work-tree——
//   workdir 保持素净:agent 看不到 runner 的 .git,eval 需要真实 git repo 时自己 git init,
//   agent 在 workdir 里的任何 git 操作都碰不到分类账。
// - 三类 commit 时点:锚点一笔(workspace.baseline);每次 t.send() 进入前 workdir 有未记录
//   变化就落一笔 eval 归因;t.send() 返回后落一笔 agent 归因(send 窗口内的全部变化)。
// - 归因排除清单 runner 私有、锚点时冻结:项目自己的 .gitignore 不参与归因判断(add -f 绕过),
//   排除靠 pathspec,include 显式打洞加回。
// - agent 归因增量 = 逐窗口 delta 序列(DiffWindow[]),不做跨窗口压缩。

import { createHash } from "node:crypto";
import type { DiffArtifact, DiffWindow, Sandbox, WindowChange } from "../types.ts";
import type { AgentWorkspaceDiffPolicy } from "../assertions/workspace-diff.ts";
import { sandboxSupportsRootCommands } from "../sandbox/backend.ts";
import { DEFAULT_LEDGER_EXPORT_DIR, DEFAULT_LEDGER_GIT_DIR } from "../sandbox/ledger-paths.ts";

/**
 * ledger 的私有 git 目录:workdir 之外、runner 控制;agent 的工具默认不会去 /tmp 翻它。这是
 * 沙箱内 provider(docker/e2b/vercel)的固定值——每个实例都是全新隔离文件系统。
 */
export const LEDGER_GIT_DIR = DEFAULT_LEDGER_GIT_DIR;

/** 默认归因排除清单(锚点时冻结):依赖、构建产物、包管理器缓存与用户项目里的 .niceeval 记录目录。
 *  框架自己不往 workdir 写任何东西(见 docs/observability.md「宿主侧行为断言:t.o11y」),
 *  所以这里没有框架路径要排。 */
const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".niceeval",
  "coverage",
  ".cache",
  ".pnpm-store",
  ".npm",
  ".yarn",
  "*venv*/",
  ".venv",
  "__pycache__",
];

function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Validate and freeze the canonical attribution policy. */
function canonicalPolicyEntries(entries: readonly string[], name: "include" | "ignore"): readonly string[] {
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "string") {
      throw new TypeError(`defineEval({ diff }).${name}[${index}] must be a string`);
    }
  }
  return [...new Set(entries)].sort(compareAscii);
}

/** Size of one physical provider file transfer. */
const EXPORT_PART_BYTES = 4_000_000;
const EXPORT_MANIFEST_HEADER = "niceeval-ledger-export-parts v1";

/**
 * 整相导出:一条 POSIX shell 命令枚举**全部** agent 窗口并把证据写进沙箱内导出文件,宿主随后
 * 经文件通道一次下载——provider 往返数与窗口数、文件数都无关。对沙箱环境的全部要求是 git 与
 * POSIX 工具(sh/awk/wc/sort/grep),不依赖 node、python 等运行时。
 *
 * 沙箱内不组装 JSON:导出文件直接拼接 git 原生输出——每窗口四段,`diff-tree -z`(状态 + 前后
 * blob sha + 路径,NUL 安全)、`numstat -z`(二进制识别)、`cat-file --batch-check`(全部 blob
 * 尺寸)、`cat-file --batch`(要内联的文本 blob 内容,输出自带长度帧)——解析与校验全部在宿主侧完成。
 * 需要在沙箱内做的两个判断都不解析路径列:sha 提取用 awk 取 diff-tree 原始输出的第 3/4 列
 * (路径在其后,含空格也不影响);二进制排除靠 numstat 与 diff-tree 输出的行号对齐。
 * 尺寸核算(--batch-check)先于内容读取(--batch),越界在产出任何内容前失败;预算只累计真正
 * 要传输的文本 blob(二进制与单文件超限文本只出字节数,不进 --batch 请求、不计预算)。
 * 宿主侧从 sizes + numstat 两段就能判出哪些条目内容被省略,沙箱不额外输出一份判定清单。
 */
function buildExportScript(exportDir: string): string {
  return [
    "set -eu",
    `D=${shellQuote(exportDir)}`,
    'rm -rf "$D" && mkdir -p "$D"',
    "OUT=$D/export.bin",
    ': > "$OUT"',
    'fail() { printf "%s\\n" "$1" >&2; exit 2; }',
    // Binary detection should reflect the data and attributes across the representable byte range.
    `numstat() { git -c core.bigFileThreshold=${Number.MAX_SAFE_INTEGER} diff-tree -r --no-renames --numstat "$@"; }`,
    // 帧格式:`section <name> <bytes>` 头一行,后跟原始字节;长度前缀让内容里的任意字节都安全。
    'emit() { printf "section %s %s\\n" "$1" "$(($(wc -c < "$2")))" >> "$OUT"; cat "$2" >> "$OUT"; }',
    'git log --reverse --format="%H %s" > "$D/log.txt"',
    "while IFS= read -r line; do",
    "  hash=${line%% *}",
    "  subject=${line#* }",
    '  case $subject in "agent "*) ;; *) continue ;; esac',
    "  label=${subject#agent }",
    // Quoted paths occupy one line each. Only the object IDs are taken from this listing.
    '  git diff-tree -r --no-renames "$hash^" "$hash" > "$D/dt.txt"',
    '  numstat "$hash^" "$hash" > "$D/ns.txt"',
    // 全部 blob 出现次数(before + after,零 sha = 无此侧,排除)→ 逐次尺寸核算。
    '  awk \'$3 !~ /^0+$/ { print $3 } $4 !~ /^0+$/ { print $4 }\' "$D/dt.txt" > "$D/occ.txt"',
    '  git cat-file --batch-check < "$D/occ.txt" > "$D/sizes.txt"',
    '  if grep -q " missing$" "$D/sizes.txt"; then fail "niceeval ledger export: blob object missing"; fi',
    // Numstat marks binary paths with "-". Transfer each text blob once per window.
    '  awk \'FILENAME == ARGV[1] { bin[FNR] = ($1 == "-"); next } !bin[FNR] { for (i = 3; i <= 4; i++) if ($i !~ /^0+$/ && !seen[$i]++) print $i }\' "$D/ns.txt" "$D/dt.txt" > "$D/text.txt"',
    '  git cat-file --batch < "$D/text.txt" > "$D/blobs.bin"',
    '  git diff-tree -r --no-renames -z "$hash^" "$hash" > "$D/dtz.bin"',
    '  numstat -z "$hash^" "$hash" > "$D/nsz.bin"',
    '  printf "window %s %s\\n" "$hash" "$label" >> "$OUT"',
    '  emit difftree "$D/dtz.bin"',
    '  emit numstat "$D/nsz.bin"',
    '  emit sizes "$D/sizes.txt"',
    '  emit blobs "$D/blobs.bin"',
    'done < "$D/log.txt"',
    // Provider 文件 API 可能拒绝超过 4 MiB 的单对象读取。这里按固定原始字节切片，并在最后
    // 原子发布 manifest；宿主只接受连续序号、精确长度和 Git blob checksum。
    'total=$(($(wc -c < "$OUT")))',
    `parts=$((total / ${EXPORT_PART_BYTES} + (total % ${EXPORT_PART_BYTES} != 0)))`,
    "MANIFEST_TMP=$D/manifest.tmp",
    "MANIFEST=$D/manifest.txt",
    `printf "%s\\ntotal %s\\nparts %s\\n" "${EXPORT_MANIFEST_HEADER}" "$total" "$parts" > "$MANIFEST_TMP"`,
    "i=0",
    'while [ "$i" -lt "$parts" ]; do',
    '  suffix=$(printf "%06d" "$i")',
    "  part=$D/export.part.$suffix",
    `  dd if="$OUT" of="$part" bs=${EXPORT_PART_BYTES} skip="$i" count=1 2>/dev/null`,
    '  size=$(($(wc -c < "$part")))',
    '  oid=$(git hash-object --no-filters "$part")',
    '  printf "part %s %s %s\\n" "$suffix" "$size" "$oid" >> "$MANIFEST_TMP"',
    "  i=$((i + 1))",
    "done",
    'mv "$MANIFEST_TMP" "$MANIFEST"',
    'rm -f "$OUT"',
    // root ledger commands may create private exports with a restrictive umask. These artifacts are
    // outside workdir and are deleted immediately after the provider file channel consumes them.
    'chmod 0644 "$MANIFEST"',
    'for part in "$D"/export.part.*; do [ -f "$part" ] || continue; chmod 0644 "$part"; done',
  ].join("\n");
}

export interface ChangeLedger {
  /** send 进入前:workdir 有未记录变化就落一笔 eval 归因(fixture / setup / runCommand 副作用)。 */
  commitEvalWindow(label: string): Promise<void>;
  /** send 返回后:落一笔 agent 归因——这个 send 窗口内的全部 workspace 变化(无变化也落空窗口)。 */
  commitAgentWindow(label: string): Promise<void>;
  /** workspace.diff 阶段:从分类账导出每个 send 窗口自己的 before/after,按时序。 */
  exportWindows(): Promise<DiffArtifact>;
  /** 回到创建时的题间锚点，并保留归因排除清单排除的动态环境。 */
  resetToAnchor(): Promise<void>;
  /**
   * 建账时探测到的执行身份是否为 root(仅当 provider 支持 root ledger 命令时才探测得到,
   * 否则恒为 false)。sandboxReuse 复用池据此在实例进池前拒绝(见 docs/feature/sandbox/library/reuse.md);
   * `resetToAnchor()` 内的同款判断作纵深防御保留。
   */
  readonly rootExecutionIdentity: boolean;
  /** Frozen semantic identity consumed by the Attempt-owned diff Attachment. */
  readonly attribution: AgentWorkspaceDiffPolicy;
}

interface LedgerOptions {
  /** defineEval({ diff }) 的归因调整:ignore 追加排除,include 打洞加回(优先级最高)。 */
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly retainResetState: boolean;
}

/** 每条 git 命令都带上私有 GIT_DIR + workdir work-tree;项目/全局 gitignore 一律不参与。 */
function gitEnv(sandbox: Sandbox, gitDir: string): globalThis.Record<string, string> {
  return {
    GIT_DIR: gitDir,
    GIT_WORK_TREE: sandbox.workdir,
    GIT_AUTHOR_NAME: "niceeval",
    GIT_AUTHOR_EMAIL: "niceeval@localhost",
    GIT_COMMITTER_NAME: "niceeval",
    GIT_COMMITTER_EMAIL: "niceeval@localhost",
    // Internal root Git must never consume configuration or hooks writable by the Agent.
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/tmp",
  };
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * Root Git can faithfully restore bytes but would otherwise recreate ordinary fixture files as root.
 * Keep a content-free metadata mirror inside the private (0700) ledger and reapply uid/gid/mode after
 * reset. The batched xargs loops preserve arbitrary Git path bytes without exposing objects to the Agent.
 */
function captureBaselineMetadataScript(): string {
  return [
    'META="$GIT_DIR/niceeval-baseline-metadata"',
    'rm -rf "$META" && mkdir -p "$META/files" "$META/dirs"',
    "export META",
    "git ls-files -z | xargs -0 -n 100 sh -c '",
    "  for p do",
    '    src="$GIT_WORK_TREE/$p"',
    '    ref="$META/files/$p"',
    '    mkdir -p "$(dirname "$ref")" && : > "$ref"',
    '    owner=$(stat -c "%u:%g" "$src") && mode=$(stat -c "%a" "$src")',
    '    chown -h "$owner" "$ref" && chmod "$mode" "$ref"',
    '    d=$(dirname "$p")',
    '    while [ "$d" != "." ]; do',
    '      dref="$META/dirs/$d/.ref"',
    '      if [ ! -e "$dref" ]; then',
    '        mkdir -p "$(dirname "$dref")" && : > "$dref"',
    '        downer=$(stat -c "%u:%g" "$GIT_WORK_TREE/$d") && dmode=$(stat -c "%a" "$GIT_WORK_TREE/$d")',
    '        chown "$downer" "$dref" && chmod "$dmode" "$dref"',
    "      fi",
    '      d=$(dirname "$d")',
    "    done",
    "  done",
    "' niceeval-meta",
    // Agent and any background process share the ordinary sandbox uid. Keep both objects and the
    // metadata mirror root-private for the whole attempt; reset never opens this directory to that uid.
    'chmod go-rwx "$GIT_DIR"',
  ].join("\n");
}

function restoreBaselineMetadataScript(): string {
  return [
    'META="$GIT_DIR/niceeval-baseline-metadata"',
    "export META",
    'if [ -d "$META/files" ]; then',
    '  find "$META/files" -type f -print0 | xargs -0 -n 100 sh -c \'',
    "    for ref do",
    '      p=${ref#"$META/files/"}',
    '      target="$GIT_WORK_TREE/$p"',
    '      if [ -e "$target" ] || [ -L "$target" ]; then',
    '        owner=$(stat -c "%u:%g" "$ref") && mode=$(stat -c "%a" "$ref")',
    '        chown -h "$owner" "$target"',
    '        [ -L "$target" ] || chmod "$mode" "$target"',
    "      fi",
    "    done",
    "  ' niceeval-meta-restore",
    "fi",
    // Apply directory metadata last so restrictive parent modes cannot interfere with child repair.
    'if [ -d "$META/dirs" ]; then',
    '  find "$META/dirs" -type f -name .ref -print0 | xargs -0 -n 100 sh -c \'',
    "    for ref do",
    "      d=${ref%/.ref}",
    '      p=${d#"$META/dirs/"}',
    '      target="$GIT_WORK_TREE/$p"',
    '      if [ -d "$target" ]; then',
    '        owner=$(stat -c "%u:%g" "$ref") && mode=$(stat -c "%a" "$ref")',
    '        chown "$owner" "$target" && chmod "$mode" "$target"',
    "      fi",
    "    done",
    "  ' niceeval-dir-meta-restore",
    "fi",
    'chmod go-rwx "$GIT_DIR"',
  ].join("\n");
}

/**
 * 把仓库根语义的 gitignore 风格规则编译成 ledger pathspec。
 * 无斜杠的名字匹配任意深度；有斜杠的规则相对 workdir 根；目录本身与后代一起处理。
 */
function gitignorePathspecs(pattern: string, exclude: boolean): string[] {
  let normalized = pattern;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  normalized = normalized.replace(/\/+$/, "");
  if (!normalized) return [];

  const glob = normalized.includes("/") ? normalized : `**/${normalized}`;
  const globs = exclude && !glob.endsWith("/**") ? [glob, `${glob}/**`] : [glob];
  const magic = exclude ? ":(glob,exclude)" : ":(glob)";
  return [...new Set(globs)].map((value) => `${magic}${value}`);
}

/** 打分类账锚点(workspace.baseline 阶段,环境层钩子之后):git init + 冻结排除清单 + 首笔 commit。 */
export async function createChangeLedger(sandbox: Sandbox, opts: LedgerOptions): Promise<ChangeLedger> {
  const includes = canonicalPolicyEntries(opts.include ?? [], "include");
  const ignored = canonicalPolicyEntries(opts.ignore ?? [], "ignore");
  const excludes = [...DEFAULT_EXCLUDES, ...ignored];
  const gitDir = LEDGER_GIT_DIR;
  const exportDir = DEFAULT_LEDGER_EXPORT_DIR;
  const env = gitEnv(sandbox, gitDir);
  const rootCommands = sandboxSupportsRootCommands(sandbox);
  // 只给 runner 私有 ledger 命令提权，以便读取题目故意设置的受限文件。脚本不 chmod/chown
  // workdir，Agent 命令仍沿标准非 root 身份；不支持提权的 provider 保持既有用户态路径。
  const commandOptions = { env, user: rootCommands ? ("root" as const) : undefined };
  // Only reuse restores this tree. Per-file metadata capture is extra work for a single-use Attempt.
  const reuseAnchor = opts.retainResetState ? " && git tag niceeval-reuse-anchor" : "";
  const captureMetadata = rootCommands && opts.retainResetState ? ` && ${captureBaselineMetadataScript()}` : "";
  const lockPrivateLedger = rootCommands ? ' && chmod go-rwx "$GIT_DIR"' : "";
  let ordinaryUid: string | undefined;
  if (rootCommands && opts.retainResetState) {
    // Capture before Agent setup/send can mutate the VM. A post-attempt `id` probe would not be a
    // trustworthy boundary when the configured execution identity itself is root.
    const identity = await sandbox.runShell("command -p id -u", { env });
    ensureCommandSucceeded(identity, "detect sandbox execution identity for reuse", false);
    ordinaryUid = identity.stdout.trim();
  }

  // add -A -f:绕过项目自己的 .gitignore(项目 ignore 的文件照常记录);排除靠 pathspec
  // (runner 私有清单,agent / fixture 写 .gitignore 影响不了它);include 用第二次 add 打洞加回。
  const excludeSpecs = excludes
    .flatMap((pattern) => gitignorePathspecs(pattern, true))
    .map(shellQuote)
    .join(" ");
  // include 打洞:路径此刻可能还不存在(如 agent 之后才写),unmatched pathspec 不算错。
  const includeSpecs = includes
    .flatMap((pattern) => gitignorePathspecs(pattern, false))
    .map(shellQuote)
    .join(" ");
  const includeAdd =
    includeSpecs.length > 0
      ? ` && { git -c advice.addEmbeddedRepo=false add -A -f -- ${includeSpecs} 2>/dev/null || true; }`
      : "";
  const rejectGitlinks =
    ' && nested=$(git ls-files --stage | awk \'$1 == "160000" { sub(/^[^\\t]*\\t/, ""); print; exit }\')' +
    ' && if [ -n "$nested" ]; then printf \'%s\\n\' "niceeval ledger cannot track nested Git repository $nested as file-level evidence; move the checkout to sandbox.workdir root, or add the whole path to defineEval({ diff: { ignore: [...] } }) when it is intentionally out of scope" >&2; exit 2; fi';
  const addAll = `git -c advice.addEmbeddedRepo=false add -A -f -- . ${excludeSpecs}${includeAdd}${rejectGitlinks}`;

  const anchor = await sandbox.runShell(
    // The path is predictable inside an isolated VM. Remove any image/prepare-time occupant or
    // symlink, then recreate the exact runner-private directory as root 0700 before Git touches it.
    `rm -rf -- ${shellQuote(gitDir)} && mkdir -p -m 0700 -- ${shellQuote(gitDir)} && ` +
      `git init -q "${gitDir}" && ${addAll} && git commit -q --allow-empty -m "anchor"${reuseAnchor}${captureMetadata}`,
    {
      ...commandOptions,
    },
  );
  ensureCommandSucceeded(anchor, "create change ledger anchor", rootCommands);

  return {
    rootExecutionIdentity: ordinaryUid === "0",
    attribution: {
      defaultPolicy: createHash("sha256")
        .update(JSON.stringify([...DEFAULT_EXCLUDES].sort()))
        .digest("hex"),
      include: includes,
      ignore: ignored,
    },
    async commitEvalWindow(label: string): Promise<void> {
      // 有未记录变化才落这一笔;干净时不产生空的 eval 归因 commit。
      const result = await sandbox.runShell(
        `${addAll} && (git diff --cached --quiet || git commit -q -m ${shellQuote(`eval ${label}`)})${lockPrivateLedger}`,
        {
          ...commandOptions,
        },
      );
      ensureCommandSucceeded(result, `commit eval window ${label}`, rootCommands);
    },
    async commitAgentWindow(label: string): Promise<void> {
      // 窗口内没有变化时也落一条(--allow-empty),diff.json 里该窗口 changes 为空对象。
      const result = await sandbox.runShell(
        `${addAll} && git commit -q --allow-empty -m ${shellQuote(`agent ${label}`)}${lockPrivateLedger}`,
        commandOptions,
      );
      ensureCommandSucceeded(result, `commit agent window ${label}`, rootCommands);
    },
    async exportWindows(): Promise<DiffArtifact> {
      return exportAgentWindows(sandbox, commandOptions, exportDir, rootCommands);
    },
    async resetToAnchor(): Promise<void> {
      if (!opts.retainResetState) throw new Error("Change ledger was created without Sandbox reuse state");
      if (ordinaryUid === "0") {
        throw new Error(
          "sandboxReuse cannot safely reuse a root-agent sandbox: the Agent could read private ledger objects from prior attempts; use a non-root execution user or disable sandboxReuse",
        );
      }
      // Root performs the byte reset, then reapplies the content-free baseline metadata mirror so
      // ordinary files return to their original uid/gid/mode instead of becoming root-owned. The
      // private object database stays 0700 throughout; no Agent/background process can read it.
      const result = await sandbox.runShell(
        `git reset -q --hard niceeval-reuse-anchor && ` +
          `git clean -fd ${excludes.map((pattern) => `-e ${shellQuote(pattern)}`).join(" ")} && ` +
          restoreBaselineMetadataScript(),
        commandOptions,
      );
      ensureCommandSucceeded(result, "reset reusable sandbox to anchor and restore ownership", rootCommands);
    },
  };
}

async function exportAgentWindows(
  sandbox: Sandbox,
  commandOptions: { readonly env: globalThis.Record<string, string>; readonly user: "root" | undefined },
  exportDir: string,
  rootCommands: boolean,
): Promise<DiffArtifact> {
  const windows: DiffWindow[] = [];
  try {
    const result = await sandbox.runShell(buildExportScript(exportDir), commandOptions);
    ensureCommandSucceeded(result, "export agent windows", rootCommands);
    const manifest = parseExportManifest(await sandbox.readText(`${exportDir}/manifest.txt`));
    const payload = new ExportPayloadReader(manifest.totalBytes, async (index) => {
      const part = manifest.parts[index]!;
      const bytes = await sandbox.readBytes(`${exportDir}/export.part.${part.suffix}`);
      if (bytes.byteLength !== part.bytes) {
        throw new Error(
          `niceeval ledger export: part ${part.suffix} has ${bytes.byteLength} bytes, expected ${part.bytes}`,
        );
      }
      const algorithm = part.oid.length === 40 ? "sha1" : "sha256";
      const actual = createHash(algorithm).update(`blob ${bytes.byteLength}\0`, "utf8").update(bytes).digest("hex");
      if (actual !== part.oid) {
        throw new Error(`niceeval ledger export: checksum mismatch for part ${part.suffix}`);
      }
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    });
    await parseExportPayload(payload, windows);
    return windows;
  } catch (cause) {
    if (windows.length > 0) throw new LedgerExportError(windows, cause);
    throw cause;
  } finally {
    await sandbox.runShell(`rm -rf ${shellQuote(exportDir)}`, commandOptions).catch(() => undefined);
  }
}

export class LedgerExportError extends Error {
  readonly windows: DiffArtifact;

  constructor(windows: DiffArtifact, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.windows = windows;
  }
}

interface ExportManifestPart {
  readonly suffix: string;
  readonly bytes: number;
  readonly oid: string;
}

interface ExportManifest {
  readonly totalBytes: number;
  readonly parts: readonly ExportManifestPart[];
}

function manifestInteger(text: string, label: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`niceeval ledger export: invalid manifest ${label}`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`niceeval ledger export: invalid manifest ${label}`);
  }
  return value;
}

function parseExportManifest(text: string): ExportManifest {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (lines[0] !== EXPORT_MANIFEST_HEADER) {
    throw new Error("niceeval ledger export: unsupported manifest header");
  }
  const totalMatch = /^total ([0-9]+)$/.exec(lines[1] ?? "");
  const partsMatch = /^parts ([0-9]+)$/.exec(lines[2] ?? "");
  if (totalMatch === null || partsMatch === null) {
    throw new Error("niceeval ledger export: malformed manifest summary");
  }
  const totalBytes = manifestInteger(totalMatch[1]!, "total bytes");
  const partCount = manifestInteger(partsMatch[1]!, "part count");
  const expectedPartCount = Math.ceil(totalBytes / EXPORT_PART_BYTES);
  if (partCount !== expectedPartCount || lines.length !== partCount + 3) {
    throw new Error("niceeval ledger export: manifest part count mismatch");
  }
  const parts: ExportManifestPart[] = [];
  let retainedBytes = 0;
  for (let index = 0; index < partCount; index += 1) {
    const match = /^part ([0-9]{6,}) ([0-9]+) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(lines[index + 3] ?? "");
    const suffix = String(index).padStart(6, "0");
    if (match === null || match[1] !== suffix) {
      throw new Error(`niceeval ledger export: invalid or non-contiguous part ${suffix}`);
    }
    const expectedBytes = Math.min(EXPORT_PART_BYTES, totalBytes - retainedBytes);
    const bytes = manifestInteger(match[2]!, `part ${suffix} bytes`);
    if (bytes !== expectedBytes || bytes === 0) {
      throw new Error(`niceeval ledger export: invalid length for part ${suffix}`);
    }
    retainedBytes += bytes;
    parts.push({ suffix, bytes, oid: match[3]! });
  }
  if (retainedBytes !== totalBytes) {
    throw new Error("niceeval ledger export: manifest total length mismatch");
  }
  return { totalBytes, parts };
}

function ensureCommandSucceeded(
  result: { exitCode: number; stderr: string },
  operation: string,
  rootCommands: boolean,
  permissionGuidance?: string,
): void {
  if (result.exitCode === 0) return;
  const lines = result.stderr.trim().split("\n").filter(Boolean);
  const permission = lines.find((line) => /permission denied|operation not permitted/i.test(line));
  if (permission !== undefined) {
    const guidance =
      permissionGuidance ??
      (rootCommands
        ? "the provider declared root command support, but root ledger execution still could not read the workspace; check its root command mapping"
        : "this sandbox provider does not support root ledger commands; use a root-capable provider for tasks that intentionally start with unreadable files instead of chmod/chowning away the task condition");
    throw new Error(`${operation} failed (exit ${result.exitCode}): ${permission}; ${guidance}`);
  }
  // git 可能先输出 advisory warning，再输出 niceeval 的可操作诊断；最后一行最接近失败根因。
  const detail = lines.at(-1);
  throw new Error(`${operation} failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`);
}

// ---------- 导出文件的宿主侧解析(严格校验:帧、git 输出形状、尺寸与内容的完备性) ----------

const ZERO_SHA = /^0+$/;

/** Parses across verified provider segments without assembling the export into a single buffer. */
class ExportPayloadReader {
  readonly length: number;
  readonly #loadPart: (index: number) => Promise<Buffer>;
  #part: Buffer = Buffer.alloc(0);
  #partOffset = 0;
  #partIndex = 0;
  #offset = 0;

  constructor(length: number, loadPart: (index: number) => Promise<Buffer>) {
    this.length = length;
    this.#loadPart = loadPart;
  }

  get offset(): number {
    return this.#offset;
  }

  async sectionEnd(expected: string): Promise<number> {
    const header = (await this.readDelimited(0x0a, this.length)).split(" ");
    if (header.length !== 3 || header[0] !== "section" || header[1] !== expected) {
      throw new Error(`niceeval ledger export: expected section ${expected}, got ${JSON.stringify(header.join(" "))}`);
    }
    const length = manifestInteger(header[2]!, `${expected} section length`);
    if (length > this.length - this.offset) {
      throw new Error(`niceeval ledger export: invalid ${expected} section length`);
    }
    return this.offset + length;
  }

  async readDelimited(delimiter: number, end: number): Promise<string> {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const pieces: string[] = [];
    while (this.offset < end) {
      if (this.#partOffset === this.#part.length) await this.#nextPart();
      const available = Math.min(end - this.offset, this.#part.length - this.#partOffset);
      const found = this.#part.indexOf(delimiter, this.#partOffset);
      if (found >= 0 && found < this.#partOffset + available) {
        pieces.push(decoder.decode(this.#take(found - this.#partOffset)));
        this.#take(1);
        return pieces.join("");
      }
      pieces.push(decoder.decode(this.#take(available), { stream: true }));
    }
    throw new Error("niceeval ledger export: missing record delimiter");
  }

  async readText(length: number): Promise<string> {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const pieces: string[] = [];
    while (length > 0) {
      if (this.#partOffset === this.#part.length) await this.#nextPart();
      const size = Math.min(length, this.#part.length - this.#partOffset);
      length -= size;
      pieces.push(decoder.decode(this.#take(size), { stream: length > 0 }));
    }
    return pieces.join("");
  }

  #take(length: number): Buffer {
    const start = this.#partOffset;
    this.#partOffset += length;
    this.#offset += length;
    return this.#part.subarray(start, this.#partOffset);
  }

  async #nextPart(): Promise<void> {
    if (this.offset >= this.length) throw new Error("niceeval ledger export: truncated payload");
    this.#part = await this.#loadPart(this.#partIndex++);
    this.#partOffset = 0;
  }
}

async function parseExportPayload(payload: ExportPayloadReader, windows: DiffWindow[]): Promise<void> {
  while (payload.offset < payload.length) {
    const header = await payload.readDelimited(0x0a, payload.length);
    const match = /^window (?:[0-9a-f]{40}|[0-9a-f]{64}) (.+)$/.exec(header);
    if (match === null) {
      throw new Error(`niceeval ledger export: expected window header, got ${JSON.stringify(header)}`);
    }
    const label = match[1]!;
    const entries = await parseDiffTree(payload, await payload.sectionEnd("difftree"), label);
    const binaryPaths = await parseBinaryPaths(payload, await payload.sectionEnd("numstat"), label);
    const sizeBySha = await parseSizes(payload, await payload.sectionEnd("sizes"), label);
    const contentBySha = await parseBlobBatch(payload, await payload.sectionEnd("blobs"), label);

    const changes = Object.create(null) as globalThis.Record<string, WindowChange>;
    for (const entry of entries) {
      const change: WindowChange = { status: entry.status };
      const beforeBytes =
        entry.status === "added" ? undefined : requireSize(sizeBySha, entry.beforeSha, label, entry.path);
      const afterBytes =
        entry.status === "deleted" ? undefined : requireSize(sizeBySha, entry.afterSha, label, entry.path);
      if (binaryPaths.has(entry.path)) {
        change.elided = { reason: "binary" };
        if (beforeBytes !== undefined) change.elided.beforeBytes = beforeBytes;
        if (afterBytes !== undefined) change.elided.afterBytes = afterBytes;
      } else {
        if (entry.status !== "added") change.before = requireContent(contentBySha, entry.beforeSha, label, entry.path);
        if (entry.status !== "deleted") change.after = requireContent(contentBySha, entry.afterSha, label, entry.path);
      }
      if (Object.hasOwn(changes, entry.path)) {
        throw new Error(`export window ${label}: duplicate path ${JSON.stringify(entry.path)}`);
      }
      changes[entry.path] = change;
    }
    windows.push({ window: label, changes });
  }
}

interface DiffTreeEntry {
  path: string;
  status: WindowChange["status"];
  beforeSha: string;
  afterSha: string;
}

const DIFF_TREE_STATUS: Readonly<Record<string, WindowChange["status"]>> = {
  A: "added",
  D: "deleted",
  M: "modified",
  T: "modified",
};

/** `git diff-tree -r --no-renames -z` repeats NUL-delimited metadata and paths. */
async function parseDiffTree(payload: ExportPayloadReader, end: number, label: string): Promise<DiffTreeEntry[]> {
  const entries: DiffTreeEntry[] = [];
  while (payload.offset < end) {
    const meta = await payload.readDelimited(0, end);
    const path = await payload.readDelimited(0, end);
    const fields = meta.split(" ");
    const status = DIFF_TREE_STATUS[fields[4] ?? ""];
    if (path === "" || fields.length !== 5 || !fields[0]!.startsWith(":") || status === undefined) {
      throw new Error(`export window ${label}: malformed git diff-tree output`);
    }
    entries.push({ path, status, beforeSha: fields[2]!, afterSha: fields[3]! });
  }
  return entries;
}

/** Binary paths show "-" for both line counts in Git numstat. */
async function parseBinaryPaths(payload: ExportPayloadReader, end: number, label: string): Promise<Set<string>> {
  const paths = new Set<string>();
  while (payload.offset < end) {
    const record = await payload.readDelimited(0, end);
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) throw new Error(`export window ${label}: malformed git --numstat output`);
    if (record.slice(0, firstTab) === "-" && record.slice(firstTab + 1, secondTab) === "-") {
      paths.add(record.slice(secondTab + 1));
    }
  }
  return paths;
}

function parseBlobHeader(header: string, label: string): { sha: string; size: number } {
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9][0-9]*)$/.exec(header);
  const size = Number(match?.[2]);
  if (match === null || !Number.isSafeInteger(size)) {
    throw new Error(`export window ${label}: malformed git cat-file header`);
  }
  return { sha: match[1]!, size };
}

async function parseSizes(payload: ExportPayloadReader, end: number, label: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  while (payload.offset < end) {
    const { sha, size } = parseBlobHeader(await payload.readDelimited(0x0a, end), label);
    sizes.set(sha, size);
  }
  return sizes;
}

async function parseBlobBatch(payload: ExportPayloadReader, end: number, label: string): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  while (payload.offset < end) {
    const { sha, size } = parseBlobHeader(await payload.readDelimited(0x0a, end), label);
    if (size >= end - payload.offset) {
      throw new Error(`export window ${label}: truncated git cat-file --batch content`);
    }
    const text = await payload.readText(size);
    if ((await payload.readText(1)) !== "\n" || contents.has(sha)) {
      throw new Error(`export window ${label}: malformed git cat-file --batch content`);
    }
    contents.set(sha, text);
  }
  return contents;
}

function requireSize(sizes: Map<string, number>, sha: string, label: string, path: string): number {
  const size = sizes.get(sha);
  if (size === undefined || ZERO_SHA.test(sha))
    throw new Error(`export window ${label}: missing blob size for ${JSON.stringify(path)}`);
  return size;
}

function requireContent(contents: Map<string, string>, sha: string, label: string, path: string): string {
  const content = contents.get(sha);
  if (content === undefined || ZERO_SHA.test(sha))
    throw new Error(`export window ${label}: missing blob content for ${JSON.stringify(path)}`);
  return content;
}
