// 参考文档生成器:从源码(TypeScript compiler API 静态分析)提取接口成员 / 导出函数 /
// 联合类型变体 / CLI flag 表,渲染成 Markdown,写回 docs-site/zh/reference/*.mdx 的
// `{/* GENERATED:BEGIN <region-id> */}...{/* GENERATED:END <region-id> */}` 标记区块。
//
// 设计:提取 + 渲染 + 区块替换是纯函数(输入文件内容字符串,输出新内容字符串),
// 不碰文件系统 —— 这样 lint/docs-site/reference-consistency.lint.ts 能在内存里复用同一套逻辑
// 做漂移检测。CLI 入口(main())只负责读写文件。
//
// 不新增依赖:只用仓库已有的 devDependencies 里的 `typescript` 包的 compiler API。
// 注意 `typescript` 是 npm alias → @typescript/typescript6(TS7 原生版不提供编程 API,
// API 消费者按官方配方留在 6.x;`tsc` 二进制来自 @typescript/native → typescript@7)。

import ts from "typescript";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ───────────────────────── 基础类型 ─────────────────────────

/** 一个可渲染的成员:函数 / 接口字段 / 联合类型变体 / CLI flag。 */
export interface Member {
  /** 展示名,如 `includes`、`gate`、`message`、`--attempts`。 */
  name: string;
  /** ts 代码块里原样展示的签名。 */
  signature: string;
  /** 紧跟的描述段落(已清理,未做 MDX 转义)。没有则省略。 */
  doc?: string;
}

/** 一组成员,可选带一个小节标题(用于一个 region 里合并多个接口,如 DirectAgentDef/SandboxAgentDef/AgentContext)。 */
export interface MemberGroup {
  heading?: string;
  members: Member[];
}

// ───────────────────────── AST 工具 ─────────────────────────

function parse(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** 短小无标点的行注释视为分组标签(如 `// 会话`、`// judge`),不当作成员的 TSDoc,避免误挂到组内第一个成员上。 */
function looksLikeSectionLabel(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  if (t.length > 14) return false;
  return !/[。!!??.]$/.test(t);
}

/** 去掉 `/** */`/`//` 标记和每行前缀,返回干净的多行文本;纯分组标签返回 undefined。 */
function cleanCommentBlock(raw: string): string | undefined {
  const lines = raw.split("\n").map((line) => {
    let l = line.trim();
    l = l.replace(/^\/\*\*?/, "");
    l = l.replace(/\*\/$/, "");
    l = l.replace(/^\*\s?/, "");
    l = l.replace(/^\/\/\s?/, "");
    return l.trimEnd();
  });
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const text = lines.join("\n").trim();
  if (looksLikeSectionLabel(text)) return undefined;
  return text;
}

/** 分隔线注释(整行 ─/=/- 重复),不应被当成任何成员的文档。 */
function isDividerComment(raw: string): boolean {
  return /^\s*\/\/\s*[─=—-]{5,}/.test(raw);
}

/** 提取紧贴 node 前面的注释块(JSDoc `/** */` 或连续的 `//` 行),隔着空行的注释视为不相关。 */
function extractDoc(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  const fullStart = node.getFullStart();
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, fullStart);
  if (!ranges || ranges.length === 0) return undefined;

  // 从最后一个注释往前合并「相邻无空行 + 同类型」的注释,构成挨着 node 的这一组。
  // 只合并同类型(连续多行 `//` 是一段手写 doc 的惯用写法),`//` 分组标签紧贴在
  // 一个 `/** */` JSDoc 前面(如 `// 会话` 后面直接跟 send() 自己的 JSDoc)时不能并进去,
  // 否则分组标签文字会污染紧邻它的真实成员文档。
  const group: ts.CommentRange[] = [ranges[ranges.length - 1]];
  for (let i = ranges.length - 2; i >= 0; i--) {
    const prev = ranges[i];
    const next = group[0];
    const prevEndLine = sourceFile.getLineAndCharacterOfPosition(prev.end).line;
    const nextStartLine = sourceFile.getLineAndCharacterOfPosition(next.pos).line;
    if (prev.kind === next.kind && nextStartLine - prevEndLine <= 1) group.unshift(prev);
    else break;
  }

  const lastInGroup = group[group.length - 1];
  const commentEndLine = sourceFile.getLineAndCharacterOfPosition(lastInGroup.end).line;
  const nodeStartLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  if (nodeStartLine - commentEndLine > 1) return undefined;

  const kept = group.filter((r) => !isDividerComment(sourceFile.text.slice(r.pos, r.end)));
  if (kept.length === 0) return undefined;
  const raw = kept.map((r) => sourceFile.text.slice(r.pos, r.end)).join("\n");
  return cleanCommentBlock(raw);
}

function findInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  let found: ts.InterfaceDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) {
    throw new Error(`interface ${name} not found in ${sourceFile.fileName}`);
  }
  return found;
}

function findTypeAlias(sourceFile: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  let found: ts.TypeAliasDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) {
    throw new Error(`type alias ${name} not found in ${sourceFile.fileName}`);
  }
  return found;
}

/**
 * `node.getText()` 掐掉了首行前导 trivia,但多行签名的后续行仍保留原始源码里的绝对缩进
 * (相对整个文件,而不是相对这个片段)——单独摘出来会显得缩进过深。这里按「非首行」里最小的
 * 前导空格数整体减去,让摘出来的多行签名自成一段合理缩进。
 */
function dedentContinuationLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 1) return text;
  const rest = lines.slice(1);
  const indents = rest.filter((l) => l.trim().length > 0).map((l) => l.match(/^ */)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return [lines[0], ...rest.map((l) => (l.trim().length ? l.slice(min) : l))].join("\n");
}

/** interface 成员的展示名(PropertySignature/MethodSignature 的 name)。 */
function memberName(member: ts.TypeElement): string {
  const name = (member as ts.PropertySignature | ts.MethodSignature).name;
  if (!name) return member.getText();
  return name.getText();
}

/** 提取一个具名 interface 的全部成员(按源码声明顺序),含签名原文与紧邻 TSDoc。 */
export function extractInterfaceMembers(sourceText: string, fileName: string, interfaceName: string): Member[] {
  const sourceFile = parse(sourceText, fileName);
  const iface = findInterface(sourceFile, interfaceName);
  return iface.members.map((member) => ({
    name: memberName(member),
    signature: dedentContinuationLines(member.getText(sourceFile).trim()),
    doc: extractDoc(sourceFile, member),
  }));
}

/**
 * 提取一个 interface 及其 extends 链上的成员，并保留每个成员的原始声明接口作为分组。
 * TypeScript 不会把继承成员放进 `InterfaceDeclaration.members`；Reference 若只读取最外层
 * interface，就会把用户实际能调用的公共成员漏掉。按祖先 → 子接口的顺序渲染，既完整也能
 * 让读者看出成员来自哪个可导入的公共类型。
 */
export function extractInterfaceMemberGroups(
  sourceText: string,
  fileName: string,
  interfaceName: string,
): MemberGroup[] {
  const sourceFile = parse(sourceText, fileName);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string): MemberGroup[] => {
    if (visited.has(name)) return [];
    if (visiting.has(name)) {
      throw new Error(`cyclic interface inheritance at ${name} in ${fileName}`);
    }

    visiting.add(name);
    const iface = findInterface(sourceFile, name);
    const inherited = (iface.heritageClauses ?? [])
      .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((clause) =>
        clause.types.map((type) => {
          if (!ts.isIdentifier(type.expression)) {
            throw new Error(`unsupported interface heritage ${type.expression.getText(sourceFile)} in ${fileName}`);
          }
          return type.expression.text;
        }),
      );
    const groups = inherited.flatMap(visit);
    visiting.delete(name);
    visited.add(name);

    return [
      ...groups,
      {
        heading: name,
        members: iface.members.map((member) => ({
          name: memberName(member),
          signature: dedentContinuationLines(member.getText(sourceFile).trim()),
          doc: extractDoc(sourceFile, member),
        })),
      },
    ];
  };

  return visit(interfaceName);
}

/**
 * 提取具名 type alias 中直接声明的对象字面量成员。alias 可用交叉类型把稳定的公共字段
 * 接到一个小对象上（如 `EvalInput = EvalAuthorFields & { test(...) }`）；这里只展开对象
 * 字面量本身，具名引用仍由调用方从其真实声明处提取，避免靠 TypeChecker 隐式改写签名。
 */
export function extractTypeLiteralMembers(sourceText: string, fileName: string, typeName: string): Member[] {
  const sourceFile = parse(sourceText, fileName);
  const alias = findTypeAlias(sourceFile, typeName);
  const literals: ts.TypeLiteralNode[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isParenthesizedTypeNode(node)) {
      visit(node.type);
      return;
    }
    if (ts.isIntersectionTypeNode(node)) {
      for (const type of node.types) visit(type);
      return;
    }
    if (ts.isTypeLiteralNode(node)) literals.push(node);
  };
  visit(alias.type);
  return literals.flatMap((literal) =>
    literal.members.map((member) => ({
      name: memberName(member),
      signature: dedentContinuationLines(member.getText(sourceFile).trim()),
      doc: extractDoc(sourceFile, member),
    })),
  );
}

