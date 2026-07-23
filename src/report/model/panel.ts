// 面板渲染件:全仓终端框线的单一物理实现(docs/feature/reports/library/layout.md「区域框:
// text 面的框线体裁」定几何契约,docs/cli.md「终端框线:一个渲染件,全仓消费」定这个模块的
// 落点与依赖方向)。同步纯函数,消费 text-layout.ts 的显示宽度量测,零 IO——不读 process、
// 不知道 stdout/stderr、不管重画。三处消费方(`Section` 的 text 面、`runner/feedback/human.ts`
// 的 live/结束面板、`sandbox/cli-commands.ts` 的 list/history)都经这里取物理行,不各自拼
// `╭─`/`╰─` 字符;传输能力(TTY、宽度、NO_COLOR)由调用方探测后经 `mode`/`width` 注入,
// 这里只负责几何。

import { charDisplayWidth, padDisplay, stringWidth } from "./text-layout.ts";

/** 面板的传输能力:`"boxed"` 画框线,`"plain"` 降级为无框文本。由调用方按真实 TTY / NO_COLOR
 *  探测结果注入——是否真的画框还要再叠加宽度下限(见 `renderPanel`),调用方不用自己判断
 *  「窄于 60 列怎么办」,那份判断只在这个模块里实现一次。 */
export type PanelMode = "boxed" | "plain";

/** 面板传输能力的唯一探测规则；调用方提供自己的 IO 事实，测试也可稳定注入。 */
export function panelCapabilityOf(input: {
  isTTY: boolean | undefined;
  noColor?: string;
  width: number | undefined;
}): { mode: PanelMode; width: number } {
  const mode: PanelMode = input.isTTY === true && input.noColor === undefined ? "boxed" : "plain";
  const width = Number.isFinite(input.width) && (input.width ?? 0) > 0 ? (input.width as number) : 80;
  return { mode, width };
}

/**
 * 面板收到的一行逻辑内容:`"line"` 是已经按内容宽度组好的一段正文(可以内嵌 `\n` 表示多个
 * 物理行,调用方不需要预先拆行);`"divider"` 是一个嵌套 `Section` 降级出的横隔——`boxed`
 * 模式下渲染成贯穿框宽的 `├─ 标题 ─┤`,`plain` 模式下渲染成与顶层同规则的标题(+meta)行。
 */
export type PanelRow =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "divider"; readonly title: string; readonly meta?: string };

/** `renderPanel` 的输入:与 docs/cli.md「终端框线」声明的形状一致。 */
export interface PanelInput {
  /** 上边框左侧嵌入的标题;省略时上边框只是纯横线(bottom-border-with-footer 的形态)。 */
  readonly title?: string;
  /** 上边框右侧嵌入的短元信息(如耗时、规模);空间不足时最先被舍弃。 */
  readonly meta?: string;
  /** 下边框右侧嵌入的下一步命令(如批量清理、下钻 diff);省略时下边框是纯横线。 */
  readonly footerCommand?: string;
  /** 已经组好的逻辑行,声明顺序即渲染顺序。 */
  readonly rows: readonly PanelRow[];
  /** 调用方报告的可用显示列数(终端宽度或已定宽的渲染上下文);默认在这里统一夹紧到 100,
   *  `capWidth: false` 声明豁免时框宽原样跟随这个值。 */
  readonly width: number;
  /** 传输能力;是否真的画框由这里叠加宽度下限后决定,调用方不重复这份判断。 */
  readonly mode: PanelMode;
  /** 声明豁免 100 列上限:`false` 时框宽跟随 `width` 全宽,不夹紧;省略或 `true` 时沿用上限
   *  (默认行为不变)。只有原地重绘、从不进入 scrollback 的动态面板可以声明豁免——豁免声明见
   *  docs/feature/reports/library/layout.md「区域框:text 面的框线体裁」几何段。 */
  readonly capWidth?: boolean;
}

/** 区域框契约的宽度上限:框宽跟随终端但不超过这个显示列数,除非调用方经
 *  `PanelInput.capWidth: false` 声明豁免。 */
const MAX_BOX_WIDTH = 100;
/** 终端窄于这个显示列数时,不论 `mode` 如何都整体降级为无框文本。 */
const MIN_BOXED_WIDTH = 60;
/** 标题/meta 截断时补的省略号;East-Asian-Ambiguous,按 `charDisplayWidth` 恒记 1 列。 */
const ELLIPSIS = "…";

