// 参考文档生成器:从源码(TypeScript compiler API 静态分析)提取接口成员 / 导出函数 /
// 联合类型变体 / CLI flag 表,渲染成 Markdown,写回 docs-site/zh/reference/*.mdx 的
// `{/* GENERATED:BEGIN <region-id> */}...{/* GENERATED:END <region-id> */}` 标记区块。
//
// 设计:提取 + 渲染 + 区块替换是纯函数(输入文件内容字符串,输出新内容字符串),
// 不碰文件系统 —— 这样 test/reference-consistency.test.ts 能在内存里复用同一套逻辑
// 做漂移检测。CLI 入口(main())只负责读写文件。
//
// 不新增依赖:只用仓库已有的 devDependencies 里的 `typescript` 包的 compiler API。
// 注意 `typescript` 是 npm alias → @typescript/typescript6(TS7 原生版不提供编程 API,
// API 消费者按官方配方留在 6.x;`tsc` 二进制来自 @typescript/native → typescript@7)。

import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ───────────────────────── 基础类型 ─────────────────────────

/** 一个可渲染的成员:函数 / 接口字段 / 联合类型变体 / CLI flag。 */
export interface Member {
  /** 展示名,如 `includes`、`gate`、`message`、`--runs`。 */
  name: string;
  /** ts 代码块里原样展示的签名。 */
  signature: string;
  /** 紧跟的描述段落(已清理,未做 MDX 转义)。没有则省略。 */
  doc?: string;
}

/** 一组成员,可选带一个小节标题(用于一个 region 里合并多个接口,如 RemoteAgentDef/SandboxAgentDef/AgentContext)。 */
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
  if (!ts.isUnionTypeNode(alias.type)) {
    throw new Error(`type alias ${typeName} in ${fileName} is not a union type`);
  }
  return alias.type.types.map((variant) => {
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
  short?: string;
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
    let short: string | undefined;
    for (const p of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pname = p.name.getText();
      if (pname === "type" && ts.isStringLiteral(p.initializer)) {
        type = p.initializer.text as "string" | "boolean";
      }
      if (pname === "short" && ts.isStringLiteral(p.initializer)) {
        short = p.initializer.text;
      }
    }
    if (type) entries.push({ key, type, short });
  }
  return entries;
}

/** 容忍性 no-op flag(文档曾接受但未实现)和已移除的 flag,不出现在生成的参考页里(叙事部分已说明)。 */
const CLI_FLAG_EXCLUDE = new Set(["watch", "json", "sandbox"]);

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

/**
 * flag 中文说明。FLAG_OPTIONS/Flags 接口本身没有逐 flag 的 TSDoc,src/i18n/zh-CN.ts 里也只有
 * `cli.help` 一整块拼接文案(而非逐 flag 的结构化 key)—— 两处都不能机器逐条提取。这里维护一份
 * 显式表,取自当前文档已核实过的说明;新增/改名 flag 时若表里缺失,generateCliFlagsRegion 会
 * 直接报错提示补充,而不是静默漏项,保留漂移守护的意义。
 */
const FLAG_DESCRIPTIONS: Record<string, string> = {
  agent: "experiment 运行不支持该 flag。要换 agent,请在 `experiments/` 下新增或复制一个配置文件。",
  model: "experiment 运行不支持该 flag。要换模型,请新增或复制一个 experiment 文件并修改 `model`。",
  runs: "每个 eval 运行多少次,常用于 pass@N。",
  "max-concurrency": "设置同时运行的 eval 数量。",
  timeout: "单个 attempt 的超时时间,单位毫秒。",
  budget: "整次运行的预算上限(美元)。",
  tag: "只运行带有该 tag 的 eval(见 `defineEval` 的 `tags`)。",
  junit: "额外写一份 JUnit XML 报告到指定路径,供 CI 消费。",
  out: "`view` 命令专用:把结果查看器静态导出到指定目录。",
  port: "`view` 命令专用:指定本地服务器监听端口。",
  dry: "只打印本次会匹配到的 eval × 运行配置,不实际执行。",
  quiet: "关闭控制台 / live 进度输出(reporter 仍会写 artifacts)。",
  force: "忽略上次运行结果,不跳过已通过的 (experiment, eval) 组合,强制全部重跑。",
  strict: "CI 中推荐使用:让软阈值(`soft`)失败也计入整条 eval 的 outcome。",
  "early-exit": "某个 eval 的一次 attempt 通过后,停止该 eval 剩余的 attempts。",
  "no-early-exit": "关闭 `--early-exit`,即使已有 attempt 通过也跑完全部 runs。",
  open: "`view` 命令专用:启动后自动打开浏览器(默认行为)。",
  "no-open": "`view` 命令专用:启动后不自动打开浏览器。",
  transcript: "`show` 命令专用:渲染单个 eval 的完整对话与工具调用(证据切面)。",
  trace: "`show` 命令专用:渲染单个 eval 的 trace 瀑布文本版(证据切面)。",
  diff: "`show` 命令专用:sandbox 里的文件改动摘要;`--diff=<文件路径>` 看单个文件的完整改动(路径必须 `=` 连写)。",
  history: "`show` 命令专用:跨 run 时间轴,只列真实执行;与 `--report` 互斥。",
  experiment: "`show` 命令专用:选集只留该实验。",
  attempt: "`show` 命令专用:指定详情 / 证据切面看第几次 attempt(与展示一致的 1 计序号)。",
  run: "`show` 命令专用:钉死看某一个结果目录(历史 run 或 `copySnapshots` 产物)。",
  report: "`show` 命令专用:把默认榜单整槽换成你的报告文件(默认导出 `defineReport(...)`)。",
  help: "打印用法说明并退出。",
  version: "打印 niceeval 的版本号并退出。",
};