/** 提取一个文件里全部顶层 `export function` 声明(按源码顺序),签名 = 去掉函数体的原文。 */
export function extractExportedFunctions(sourceText: string, fileName: string): Member[] {
  const sourceFile = parse(sourceText, fileName);
  const out: Member[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    const hasExport = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
    if (!hasExport) continue;
    const signature = dedentContinuationLines(
      sourceFile.text.slice(stmt.getStart(sourceFile), stmt.body.getStart(sourceFile)).trim(),
    );
    out.push({
      name: stmt.name.text,
      signature: `${signature} { ... }`,
      doc: extractDoc(sourceFile, stmt),
    });
  }
  return out;
}

/** 提取一个 `export type X = A | B | ...` 联合类型的各变体(对象字面量类型),变体名取其 `type: "..."` 字面量属性。 */
export function extractUnionVariants(sourceText: string, fileName: string, typeName: string): Member[] {
  const sourceFile = parse(sourceText, fileName);
  const alias = findTypeAlias(sourceFile, typeName);
  // `{ 公共字段 } & ( A | B | … )` 形态(如 StreamEvent 的 truncated 落盘标记):
  // 从交叉类型里取出括号包着的联合部分,公共字段不进变体表。
  let unionNode: ts.TypeNode = alias.type;
  if (ts.isIntersectionTypeNode(unionNode)) {
    const inner = unionNode.types
      .map((t) => (ts.isParenthesizedTypeNode(t) ? t.type : t))
      .find((t) => ts.isUnionTypeNode(t));
    if (inner) unionNode = inner;
  }
  if (ts.isParenthesizedTypeNode(unionNode)) unionNode = unionNode.type;
  if (!ts.isUnionTypeNode(unionNode)) {
    throw new Error(`type alias ${typeName} in ${fileName} is not a union type`);
  }
  return unionNode.types.map((variant) => {
    let name = variant.getText(sourceFile);
    if (ts.isTypeLiteralNode(variant)) {
      for (const member of variant.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name?.getText() === "type" &&
          member.type &&
          ts.isLiteralTypeNode(member.type) &&
          ts.isStringLiteral(member.type.literal)
        ) {
          name = member.type.literal.text;
          break;
        }
      }
    }
    return {
      name,
      signature: dedentContinuationLines(variant.getText(sourceFile).trim()),
      doc: extractDoc(sourceFile, variant),
    };
  });
}

// ───────────────────────── CLI flags(静态提取,不 import src/cli.ts) ─────────────────────────

interface FlagEntry {
  key: string; // FLAG_OPTIONS 里的原始 key,如 "max-concurrency"
  type: "string" | "boolean";
  multiple: boolean;
  short?: string;
  /** 紧邻该 flag 属性的 JSDoc,即文档 flag 表里的中文说明。 */
  doc?: string;
}

/** 静态解析 `const FLAG_OPTIONS = { ... } as const;` 对象字面量,不 import 模块(cli.ts 有模块级副作用)。 */
function extractFlagOptions(sourceText: string, fileName: string): FlagEntry[] {
  const sourceFile = parse(sourceText, fileName);
  let objectLiteral: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (objectLiteral) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "FLAG_OPTIONS" &&
      node.initializer
    ) {
      let init = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) objectLiteral = init;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!objectLiteral) throw new Error(`FLAG_OPTIONS not found in ${fileName}`);

  const entries: FlagEntry[] = [];
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText();
    if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
    let type: "string" | "boolean" | undefined;
    let multiple = false;
    let short: string | undefined;
    for (const p of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pname = p.name.getText();
      if (pname === "type" && ts.isStringLiteral(p.initializer)) {
        type = p.initializer.text as "string" | "boolean";
      }
      if (pname === "multiple" && p.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        multiple = true;
      }
      if (pname === "short" && ts.isStringLiteral(p.initializer)) {
        short = p.initializer.text;
      }
    }
    if (type) entries.push({ key, type, multiple, short, doc: extractDoc(sourceFile, prop) });
  }
  return entries;
}

/**
 * 数字型 flag(源码里经 `numberFlag("<name>", ...)` 校验)的 key 集合。
 * FLAG_OPTIONS 表本身只区分 string/boolean(parseArgs 层面),真实语义类型要看 parseArgs() 函数体
 * 怎么处理这个 value —— 这里做同一份 AST 里的静态文本匹配,不 import 模块。
 */
