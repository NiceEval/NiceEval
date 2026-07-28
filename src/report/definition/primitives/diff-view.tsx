// DiffView:文件清单与可展开 patch(docs/feature/reports/components/primitives/diff-view.md)。

import type { ReactElement, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import {
  dataShapeError,
  isObject,
  type DataProps,
} from "../../components/shared.ts";
import { type ReportLocale } from "../../model/locale.ts";
import type { SourceInput } from "../../source.ts";
import { defineComponent, type ResolveContext, type TextContext } from "../tree.ts";

export type DiffChange = "generated" | "modified" | "deleted";

export interface DiffFile {
  path: string;
  change: DiffChange;
  added: number;
  removed: number;
  patch?: string;
}

export type DiffContent = readonly DiffFile[];

export type DiffViewProps<Input extends SourceInput = SourceInput> = DataProps<
  DiffContent | null,
  globalThis.Record<never, never>,
  {
    locale?: ReportLocale;
    className?: string;
    /** text 面 `--diff` 下钻;数据源投影或 attempt page resolve 时填入。 */
    locator?: AttemptLocator;
  },
  Input
>;

type ResolvedDiffViewProps = {
  data: DiffContent | null;
  drillDown?: string;
  locator?: AttemptLocator;
  locale?: ReportLocale;
  className?: string;
};

const CHANGE_ORDER: readonly DiffChange[] = ["generated", "modified", "deleted"];

const CHANGE_LABEL: globalThis.Record<DiffChange, string> = {
  generated: "generated",
  modified: "modified",
  deleted: "deleted",
};

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function netLetter(change: DiffChange): string {
  return change === "generated" ? "A" : change === "deleted" ? "D" : "M";
}

function validateDiffFile(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a DiffFile object`;
  if (typeof value.path !== "string") return `"${path}.path" must be a string`;
  if (value.change !== "generated" && value.change !== "modified" && value.change !== "deleted") {
    return `"${path}.change" must be generated | modified | deleted`;
  }
  if (typeof value.added !== "number") return `"${path}.added" must be a number`;
  if (typeof value.removed !== "number") return `"${path}.removed" must be a number`;
  if (value.patch !== undefined && typeof value.patch !== "string") return `"${path}.patch" must be a string`;
  return null;
}

function assertDiffContent(data: unknown): DiffContent | null {
  if (data === null || data === undefined) return null;
  if (!Array.isArray(data)) {
    throw dataShapeError("DiffView", "diffViewData", "DiffContent", '"data" must be an array or null');
  }
  for (let i = 0; i < data.length; i++) {
    const problem = validateDiffFile(data[i], `data[${i}]`);
    if (problem !== null) throw dataShapeError("DiffView", "diffViewData", "DiffContent", problem);
  }
  return data as DiffContent;
}

function groupFiles(files: DiffContent): Array<{ change: DiffChange; files: DiffFile[] }> {
  const buckets = new Map<DiffChange, DiffFile[]>();
  for (const change of CHANGE_ORDER) buckets.set(change, []);
  for (const file of files) buckets.get(file.change)!.push(file);
  for (const list of buckets.values()) list.sort((a, b) => a.path.localeCompare(b.path));
  return CHANGE_ORDER.map((change) => ({ change, files: buckets.get(change)! })).filter((g) => g.files.length > 0);
}

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

function PatchBody({ patch }: { patch?: string }): ReactElement {
  if (patch === undefined || patch.trim().length === 0) {
    return <p className="niceeval-diff-patch-missing">Patch unavailable for this file.</p>;
  }
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

function FileRow({ file }: { file: DiffFile }): ReactElement {
  return (
    <li className={cx("niceeval-diff-file", `niceeval-diff-${file.change}`)}>
      <details>
        <summary className="niceeval-diff-file-summary">
          <span className="niceeval-diff-change">{CHANGE_LABEL[file.change]}</span>
          <span className="niceeval-diff-path">{file.path}</span>
          {/* 折叠态的增删数与展开后 patch 里的增行、删行同一套颜色(diff-view.md「渲染」)。 */}
          <span className="niceeval-diff-lines">
            <span className="niceeval-diff-lines-added">+{file.added}</span>
            {" / "}
            <span className="niceeval-diff-lines-removed">-{file.removed}</span>
          </span>
        </summary>
        <PatchBody patch={file.patch} />
      </details>
    </li>
  );
}

function attemptDrillDown(ctx: ResolveContext, flag: string): string | undefined {
  if (ctx.page.input !== "attempt") return undefined;
  return `niceeval show ${ctx.page.locator} ${flag}`;
}

export function diffViewText(
  data: DiffContent,
  ctx: TextContext,
  locator?: AttemptLocator,
  drillDown?: string,
): string {
  const head = [`changes: ${data.length} file${data.length === 1 ? "" : "s"} changed by agent`];
  const command =
    drillDown ??
    (locator !== undefined && ctx.attemptCommand ? `${ctx.attemptCommand(locator)} --diff` : undefined);
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  const sorted = [...data].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    lines.push(`  ${netLetter(file.change)} ${file.path} (+${file.added}/-${file.removed})`);
  }
  return lines.join("\n");
}

export const DiffView = defineComponent<DiffViewProps, ResolvedDiffViewProps>({
  dimensions: () => ({}),
  resolve(props, ctx) {
    const locator =
      props.locator ?? (ctx.page.input === "attempt" ? ctx.page.locator : undefined);
    return {
      data: props.data ?? null,
      drillDown: attemptDrillDown(ctx, "--diff"),
      locator,
      locale: props.locale,
      className: props.className,
    };
  },
  web({ data, className }) {
    const files = assertDiffContent(data);
    if (files === null || files.length === 0) return null;
    return (
      <div className={cx("niceeval-report", "niceeval-diff-view", className)}>
        {groupFiles(files).map((group) => (
          <section key={group.change} className="niceeval-diff-group" data-change={group.change}>
            <h3 className="niceeval-diff-group-title">{CHANGE_LABEL[group.change]}</h3>
            <ul className="niceeval-diff-group-list">
              {group.files.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  },
  text({ data, drillDown, locator }, ctx) {
    const files = assertDiffContent(data);
    if (files === null || files.length === 0) return "";
    return diffViewText(files, ctx, locator, drillDown);
  },
});
DiffView.displayName = "DiffView";