interface CliFlagRow {
  flags: string[]; // 一或两个 `--x` 形式,负向 flag 配对显示在同一行
  type: "string" | "number" | "boolean";
  description: string;
}

function buildCliFlagRows(sourceText: string, fileName: string): CliFlagRow[] {
  const entries = extractFlagOptions(sourceText, fileName).filter((e) => !CLI_FLAG_EXCLUDE.has(e.key));
  const numberKeys = extractNumberFlagKeys(sourceText, fileName);

  // 负向 flag(no-early-exit / no-open)与正向 flag 合并成一行,不单独成表项。
  const negatedOf = new Map<string, string>(); // "no-early-exit" -> "early-exit"
  for (const e of entries) {
    if (e.key.startsWith("no-")) negatedOf.set(e.key, e.key.slice("no-".length));
  }

  const rows: CliFlagRow[] = [];
  for (const e of entries) {
    if (negatedOf.has(e.key)) continue; // 作为配对项在正向 flag 那里一起渲染
    const desc = FLAG_DESCRIPTIONS[e.key];
    if (desc === undefined) {
      throw new Error(
        `flag --${e.key} has no description; add it to FLAG_DESCRIPTIONS in scripts/generate-reference.ts, then rerun pnpm docs:reference.`,
      );
    }
    const flags = [`--${e.key}`];
    const negKey = `no-${e.key}`;
    if (entries.some((x) => x.key === negKey)) flags.push(`--${negKey}`);
    const type: CliFlagRow["type"] = numberKeys.has(e.key) ? "number" : e.type === "boolean" ? "boolean" : "string";
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

/** 渲染多个具名分组(如 agent-def region 里的 RemoteAgentDef / SandboxAgentDef / AgentContext)。 */
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
  const begin = `{/* GENERATED:BEGIN ${regionId} */}`;
  const end = `{/* GENERATED:END ${regionId} */}`;
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
  "src/scoring/types.ts",
  "src/runner/types.ts",
  "src/context/types.ts",
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

function computeRegionBody(regionId: string, sources: SourceMap): string {
  switch (regionId) {
    case "expect-matchers":
      return renderMemberList(extractExportedFunctions(sources["src/expect/index.ts"], "src/expect/index.ts"));
    case "value-assertion":
      return renderMemberList(
        extractInterfaceMembers(sources["src/scoring/types.ts"], "src/scoring/types.ts", "ValueAssertion"),
      );
    case "defineeval-options":
      return renderMemberList(
        extractInterfaceMembers(sources["src/runner/types.ts"], "src/runner/types.ts", "EvalDef"),
      );
    case "test-context":
      return renderMemberList(
        extractInterfaceMembers(sources["src/context/types.ts"], "src/context/types.ts", "TestContext"),
      );
    case "turn-handle":
      return renderMemberList(
        extractInterfaceMembers(sources["src/context/types.ts"], "src/context/types.ts", "TurnHandle"),
      );
    case "config-fields":
      return renderMemberList(
        extractInterfaceMembers(sources["src/runner/types.ts"], "src/runner/types.ts", "Config"),
      );
    case "agent-def":
      return renderMemberGroups([
        {
          heading: "RemoteAgentDef",
          members: extractInterfaceMembers(sources["src/agents/types.ts"], "src/agents/types.ts", "RemoteAgentDef"),
        },
        {
          heading: "SandboxAgentDef",
          members: extractInterfaceMembers(sources["src/agents/types.ts"], "src/agents/types.ts", "SandboxAgentDef"),
        },
        {
          heading: "AgentContext",
          members: extractInterfaceMembers(sources["src/agents/types.ts"], "src/agents/types.ts", "AgentContext"),
        },
      ]);
    case "sandbox-methods":
      return renderMemberGroups([
        {
          heading: "Sandbox",
          members: extractInterfaceMembers(sources["src/sandbox/types.ts"], "src/sandbox/types.ts", "Sandbox"),
        },
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

/**
 * 纯函数:给定一个 reference mdx 文件当前内容 + 全部源文件内容,重新计算它全部 region 的内容
 * 并写回对应标记区块,返回新的文件内容。不接触文件系统。
 */
export function regenerateReferenceDoc(file: string, mdxContent: string, sources: SourceMap): string {
  const entry = REFERENCE_FILES.find((f) => f.file === file);
  if (!entry) throw new Error(`${file} is not a registered reference doc`);
  let content = mdxContent;
  for (const regionId of entry.regions) {
    const body = computeRegionBody(regionId, sources);
    content = replaceRegion(content, regionId, body);
  }
  return content;
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

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (isMain) main();