function extractNumberFlagKeys(sourceText: string, fileName: string): Set<string> {
  const sourceFile = parse(sourceText, fileName);
  const keys = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "numberFlag" &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      keys.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

interface CliFlagRow {
  flags: string[]; // 一或两个 `--x` 形式,负向 flag 配对显示在同一行
  type: "string" | "string[]" | "number" | "boolean";
  description: string;
}

function buildCliFlagRows(sourceText: string, fileName: string): CliFlagRow[] {
  const entries = extractFlagOptions(sourceText, fileName);
  const numberKeys = extractNumberFlagKeys(sourceText, fileName);
  // 这些选项只属于尚待删除的旧实现入口，不是 docs/ 已定稿的目标 CLI。
  // 参考页必须描述目标契约，不能因解析器暂未收敛而继续公开已砍功能。
  const hiddenImplementationFlags = new Set([
    "source",
    "execution",
    "timing",
    "grep",
    "expand",
    "diff",
    "history",
    "usage",
    "stats",
    "theme",
  ]);

  // 负向 flag(no-early-exit / no-open)与正向 flag 合并成一行,不单独成表项。
  const negatedOf = new Map<string, string>(); // "no-early-exit" -> "early-exit"
  for (const e of entries) {
    if (e.key.startsWith("no-")) negatedOf.set(e.key, e.key.slice("no-".length));
  }

  const rows: CliFlagRow[] = [];
  for (const e of entries) {
    if (negatedOf.has(e.key)) continue; // 作为配对项在正向 flag 那里一起渲染
    if (hiddenImplementationFlags.has(e.key)) continue;
    const desc = e.doc;
    if (desc === undefined) {
      throw new Error(
        `flag --${e.key} has no description; add a JSDoc comment on its FLAG_OPTIONS entry in ${fileName}, then rerun pnpm docs:reference.`,
      );
    }
    const flags = [`--${e.key}`];
    const negKey = `no-${e.key}`;
    if (entries.some((x) => x.key === negKey)) flags.push(`--${negKey}`);
    const type: CliFlagRow["type"] = numberKeys.has(e.key)
      ? "number"
      : e.type === "boolean"
      ? "boolean"
      : e.multiple
      ? "string[]"
      : "string";
    rows.push({ flags, type, description: desc });
  }
  return rows;
}

// ───────────────────────── MDX 安全转义 ─────────────────────────

/** 描述段落里的裸 `<`/`{` 会被 Mintlify 的 MDX/acorn 解析成 JSX,这里转义;反引号内的行内代码不转义。 */
/**
 * 裸 `http(s)://...` 文本(如 TSDoc 里举例用的占位 URL)即使转义了尖括号,Mintlify 的
 * broken-links 检查依旧会把它当真链接扫描并报「broken link」。把它包进行内代码(反引号)
 * 就当普通文本处理,不再被当作链接候选——处理顺序要在转义 `<`/`>`/`{`/`}` 之前,
 * 这样 URL 里的原始字符不需要再转义(反引号内本来就不会被解析成 JSX)。
 */
function protectBareUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s，。；;,、)）\]】]+/g, (url) => `\`${url}\``);
}

function escapeMdxProse(text: string): string {
  const segments = protectBareUrls(text).split("`");
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = segments[i]
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\{/g, "&#123;")
      .replace(/\}/g, "&#125;");
  }
  return segments.join("`");
}

// ───────────────────────── 渲染 ─────────────────────────

function renderMember(m: Member, headingLevel: number): string {
  const hashes = "#".repeat(headingLevel);
  const parts = [`${hashes} \`${m.name}\``, "", "```ts", m.signature, "```"];
  if (m.doc) {
    parts.push("", escapeMdxProse(m.doc));
  }
  return parts.join("\n");
}

/** 渲染一组扁平成员(每个成员一个标题 + 代码块 + 可选描述)。 */
export function renderMemberList(members: Member[], headingLevel = 4): string {
  return members.map((m) => renderMember(m, headingLevel)).join("\n\n");
}

/** 渲染多个具名分组(如 agent-def region 里的 DirectAgentDef / SandboxAgentDef / AgentContext)。 */
export function renderMemberGroups(groups: MemberGroup[], groupHeadingLevel = 3, memberHeadingLevel = 4): string {
  return groups
    .map((g) => {
      const body = renderMemberList(g.members, memberHeadingLevel);
      if (!g.heading) return body;
      return `${"#".repeat(groupHeadingLevel)} \`${g.heading}\`\n\n${body}`;
    })
    .join("\n\n");
}

function renderCliFlagsTable(rows: CliFlagRow[]): string {
  const header = "| Flag | 类型 | 说明 |\n|---|---|---|";
  const lines = rows.map((r) => {
    const flagCell = r.flags.map((f) => `\`${f}\``).join(" / ");
    return `| ${flagCell} | ${r.type} | ${escapeMdxProse(r.description).replace(/\|/g, "\\|")} |`;
  });
  return [header, ...lines].join("\n");
}

