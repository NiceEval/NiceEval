import {
  effectivePanelMode,
  panelContentWidth,
  renderPanel,
  type PanelMode,
  type PanelRow,
} from "./panel.ts";
import {
  charDisplayWidth,
  padDisplay,
  stringWidth,
  wrapDisplay,
} from "./text-layout.ts";

export interface TerminalRenderOptions {
  readonly width: number;
  readonly mode: PanelMode;
}

export interface TerminalDividerBlock {
  readonly kind: "divider";
  readonly title: string;
  readonly meta?: string;
  readonly attachNext?: boolean;
}

export interface TerminalKeyValueBlock {
  readonly kind: "keyValue";
  readonly entries: readonly {
    readonly key: string;
    readonly value: string;
  }[];
}

export interface TerminalTableColumn {
  readonly header: string;
  readonly maxWidth?: number;
}

export interface TerminalTableBlock {
  readonly kind: "table";
  readonly columns: readonly TerminalTableColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly overflow?: "truncate" | "wrap";
}

export interface TerminalTreeNode {
  readonly label: string;
  readonly children?: readonly TerminalTreeNode[];
}

export interface TerminalTreeBlock {
  readonly kind: "tree";
  readonly nodes: readonly TerminalTreeNode[];
}

export interface TerminalRawBlock {
  readonly kind: "raw";
  readonly text: string;
}

export interface TerminalCodeBlock {
  readonly kind: "code";
  readonly text: string;
  readonly language?: string;
}

export interface TerminalCommandBlock {
  readonly kind: "command";
  readonly command: string;
}

export type TerminalContentBlock =
  | TerminalDividerBlock
  | TerminalKeyValueBlock
  | TerminalTableBlock
  | TerminalTreeBlock
  | TerminalRawBlock
  | TerminalCodeBlock
  | TerminalCommandBlock;

export type TerminalPanelContentBlock = Exclude<
  TerminalContentBlock,
  TerminalRawBlock | TerminalCodeBlock
>;

export interface TerminalPanelBlock {
  readonly kind: "panel";
  readonly title?: string;
  readonly meta?: string;
  readonly footerCommand?: string;
  readonly blocks: readonly TerminalPanelContentBlock[];
  readonly capWidth?: boolean;
}

export type TerminalBlock = TerminalPanelBlock | TerminalContentBlock;

const COLUMN_GAP = 2;
const DEFAULT_MAX_COLUMN_WIDTH = 40;
const ELLIPSIS = "…";

function takeDisplay(text: string, width: number): string {
  let output = "";
  let observed = 0;
  for (const character of text) {
    const next = charDisplayWidth(character.codePointAt(0)!);
    if (observed + next > width) break;
    output += character;
    observed += next;
  }
  return output;
}

function truncateDisplay(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  if (width <= 0) return "";
  if (width === 1) return ELLIPSIS;
  return `${takeDisplay(text, width - 1)}${ELLIPSIS}`;
}

function tableWidths(block: TerminalTableBlock, width: number): number[] {
  const widths = block.columns.map((column, index) => {
    const observed = Math.max(
      stringWidth(column.header),
      ...block.rows.flatMap((row) => (row[index] ?? "").split("\n").map(stringWidth)),
    );
    return Math.max(1, Math.min(column.maxWidth ?? DEFAULT_MAX_COLUMN_WIDTH, observed));
  });
  const available = Math.max(
    widths.length,
    Math.floor(width) - Math.max(0, widths.length - 1) * COLUMN_GAP,
  );
  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    const widest = Math.max(...widths);
    const index = widths.findIndex((value) => value === widest);
    if (index < 0 || widths[index] === 1) break;
    widths[index] -= 1;
  }
  return widths;
}

function renderTable(block: TerminalTableBlock, width: number, mode: PanelMode): string[] {
  if (block.columns.length === 0) return [];
  const widths = tableWidths(block, width);
  const separator = mode === "boxed" ? "─" : "-";
  const renderRow = (cells: readonly string[], wrap: boolean): string[] => {
    const physical = widths.map((columnWidth, index) => {
      const value = cells[index] ?? "";
      return wrap && columnWidth >= 4
        ? wrapDisplay(value, columnWidth)
        : value.split("\n").map((line) => truncateDisplay(line, columnWidth));
    });
    const height = Math.max(...physical.map((cell) => cell.length), 1);
    return Array.from({ length: height }, (_, line) =>
      physical
        .map((cell, index) => padDisplay(cell[line] ?? "", widths[index]!))
        .join(" ".repeat(COLUMN_GAP))
        .trimEnd(),
    );
  };
  return [
    ...renderRow(block.columns.map((column) => column.header), false),
    widths.map((columnWidth) => separator.repeat(columnWidth)).join(" ".repeat(COLUMN_GAP)),
    ...block.rows.flatMap((row) => renderRow(row, block.overflow === "wrap")),
  ];
}