/** 框宽 = capWidth 时 min(终端可用宽度, 100),豁免时原样等于终端可用宽度;两侧留出边框列。 */
function boxWidthOf(width: number, capWidth: boolean): number {
  const floored = Math.max(1, Math.floor(width));
  return capWidth ? Math.min(MAX_BOX_WIDTH, floored) : floored;
}

/** 宽度下限与 `mode` 叠加后的真实体裁:调用方只报能力,「窄于 60 列怎么办」只在这里判一次。 */
function effectiveMode(mode: PanelMode, width: number): PanelMode {
  return mode === "boxed" && width >= MIN_BOXED_WIDTH ? "boxed" : "plain";
}

/**
 * 子节点(或调用方自己的正文)应该按多宽的显示列排版。`boxed` 模式下框宽减 4(左右边框各
 * 1 列 + 1 格 padding);`plain` 模式下只减 2(两列缩进)。嵌套 Section 复用同一个函数、
 * 同一个 `width` 参数——嵌套不吞可用宽度。
 */
export function panelContentWidth(width: number, mode: PanelMode, capWidth = true): number {
  const eff = effectiveMode(mode, width);
  if (eff === "boxed") return Math.max(1, boxWidthOf(width, capWidth) - 4);
  return Math.max(1, Math.floor(width) - 2);
}

/** 按显示宽度从头部截取,不超过 `width` 列(不足一个字符宽度的尾部丢弃,不产生半格)。 */
function takeByWidth(text: string, width: number): string {
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = charDisplayWidth(ch.codePointAt(0)!);
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** 按显示宽度从尾部截取,不超过 `width` 列。 */
function takeByWidthFromEnd(text: string, width: number): string {
  const chars = Array.from(text);
  let out = "";
  let w = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charDisplayWidth(chars[i]!.codePointAt(0)!);
    if (w + cw > width) break;
    out = chars[i] + out;
    w += cw;
  }
  return out;
}

/** 中段截断补 `…`:保留头尾,丢中间——命令行/标题过长时都用这条规则,不是各自发明的特例。 */
function ellipsizeMiddle(text: string, targetWidth: number): string {
  if (stringWidth(text) <= targetWidth) return text;
  if (targetWidth <= 0) return "";
  if (targetWidth === 1) return ELLIPSIS;
  const budget = targetWidth - stringWidth(ELLIPSIS);
  const headWidth = Math.ceil(budget / 2);
  const tailWidth = budget - headWidth;
  return `${takeByWidth(text, headWidth)}${ELLIPSIS}${takeByWidthFromEnd(text, tailWidth)}`;
}

/** 一条边框线里,标题/meta 各自占用的固定字符数(不含内容本身):"─ " + " " 或 " " + " ─"。 */
const EMBED_OVERHEAD = 3;

/**
 * 上/下边框(或嵌套横隔)嵌字的截断优先级:横线先缩到最短一段;缩到头先截标题中段补 `…`,
 * 最后才放弃 meta——meta 通常在正文里另有出处,标题没有。
 */
function fitTitleMeta(
  title: string | undefined,
  meta: string | undefined,
  inner: number,
): { title?: string; meta?: string } {
  if (title === undefined && meta === undefined) return {};
  const minFill = title !== undefined && meta !== undefined ? 1 : 0;
  const fits = (t: string | undefined, m: string | undefined): boolean => {
    const l = t !== undefined ? stringWidth(t) + EMBED_OVERHEAD : 0;
    const r = m !== undefined ? stringWidth(m) + EMBED_OVERHEAD : 0;
    return inner - l - r >= minFill;
  };

  if (fits(title, meta)) return { title, meta };

  if (title !== undefined) {
    const rFixed = meta !== undefined ? stringWidth(meta) + EMBED_OVERHEAD : 0;
    const targetTitleWidth = Math.max(1, inner - EMBED_OVERHEAD - rFixed - minFill);
    const truncated = ellipsizeMiddle(title, targetTitleWidth);
    if (fits(truncated, meta)) return { title: truncated, meta };
  }

  if (meta === undefined) {
    // 没有 meta 可放弃了:标题已经尽量截到当前可用宽度,如实返回(极窄框的最后手段)。
    const targetTitleWidth = Math.max(1, inner - EMBED_OVERHEAD);
    return { title: title !== undefined ? ellipsizeMiddle(title, targetTitleWidth) : undefined };
  }

  // 放弃 meta,标题重新对着让出来的整条宽度截断。
  const targetTitleWidth = Math.max(1, inner - EMBED_OVERHEAD);
  return { title: title !== undefined ? ellipsizeMiddle(title, targetTitleWidth) : undefined, meta: undefined };
}