// ───────────────────────── 区块替换(纯函数) ─────────────────────────

export function replaceRegion(content: string, regionId: string, newBody: string): string {
  return replaceBetween(content, `{/* GENERATED:BEGIN ${regionId} */}`, `{/* GENERATED:END ${regionId} */}`, newBody);
}

/** 同 replaceRegion,但用 HTML 注释标记——给不走 MDX 解析的纯 Markdown 文件(如包根 INDEX.md)。 */
export function replaceMdRegion(content: string, regionId: string, newBody: string): string {
  return replaceBetween(content, `<!-- GENERATED:BEGIN ${regionId} -->`, `<!-- GENERATED:END ${regionId} -->`, newBody);
}

function replaceBetween(content: string, begin: string, end: string, newBody: string): string {
  const beginIdx = content.indexOf(begin);
  if (beginIdx === -1) {
    throw new Error(`region marker "${begin}" not found`);
  }
  const endIdx = content.indexOf(end, beginIdx);
  if (endIdx === -1) {
    throw new Error(`region marker "${end}" not found (after BEGIN)`);
  }
  const before = content.slice(0, beginIdx + begin.length);
  const after = content.slice(endIdx);
  return `${before}\n\n${newBody.trim()}\n\n${after}`;
}

// ───────────────────────── region 定义:regionId → 从源码算出 body ─────────────────────────

/** 生成器需要读取的源文件(相对仓库根),CLI 与测试共用同一份清单。 */
export const SOURCE_FILES = [
  "src/expect/index.ts",
  "src/assertions/match.ts",
  "src/assertions/types.ts",
  "src/runner/types.ts",
  "src/context/assert-first.ts",
  "src/agents/types.ts",
  "src/sandbox/types.ts",
  "src/o11y/types.ts",
  "src/cli.ts",
  "src/agents/claude-code.ts",
  "src/agents/codex.ts",
  "src/agents/bub.ts",
  "src/agents/ui-message-stream.ts",
] as const;

export type SourceMap = Record<(typeof SOURCE_FILES)[number], string>;

/** `niceeval/expect` 的公开 matcher factory；内部 evaluator 与纯辅助函数不进入作者参考。 */
const EXPECT_FACTORY_NAMES = new Set([
  "and",
  "or",
  "not",
  "includes",
  "excludes",
  "pattern",
  "equals",
  "matches",
  "similarity",
  "includesUrl",
  "hasSections",
  "satisfies",
  "isDefined",
  "isTrue",
  "isFalse",
  "commandSucceeded",
  "defineValueMatch",
  "defineScoreMatch",
  // Tool selectors live in docs/feature/assertions/library/scoped-assertions.md.
  // Keeping their signatures out of this generated list avoids a second author-facing
  // definition beside the scope contract.
  "eventMatch",
]);

const ASSERTION_SCOPE_METHODS = new Set(["calledTool", "notCalledTool"]);

// Implementation-only interface names are not the public authoring ABI. Reference
// output exposes stable domain names; durable RecordAttachment schemas keep their
// own versioned identities elsewhere.
const AUTHORING_TYPE_NAMES: readonly [RegExp, string][] = [
  [/\bAssertFirstTurnHandle\b/g, "TurnHandle"],
  [/\bAssertFirstSessionHandle\b/g, "SessionHandle"],
  [/\bAssertFirstRespondAnswer\b/g, "InputAnswer"],
  [/\bAssertFirstSandbox\b/g, "Sandbox"],
  [/\bAssertFirstRootJudge\b/g, "RootJudge"],
  [/\bAssertFirstTurnJudge\b/g, "TurnJudge"],
  [/\bAssertionsRuntimeV1\b/g, "AssertionRuntime"],
  [/\bBooleanAssertionHandleV1\b/g, "BooleanAssertionHandle"],
  [/\bMeasurementAssertionHandleV1\b/g, "MeasurementAssertionHandle"],
  [/\bPostRunBooleanAssertionHandleV1\b/g, "PostRunBooleanAssertionHandle"],
  [/\bDirectScoreAssertionHandleV1\b/g, "DirectScoreAssertionHandle"],
];

function authorFacingMembers(members: Member[]): Member[] {
  return members.map((member) => ({
    ...member,
    signature: AUTHORING_TYPE_NAMES.reduce(
      (signature, [implementationName, publicName]) => signature.replace(implementationName, publicName),
      member.signature,
    ),
  }));
}