function renderKeyValue(block: TerminalKeyValueBlock, width: number): string[] {
  if (block.entries.length === 0) return [];
  const keyWidth = Math.min(
    Math.max(...block.entries.map((entry) => stringWidth(entry.key))),
    Math.max(1, Math.floor(width / 2)),
  );
  const valueWidth = Math.max(4, width - keyWidth - COLUMN_GAP);
  return block.entries.flatMap((entry) => {
    const key = truncateDisplay(entry.key, keyWidth);
    const values = wrapDisplay(entry.value, valueWidth);
    return values.map((value, index) =>
      `${index === 0 ? padDisplay(key, keyWidth) : " ".repeat(keyWidth)}  ${value}`.trimEnd(),
    );
  });
}

function renderTree(block: TerminalTreeBlock, width: number, mode: PanelMode): string[] {
  const lines: string[] = [];
  const visit = (nodes: readonly TerminalTreeNode[], ancestors: readonly boolean[]): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const indent = ancestors
        .map((ancestorLast) => (ancestorLast ? "   " : mode === "boxed" ? "│  " : "|  "))
        .join("");
      const branch = mode === "boxed" ? (last ? "└─ " : "├─ ") : "- ";
      const prefix = `${indent}${branch}`;
      const labelWidth = Math.max(4, width - stringWidth(prefix));
      const labels = wrapDisplay(node.label, labelWidth);
      lines.push(...labels.map((label, line) => `${line === 0 ? prefix : " ".repeat(stringWidth(prefix))}${label}`));
      if (node.children?.length) visit(node.children, [...ancestors, last]);
    });
  };
  visit(block.nodes, []);
  return lines;
}

function renderContent(block: TerminalContentBlock, options: TerminalRenderOptions): string[] {
  switch (block.kind) {
    case "divider": {
      const meta = block.meta === undefined ? "" : `  ${block.meta}`;
      if (options.mode === "plain") return [`${block.title}${meta}`];
      const heading = `─ ${block.title}${meta} `;
      return [`${heading}${"─".repeat(Math.max(0, options.width - stringWidth(heading)))}`];
    }
    case "keyValue":
      return renderKeyValue(block, options.width);
    case "table":
      return renderTable(block, options.width, options.mode);
    case "tree":
      return renderTree(block, options.width, options.mode);
    case "raw":
    case "code":
      return block.text.split("\n");
    case "command":
      return [block.command];
  }
}

function renderPanelBlock(block: TerminalPanelBlock, options: TerminalRenderOptions): string[] {
  const contentWidth = panelContentWidth(options.width, options.mode, block.capWidth);
  const rows: PanelRow[] = [];
  block.blocks.forEach((child, index) => {
    const previous = block.blocks[index - 1];
    if (index > 0) {
      const attachedToPrevious = previous?.kind === "divider" && previous.attachNext === true;
      if (
        !attachedToPrevious &&
        (child.kind !== "divider" || child.attachNext === true)
      ) {
        rows.push({ kind: "line", text: "" });
      }
    }
    if (child.kind === "divider") {
      rows.push({ kind: "divider", title: child.title, meta: child.meta });
      return;
    }
    rows.push(
      ...renderContent(child, { ...options, width: contentWidth }).map((text) => ({
        kind: "line" as const,
        text,
      })),
    );
  });
  return renderPanel({
    title: block.title,
    meta: block.meta,
    footerCommand: block.footerCommand,
    rows,
    width: options.width,
    mode: options.mode,
    capWidth: block.capWidth,
  });
}

export function renderBlocks(
  blocks: readonly TerminalBlock[],
  options: TerminalRenderOptions,
): string[] {
  const effectiveOptions = {
    ...options,
    mode: effectivePanelMode(options.mode, options.width),
  };
  return blocks.flatMap((block, index) => [
    ...(index === 0 ? [] : [""]),
    ...(block.kind === "panel"
      ? renderPanelBlock(block, effectiveOptions)
      : renderContent(block, effectiveOptions)),
  ]);
}

export function renderTerminal(
  blocks: readonly TerminalBlock[],
  options: TerminalRenderOptions,
): string {
  const lines = renderBlocks(blocks, options);
  if (lines.length === 0) return "";
  const output = lines.join("\n");
  return output.endsWith("\n") ? output : `${output}\n`;
}
