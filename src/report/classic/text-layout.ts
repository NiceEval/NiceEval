/**
 * Classic custom text faces share the current terminal's width semantics.
 * These aliases preserve the familiar v0.12 names without creating a second
 * implementation that could disagree on CJK width or wrapping.
 */
export {
  indentBlock as indent,
  joinColumns as columns,
  padDisplay as padEnd,
  padStartDisplay as padStart,
  stringWidth,
  textBar as bar,
  wrapDisplay as wrapText,
} from "../model/text-layout.ts";
export type { ColumnAlign } from "../model/text-layout.ts";