// `TestContext` is the public alias of this Assert-first declaration. Its nested Turn
// shape lives beside it, so reference output reads both from here instead of legacy
// compatibility declarations.
const ASSERT_FIRST_REFERENCE = {
  source: "src/context/assert-first.ts",
  testContext: "AssertFirstTestContext",
  turnHandle: "AssertFirstTurnHandle",
} as const;

function computeRegionBody(regionId: string, sources: SourceMap): string {
  switch (regionId) {
    case "expect-matchers":
      return renderMemberList(
        extractExportedFunctions(sources["src/assertions/match.ts"], "src/assertions/match.ts")
          .filter((member) => EXPECT_FACTORY_NAMES.has(member.name)),
      );
    case "value-assertion":
      return renderMemberGroups([
        {
          heading: "Match",
          members: extractInterfaceMembers(sources["src/assertions/match.ts"], "src/assertions/match.ts", "Match")
            .filter((member) => !member.name.startsWith("[")),
        },
        {
          heading: "BooleanMatch",
          members: extractInterfaceMembers(
            sources["src/assertions/match.ts"],
            "src/assertions/match.ts",
            "BooleanMatch",
          ),
        },
        {
          heading: "ScoreMatch",
          members: extractInterfaceMembers(
            sources["src/assertions/match.ts"],
            "src/assertions/match.ts",
            "ScoreMatch",
          ),
        },
      ]);
    case "defineeval-options":
      return renderMemberList(
        [
          ...extractInterfaceMembers(
            sources["src/runner/types.ts"],
            "src/runner/types.ts",
            "EvalAuthorFields",
          ),
          ...extractTypeLiteralMembers(
            sources["src/runner/types.ts"],
            "src/runner/types.ts",
            "EvalInput",
          ).filter((member) => member.name === "test"),
        ],
      );
    case "test-context":
      return renderMemberList(
        authorFacingMembers(
          extractTypeLiteralMembers(
            sources[ASSERT_FIRST_REFERENCE.source],
            ASSERT_FIRST_REFERENCE.source,
            ASSERT_FIRST_REFERENCE.testContext,
          ).filter((member) => !ASSERTION_SCOPE_METHODS.has(member.name)),
        ),
      );
    case "turn-handle":
      return renderMemberList(
        authorFacingMembers(
          extractInterfaceMembers(
            sources[ASSERT_FIRST_REFERENCE.source],
            ASSERT_FIRST_REFERENCE.source,
            ASSERT_FIRST_REFERENCE.turnHandle,
          ).filter((member) => !ASSERTION_SCOPE_METHODS.has(member.name)),
        ),
      );
    case "config-fields":
      return renderMemberList(
        extractInterfaceMembers(sources["src/runner/types.ts"], "src/runner/types.ts", "Config"),
      );
    case "agent-def":
      const agentContextMembers = extractInterfaceMembers(
        sources["src/agents/types.ts"],
        "src/agents/types.ts",
        "AgentContext",
      ).map((member) =>
        member.name === "fact"
          ? {
              ...member,
              signature: "fact(name: string, value: JsonValue): void;",
              doc: "写入本 Attempt 的 generic custom fact document。name 使用反向域格式且不能以 `niceeval.` 开头；同一 owner/name 只允许写一次，第二次写入是 typed error，不替换也不追加。value 可以是任意 JsonValue。`{ observedAt, value }` 经 JSON.stringify 后最多 65,536 UTF-8 bytes；超限同步抛出 `record-custom-fact-too-large`，且不留下部分文件。不影响 Turn status、verdict、评分或指纹。形状与归属语义见 docs/feature/record/architecture.md。",
            }
          : member,
      );
      return renderMemberGroups([
        {
          heading: "DirectAgentDef",
          members: extractInterfaceMembers(sources["src/agents/types.ts"], "src/agents/types.ts", "DirectAgentDef"),
        },
        {
          heading: "SandboxAgentDef",
          members: extractInterfaceMembers(sources["src/agents/types.ts"], "src/agents/types.ts", "SandboxAgentDef"),
        },
        {
          heading: "AgentContext",
          members: agentContextMembers,
        },
      ]);
    case "sandbox-methods":
      return renderMemberGroups([
        ...extractInterfaceMemberGroups(
          sources["src/sandbox/types.ts"],
          "src/sandbox/types.ts",
          "Sandbox",
        ),
        {
          heading: "CommandOptions",
          members: extractInterfaceMembers(
            sources["src/sandbox/types.ts"],
            "src/sandbox/types.ts",
            "CommandOptions",
          ),
        },
      ]);
    case "stream-events":
      return renderMemberList(
        extractUnionVariants(sources["src/o11y/types.ts"], "src/o11y/types.ts", "StreamEvent"),
      );
    case "usage-fields":
      return renderMemberList(extractInterfaceMembers(sources["src/o11y/types.ts"], "src/o11y/types.ts", "Usage"));
    case "cli-flags":
      return renderCliFlagsTable(buildCliFlagRows(sources["src/cli.ts"], "src/cli.ts"));
    case "builtin-agent-config":
      return renderMemberGroups([
        {
          heading: "ClaudeCodeConfig",
          members: extractInterfaceMembers(
            sources["src/agents/claude-code.ts"],
            "src/agents/claude-code.ts",
            "ClaudeCodeConfig",
          ),
        },
        {
          heading: "CodexConfig",
          members: extractInterfaceMembers(sources["src/agents/codex.ts"], "src/agents/codex.ts", "CodexConfig"),
        },
        {
          heading: "BubConfig",
          members: extractInterfaceMembers(sources["src/agents/bub.ts"], "src/agents/bub.ts", "BubConfig"),
        },
      ]);
    case "ui-message-stream-options":
      return renderMemberList(
        extractInterfaceMembers(
          sources["src/agents/ui-message-stream.ts"],
          "src/agents/ui-message-stream.ts",
          "UiMessageStreamAgentOptions",
        ),
      );
    default:
      throw new Error(`unknown region id: ${regionId}`);
  }
}