/** 一条边框线:corners[0] + 左嵌字 + 横线 + 右嵌字 + corners[1],总显示宽度恒等于 `boxWidth`。 */
function buildBorderLine(
  corners: readonly [string, string],
  title: string | undefined,
  meta: string | undefined,
  boxWidth: number,
): string {
  const inner = boxWidth - 2;
  const fit = fitTitleMeta(title, meta, inner);
  const left = fit.title !== undefined ? `─ ${fit.title} ` : "";
  const right = fit.meta !== undefined ? ` ${fit.meta} ─` : "";
  const fillLen = Math.max(0, inner - stringWidth(left) - stringWidth(right));
  return `${corners[0]}${left}${"─".repeat(fillLen)}${right}${corners[1]}`;
}

/** 一条正文行:左右边框各 1 列 + 1 格 padding,超宽的行尾截断补 `…`(不换行撑高——「已经组好
 *  的逻辑行」是调用方的责任,这里只是防御性兜底,不重新实现折行)。 */
function buildContentLine(text: string, contentWidth: number): string {
  const truncated =
    stringWidth(text) <= contentWidth
      ? text
      : `${takeByWidth(text, Math.max(0, contentWidth - stringWidth(ELLIPSIS)))}${ELLIPSIS}`;
  return `│ ${padDisplay(truncated, contentWidth)} │`;
}

/** boxed 体裁:顶层完整四边框,`rows` 里的 `divider` 降为横隔,不再嵌套画框。 */
function renderBoxed(input: PanelInput): string[] {
  const boxWidth = boxWidthOf(input.width, input.capWidth ?? true);
  const contentWidth = boxWidth - 4;
  const lines: string[] = [buildBorderLine(["╭", "╮"], input.title, input.meta, boxWidth)];
  for (const row of input.rows) {
    if (row.kind === "divider") {
      lines.push(buildBorderLine(["├", "┤"], row.title, row.meta, boxWidth));
      continue;
    }
    for (const physical of row.text.split("\n")) lines.push(buildContentLine(physical, contentWidth));
  }
  lines.push(buildBorderLine(["╰", "╯"], undefined, input.footerCommand, boxWidth));
  return lines;
}

/** 无框正文行:title 单独成行(+meta 同行右侧,放不下换到下一行两格缩进),内容一字不变。 */
function headingLines(title: string, meta: string | undefined, width: number): string[] {
  if (meta === undefined) return [title];
  const gap = width - stringWidth(title) - stringWidth(meta);
  if (gap >= 1) return [title + " ".repeat(gap) + meta];
  return [title, `  ${meta}`];
}

/** plain 体裁:降级为无框文本,title 单独成行、meta 跟在同一行右侧、正文缩进两列。 */
function renderPlain(input: PanelInput): string[] {
  const width = Math.max(1, Math.floor(input.width));
  const lines: string[] = [];
  if (input.title !== undefined) lines.push(...headingLines(input.title, input.meta, width));
  for (const row of input.rows) {
    if (row.kind === "divider") {
      lines.push(...headingLines(row.title, row.meta, width).map((l) => `  ${l}`));
      continue;
    }
    for (const physical of row.text.split("\n")) lines.push(`  ${physical}`);
  }
  if (input.footerCommand !== undefined) lines.push(`  ${input.footerCommand}`);
  return lines;
}

/**
 * 面板渲染件的唯一入口:同步纯函数,收 `PanelInput`,返回物理行数组——调用方直接
 * `join("\n")` 写出,或逐行喂给 live 面板的覆盖重画。
 *
 * 实现区域框契约的全部几何规则:宽度上限 100 显示列(调用方经 `capWidth: false` 声明豁免)、
 * 边框嵌字与「先保标题后保 meta」的截断次序、嵌套 Section 降横隔、终端窄于 60 列时整体降级
 * 为无框文本。不做 IO、不管重画——传输能力(TTY / NO_COLOR / 宽度)由调用方探测后经
 * `mode` / `width` 注入。
 *
 * @param input 面板内容与传输能力,见 {@link PanelInput}。
 * @returns 物理行数组,已经按显示宽度对齐/截断,不含结尾换行。
 */
export function renderPanel(input: PanelInput): string[] {
  const eff = effectiveMode(input.mode, input.width);
  return eff === "boxed" ? renderBoxed(input) : renderPlain(input);
}
