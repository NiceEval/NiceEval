// Markdown:CommonMark + GFM 散文排版(docs/feature/reports/library/layout.md#markdown)。
// 解析一次产出 AST，text / web 从同一棵树投影。

import type { ReactElement, ReactNode } from "react";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { COMPONENT_RAW_CHILDREN, defineComponent } from "../tree.ts";
import { resolveLocalizedText, type LocalizedText } from "../../model/locale.ts";
import { stringWidth, wrapDisplay } from "../../model/text-layout.ts";

export interface MarkdownProps {
  /** CommonMark 正文。作者写下几种语言就有几种，组件不翻译。 */
  children: LocalizedText;
  className?: string;
}

/** mdast 子集：只声明本文件用到的字段，不依赖 @types/mdast 是否 hoist。 */
export interface MarkdownAst {
  type: string;
  children?: MarkdownAst[];
  value?: string;
  url?: string;
  alt?: string | null;
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
}

const TABLE_ERROR =
  "Markdown tables are not supported in <Markdown>. Use the <Table> primitive instead — " +
  "terminal column widths must go through stringWidth / wrapDisplay (CJK counts as 2 columns). " +
  "See docs/feature/reports/library/layout.md#table.";

const ANSI_BOLD_ON = "\u001b[1m";
const ANSI_BOLD_OFF = "\u001b[22m";
const ANSI_ITALIC_ON = "\u001b[3m";
const ANSI_ITALIC_OFF = "\u001b[23m";
const ANSI_STRIKE_ON = "\u001b[9m";
const ANSI_STRIKE_OFF = "\u001b[29m";

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function walkHasTable(node: MarkdownAst): boolean {
  if (node.type === "table") return true;
  return (node.children ?? []).some(walkHasTable);
}

/** GFM 表格:`|` 起首行 + 分隔行。解析前扫描,按完整用户反馈拒绝。 */
export function detectMarkdownTable(source: string): boolean {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i].trim();
    const next = lines[i + 1].trim();
    if (!trimmed.startsWith("|") || trimmed.length <= 1 || !trimmed.includes("|", 1)) continue;
    if (!next.includes("-")) continue;
    if (next.startsWith("|") && /^\|[\s|:-]+$/.test(next)) return true;
    if (/^[\s|:-]+$/.test(next) && next.includes("|")) return true;
  }
  return false;
}

/** 解析 Markdown；遇到表格语法按完整用户反馈拒绝并指引 Table。 */
export function parseMarkdown(source: string): MarkdownAst {
  if (detectMarkdownTable(source)) throw new Error(TABLE_ERROR);
  const tree = remark().use(remarkParse).use(remarkGfm).parse(source) as MarkdownAst;
  if (walkHasTable(tree)) throw new Error(TABLE_ERROR);
  return tree;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function childrenOf(node: MarkdownAst): MarkdownAst[] {
  return node.children ?? [];
}

interface TextOpts {
  width: number;
  useAnsi: boolean;
}

function phrasingText(nodes: readonly MarkdownAst[], opts: TextOpts): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "html":
        out += node.value ?? "";
        break;
      case "break":
        out += "\n";
        break;
      case "strong": {
        const inner = phrasingText(childrenOf(node), opts);
        out += opts.useAnsi ? `${ANSI_BOLD_ON}${inner}${ANSI_BOLD_OFF}` : phrasingTextPlain(childrenOf(node));
        break;
      }
      case "emphasis": {
        const inner = phrasingText(childrenOf(node), opts);
        out += opts.useAnsi ? `${ANSI_ITALIC_ON}${inner}${ANSI_ITALIC_OFF}` : phrasingTextPlain(childrenOf(node));
        break;
      }
      case "delete": {
        const inner = phrasingText(childrenOf(node), opts);
        out += opts.useAnsi ? `${ANSI_STRIKE_ON}${inner}${ANSI_STRIKE_OFF}` : phrasingTextPlain(childrenOf(node));
        break;
      }
      case "link":
      case "linkReference": {
        const label = phrasingTextPlain(childrenOf(node));
        if (node.type === "link") {
          const url = node.url ?? "";
          out += label === url || !url ? label : `${label} (${url})`;
        } else {
          out += label;
        }
        break;
      }
      case "image":
      case "imageReference": {
        const alt = node.type === "image" ? (node.alt ?? "") : phrasingTextPlain(childrenOf(node));
        const url = node.type === "image" ? (node.url ?? "") : "";
        out += url && alt !== url ? `${alt} (${url})` : alt || url;
        break;
      }
      default:
        out += phrasingTextPlain(childrenOf(node));
        break;
    }
  }
  return out;
}

