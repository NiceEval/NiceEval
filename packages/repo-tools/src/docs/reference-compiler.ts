// 参考文档生成器:从源码(TypeScript compiler API 静态分析)提取接口成员 / 导出函数 /
// 联合类型变体 / CLI flag 表,渲染成 Markdown,写回 apps/docs-site/zh/reference/*.mdx 的
// `{/* GENERATED:BEGIN <region-id> */}...{/* GENERATED:END <region-id> */}` 标记区块。
//
// 设计:提取 + 渲染 + 区块替换是纯函数(输入文件内容字符串,输出新内容字符串),
// 不碰文件系统 —— 这样 lint/docs-site/reference-consistency.lint.ts 能在内存里复用同一套逻辑
// 做漂移检测。Effect program 只负责边界读取与原子替换。
//
// 不新增依赖:只用仓库已有的 devDependencies 里的 `typescript` 包的 compiler API。
// 注意 `typescript` 是 npm alias → @typescript/typescript6(TS7 原生版不提供编程 API,
// API 消费者按官方配方留在 6.x;`tsc` 二进制来自 @typescript/native → typescript@7)。

import ts from "typescript";

// ───────────────────────── 基础类型 ─────────────────────────

/** 一个可渲染的成员:函数 / 接口字段 / 联合类型变体 / CLI flag。 */
export interface Member {
  /** 展示名,如 `includes`、`gate`、`message`、`--attempts`。 */
  name: string;
  /** ts 代码块里原样展示的签名。 */
  signature: string;
  /** 紧跟的描述段落(已清理,未做 MDX 转义)。没有则省略。 */
  doc?: string | undefined;
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
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
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
  const group: ts.CommentRange[] = [ranges[ranges.length - 1]!];
  for (let i = ranges.length - 2; i >= 0; i--) {
    const prev = ranges[i]!;
    const next = group[0]!;
    const prevEndLine = sourceFile.getLineAndCharacterOfPosition(prev.end).line;
    const nextStartLine = sourceFile.getLineAndCharacterOfPosition(next.pos).line;
    if (prev.kind === next.kind && nextStartLine - prevEndLine <= 1) group.unshift(prev);
    else break;
  }

  const lastInGroup = group[group.length - 1]!;
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

// ───────────────────────── CLI flags（静态提取，不 import 或执行 CLI 模块）─────────────────────────

interface FlagEntry {
  key: string; // owner schema 里的原始 key,如 "max-concurrency"
  type: "string" | "boolean";
  multiple: boolean;
  short?: string;
  /** Formal boolean|string syntax owned by one option schema. */
  optionalValue?: CliOptionalValue;
  /** Hidden entries remain parser input but leave the public reference. */
  visible: boolean;
  /** Schema help.summary, with an adjacent comment as a static fallback. */
  doc?: string | undefined;
}

interface CliOptionalValue {
  readonly default: string | true;
  readonly values?: readonly string[];
  readonly separated: boolean;
}

function resolveIdentifierInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (found !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function unwrapObjectLiteral(expression: ts.Expression, sourceFile?: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return unwrapObjectLiteral(expression.expression, sourceFile);
  }
  if (
    ts.isCallExpression(expression) && expression.expression.getText() === "Object.freeze" &&
    expression.arguments.length === 1
  ) {
    return unwrapObjectLiteral(expression.arguments[0]!, sourceFile);
  }
  if (ts.isIdentifier(expression) && sourceFile !== undefined) {
    const initializer = resolveIdentifierInitializer(sourceFile, expression.text);
    return initializer === undefined ? undefined : unwrapObjectLiteral(initializer, sourceFile);
  }
  return undefined;
}

function findOptionSchema(sourceFile: ts.SourceFile, schemaName: string): ts.ObjectLiteralExpression {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.name.getText() === schemaName && node.initializer) {
      found = unwrapObjectLiteral(node.initializer, sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`CLI option schema ${schemaName} not found in ${sourceFile.fileName}`);
  return found;
}

function propertyValue(objectLiteral: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = objectLiteral.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && candidate.name.getText() === name,
  );
  return property !== undefined && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function stringLiteral(expression: ts.Expression | undefined): string | undefined {
  if (expression !== undefined && (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression))) {
    return stringLiteral(expression.expression);
  }
  return expression !== undefined && ts.isStringLiteral(expression) ? expression.text : undefined;
}

