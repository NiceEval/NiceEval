// AttemptDiff:generated / modified / deleted 文件摘要与展开的行变化统计。没有变更时零输出
// (docs/feature/reports/components/attempt-detail.md)。

import type { ReactElement } from "react";
import type { AttemptDiffData, AttemptDiffFileEntry } from "../../model/types.ts";
import { cx } from "../shared.ts";

const NET_LABEL: Record<AttemptDiffFileEntry["net"], string> = { added: "generated", modified: "modified", deleted: "deleted" };

function FileRow({ file }: { file: AttemptDiffFileEntry }): ReactElement {
  return (
    <li className={cx("nre-diff-file", `nre-diff-${file.net}`)}>
      <span className="nre-diff-net">{NET_LABEL[file.net]}</span>
      <span className="nre-diff-path">{file.path}</span>
      {file.binary ? (
        <span className="nre-diff-lines">binary</span>
      ) : (
        <span className="nre-diff-lines">
          +{file.lines.added} / -{file.lines.deleted}
        </span>
      )}
    </li>
  );
}

export function AttemptDiff({ data, className }: { data: AttemptDiffData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  return (
    <ul className={cx("nre", "nre-attempt-diff", className)}>
      {data.files.map((f) => (
        <FileRow key={f.path} file={f} />
      ))}
    </ul>
  );
}