function phrasingTextPlain(nodes: readonly MarkdownAst[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "html":
        out += node.value ?? "";
        break;
      case "break":
        out += "\n";
        break;
      case "strong":
      case "emphasis":
      case "delete":
      case "link":
      case "linkReference":
        out += phrasingTextPlain(childrenOf(node));
        break;
      case "image":
        out += node.alt ?? "";
        break;
      case "imageReference":
        out += phrasingTextPlain(childrenOf(node));
        break;
      default:
        out += phrasingTextPlain(childrenOf(node));
        break;
    }
  }
  return out;
}

function listPrefix(item: MarkdownAst, ordered: boolean, index: number, depth: number): string {
  const indent = "  ".repeat(depth);
  if (item.checked === true) return `${indent}[x] `;
  if (item.checked === false) return `${indent}[ ] `;
  if (ordered) return `${indent}${index}. `;
  return `${indent}- `;
}

function projectBlockText(node: MarkdownAst, opts: TextOpts, depth: number, listDepth = 0): string[] {
  const indent = "  ".repeat(depth);
  switch (node.type) {
    case "paragraph": {
      const text = phrasingText(childrenOf(node), opts);
      return wrapDisplay(text, Math.max(1, opts.width - stringWidth(indent))).map((line) => indent + line);
    }
    case "heading": {
      const plain = phrasingTextPlain(childrenOf(node));
      const line = opts.useAnsi ? `${ANSI_BOLD_ON}${plain}${ANSI_BOLD_OFF}` : plain;
      return [indent + line];
    }
    case "code":
      return (node.value ?? "").split("\n").map((line) => `${indent}  ${line}`);
    case "blockquote": {
      const inner = childrenOf(node).flatMap((child) =>
        projectBlockText(child, { ...opts, width: Math.max(1, opts.width - 2) }, 0, listDepth),
      );
      return inner.map((line) => `${indent}> ${line}`);
    }
    case "list": {
      const lines: string[] = [];
      const ordered = node.ordered === true;
      childrenOf(node).forEach((item, i) => {
        const prefix = listPrefix(item, ordered, (node.start ?? 1) + i, listDepth);
        const childWidth = Math.max(1, opts.width - stringWidth(prefix));
        const body = childrenOf(item).flatMap((child) =>
          projectBlockText(child, { ...opts, width: childWidth }, 0, listDepth + 1),
        );
        if (body.length === 0) {
          lines.push(prefix.trimEnd());
          return;
        }
        lines.push(prefix + body[0]!);
        const continuation = " ".repeat(stringWidth(prefix));
        for (const line of body.slice(1)) {
          lines.push(continuation + line);
        }
      });
      return lines;
    }
    case "thematicBreak":
      return [indent + "─".repeat(Math.max(1, opts.width - stringWidth(indent)))];
    case "html":
      return wrapDisplay(node.value ?? "", Math.max(1, opts.width - stringWidth(indent))).map((line) => indent + line);
    case "yaml":
    case "toml":
      return [];
    default:
      return childrenOf(node).flatMap((child) => projectBlockText(child, opts, depth, listDepth));
  }
}