function booleanLiteral(expression: ts.Expression | undefined): boolean | undefined {
  if (expression !== undefined && (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression))) {
    return booleanLiteral(expression.expression);
  }
  if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function arrayStringLiterals(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): readonly string[] | undefined {
  if (expression === undefined) return undefined;
  const array = unwrapArrayLiteral(expression, sourceFile);
  if (array === undefined) return undefined;
  const values = array.elements.map((element) => ts.isStringLiteral(element) ? element.text : undefined);
  return values.every((value): value is string => value !== undefined) ? Object.freeze(values) : undefined;
}

function unwrapArrayLiteral(expression: ts.Expression, sourceFile?: ts.SourceFile): ts.ArrayLiteralExpression | undefined {
  if (ts.isArrayLiteralExpression(expression)) return expression;
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return unwrapArrayLiteral(expression.expression, sourceFile);
  }
  if (ts.isCallExpression(expression) && expression.expression.getText() === "Object.freeze" && expression.arguments.length === 1) {
    return unwrapArrayLiteral(expression.arguments[0]!, sourceFile);
  }
  if (ts.isIdentifier(expression) && sourceFile !== undefined) {
    const initializer = resolveIdentifierInitializer(sourceFile, expression.text);
    return initializer === undefined ? undefined : unwrapArrayLiteral(initializer, sourceFile);
  }
  return undefined;
}

function optionalValueFromObject(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): CliOptionalValue | undefined {
  if (expression === undefined) return undefined;
  const object = unwrapObjectLiteral(expression, sourceFile);
  if (object === undefined) return undefined;
  const defaultValue = stringLiteral(propertyValue(object, "default"));
  const booleanDefault = booleanLiteral(propertyValue(object, "default"));
  const values = arrayStringLiterals(propertyValue(object, "values"), sourceFile);
  if (defaultValue === undefined && booleanDefault !== true) return undefined;
  return Object.freeze({
    default: defaultValue ?? true,
    ...(values === undefined ? {} : { values }),
    separated: booleanLiteral(propertyValue(object, "separated")) === true,
  });
}

function helpSummary(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): string | undefined {
  const object = expression === undefined ? undefined : unwrapObjectLiteral(expression, sourceFile);
  if (object !== undefined) return stringLiteral(propertyValue(object, "summary"));
  if (
    expression !== undefined &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "help"
  ) {
    return stringLiteral(expression.arguments[0]);
  }
  return undefined;
}

function flagFromHelperCall(
  expression: ts.CallExpression,
  key: string,
  sourceFile: ts.SourceFile,
): FlagEntry | undefined {
  if (!ts.isIdentifier(expression.expression)) return undefined;
  if (expression.expression.text === "option") {
    const object = unwrapObjectLiteral(expression.arguments[0]!, sourceFile);
    if (object !== undefined) return flagFromOptionObject(object, key, sourceFile);
    const type = stringLiteral(expression.arguments[0]);
    const doc = stringLiteral(expression.arguments[1]);
    if ((type !== "string" && type !== "boolean") || doc === undefined) return undefined;
    return {
      key,
      type,
      multiple: booleanLiteral(expression.arguments[2]) === true,
      visible: true,
      doc,
    };
  }
  if (expression.expression.text === "optionalTier") {
    const doc = stringLiteral(expression.arguments[0]);
    const defaultValue = stringLiteral(expression.arguments[1]);
    const values = arrayStringLiterals(expression.arguments[2], sourceFile);
    if (doc === undefined || defaultValue === undefined || values === undefined) return undefined;
    return {
      key,
      type: "boolean",
      multiple: false,
      optionalValue: Object.freeze({
        default: defaultValue,
        values,
        separated: booleanLiteral(expression.arguments[3]) === true,
      }),
      visible: true,
      doc,
    };
  }
  return undefined;
}

function flagFromOptionObject(
  value: ts.ObjectLiteralExpression,
  key: string,
  sourceFile: ts.SourceFile,
): FlagEntry | undefined {
  const type = stringLiteral(propertyValue(value, "type"));
  if (type !== "string" && type !== "boolean") return undefined;
  const short = stringLiteral(propertyValue(value, "short"));
  const help = propertyValue(value, "help");
  const helpObject = help === undefined ? undefined : unwrapObjectLiteral(help, sourceFile);
  const visibility = helpObject === undefined ? undefined : stringLiteral(propertyValue(helpObject, "visibility"));
  const optionalValue = optionalValueFromObject(propertyValue(value, "optionalValue"), sourceFile);
  return {
    key,
    type,
    multiple: booleanLiteral(propertyValue(value, "multiple")) === true,
    ...(short === undefined ? {} : { short }),
    ...(optionalValue === undefined ? {} : { optionalValue }),
    visible: visibility !== "hidden",
    doc: helpSummary(help, sourceFile),
  };
}

