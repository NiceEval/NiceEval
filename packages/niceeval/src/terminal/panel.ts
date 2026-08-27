import { charDisplayWidth, padDisplay, stringWidth } from "./text-layout.ts";

export type PanelMode = "boxed" | "plain";

export function panelCapabilityOf(input: {
  readonly isTTY: boolean | undefined;
  readonly noColor?: string;
  readonly width: number | undefined;
}): { readonly mode: PanelMode; readonly width: number } {
  return Object.freeze({
    mode: input.isTTY === true && input.noColor === undefined ? "boxed" : "plain",
    width: Number.isFinite(input.width) && (input.width ?? 0) > 0 ? input.width! : 80,
  });
}

export type PanelRow =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "divider"; readonly title: string; readonly meta?: string };

export interface PanelInput {
  readonly title?: string;
  readonly meta?: string;
  readonly footerCommand?: string;
  readonly rows: readonly PanelRow[];
  readonly width: number;
  readonly mode: PanelMode;
  readonly capWidth?: boolean;
}

const MAX_BOX_WIDTH = 100;
const MIN_BOXED_WIDTH = 60;
const ELLIPSIS = "…";

function boxWidthOf(width: number, capWidth: boolean): number {
  const floored = Math.max(1, Math.floor(width));
  return capWidth ? Math.min(MAX_BOX_WIDTH, floored) : floored;
}

export function effectivePanelMode(mode: PanelMode, width: number): PanelMode {
  return mode === "boxed" && width >= MIN_BOXED_WIDTH ? "boxed" : "plain";
}

export function panelContentWidth(width: number, mode: PanelMode, capWidth = true): number {
  return effectivePanelMode(mode, width) === "boxed"
    ? Math.max(1, boxWidthOf(width, capWidth) - 4)
    : Math.max(1, Math.floor(width) - 2);
}

function takeByWidth(text: string, width: number): string {
  let output = "";
  let observed = 0;
  for (const character of text) {
    const characterWidth = charDisplayWidth(character.codePointAt(0)!);
    if (observed + characterWidth > width) break;
    output += character;
    observed += characterWidth;
  }
  return output;
}

function takeByWidthFromEnd(text: string, width: number): string {
  const characters = Array.from(text);
  let output = "";
  let observed = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]!;
    const characterWidth = charDisplayWidth(character.codePointAt(0)!);
    if (observed + characterWidth > width) break;
    output = character + output;
    observed += characterWidth;
  }
  return output;
}

function ellipsizeMiddle(text: string, targetWidth: number): string {
  if (stringWidth(text) <= targetWidth) return text;
  if (targetWidth <= 0) return "";
  if (targetWidth === 1) return ELLIPSIS;
  const budget = targetWidth - 1;
  const head = Math.ceil(budget / 2);
  return `${takeByWidth(text, head)}${ELLIPSIS}${takeByWidthFromEnd(text, budget - head)}`;
}

function fitTitleMeta(title: string | undefined, meta: string | undefined, inner: number) {
  const fits = (left: string | undefined, right: string | undefined): boolean => {
    const leftWidth = left === undefined ? 0 : stringWidth(left) + 3;
    const rightWidth = right === undefined ? 0 : stringWidth(right) + 3;
    return inner - leftWidth - rightWidth >= (left !== undefined && right !== undefined ? 1 : 0);
  };
  if (fits(title, meta)) return { title, meta };
  if (title !== undefined) {
    const metaWidth = meta === undefined ? 0 : stringWidth(meta) + 3;
    const truncated = ellipsizeMiddle(title, Math.max(1, inner - 3 - metaWidth - (meta === undefined ? 0 : 1)));
    if (fits(truncated, meta)) return { title: truncated, meta };
  }
  return { title: title === undefined ? undefined : ellipsizeMiddle(title, Math.max(1, inner - 3)) };
}

function border(corners: readonly [string, string], title: string | undefined, meta: string | undefined, width: number): string {
  const fit = fitTitleMeta(title, meta, width - 2);
  const left = fit.title === undefined ? "" : `─ ${fit.title} `;
  const right = fit.meta === undefined ? "" : ` ${fit.meta} ─`;
  return `${corners[0]}${left}${"─".repeat(Math.max(0, width - 2 - stringWidth(left) - stringWidth(right)))}${right}${corners[1]}`;
}

function contentLine(text: string, width: number): string {
  const value = stringWidth(text) <= width ? text : `${takeByWidth(text, Math.max(0, width - 1))}${ELLIPSIS}`;
  return `│ ${padDisplay(value, width)} │`;
}

function headingLines(title: string, meta: string | undefined, width: number): string[] {
  if (meta === undefined) return [title];
  const gap = width - stringWidth(title) - stringWidth(meta);
  return gap >= 1 ? [title + " ".repeat(gap) + meta] : [title, `  ${meta}`];
}

function renderPlain(input: PanelInput): string[] {
  const width = Math.max(1, Math.floor(input.width));
  const lines: string[] = [];
  if (input.title !== undefined) lines.push(...headingLines(input.title, input.meta, width));
  for (const row of input.rows) {
    if (row.kind === "divider") lines.push(...headingLines(row.title, row.meta, width).map((line) => `  ${line}`));
    else lines.push(...row.text.split("\n").map((line) => `  ${line}`));
  }
  if (input.footerCommand !== undefined) lines.push(`  ${input.footerCommand}`);
  return lines;
}

function renderBoxed(input: PanelInput): string[] {
  const width = boxWidthOf(input.width, input.capWidth ?? true);
  const lines = [border(["╭", "╮"], input.title, input.meta, width)];
  for (const row of input.rows) {
    if (row.kind === "divider") lines.push(border(["├", "┤"], row.title, row.meta, width));
    else lines.push(...row.text.split("\n").map((line) => contentLine(line, width - 4)));
  }
  lines.push(border(["╰", "╯"], undefined, input.footerCommand, width));
  return lines;
}

export function renderPanel(input: PanelInput): string[] {
  return effectivePanelMode(input.mode, input.width) === "boxed" ? renderBoxed(input) : renderPlain(input);
}