export function markdownToText(tree: MarkdownAst, width: number, useAnsi = false): string {
  const opts: TextOpts = { width, useAnsi };
  const blocks = childrenOf(tree).map((child) => projectBlockText(child, opts, 0).join("\n"));
  return blocks.filter((block) => block.length > 0).join("\n\n");
}

function phrasingWeb(nodes: readonly MarkdownAst[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <span key={i}>{node.value}</span>;
      case "inlineCode":
        return (
          <code key={i} className="niceeval-md-code">
            {node.value}
          </code>
        );
      case "break":
        return <br key={i} />;
      case "strong":
        return <strong key={i}>{phrasingWeb(childrenOf(node))}</strong>;
      case "emphasis":
        return <em key={i}>{phrasingWeb(childrenOf(node))}</em>;
      case "delete":
        return <del key={i}>{phrasingWeb(childrenOf(node))}</del>;
      case "link":
        return (
          <a key={i} href={node.url} rel="noopener" className="niceeval-md-a">
            {phrasingWeb(childrenOf(node))}
          </a>
        );
      case "image":
        return <img key={i} src={node.url} alt={node.alt ?? ""} className="niceeval-md-img" />;
      case "html":
        return <span key={i}>{node.value ?? ""}</span>;
      default:
        return <span key={i}>{phrasingWeb(childrenOf(node))}</span>;
    }
  });
}

function blockWeb(node: MarkdownAst, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className="niceeval-md-p">
          {phrasingWeb(childrenOf(node))}
        </p>
      );
    case "heading": {
      const depth = Math.min(6, Math.max(1, node.depth ?? 1));
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} className={cx("niceeval-md-h", `niceeval-md-h${depth}`)}>
          {phrasingWeb(childrenOf(node))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre key={key} className="niceeval-md-pre">
          <code className={node.lang ? `language-${node.lang}` : undefined}>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="niceeval-md-blockquote">
          {childrenOf(node).map((child, i) => blockWeb(child, i))}
        </blockquote>
      );
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className="niceeval-md-list"
          start={node.ordered ? (node.start ?? undefined) : undefined}
        >
          {childrenOf(node).map((item, i) => (
            <li key={i} className="niceeval-md-li">
              {item.checked === true || item.checked === false ? (
                <input type="checkbox" checked={item.checked} readOnly className="niceeval-md-task" />
              ) : null}
              {childrenOf(item).map((child, j) => blockWeb(child, j))}
            </li>
          ))}
        </Tag>
      );
    }
    case "thematicBreak":
      return <hr key={key} className="niceeval-md-hr" />;
    case "html":
      return (
        <p key={key} className="niceeval-md-html">
          {node.value ?? ""}
        </p>
      );
    default:
      return <div key={key}>{childrenOf(node).map((child, i) => blockWeb(child, i))}</div>;
  }
}

export function markdownToWeb(tree: MarkdownAst, className?: string): ReactElement {
  return (
    <div className={cx("niceeval-report", "niceeval-markdown", "niceeval-md", className)}>
      {childrenOf(tree).map((child, i) => blockWeb(child, i))}
    </div>
  );
}

/** 供测试断言 web 面不含裸 HTML 标签(转义后的可见文本)。 */
export function markdownWebPlainText(tree: MarkdownAst): string {
  return childrenOf(tree)
    .map((child) => phrasingTextPlain(childrenOf(child)))
    .join("\n");
}

export const Markdown = defineComponent<MarkdownProps>({
  dimensions: () => ({}),
  web({ children, className }, ctx) {
    const source = resolveLocalizedText(children, ctx.locale);
    return markdownToWeb(parseMarkdown(source), className);
  },
  text({ children }, ctx) {
    const source = resolveLocalizedText(children, ctx.locale);
    const useAnsi = ctx.panelMode === "boxed";
    return markdownToText(parseMarkdown(source), ctx.width, useAnsi);
  },
});
Markdown.displayName = "Markdown";
Markdown[COMPONENT_RAW_CHILDREN] = true;
