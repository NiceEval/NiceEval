/** Test-side reader for the built-in text report's named summary grid. */

export interface TextStatCell {
  readonly label: string;
  readonly value: string;
  /** Zero-based physical coordinates in the original frame, useful in mismatch messages. */
  readonly row: number;
  readonly column: number;
}

const STAT_GROUPS: readonly (readonly string[])[] = [
  ["Pass rate", "Experiments", "Evals"],
  ["Attempts", "Eval results", "Total cost"],
];

function stripAnsi(frame: string): string {
  return frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n");
}

/**
 * Read a value by its label and physical column. This intentionally does not search the whole
 * transcript for the value: a correct number in the wrong summary cell is still a mismatch.
 */
export function readTextStatCell(frame: string, label: string): TextStatCell | undefined {
  const lines = stripAnsi(frame).split("\n");
  for (const labels of STAT_GROUPS) {
    const field = labels.indexOf(label);
    if (field < 0) continue;
    const headerRow = lines.findIndex((line) => labels.every((candidate) => line.includes(candidate)));
    if (headerRow < 0 || lines[headerRow + 1] === undefined) return undefined;
    const starts = labels.map((candidate) => lines[headerRow]!.indexOf(candidate));
    const column = starts[field]!;
    const end = starts[field + 1];
    return {
      label,
      value: lines[headerRow + 1]!.slice(column, end).trim(),
      row: headerRow + 1,
      column,
    };
  }
  return undefined;
}