/** 每个参考页对应哪些 region id;CLI 与漂移测试共用,避免两处各写一份清单跑偏。 */
export const REFERENCE_FILES: { file: string; regions: string[] }[] = [
  { file: "expect.mdx", regions: ["expect-matchers", "value-assertion"] },
  { file: "define-eval.mdx", regions: ["defineeval-options", "test-context", "turn-handle"] },
  { file: "define-config.mdx", regions: ["config-fields"] },
  { file: "define-agent.mdx", regions: ["agent-def", "sandbox-methods"] },
  { file: "events.mdx", regions: ["stream-events", "usage-fields"] },
  { file: "cli.mdx", regions: ["cli-flags"] },
  { file: "builtin-agents.mdx", regions: ["builtin-agent-config", "ui-message-stream-options"] },
];

// 每个生成区块的第一行:对着文件想手改文案的人,在现场说清来源与再生成命令。
// MDX 注释不渲染;作为区块内容的一部分随每次生成写入,不会漂移、不需要手工维护。
const REGION_PROVENANCE =
  "{/* 本区块由 pnpm docs:reference 从源码注释生成,勿手改;要改文案,改对应源码的 TSDoc/JSDoc(映射见 scripts/generate-reference.ts) */}";

/**
 * 纯函数:给定一个 reference mdx 文件当前内容 + 全部源文件内容,重新计算它全部 region 的内容
 * 并写回对应标记区块,返回新的文件内容。不接触文件系统。
 */
export function regenerateReferenceDoc(file: string, mdxContent: string, sources: SourceMap): string {
  const entry = REFERENCE_FILES.find((f) => f.file === file);
  if (!entry) throw new Error(`${file} is not a registered reference doc`);
  let content = mdxContent;
  for (const regionId of entry.regions) {
    const body = `${REGION_PROVENANCE}\n\n${computeRegionBody(regionId, sources)}`;
    content = replaceRegion(content, regionId, body);
  }
  return content;
}

// ───────────────────────── 随包 AI 索引:INDEX.md(构建产物) ─────────────────────────
//
// 包根 INDEX.md 是 coding agent 读随包文档的单点入口(机制见 docs/engineering/agent-docs/)。
// 它不签入 git:`prepare`(pnpm run build:index)在安装 / 发版打包前,读签入的
// INDEX.template.md(手写导语 + 空区块),把文档树填进区块后写出 INDEX.md——与 dist/report
// 同一个构建产物模型。树的文案从 docs-site/zh 各页 frontmatter title/description 来,
// 文案单源在页面自己身上,与参考页区块同一个模式。

/** 包根 INDEX.md 里生成树的 region id;Markdown 文件用 HTML 注释标记(见 replaceMdRegion)。 */
export const BUNDLED_INDEX_REGION = "bundled-docs-tree";

/** 一个随包正文页:路径相对仓库根(如 `docs-site/zh/tutorials/fixtures.mdx`)+ 文件内容。 */
export interface ZhPage {
  path: string;
  content: string;
}

/** 树的顶层目录顺序,按 agent 的使用顺序排;清单外的新目录自动排在其后(字典序),不需要改生成器。 */
const ZH_DIR_ORDER = ["tutorials", "explanation", "reference", "troubleshooting", "examples"];

