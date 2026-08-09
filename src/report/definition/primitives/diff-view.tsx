// DiffView:按路径分层的文件清单与逐窗口 patch
// (docs/feature/reports/README.md)。值形状、摘要文本、内联预算与
// 树的构成都在 diff-lines.ts,这里只负责两面渲染。

import type { ReactElement, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { isAttemptEvidence } from "../../../record/attempt-evidence.ts";
import { normalizeTurnLabel } from "../../../shared/turn-label.ts";
import { ATTEMPT_PAGE_ID, dataShapeError, isObject } from "../../components/shared.ts";
import { type ReportLocale } from "../../model/locale.ts";
import { defineComponent, type ResolveContext, type TextContext } from "../tree.ts";
import {
  buildDiffTree,
  diffChangeLetter,
  diffElidedLabel,
  diffSummaryText,
  planInlinePatches,
  type DiffContent,
  type DiffFile,
  type DiffFileWindow,
  type DiffTreeNode,
} from "./diff-lines.ts";

export type { DiffChange, DiffContent, DiffFile, DiffFileWindow } from "./diff-lines.ts";

export interface DiffViewProps {
  files: DiffContent | null;
  locale?: ReportLocale;
  className?: string;
  /** text 面 `--diff` 下钻;数据源投影或 attempt page resolve 时填入。 */
  locator?: AttemptLocator;
}

type ResolvedDiffViewProps = {
  files: DiffContent | null;
  drillDown?: string;
  locator?: AttemptLocator;
  locale?: ReportLocale;
  className?: string;
};

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function validateDiffFile(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a DiffFile object`;
  if (typeof value.path !== "string") return `"${path}.path" must be a string`;
  if (value.change !== "added" && value.change !== "modified" && value.change !== "deleted") {
    return `"${path}.change" must be added | modified | deleted`;
  }
  if (typeof value.added !== "number") return `"${path}.added" must be a number`;
  if (typeof value.removed !== "number") return `"${path}.removed" must be a number`;
  if (!Array.isArray(value.windows)) return `"${path}.windows" must be an array of DiffFileWindow`;
  for (let i = 0; i < value.windows.length; i++) {
    const w: unknown = value.windows[i];
    if (!isObject(w) || typeof w.window !== "string") {
      return `"${path}.windows[${i}].window" must be a string`;
    }
    if (w.patch !== undefined && typeof w.patch !== "string") {
      return `"${path}.windows[${i}].patch" must be a string`;
    }
  }
  return null;
}

function assertDiffContent(files: unknown): DiffContent | null {
  if (files === null || files === undefined) return null;
  if (!Array.isArray(files)) {
    throw dataShapeError("DiffView", "diffViewFiles", "DiffContent", '"files" must be an array or null');
  }
  for (let i = 0; i < files.length; i++) {
    const problem = validateDiffFile(files[i], `files[${i}]`);
    if (problem !== null) throw dataShapeError("DiffView", "diffViewFiles", "DiffContent", problem);
  }
  return files as DiffContent;
}

// ───────────────────────── patch 正文 ─────────────────────────

interface PatchLine {
  kind: "add" | "remove" | "context" | "meta";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

function parsePatchLines(patch: string): PatchLine[] {
  const out: PatchLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      out.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      out.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", oldNo: null, newNo, text: raw.slice(1) });
      newNo += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "remove", oldNo, newNo: null, text: raw.slice(1) });
      oldNo += 1;
      continue;
    }
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    out.push({ kind: "context", oldNo, newNo, text });
    oldNo += 1;
    newNo += 1;
  }
  return out;
}

function PatchBody({ patch }: { patch: string }): ReactElement {
  const lines = parsePatchLines(patch);
  return (
    <pre className="niceeval-diff-patch">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cx(
            "niceeval-diff-patch-line",
            line.kind === "add" && "niceeval-diff-patch-line--add",
            line.kind === "remove" && "niceeval-diff-patch-line--remove",
            line.kind === "meta" && "niceeval-diff-patch-line--meta",
          )}
        >
          <span className="niceeval-diff-patch-ln niceeval-diff-patch-ln-old">
            {line.oldNo === null ? "" : line.oldNo}
          </span>
          <span className="niceeval-diff-patch-ln niceeval-diff-patch-ln-new">
            {line.newNo === null ? "" : line.newNo}
          </span>
          <span className="niceeval-diff-patch-text">{line.text}</span>
        </div>
      ))}
    </pre>
  );
}

/** 一个文件的展开区:窗口之间独立分段,不合成跨窗口 patch。 */
function WindowSections({ windows }: { windows: readonly DiffFileWindow[] }): ReactElement {
  const withPatch = windows.filter((w) => w.patch !== undefined && w.patch.length > 0);
  if (withPatch.length === 0) {
    return <p className="niceeval-diff-patch-missing">Patch unavailable for this file.</p>;
  }
  return (
    <>
      {withPatch.map((w) => (
        <section key={w.window} className="niceeval-diff-window">
          <h4 className="niceeval-diff-window-title">window {normalizeTurnLabel(w.window)}</h4>
          <PatchBody patch={w.patch!} />
        </section>
      ))}
    </>
  );
}

// ───────────────────────── 路径树 ─────────────────────────

function basename(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

function LineCounts({ added, removed }: { added: number; removed: number }): ReactElement {
  // 折叠态的增删数与展开后 patch 里的增行、删行同一套颜色(diff-view.md「web 面:路径树」)。
  return (
    <span className="niceeval-diff-lines">
      <span className="niceeval-diff-lines-added">+{added}</span>
      {" / "}
      <span className="niceeval-diff-lines-removed">-{removed}</span>
    </span>
  );
}

function FileSummary({ file }: { file: DiffFile }): ReactNode {
  return (
    <>
      <span className="niceeval-diff-change" data-change={file.change}>
        {diffChangeLetter(file.change)}
      </span>
      <span className="niceeval-diff-path">{basename(file.path)}</span>
      {/* 内容被省略的文件行:字节数变化 + 原因标注,替掉没有意义的 +N / -M(diff-view.md「web 面:路径树」)。 */}
      {file.elided ? (
        <span className="niceeval-diff-bytes">
          {diffElidedLabel(file.elided.reason)} {file.elided.beforeBytes ?? 0} → {file.elided.afterBytes ?? 0} bytes
        </span>
      ) : (
        <LineCounts added={file.added} removed={file.removed} />
      )}
    </>
  );
}

function FileRow({
  file,
  inlined,
  drillCommand,
}: {
  file: DiffFile;
  inlined: boolean;
  drillCommand?: string;
}): ReactElement {
  const className = cx("niceeval-diff-file", `niceeval-diff-${file.change}`);
  // 内联不了的文件不给空的展开区:直接把下钻命令摆在行上(diff-view.md「内联预算」)。
  if (!inlined) {
    // 内容被省略的文件没有 patch 可看,不给下钻命令(下钻也拿不到内容);超预算的文件把命令摆在行上。
    const elided = file.elided;
    return (
      <li className={className} data-inlined="false">
        <div className="niceeval-diff-file-summary">
          <FileSummary file={file} />
        </div>
        <p className="niceeval-diff-patch-omitted">
          {elided ? `${diffElidedLabel(elided.reason)} file · content elided from the diff export` : "patch over inline budget"}
          {elided === undefined && drillCommand !== undefined ? (
            <>
              {" · "}
              <code>{`${drillCommand}=${file.path}`}</code>
            </>
          ) : null}
        </p>
      </li>
    );
  }
  return (
    <li className={className} data-inlined="true">
      <details>
        <summary className="niceeval-diff-file-summary">
          <FileSummary file={file} />
        </summary>
        <WindowSections windows={file.windows} />
      </details>
    </li>
  );
}

function TreeList({
  node,
  inlined,
  drillCommand,
}: {
  node: DiffTreeNode;
  inlined: Set<string>;
  drillCommand?: string;
}): ReactElement {
  return (
    <ul className="niceeval-diff-tree">
      {node.dirs.map((dir) => (
        <li key={dir.path} className="niceeval-diff-dir">
          {/* 目录默认展开:文件清单是这个区块的主体,不藏在一次点击后面。 */}
          <details open>
            <summary className="niceeval-diff-dir-summary">
              <span className="niceeval-diff-dir-name">{dir.name}/</span>
              <span className="niceeval-diff-dir-count">
                {dir.fileCount} {dir.fileCount === 1 ? "file" : "files"}
              </span>
              <LineCounts added={dir.added} removed={dir.removed} />
            </summary>
            <TreeList node={dir} inlined={inlined} drillCommand={drillCommand} />
          </details>
        </li>
      ))}
      {node.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          inlined={inlined.has(file.path)}
          drillCommand={drillCommand}
        />
      ))}
    </ul>
  );
}

function attemptDrillDown(ctx: ResolveContext, flag: string): string | undefined {
  const input = ctx.page.input;
  if (!isAttemptEvidence(input)) return undefined;
  return `niceeval show ${input.locator} ${flag}`;
}

export function diffViewText(
  files: DiffContent,
  ctx: TextContext,
  locator?: AttemptLocator,
  drillDown?: string,
): string {
  const command =
    drillDown ?? (locator !== undefined ? ctx.command({ page: ATTEMPT_PAGE_ID, params: { locator } }) : undefined);
  return diffSummaryText(files, { drillDown: command !== undefined ? `${command} --diff` : undefined });
}

export const DiffView = defineComponent<DiffViewProps, ResolvedDiffViewProps>({
  dimensions: () => ({}),
  resolve(props, ctx) {
    const locator = props.locator ?? (isAttemptEvidence(ctx.page.input) ? ctx.page.input.locator : undefined);
    return {
      files: props.files ?? null,
      drillDown: attemptDrillDown(ctx, "--diff"),
      locator,
      locale: props.locale,
      className: props.className,
    };
  },
  web({ files, locator, className }) {
    const list = assertDiffContent(files);
    if (list === null || list.length === 0) return null;
    const drillCommand = locator === undefined ? undefined : `niceeval show ${locator} --diff`;
    return (
      <div className={cx("niceeval-report", "niceeval-diff-view", className)}>
        <TreeList node={buildDiffTree(list)} inlined={planInlinePatches(list)} drillCommand={drillCommand} />
      </div>
    );
  },
  text({ files, drillDown, locator }, ctx) {
    const list = assertDiffContent(files);
    if (list === null || list.length === 0) return "";
    return diffViewText(list, ctx, locator, drillDown);
  },
});
DiffView.displayName = "DiffView";