/** Statically parse an owner schema without importing or executing any CLI module. */
function extractFlagOptions(sourceText: string, fileName: string, schemaName: string): FlagEntry[] {
  const sourceFile = parse(sourceText, fileName);
  const objectLiteral = findOptionSchema(sourceFile, schemaName);

  const entries: FlagEntry[] = [];
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText();
    const value = unwrapObjectLiteral(prop.initializer, sourceFile);
    const entry = value === undefined
      ? ts.isCallExpression(prop.initializer) ? flagFromHelperCall(prop.initializer, key, sourceFile) : undefined
      : flagFromOptionObject(value, key, sourceFile);
    if (entry !== undefined) entries.push({ ...entry, doc: entry.doc ?? extractDoc(sourceFile, prop) });
  }
  return entries;
}

/**
 * 数字型 flag（源码里经 `numberFlag(value, "--<name>")` 校验）的 key 集合。
 * schema 本身只区分 string/boolean（parseArgs 层面）；真实语义类型取决于 owner 如何校验值。
 */
function extractNumberFlagKeys(sourceText: string, fileName: string): Set<string> {
  const sourceFile = parse(sourceText, fileName);
  const keys = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "numberFlag" &&
      node.arguments.some(ts.isStringLiteral)
    ) {
      for (const argument of node.arguments) {
        if (ts.isStringLiteral(argument) && argument.text.startsWith("--")) keys.add(argument.text.slice(2));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

interface CliFlagRow {
  flags: string[]; // 一或两个 `--x` 形式,负向 flag 配对显示在同一行
  type: string;
  description: string;
  commands: string[];
}

/** CLI terminal help is English; these Docker-only public rows are Chinese in the zh reference. */
const CHINESE_CLI_REFERENCE_SUMMARIES: Readonly<Record<string, string>> = Object.freeze({
  tag: "只选择带有该 tag 的评估用例。",
  attempts: "让每个选中的评估用例运行指定次数。",
  "max-concurrency": "限制同时执行的 Attempt 数量。",
  "max-build-concurrency": "限制同时准备 Sandbox build 的数量。",
  timeout: "以毫秒设置每个 Attempt 的超时时间。",
  budget: "以美元设置本次 Invocation 的预算。",
  junit: "写出必需的 JUnit 报告。",
  json: "写出该命令的机器文档或事件流。",
  dry: "规划但不创建 Invocation。",
  rerun: "要求重新运行失败目标或全部目标。",
  "keep-sandbox": "保留 failed 或全部已结束 Attempt 的 Sandbox。",
  "early-exit": "某次结果通过后停止该评估用例余下的 Attempt。",
  record: "使用指定的 NiceEval Record root。",
  teardown: "运行显式的 Experiment teardown 恢复。",
  "recover-shared-state": "指定要显式恢复的共享状态 key。",
  "owner-token": "提供准确的共享状态 owner token。",
  "confirm-owner-terminated": "确认记录的 owner 已终止。",
  "confirm-remote-quiesced": "确认远端共享状态已静止。",
  all: "包含已经完成的 Invocation 状态条目。",
  run: "选择一个已发布的精确 Run；可重复传入以选择多个 Run。",
  experiment: "按 Experiment selector 缩小当前项目的结果。",
  report: "使用标准 Report 或可信的 Report module 路径。",
  theme: "使用 basalt、chalk 或可信的 Theme module 路径。",
  page: "选择 show 的目标或 view 的初始路由。",
  source: "显示一个 Attempt 的源快照；可选地只显示一个文件。",
  execution: "显示一个 Attempt 保留的执行证据。",
  timing: "显示摘要或完整的时序证据。",
  grep: "用 JavaScript 正则表达式过滤执行证据。",
  diff: "显示选中 Attempt 的文件改动；可选地只显示一个内联路径。",
  out: "导出完整的静态 Report 站点。",
  host: "监听指定地址；裸写 `--host` 会监听 0.0.0.0。",
  port: "监听指定端口；默认选择可用端口。",
  open: "在浏览器中打开实时 Report。",
  help: "打印该命令的帮助。",
  version: "打印当前安装的 NiceEval 版本。",
  yes: "确认计划中的 Record maintenance 操作。",
  smoke: "运行 Docker profile 的探测诊断。",
  domain: "选择一个由 NiceEval 管理的 Docker 缓存域。",
  apply: "应用先前签发的 Docker 缓存回收计划。",
  window: "选择一个已记录的改动窗口。",
  path: "选择 Sandbox diff 中的一个路径。",
  "leave-running": "离开 shell 后继续保留 Sandbox。",
  orphans: "检查已终止运行遗留的未登记 Sandbox 实例。",
  force: "同时清理未验证的孤儿候选项。",
  "src/cli/program.ts#APPLICATION_CLI_OPTIONS#help": "打印根命令索引。",
  "src/sandbox/cli/contribution.ts#SANDBOX_CLI_OPTIONS#all": "销毁全部留存 Sandbox。",
  "src/experiment/host/cli/contribution.ts#EXP_RENAME_CLI_OPTIONS#dry": "预览显式 Experiment 重命名。",
});

interface CliOptionSchemaSource {
  readonly source: (typeof SOURCE_FILES)[number];
  readonly schema: string;
  /** Commands that own this schema; shared options list every applicable command. */
  readonly commands: readonly string[];
}

/** Static composition descriptors: generator never imports or executes the CLI. */
const CLI_OPTION_SCHEMA_SOURCES = [
  { source: "src/cli/program.ts", schema: "APPLICATION_CLI_OPTIONS", commands: [""] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "CHECK_CLI_OPTIONS", commands: ["check"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "EXP_NORMAL_CLI_OPTIONS", commands: ["exp"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "EXP_LIST_CLI_OPTIONS", commands: ["exp list"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "EXP_RENAME_CLI_OPTIONS", commands: ["exp rename"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "EXP_TEARDOWN_CLI_OPTIONS", commands: ["exp --teardown"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "DEBUG_CLI_OPTIONS", commands: ["debug"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "ACCEPT_CLI_OPTIONS", commands: ["accept"] },
  { source: "src/experiment/host/cli/contribution.ts", schema: "SESSION_CLI_OPTIONS", commands: ["session"] },
  { source: "src/report/cli/contribution.ts", schema: "REPORT_CLI_OPTIONS", commands: ["show", "view"] },
  { source: "src/record/host/cli/contribution.ts", schema: "RECORD_MAINTENANCE_CLI_OPTIONS", commands: ["clean", "migrate"] },
  { source: "src/project/cli/contribution.ts", schema: "PROJECT_INIT_CLI_OPTIONS", commands: ["init"] },
  { source: "src/docker/cli/contribution.ts", schema: "DOCKER_OPTIONS", commands: ["docker"] },
  { source: "src/sandbox/cli/contribution.ts", schema: "SANDBOX_CLI_OPTIONS", commands: ["sandbox"] },
  { source: "src/eval/cli/contribution.ts", schema: "EVAL_CATALOG_OPTIONS", commands: ["list"] },
] as const satisfies readonly CliOptionSchemaSource[];

/**
 * Parser schemas remain the only source of parser shapes and summaries. These
 * descriptors only record command-family routing already enforced by owners.
 */
const CLI_OPTION_COMMAND_OWNERSHIP: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  "src/report/cli/contribution.ts#REPORT_CLI_OPTIONS": Object.freeze({
    source: Object.freeze(["show"]),
    execution: Object.freeze(["show"]),
    timing: Object.freeze(["show"]),
    grep: Object.freeze(["show"]),
    diff: Object.freeze(["show"]),
    json: Object.freeze(["show"]),
    out: Object.freeze(["view"]),
    host: Object.freeze(["view"]),
    port: Object.freeze(["view"]),
    open: Object.freeze(["view"]),
    "no-open": Object.freeze(["view"]),
  }),
  "src/sandbox/cli/contribution.ts#SANDBOX_CLI_OPTIONS": Object.freeze({
    all: Object.freeze(["sandbox stop"]),
    window: Object.freeze(["sandbox diff"]),
    path: Object.freeze(["sandbox diff"]),
    "leave-running": Object.freeze(["sandbox enter"]),
    record: Object.freeze(["sandbox list", "sandbox enter", "sandbox history", "sandbox diff", "sandbox stop", "sandbox prune"]),
    orphans: Object.freeze(["sandbox list"]),
    force: Object.freeze(["sandbox prune"]),
  }),
  "src/docker/cli/contribution.ts#DOCKER_OPTIONS": Object.freeze({
    json: Object.freeze(["docker profile list", "docker profile doctor", "docker cache inventory", "docker cache gc"]),
    smoke: Object.freeze(["docker profile doctor"]),
    domain: Object.freeze(["docker cache inventory", "docker cache gc"]),
    apply: Object.freeze(["docker cache gc"]),
  }),
});

function commandsForSchemaOption(
  source: CliOptionSchemaSource["source"],
  schema: string,
  key: string,
  commands: readonly string[],
): string[] {
  return [...(CLI_OPTION_COMMAND_OWNERSHIP[`${source}#${schema}`]?.[key] ?? commands)];
}

interface CollectedCliFlag extends FlagEntry {
  commands: string[];
  readonly number: boolean;
  readonly source: CliOptionSchemaSource["source"];
  readonly schema: string;
  /** The source help summary is grouping identity, before zh-reference rendering. */
  readonly summary: string;
}

function optionalValueShape(entry: FlagEntry): string {
  const optional = entry.optionalValue;
  return optional === undefined
    ? "none"
    : JSON.stringify({ default: optional.default, values: optional.values, separated: optional.separated });
}

function renderedOptionType(entry: CollectedCliFlag): string {
  if (entry.optionalValue !== undefined) {
    const values = entry.optionalValue.values;
    if (entry.optionalValue.default !== true) {
      return values === undefined ? "string" : values.map((value) => `\`${value}\``).join(" | ");
    }
    return values === undefined ? "true | string" : `true | ${values.map((value) => `\`${value}\``).join(" | ")}`;
  }
  if (entry.number) return "number";
  if (entry.type === "boolean") return "boolean";
  return entry.multiple ? "string[]" : "string";
}

function renderedFlagSyntax(entry: CollectedCliFlag): string {
  const flag = `--${entry.key}`;
  const optional = entry.optionalValue;
  if (optional === undefined) return `\`${flag}\``;
  const value = optional.values === undefined ? "<value>" : optional.values.join("|");
  const bare = optional.default === true ? `\`${flag}\`` : `\`${flag}\`（单独使用为 \`${optional.default}\`）`;
  const inline = `\`${flag}=${value}\``;
  const separated = `\`${flag} ${value}\``;
  return optional.separated ? `${bare} / ${inline} / ${separated}` : `${bare} / ${inline}`;
}

function referenceSummary(entry: CollectedCliFlag): string {
  return CHINESE_CLI_REFERENCE_SUMMARIES[`${entry.source}#${entry.schema}#${entry.key}`]
    ?? CHINESE_CLI_REFERENCE_SUMMARIES[entry.key]
    ?? entry.summary;
}

function buildCliFlagRows(sources: SourceMap): CliFlagRow[] {
  const entries = CLI_OPTION_SCHEMA_SOURCES.flatMap(({ source, schema, commands }) => {
    const numberKeys = extractNumberFlagKeys(sources[source], source);
    return extractFlagOptions(sources[source], source, schema).map((entry): CollectedCliFlag => {
      if (entry.doc === undefined) {
        throw new Error(`flag --${entry.key} has no public summary in ${source}#${schema}`);
      }
      return {
        ...entry,
        commands: commandsForSchemaOption(source, schema, entry.key, commands),
        number: numberKeys.has(entry.key),
        source,
        schema,
        summary: entry.doc,
      };
    });
  });

  // 负向 flag(no-early-exit / no-open)与正向 flag 合并成一行,不单独成表项。
  const negatedOf = new Map<string, string>(); // "no-early-exit" -> "early-exit"
  for (const e of entries) {
    if (e.key.startsWith("no-")) negatedOf.set(e.key, e.key.slice("no-".length));
  }

  const seen = new Map<string, CollectedCliFlag>();
  for (const e of entries) {
    const groupKey = JSON.stringify({
      key: e.key,
      type: e.type,
      multiple: e.multiple,
      short: e.short,
      number: e.number,
      optionalValue: optionalValueShape(e),
      summary: e.summary,
    });
    const previous = seen.get(groupKey);
    if (previous !== undefined) {
      previous.commands = [...new Set([...previous.commands, ...e.commands])];
      continue;
    }
    seen.set(groupKey, e);
  }

  const rows: CliFlagRow[] = [];
  for (const e of seen.values()) {
    if (negatedOf.has(e.key)) continue; // 作为配对项在正向 flag 那里一起渲染
    if (!e.visible) continue;
    const flags = [renderedFlagSyntax(e)];
    const negKey = `no-${e.key}`;
    if (entries.some((x) => x.key === negKey && x.commands.some((command) => e.commands.includes(command)))) flags.push(`\`--${negKey}\``);
    rows.push({ flags, type: renderedOptionType(e), description: referenceSummary(e), commands: [...e.commands] });
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
    segments[i] = segments[i]!
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
  const header = "| Flag | 命令 | 类型 | 说明 |\n|---|---|---|---|";
  const lines = rows.map((r) => {
    const flagCell = r.flags.join(" / ").replace(/\|/g, "\\|");
    const commandCell = r.commands.map((command) => `\`niceeval${command === "" ? "" : ` ${command}`}\``).join("、");
    return `| ${flagCell} | ${commandCell} | ${r.type.replace(/\|/g, "\\|")} | ${escapeMdxProse(r.description).replace(/\|/g, "\\|")} |`;
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
  "src/cli/program.ts",
  "src/experiment/host/cli/contribution.ts",
  "src/report/cli/contribution.ts",
  "src/record/host/cli/contribution.ts",
  "src/project/cli/contribution.ts",
  "src/docker/cli/contribution.ts",
  "src/sandbox/cli/contribution.ts",
  "src/eval/cli/contribution.ts",
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
      return renderCliFlagsTable(buildCliFlagRows(sources));
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
  "{/* 本区块由 pnpm docs:reference 从源码注释生成,勿手改;要改文案,改对应源码的 TSDoc/JSDoc(映射见 packages/repo-tools/src/docs/reference-compiler.ts) */}";

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
// 同一个构建产物模型。树的文案从 apps/docs-site/zh 各页 frontmatter title/description 来,
// 文案单源在页面自己身上；bundled index 与公开 reference 是两个独立 owner。

const BUNDLED_DOCS_ROOT = "docs-site";

/** 包根 INDEX.md 里生成树的 region id;Markdown 文件用 HTML 注释标记(见 replaceMdRegion)。 */
export const BUNDLED_INDEX_REGION = "bundled-docs-tree";

/** 一个随包正文页:路径相对 package 根(如 `docs-site/zh/tutorials/fixtures.mdx`)+ 文件内容。 */
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
  const line = fm?.[1]?.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1]?.trim();
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
    const rel = page.path.replace(new RegExp(`^${BUNDLED_DOCS_ROOT}/zh/`), "");
    const dir = rel.includes("/") ? rel.split("/")[0]! : ".";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(page);
  }
  const known = ZH_DIR_ORDER.filter((d) => groups.has(d));
  const rest = [...groups.keys()].filter((d) => !ZH_DIR_ORDER.includes(d)).sort();
  return [...known, ...rest]
    .map((dir) => {
      const heading = dir === "." ? `## \`${BUNDLED_DOCS_ROOT}/zh/\`` : `## \`${BUNDLED_DOCS_ROOT}/zh/${dir}/\``;
      const rows = groups
        .get(dir)!
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((p) => `- \`${p.path}\` — ${frontmatterField(p, "title")}:${frontmatterField(p, "description")}`);
      return [heading, "", ...rows].join("\n");
    })
    .join("\n\n");
}

const BUNDLED_INDEX_PROVENANCE =
  "<!-- 本文件是构建产物(pnpm run build:index),勿手改:树区文案改对应页面的 frontmatter title/description,导语改 INDEX.template.md(生成逻辑见 packages/repo-tools/src/docs/reference-compiler.ts) -->";

/** 纯函数:把文档树填进模板(INDEX.template.md 内容)的区块,返回完整 INDEX.md 内容。不接触文件系统。 */
export function regenerateBundledIndex(templateContent: string, pages: ZhPage[]): string {
  const body = `${BUNDLED_INDEX_PROVENANCE}\n\n${renderBundledIndexTree(pages)}`;
  return replaceMdRegion(templateContent, BUNDLED_INDEX_REGION, body);
}