/** 站点导航入口不进树:它们服务网站导航,对包内读者没有路由价值。 */
function isNavEntryPage(relPath: string): boolean {
  const base = relPath.split("/").pop()!;
  return base === "index.mdx" || base === "introduction.mdx";
}

/** 取 frontmatter 里的单行字段值(去掉包裹引号);缺失即抛错——每页必须能自述给谁解决什么任务。 */
function frontmatterField(page: ZhPage, field: "title" | "description"): string {
  const fm = page.content.match(/^---\n([\s\S]*?)\n---/);
  const line = fm?.[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1].trim();
  const value = line?.replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!value) {
    throw new Error(`${page.path} 缺少 frontmatter ${field};补上一句任务视角的自述后重跑 pnpm docs:reference。`);
  }
  return value;
}

/** 渲染文档树:按顶层目录分组,每页一行「路径 — title:description」,全部文案来自页面 frontmatter。 */
export function renderBundledIndexTree(pages: ZhPage[]): string {
  const groups = new Map<string, ZhPage[]>();
  for (const page of pages) {
    if (isNavEntryPage(page.path)) continue;
    const rel = page.path.replace(/^docs-site\/zh\//, "");
    const dir = rel.includes("/") ? rel.split("/")[0] : ".";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(page);
  }
  const known = ZH_DIR_ORDER.filter((d) => groups.has(d));
  const rest = [...groups.keys()].filter((d) => !ZH_DIR_ORDER.includes(d)).sort();
  return [...known, ...rest]
    .map((dir) => {
      const heading = dir === "." ? "## `docs-site/zh/`" : `## \`docs-site/zh/${dir}/\``;
      const rows = groups
        .get(dir)!
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((p) => `- \`${p.path}\` — ${frontmatterField(p, "title")}:${frontmatterField(p, "description")}`);
      return [heading, "", ...rows].join("\n");
    })
    .join("\n\n");
}

const BUNDLED_INDEX_PROVENANCE =
  "<!-- 本文件是构建产物(pnpm run build:index),勿手改:树区文案改对应页面的 frontmatter title/description,导语改 INDEX.template.md(生成逻辑见 scripts/generate-reference.ts) -->";

/** 纯函数:把文档树填进模板(INDEX.template.md 内容)的区块,返回完整 INDEX.md 内容。不接触文件系统。 */
export function regenerateBundledIndex(templateContent: string, pages: ZhPage[]): string {
  const body = `${BUNDLED_INDEX_PROVENANCE}\n\n${renderBundledIndexTree(pages)}`;
  return replaceMdRegion(templateContent, BUNDLED_INDEX_REGION, body);
}

/** 枚举 docs-site/zh 下全部 .mdx 页面(含导航入口,过滤在渲染层做),CLI 与漂移测试共用。 */
export function loadZhPages(root: string): ZhPage[] {
  const dir = join(root, "docs-site/zh");
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((rel) => rel.endsWith(".mdx"))
    .sort()
    .map((rel) => {
      const path = `docs-site/zh/${rel.split("\\").join("/")}`;
      return { path, content: readFileSync(join(root, path), "utf8") };
    });
}

// ───────────────────────── CLI 入口(唯一做文件 IO 的地方) ─────────────────────────

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadSources(root: string): SourceMap {
  const sources = {} as SourceMap;
  for (const rel of SOURCE_FILES) {
    sources[rel] = readFileSync(join(root, rel), "utf8");
  }
  return sources;
}

function main(): void {
  const root = repoRoot();

  // `--bundled-index`:只生成包根 INDEX.md,给 `prepare`(build:index)在安装/发版打包前用。
  // 不带参数是开发命令 `pnpm docs:reference`:重新生成参考页区块,并顺带产出 INDEX.md 供本地预览。
  const indexOnly = process.argv.includes("--bundled-index");
  if (!indexOnly) {
    const sources = loadSources(root);
    for (const { file } of REFERENCE_FILES) {
      const path = join(root, "docs-site/zh/reference", file);
      const original = readFileSync(path, "utf8");
      const updated = regenerateReferenceDoc(file, original, sources);
      if (updated !== original) {
        writeFileSync(path, updated, "utf8");
        process.stdout.write(`updated ${file}\n`);
      } else {
        process.stdout.write(`unchanged ${file}\n`);
      }
    }
  }

  const template = readFileSync(join(root, "INDEX.template.md"), "utf8");
  writeFileSync(join(root, "INDEX.md"), regenerateBundledIndex(template, loadZhPages(root)), "utf8");
  process.stdout.write("generated INDEX.md\n");
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (isMain) main();
